// 整列アルゴリズム「sugiyama-ext」（方針E: スギヤマフレームワーク拡張）。
// 「親ノードの右ハンドルに繋いだ子は右方向の階層に、上/下ハンドルに繋いだ子は親に少し被る形で
// 上/下に」配置する、方向混在の階層レイアウト。ELKは1実行=1方向・整数レイヤーしか扱えず、
// 「半レイヤーぶんの重なり配置」を表現できないため、スギヤマの4フェーズを自前実装する
// （ELK非依存・同期処理）。設計の詳細・検討経緯はdocs/align-branch-layout.md「方針E」を参照。
//
// 右向き(RIGHT)レイアウトを基準に説明する。下向き(DOWN)は primary/cross 軸を入れ替えるだけで
// 自然に90度回転して適用される（下記 primarySize/crossSize/currentCenterPC/centerPCtoTopLeft が吸収）。
//
// スギヤマの4フェーズとの対応:
//   1. 循環除去   : BFS全域木を作りDAG化（branch方針と同じ。循環/複数親エッジは位置計算から除外）
//   2. レイヤー割当: ハンドルの役割で親からのオフセットを変える。forward(右)=+1層ぶん前進、
//                    cross(上/下)=約0.5層ぶんだけ前進させて親に被せる、backward(左)=-1層ぶん後退
//   3. 交差削減   : 同レイヤー内の順序は「ハンドルの役割でグループ分け」＋「Align実行時点の現在位置順」で
//                    初期化し、forward群は子孫のバリセンタで並べ替えて2層間の交差を減らす
//   4. 座標割当   : cross(上/下)群は親のprimary帯に被せて上/下に積む。forward群は従来通り前方に配置
import { MapNode, MapEdge, LayoutDirection } from '../types';
import { LayoutResult } from './layout';
import { classifyEdgeSide, HandleSide } from './branchLayout';

const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 60;

// --- チューニング定数（意味・調整箇所は docs/tuning.md「整列アルゴリズムのdev限定切り替え」参照）---
const PRIMARY_GAP = 60; // 層と層の間隔（primary方向、px）。ELKの nodeNodeBetweenLayers=80 に合わせている
const CROSS_GAP = 10; // 積み重ねる兄弟の間隔（cross方向、px）。ELKの nodeNode=50 に合わせている
const SIBLING_GAP = 8; // forward/backward群の兄弟サブツリー間の間隔（cross方向、px）
// cross(上/下)の子を親のprimary帯にどれだけ被せるか。子サブツリーの後端を
// 「親の後端(-W/2)から primary幅×この比率だけ前方」に合わせる。0=全被り、0.5=前半分に被る、1=被らない
const CROSS_OVERLAP_RATIO = 0.8;
// 複数ツリー（複数root）の外接矩形が重なる場合に空けるツリー間の最小マージン（px）
const TREE_MARGIN = 40;
// ツリー分離（押し離し）反復の上限。通常は数回で収束する
const TREE_SEPARATION_MAX_ITER = 200;

// ハンドルの役割。レイアウト方向を基準にした相対的な向き
//   forward  : 流れ方向（RIGHT:右 / DOWN:下）。従来の階層と同じく+1層ぶん前進
//   backward : 流れの逆（RIGHT:左 / DOWN:上）。-1層ぶん後退
//   crossNeg : 流れに直交する負側（RIGHT:上 / DOWN:左）
//   crossPos : 流れに直交する正側（RIGHT:下 / DOWN:右）
type Role = 'forward' | 'backward' | 'crossNeg' | 'crossPos';

function handleRole(side: HandleSide, direction: LayoutDirection): Role {
  if (direction === 'RIGHT') {
    switch (side) {
      case 'right':
        return 'forward';
      case 'left':
        return 'backward';
      case 'top':
        return 'crossNeg';
      case 'bottom':
        return 'crossPos';
    }
  }
  // DOWN
  switch (side) {
    case 'bottom':
      return 'forward';
    case 'top':
      return 'backward';
    case 'left':
      return 'crossNeg';
    case 'right':
      return 'crossPos';
  }
}

// primary=流れ方向のサイズ、cross=直交方向のサイズ
function primarySize(node: MapNode, direction: LayoutDirection): number {
  return direction === 'RIGHT' ? node.width || DEFAULT_NODE_WIDTH : node.height || DEFAULT_NODE_HEIGHT;
}
function crossSize(node: MapNode, direction: LayoutDirection): number {
  return direction === 'RIGHT' ? node.height || DEFAULT_NODE_HEIGHT : node.width || DEFAULT_NODE_WIDTH;
}

// ノードの現在位置(top-left)を、中心の (primary, cross) 座標へ変換する
function currentCenterPC(node: MapNode, direction: LayoutDirection): { p: number; c: number } {
  const w = node.width || DEFAULT_NODE_WIDTH;
  const h = node.height || DEFAULT_NODE_HEIGHT;
  if (direction === 'RIGHT') {
    return { p: node.position.x + w / 2, c: node.position.y + h / 2 };
  }
  return { p: node.position.y + h / 2, c: node.position.x + w / 2 };
}

// 中心の (primary, cross) 座標を、ノードの位置(top-left)へ戻す
function centerPCtoTopLeft(p: number, c: number, node: MapNode, direction: LayoutDirection): { x: number; y: number } {
  const w = node.width || DEFAULT_NODE_WIDTH;
  const h = node.height || DEFAULT_NODE_HEIGHT;
  if (direction === 'RIGHT') {
    return { x: p - w / 2, y: c - h / 2 };
  }
  return { x: c - w / 2, y: p - h / 2 };
}

// ノードの現在のcross座標（並び順の初期化に使う）
function currentCross(node: MapNode, direction: LayoutDirection): number {
  return currentCenterPC(node, direction).c;
}

// レイヤ役割のオフセット（＝そのエッジを辿ったときのレイヤ深さの増分）。
// forward=+1層、cross(上/下)=+0.5層、backward=-1層。「候補レイヤが複数あるとき深いものを採用」は、
// このオフセットで重み付けしたロンゲストパスを採ることで実現する
function roleDelta(role: Role): number {
  switch (role) {
    case 'forward':
      return 1;
    case 'backward':
      return -1;
    case 'crossNeg':
    case 'crossPos':
      return 0.5;
  }
}

/**
 * レイヤ割当つきの全域木（森）を構築する。
 * 1. DFSで後退辺（back edge）を除いてDAG化する（循環除去。除いた辺＝循環・複数親の非採用側は
 *    描画のみで位置計算に使わない）。
 * 2. DAG上でロンゲストパス（roleDeltaで重み付けした最深レイヤ）を計算し、各ノードの主たる親を
 *    「そのノードのレイヤを最も深くする入辺」に選ぶ。これにより A1→B1→C1→D1 と A1→B2→D1 では、
 *    D1 は（浅い）B2 ではなく（深い）C1 の子として配置される（docs/align-branch-layout.md 方針E参照）。
 * 決定的（ノード配列順・エッジ配列順のみに依存）。
 */
function buildLayeredForest(
  nodes: MapNode[],
  edges: MapEdge[],
  direction: LayoutDirection
): { rootIds: string[]; treeChildren: Map<string, MapEdge[]> } {
  const nodeIds = new Set(nodes.map((n) => n.id));

  // 出辺隣接リスト（エッジ配列順を保持）と入次数
  const outgoing = new Map<string, MapEdge[]>();
  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source)!.push(edge);
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
  }

  // --- 1. DFSで後退辺を除きDAG化 ---
  const color = new Map<string, 'white' | 'gray' | 'black'>(nodes.map((n) => [n.id, 'white']));
  const dagOut = new Map<string, MapEdge[]>();
  const dfs = (u: string) => {
    color.set(u, 'gray');
    for (const edge of outgoing.get(u) || []) {
      if (color.get(edge.target) === 'gray') continue; // 後退辺 → DAGから除外（循環を断つ）
      if (!dagOut.has(u)) dagOut.set(u, []);
      dagOut.get(u)!.push(edge);
      if (color.get(edge.target) === 'white') dfs(edge.target);
    }
    color.set(u, 'black');
  };
  // 入次数0のノードを優先的にDFS起点にし、残った孤立循環成分も配列順で起点にする
  for (const n of nodes) if (inDegree.get(n.id) === 0 && color.get(n.id) === 'white') dfs(n.id);
  for (const n of nodes) if (color.get(n.id) === 'white') dfs(n.id);

  // --- 2a. DAGのトポロジカル順（配列順で決定的にKahn法）---
  const workInDeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (const [, es] of dagOut) for (const e of es) workInDeg.set(e.target, (workInDeg.get(e.target) || 0) + 1);
  const topo: string[] = [];
  const remaining = new Set(nodes.map((n) => n.id));
  while (remaining.size > 0) {
    // 残りのうち配列順で最初の「in次数0」を採る（決定的）。念のため見つからなければ配列順先頭
    let picked: string | null = null;
    for (const n of nodes) {
      if (remaining.has(n.id) && (workInDeg.get(n.id) || 0) === 0) { picked = n.id; break; }
    }
    if (picked === null) for (const n of nodes) if (remaining.has(n.id)) { picked = n.id; break; }
    remaining.delete(picked!);
    topo.push(picked!);
    for (const e of dagOut.get(picked!) || []) workInDeg.set(e.target, (workInDeg.get(e.target) || 0) - 1);
  }

  // --- 2b. ロンゲストパス（最深レイヤ）で親を選ぶ ---
  const layer = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const parentEdge = new Map<string, MapEdge | null>(nodes.map((n) => [n.id, null]));
  for (const u of topo) {
    for (const e of dagOut.get(u) || []) {
      const cand = (layer.get(u) || 0) + roleDelta(handleRole(classifyEdgeSide(e, direction), direction));
      // まだ親未定、またはより深いレイヤになるなら採用（同点はトポロジ/エッジ配列順で先着＝決定的）
      if (parentEdge.get(e.target) == null || cand > (layer.get(e.target) as number)) {
        layer.set(e.target, cand);
        parentEdge.set(e.target, e);
      }
    }
  }

  // --- 森を組み立てる（入辺を持たないノードがroot）---
  const treeChildren = new Map<string, MapEdge[]>();
  const rootIds: string[] = [];
  for (const n of nodes) {
    const pe = parentEdge.get(n.id);
    if (pe == null) {
      rootIds.push(n.id);
    } else {
      if (!treeChildren.has(pe.source)) treeChildren.set(pe.source, []);
      treeChildren.get(pe.source)!.push(pe);
    }
  }
  return { rootIds, treeChildren };
}

// あるノードを根とするサブツリーの箱。centersは、根の中心を原点(0,0)とした
// (primary, cross) ローカル座標での各ノード中心。p/cのmin/maxは箱の外接範囲
interface Box {
  centers: Map<string, { p: number; c: number }>;
  pMin: number;
  pMax: number;
  cMin: number;
  cMax: number;
}

// childBoxを (offP, offC) だけ平行移動して parentへ取り込み、外接範囲を更新する
function mergeChildBox(
  parent: Box,
  child: Box,
  offP: number,
  offC: number
): void {
  for (const [id, pos] of child.centers) {
    parent.centers.set(id, { p: pos.p + offP, c: pos.c + offC });
  }
  parent.pMin = Math.min(parent.pMin, offP + child.pMin);
  parent.pMax = Math.max(parent.pMax, offP + child.pMax);
  parent.cMin = Math.min(parent.cMin, offC + child.cMin);
  parent.cMax = Math.max(parent.cMax, offC + child.cMax);
}

/**
 * ノードnodeIdを根とするサブツリーを、ボトムアップに箱として組み立てる。
 * 交差削減・座標割当をこの中で一体で行う（スギヤマの2〜4フェーズに相当）。
 */
function layoutSubtree(
  nodeId: string,
  nodesById: Map<string, MapNode>,
  treeChildren: Map<string, MapEdge[]>,
  direction: LayoutDirection
): Box {
  const node = nodesById.get(nodeId)!;
  const w = primarySize(node, direction);
  const h = crossSize(node, direction);

  const box: Box = {
    centers: new Map([[nodeId, { p: 0, c: 0 }]]),
    pMin: -w / 2,
    pMax: w / 2,
    cMin: -h / 2,
    cMax: h / 2,
  };

  const childEdges = treeChildren.get(nodeId) || [];
  if (childEdges.length === 0) return box;

  // フェーズ2の準備: 役割ごとにバケット分け
  const buckets: Record<Role, MapEdge[]> = { forward: [], backward: [], crossNeg: [], crossPos: [] };
  for (const edge of childEdges) {
    buckets[handleRole(classifyEdgeSide(edge, direction), direction)].push(edge);
  }

  // 子サブツリーを先に再帰で確定（ボトムアップ）
  const childBox = (edge: MapEdge): Box => layoutSubtree(edge.target, nodesById, treeChildren, direction);

  // --- forward / backward: 前方(後方)へ1層。cross方向に兄弟を積んで中央寄せ ---
  // 並び順: 現在位置順で初期化し、子孫のバリセンタで並べ替えて2層間の交差を減らす（フェーズ3）
  const orderForwardLike = (edges: MapEdge[]): MapEdge[] => {
    const bary = (edge: MapEdge): number => {
      const child = nodesById.get(edge.target)!;
      const grandForward = (treeChildren.get(edge.target) || []).filter(
        (ge) => handleRole(classifyEdgeSide(ge, direction), direction) === 'forward'
      );
      const crosses = [currentCross(child, direction)];
      for (const ge of grandForward) crosses.push(currentCross(nodesById.get(ge.target)!, direction));
      return crosses.reduce((a, b) => a + b, 0) / crosses.length;
    };
    return [...edges].sort((a, b) => bary(a) - bary(b));
  };

  const placeForwardLike = (edges: MapEdge[], primarySign: 1 | -1) => {
    const ordered = orderForwardLike(edges);
    const boxes = ordered.map((e) => ({ e, b: childBox(e) }));

    // cross方向に順に積む（中央寄せは後で）
    let cursor = 0;
    const placed = boxes.map(({ e, b }) => {
      const cC = cursor - b.cMin; // 箱の上端がcursorに来るように中心を決める
      cursor += b.cMax - b.cMin + SIBLING_GAP;
      return { e, b, cC };
    });
    const totalCross = Math.max(0, cursor - SIBLING_GAP);
    const shift = -totalCross / 2; // 群を親のcross中心(0)に揃える

    for (const { b, cC } of placed) {
      // primary: forwardは箱の後端を +(W/2+GAP) に、backwardは箱の前端を -(W/2+GAP) に揃える
      const cP =
        primarySign === 1 ? w / 2 + PRIMARY_GAP - b.pMin : -(w / 2 + PRIMARY_GAP) - b.pMax;
      mergeChildBox(box, b, cP, cC + shift);
    }
  };

  if (buckets.forward.length > 0) placeForwardLike(buckets.forward, 1);
  if (buckets.backward.length > 0) placeForwardLike(buckets.backward, -1);

  // crossNeg/crossPos は親のprimary帯に被さるため、既に置いた forward/backward群と cross方向(右向きなら上下)で
  // 重なりうる。それを避けるため、親＋forward/backward群を含めた現在の箱のcross範囲の「外側」から積み始める。
  // （このスナップショットを取ってから crossPos/crossNeg を置く）
  const middleCMin = box.cMin;
  const middleCMax = box.cMax;

  // --- crossNeg(上) / crossPos(下): 親のprimary帯に被せ、cross方向に親＋forward群の外へ積む ---
  // 並び順は現在のcross位置の昇順（＝見た目の上→下の順）を保つ（フェーズ3のcross群ルール）
  const orderByCrossAsc = (edges: MapEdge[]): MapEdge[] =>
    [...edges].sort((a, b) => currentCross(nodesById.get(a.target)!, direction) - currentCross(nodesById.get(b.target)!, direction));

  // 子サブツリーの後端を「親の後端(-W/2)から primary幅×ratio だけ前方」に合わせる（＝親に被せる）
  const crossChildPrimary = (b: Box): number => -w / 2 + w * CROSS_OVERLAP_RATIO - b.pMin;

  if (buckets.crossPos.length > 0) {
    // 親＋forward/backward群の下端(middleCMax)のすぐ外側から、現在の上→下の順で積む
    let nextTop = middleCMax + CROSS_GAP;
    for (const e of orderByCrossAsc(buckets.crossPos)) {
      const b = childBox(e);
      const cC = nextTop - b.cMin; // 箱の上端をnextTopに合わせる
      mergeChildBox(box, b, crossChildPrimary(b), cC);
      nextTop = cC + b.cMax + CROSS_GAP;
    }
  }

  if (buckets.crossNeg.length > 0) {
    // 親＋forward/backward群の上端(middleCMin)のすぐ外側へ積む。見た目の順序を保つため、
    // 現在の下側の子ほど親に近く、上側の子ほど遠く（上）に来るように、下→上の順で下から積み上げる
    let nextBottom = middleCMin - CROSS_GAP;
    for (const e of orderByCrossAsc(buckets.crossNeg).reverse()) {
      const b = childBox(e);
      const cC = nextBottom - b.cMax; // 箱の下端をnextBottomに合わせる
      mergeChildBox(box, b, crossChildPrimary(b), cC);
      nextBottom = cC + b.cMin - CROSS_GAP;
    }
  }

  return box;
}

interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * 複数ツリーの外接矩形が重なる場合に、最小限の移動で押し離すオフセットを求める。
 * 重ならないツリーは動かさない（オフセット0＝root位置を保つ）。ペア順・軸選択が固定なので決定的。
 * 各反復で、重なっているペアを「食い込みが小さい方の軸」に沿って半分ずつ押し離す。
 */
function separateTrees(bboxes: Rect[]): { dx: number; dy: number }[] {
  const offsets = bboxes.map(() => ({ dx: 0, dy: 0 }));
  if (bboxes.length < 2) return offsets;
  const m = TREE_MARGIN / 2; // 各矩形を全周mだけ膨らませる → 実効ギャップ TREE_MARGIN

  for (let iter = 0; iter < TREE_SEPARATION_MAX_ITER; iter++) {
    let moved = false;
    for (let i = 0; i < bboxes.length; i++) {
      for (let j = i + 1; j < bboxes.length; j++) {
        const ai: Rect = {
          minX: bboxes[i].minX + offsets[i].dx - m,
          minY: bboxes[i].minY + offsets[i].dy - m,
          maxX: bboxes[i].maxX + offsets[i].dx + m,
          maxY: bboxes[i].maxY + offsets[i].dy + m,
        };
        const aj: Rect = {
          minX: bboxes[j].minX + offsets[j].dx - m,
          minY: bboxes[j].minY + offsets[j].dy - m,
          maxX: bboxes[j].maxX + offsets[j].dx + m,
          maxY: bboxes[j].maxY + offsets[j].dy + m,
        };
        const ox = Math.min(ai.maxX, aj.maxX) - Math.max(ai.minX, aj.minX);
        const oy = Math.min(ai.maxY, aj.maxY) - Math.max(ai.minY, aj.minY);
        if (ox <= 0 || oy <= 0) continue; // 重なっていない

        moved = true;
        if (ox <= oy) {
          const half = ox / 2;
          if ((ai.minX + ai.maxX) / 2 <= (aj.minX + aj.maxX) / 2) {
            offsets[i].dx -= half;
            offsets[j].dx += half;
          } else {
            offsets[i].dx += half;
            offsets[j].dx -= half;
          }
        } else {
          const half = oy / 2;
          if ((ai.minY + ai.maxY) / 2 <= (aj.minY + aj.maxY) / 2) {
            offsets[i].dy -= half;
            offsets[j].dy += half;
          } else {
            offsets[i].dy += half;
            offsets[j].dy -= half;
          }
        }
      }
    }
    if (!moved) break;
  }
  return offsets;
}

/**
 * 「sugiyama-ext」アルゴリズムのエントリポイント。
 * 各rootのサブツリーを、そのrootの現在位置を基準に配置し（メンタルマップ保持）、
 * 最後にツリー同士が重なる場合だけ押し離す（重ならなければrootは動かさない）。
 */
export async function calculateSugiyamaExtLayout(
  nodes: MapNode[],
  edges: MapEdge[],
  direction: LayoutDirection
): Promise<LayoutResult> {
  if (nodes.length === 0) {
    return { nodes: [] };
  }

  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const { rootIds, treeChildren } = buildLayeredForest(nodes, edges, direction);

  // 各ツリーを、そのrootの現在中心を基準に絶対座標へ配置し、外接矩形も求める
  const trees = rootIds.map((rootId) => {
    const box = layoutSubtree(rootId, nodesById, treeChildren, direction);
    const anchor = currentCenterPC(nodesById.get(rootId)!, direction);
    const positions = new Map<string, { x: number; y: number }>();
    const bbox: Rect = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const [id, pos] of box.centers) {
      const n = nodesById.get(id)!;
      const tl = centerPCtoTopLeft(pos.p + anchor.p, pos.c + anchor.c, n, direction);
      positions.set(id, tl);
      const nw = n.width || DEFAULT_NODE_WIDTH;
      const nh = n.height || DEFAULT_NODE_HEIGHT;
      bbox.minX = Math.min(bbox.minX, tl.x);
      bbox.minY = Math.min(bbox.minY, tl.y);
      bbox.maxX = Math.max(bbox.maxX, tl.x + nw);
      bbox.maxY = Math.max(bbox.maxY, tl.y + nh);
    }
    return { positions, bbox };
  });

  // ツリー間の重なりを解消（重ならないツリーは動かさない）
  const offsets = separateTrees(trees.map((t) => t.bbox));

  const finalTopLeft = new Map<string, { x: number; y: number }>();
  trees.forEach((tree, i) => {
    const { dx, dy } = offsets[i];
    for (const [id, tl] of tree.positions) {
      finalTopLeft.set(id, { x: tl.x + dx, y: tl.y + dy });
    }
  });

  return {
    nodes: nodes.map((n) => ({ id: n.id, position: finalTopLeft.get(n.id) || n.position })),
  };
}
