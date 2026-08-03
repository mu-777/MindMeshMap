// 整列アルゴリズム「hola-lite」（方針I: HOLA のパイプラインの最小構成再実装）。
// 原典は Kieffer, Dwyer, Marriott, Wybrow, "HOLA: Human-like Orthogonal Network Layout"
// (IEEE TVCG 2016)。公式実装は C++ の libdialect（Adaptagrams）だが、JS/WASM ポートが無く
// 2万行規模なので、**このアプリの問題設定に意味のある段だけ**を自前実装したもの。
// フェーズごとの入出力を含む詳細仕様は docs/align-algorithms.md §9、
// 採用理由・原典との差分・不採用案は docs/align-branch-layout.md「方針I」を参照。
//
// HOLA の DiAlEcT パイプラインに対応させた4段構成:
//   D (Decompose) : 次数1のノードを反復的に剥がして core（2-core）と周辺ツリーに分ける。
//                   あわせて「向きの期待を課してよいエッジ」だけの強制フォレスト F を作る。
//   A (Arrange)   : core を含む成分どうしの配置を、現在位置を初期値としたストレス最適化で決める。
//                   原典は core のノードそのものにストレスをかけるが、こちらは契約
//                   （ハンドル向き一致）を守るため **成分を剛体の箱として** 扱う（後述）。
//   E (Expand)    : 各成分を、親の4面（上下左右）へ対称に伸ばす再帰的な箱合成で組み立てる。
//                   sugiyama系と違い**大域的な流れ方向（層）を持たない**のがこの方式の主眼。
//   T (Transform) : 成分の箱を絶対座標へ置き、重なる箱だけを押し離す。
//
// **原典との一番大きな違い**: HOLA は直交ルーティング（曲げ点つきの配線）とセットで価値が出る
// アルゴリズムだが、このアプリは LayoutResult（ノード座標のみ）しか受け取らず React Flow の
// ベジェで描き直すため、配線の段は持たない（docs/align-branch-layout.md「方針F」と同じ理由）。
// また HANDLE_DIRECTION を契約に入れた以上、幾何は強制フォレスト F でほぼ決まるので、
// ストレス最適化の役割は「成分の置き場所」に限定される（同「方針I」に測定込みで記録）。
import { MapNode, MapEdge, LayoutDirection } from '../types';
import { LayoutResult } from './layout';
import { classifyEdgeSide, HandleSide } from './branchLayout';

// --- チューニング定数（意味・調整箇所は docs/tuning.md「整列アルゴリズム」参照）---
const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 60;
// 親と子の間隔（子が伸びる向き、px）。4面とも同じ値を使う（方向で非対称にしない）
export const GROWTH_GAP = 60;
// 同じ面に並ぶ兄弟サブツリーの箱どうしの間隔（px）
export const SIBLING_GAP = 8;
// 別の面へ伸びた群どうし（例: 右の子の群と上の子の群）の間隔（px）
const QUADRANT_GAP = 20;
// 成分（コンポーネント）の外接矩形どうしの最小マージン（px）
const COMPONENT_MARGIN = 40;
// 成分の押し離し反復の上限。通常は数回で収束する
const SEPARATION_MAX_ITER = 200;
// ストレス最適化（SMACOF）の反復上限と打ち切り閾値（最大移動量, px）
const STRESS_MAX_ITER = 100;
const STRESS_EPSILON = 0.5;
// 成分間エッジ1本あたりの理想距離に足す余白（px）。理想距離は両端の箱の半径＋この値
const STRESS_LINK_GAP = 80;

function nodeWidth(node: MapNode): number {
  return node.width || DEFAULT_NODE_WIDTH;
}
function nodeHeight(node: MapNode): number {
  return node.height || DEFAULT_NODE_HEIGHT;
}

interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// あるノードを根とするサブツリーの「箱」。positionsは、そのノード自身の左上を原点(0,0)と
// したローカル座標系での自分＋全子孫の左上位置（上/左へ伸びた子孫があるので負もありうる）。
// min/maxは原点から見た箱の外接矩形
interface Box extends Rect {
  positions: Map<string, { x: number; y: number }>;
}

// --- D: 分解 -------------------------------------------------------------

/**
 * 次数1のノードを反復的に剥がして core（2-core）を求める（HOLA の peeling）。
 * 自己ループは無視し、多重辺は1本として数える。剥がされたノード＝周辺ツリー。
 * このアルゴリズムでは core を「ストレス最適化の対象成分を選ぶ」ためだけに使う
 * （純粋な木のマップでは core が空になり、A段をまるごと飛ばせる）。
 */
function peelCore(nodes: MapNode[], edges: MapEdge[]): Set<string> {
  const ids = new Set(nodes.map((n) => n.id));
  const adjacency = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set<string>()]));
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
  }

  const alive = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...alive]) {
      let degree = 0;
      for (const neighbour of adjacency.get(id)!) {
        if (alive.has(neighbour)) degree++;
      }
      if (degree <= 1) {
        alive.delete(id);
        changed = true;
      }
    }
  }
  return alive;
}

interface Forest {
  /** 親ID → 採用した子エッジ（edges配列順） */
  childEdges: Map<string, MapEdge[]>;
  /** 採用された親を持たないノード＝各成分の根（nodes配列順） */
  rootIds: string[];
  /** 子ID → 親ID */
  parentOf: Map<string, string>;
}

/**
 * 「向きの期待を課してよいエッジ」だけからなる強制フォレスト F を作る。
 *
 * **判定は e2e/lib/layout-metrics.mjs の `unambiguousTreeEdges()` と同一**にしてある:
 *   - target の入次数が1（親候補が1つしかない）
 *   - かつ DFS の後退辺（循環を閉じる辺）でない
 * 評価環境が「向き一致」を課すのはこの集合だけなので、**この集合の全エッジをハンドルの向きどおりに
 * 配置すれば HANDLE_DIRECTION 契約が構造的に保証される**（docs/align-branch-layout.md「方針I」）。
 * 逆に言うと、判定を metrics 側とズラすと契約が静かに破れる。片方を変えたら必ず両方を直すこと。
 *
 * 各ノードの親は高々1つ・後退辺を除いてあるので、結果は必ず森（閉路を持たない）になる。
 * 採用されなかったエッジ（循環・複数親の非採用側・自己ループ）は位置計算から除外され、
 * A段（成分どうしのストレス最適化）でだけ効く。
 */
function buildEnforcedForest(nodes: MapNode[], edges: MapEdge[]): Forest {
  const ids = new Set(nodes.map((n) => n.id));

  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (const edge of edges) {
    if (ids.has(edge.target)) inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
  }

  const outgoing = new Map<string, MapEdge[]>(nodes.map((n) => [n.id, []]));
  for (const edge of edges) {
    if (ids.has(edge.source) && ids.has(edge.target)) outgoing.get(edge.source)!.push(edge);
  }

  // DFSで後退辺を検出する（color: 0=未訪問, 1=探索中, 2=完了）。metrics側は再帰だが、
  // 深い木でスタックを使い切らないよう明示スタックで書く（辿る順序は同じ）
  const color = new Map<string, 0 | 1 | 2>(nodes.map((n) => [n.id, 0]));
  const backEdgeIds = new Set<string>();
  const visit = (start: string) => {
    const stack: { id: string; index: number }[] = [{ id: start, index: 0 }];
    color.set(start, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const outEdges = outgoing.get(frame.id)!;
      if (frame.index >= outEdges.length) {
        color.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const edge = outEdges[frame.index++];
      const c = color.get(edge.target);
      if (c === 1) backEdgeIds.add(edge.id);
      else if (c === 0) {
        color.set(edge.target, 1);
        stack.push({ id: edge.target, index: 0 });
      }
    }
  };
  // 入次数0から始めると自然な向きの木になる。残り（孤立循環）は配列順で拾う
  for (const n of nodes) if (inDegree.get(n.id) === 0 && color.get(n.id) === 0) visit(n.id);
  for (const n of nodes) if (color.get(n.id) === 0) visit(n.id);

  const childEdges = new Map<string, MapEdge[]>();
  const parentOf = new Map<string, string>();
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    if (inDegree.get(edge.target) !== 1) continue;
    if (backEdgeIds.has(edge.id)) continue;
    if (!childEdges.has(edge.source)) childEdges.set(edge.source, []);
    childEdges.get(edge.source)!.push(edge);
    parentOf.set(edge.target, edge.source);
  }

  const rootIds = nodes.filter((n) => !parentOf.has(n.id)).map((n) => n.id);
  return { childEdges, rootIds, parentOf };
}

// --- E: 箱の合成（4方向対称の成長）---------------------------------------

/** 箱の外接矩形（ローカル座標）をオフセットぶん平行移動したもの */
function shiftRect(rect: Rect, dx: number, dy: number): Rect {
  return { minX: rect.minX + dx, minY: rect.minY + dy, maxX: rect.maxX + dx, maxY: rect.maxY + dy };
}

/** 2矩形が、間隔gapを空けた状態で見て重なるか（gap=0なら純粋な矩形の重なり） */
function rectsOverlap(a: Rect, b: Rect, gap: number): boolean {
  return a.minX < b.maxX + gap && b.minX < a.maxX + gap && a.minY < b.maxY + gap && b.minY < a.maxY + gap;
}

interface PlacedChild {
  box: Box;
  dx: number;
  dy: number;
}

/** 面ごとの子の群（群まるごと剛体として動かす） */
interface Group {
  side: HandleSide;
  children: PlacedChild[];
  rect: Rect;
}

/**
 * 1つの面に付いた子サブツリーを、その面の向きへ並べた群にする。
 *   right/left … 子を縦に積む（親の中心に対して縦方向に中央揃え）
 *   top/bottom … 子を横に並べる（同じく横方向に中央揃え）
 * 子の箱は自分自身が上/左へ伸びていることがある（minX/minYが負）ので、
 * **群全体が親から GROWTH_GAP 以上離れる**ように群のオフセットを決める（子の根の線は揃う）。
 */
function buildGroup(side: HandleSide, boxes: Box[], parentW: number, parentH: number): Group {
  const vertical = side === 'top' || side === 'bottom'; // 子を横に並べる面
  // 積む方向のサイズ合計
  let span = 0;
  for (const box of boxes) {
    span += vertical ? box.maxX - box.minX : box.maxY - box.minY;
  }
  span += SIBLING_GAP * (boxes.length - 1);

  // 親の中心に対して、積む方向で中央揃えにする
  const stackStart = vertical ? (parentW - span) / 2 : (parentH - span) / 2;

  // 成長方向のオフセット（群全体が親から GROWTH_GAP 以上離れる位置）
  let growth = 0;
  switch (side) {
    case 'right':
      growth = parentW + GROWTH_GAP + Math.max(0, ...boxes.map((b) => -b.minX));
      break;
    case 'left':
      growth = -GROWTH_GAP - Math.max(0, ...boxes.map((b) => b.maxX));
      break;
    case 'bottom':
      growth = parentH + GROWTH_GAP + Math.max(0, ...boxes.map((b) => -b.minY));
      break;
    case 'top':
      growth = -GROWTH_GAP - Math.max(0, ...boxes.map((b) => b.maxY));
      break;
  }

  const children: PlacedChild[] = [];
  const rect: Rect = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let cursor = stackStart;
  for (const box of boxes) {
    const stackSize = vertical ? box.maxX - box.minX : box.maxY - box.minY;
    const stackOffset = cursor - (vertical ? box.minX : box.minY);
    const dx = vertical ? stackOffset : growth;
    const dy = vertical ? growth : stackOffset;
    children.push({ box, dx, dy });
    const placed = shiftRect(box, dx, dy);
    rect.minX = Math.min(rect.minX, placed.minX);
    rect.minY = Math.min(rect.minY, placed.minY);
    rect.maxX = Math.max(rect.maxX, placed.maxX);
    rect.maxY = Math.max(rect.maxY, placed.maxY);
    cursor += stackSize + SIBLING_GAP;
  }
  return { side, children, rect };
}

/** 群まるごとを平行移動する */
function shiftGroup(group: Group, dx: number, dy: number): void {
  for (const child of group.children) {
    child.dx += dx;
    child.dy += dy;
  }
  group.rect = shiftRect(group.rect, dx, dy);
}

/**
 * 上/下の群が左/右の群と四隅でぶつかるのを解消する（HOLA の Expand に相当する最小限の処理）。
 * 上/下の群は「親より上（下）」という制約さえ守れば横には自由に動けるので、
 *   1. 横へ逃がす（ぶつからない側があればそちら。西→東の順で試す）
 *   2. 両側ふさがっていたら、ぶつかっている群の外側（さらに上／下）へ押し出す
 * の順で解く。どちらも親との位置関係（＝ハンドルの向き）は変えないので契約は壊れない。
 */
function resolveQuadrantConflict(group: Group, horizontalGroups: Group[]): void {
  const conflicting = () => horizontalGroups.filter((h) => rectsOverlap(group.rect, h.rect, QUADRANT_GAP));
  if (conflicting().length === 0) return;

  const candidates: number[] = [];
  // 西へ逃がす: ぶつかっている群すべての左端より左へ
  candidates.push(Math.min(...conflicting().map((h) => h.rect.minX - QUADRANT_GAP - group.rect.maxX)));
  // 東へ逃がす: ぶつかっている群すべての右端より右へ
  candidates.push(Math.max(...conflicting().map((h) => h.rect.maxX + QUADRANT_GAP - group.rect.minX)));
  for (const dx of candidates) {
    const moved = shiftRect(group.rect, dx, 0);
    if (!horizontalGroups.some((h) => rectsOverlap(moved, h.rect, QUADRANT_GAP))) {
      shiftGroup(group, dx, 0);
      return;
    }
  }

  // 横がふさがっている場合は成長方向へ押し出す（上の群はさらに上、下の群はさらに下）
  const blockers = conflicting();
  if (group.side === 'top') {
    const dy = Math.min(...blockers.map((h) => h.rect.minY - QUADRANT_GAP - group.rect.maxY));
    shiftGroup(group, 0, Math.min(0, dy));
  } else {
    const dy = Math.max(...blockers.map((h) => h.rect.maxY + QUADRANT_GAP - group.rect.minY));
    shiftGroup(group, 0, Math.max(0, dy));
  }
}

/**
 * ノードvを根とするサブツリーの箱を、ボトムアップ再帰で組み立てる。
 * 子は「ソース面（ハンドル）」ごとに4つの群へ分け、その面の向きへ伸ばす。
 * **大域的な流れ方向を持たない**（上ハンドルの子はサブツリーごと上へ伸びる）のが
 * sugiyama系との一番の違い。
 */
function layoutSubtree(
  id: string,
  nodesById: Map<string, MapNode>,
  forest: Forest,
  direction: LayoutDirection,
  siblingOrder: (edges: MapEdge[], side: HandleSide) => MapEdge[]
): Box {
  const node = nodesById.get(id)!;
  const w = nodeWidth(node);
  const h = nodeHeight(node);

  const positions = new Map<string, { x: number; y: number }>([[id, { x: 0, y: 0 }]]);
  const box: Box = { positions, minX: 0, minY: 0, maxX: w, maxY: h };

  const childEdges = forest.childEdges.get(id) || [];
  if (childEdges.length === 0) return box;

  // 子をソース面ごとに分ける
  const bySide = new Map<HandleSide, MapEdge[]>();
  for (const edge of childEdges) {
    const side = classifyEdgeSide(edge, direction);
    if (!bySide.has(side)) bySide.set(side, []);
    bySide.get(side)!.push(edge);
  }

  // 面ごとに群を作る。左右（子を縦に積む面）を先に置き、上下はその後で四隅の衝突を解く
  const groups: Group[] = [];
  const order: HandleSide[] = ['right', 'left', 'top', 'bottom'];
  for (const side of order) {
    const edgesOnSide = bySide.get(side);
    if (!edgesOnSide || edgesOnSide.length === 0) continue;
    const ordered = siblingOrder(edgesOnSide, side);
    const boxes = ordered.map((edge) => layoutSubtree(edge.target, nodesById, forest, direction, siblingOrder));
    const group = buildGroup(side, boxes, w, h);
    if (side === 'top' || side === 'bottom') {
      resolveQuadrantConflict(
        group,
        groups.filter((g) => g.side === 'right' || g.side === 'left')
      );
    }
    groups.push(group);
  }

  for (const group of groups) {
    for (const child of group.children) {
      for (const [childId, pos] of child.box.positions) {
        positions.set(childId, { x: pos.x + child.dx, y: pos.y + child.dy });
      }
    }
    box.minX = Math.min(box.minX, group.rect.minX);
    box.minY = Math.min(box.minY, group.rect.minY);
    box.maxX = Math.max(box.maxX, group.rect.maxX);
    box.maxY = Math.max(box.maxY, group.rect.maxY);
  }

  return box;
}

// --- A: 成分どうしのストレス最適化 ---------------------------------------

interface Component {
  rootId: string;
  nodeIds: string[];
  box: Box;
  /** 箱の中心の、根ノード左上からの相対位置 */
  centerOffset: { x: number; y: number };
  /** 箱の中心の初期位置（＝根の現在位置に箱を置いたときの中心） */
  seed: { x: number; y: number };
  /** ストレス最適化の対象か（core を含み、他成分と繋がっている成分だけ） */
  inStress: boolean;
  radius: number;
}

/**
 * 成分どうしの配置をストレス最適化（SMACOF の局所更新版）で決める。
 * HOLA の A段（core にストレスをかける）に対応するが、**契約（ハンドル向き一致）を守るため
 * 成分の中身は動かさず、剛体の箱の中心だけを動かす**。
 * 初期値は現在位置（ユーザーの指示どおりシードとして使う＝メンタルマップ保持、§26）。
 * 反復回数固定・乱数なしなので決定的。
 */
function stressPositions(
  components: Component[],
  links: { a: number; b: number }[]
): { x: number; y: number }[] {
  const positions = components.map((c) => ({ ...c.seed }));
  const active = components.map((c) => c.inStress);

  // 成分グラフ上の最短距離（辺の長さ＝両端の箱の半径＋余白）をダイクストラで求める
  const n = components.length;
  const adjacency = new Map<number, { to: number; length: number }[]>();
  for (const link of links) {
    const length = components[link.a].radius + components[link.b].radius + STRESS_LINK_GAP;
    if (!adjacency.has(link.a)) adjacency.set(link.a, []);
    if (!adjacency.has(link.b)) adjacency.set(link.b, []);
    adjacency.get(link.a)!.push({ to: link.b, length });
    adjacency.get(link.b)!.push({ to: link.a, length });
  }
  const distance: number[][] = [];
  for (let i = 0; i < n; i++) {
    const dist = new Array<number>(n).fill(Infinity);
    if (active[i]) {
      dist[i] = 0;
      const visited = new Array<boolean>(n).fill(false);
      for (;;) {
        let u = -1;
        for (let k = 0; k < n; k++) if (!visited[k] && dist[k] < Infinity && (u < 0 || dist[k] < dist[u])) u = k;
        if (u < 0) break;
        visited[u] = true;
        for (const edge of adjacency.get(u) || []) {
          if (!active[edge.to]) continue;
          const next = dist[u] + edge.length;
          if (next < dist[edge.to]) dist[edge.to] = next;
        }
      }
    }
    distance.push(dist);
  }

  for (let iter = 0; iter < STRESS_MAX_ITER; iter++) {
    let maxMove = 0;
    for (let i = 0; i < n; i++) {
      if (!active[i]) continue;
      let numX = 0;
      let numY = 0;
      let den = 0;
      for (let j = 0; j < n; j++) {
        if (i === j || !active[j]) continue;
        const d = distance[i][j];
        if (!Number.isFinite(d) || d <= 0) continue; // 繋がっていない成分どうしは引き合わない
        const weight = 1 / (d * d);
        let dx = positions[i].x - positions[j].x;
        let dy = positions[i].y - positions[j].y;
        let norm = Math.hypot(dx, dy);
        if (norm < 1e-9) {
          // 完全に重なっている場合の向きは配列順から決める（乱数を使わない＝決定的）
          dx = i < j ? -1 : 1;
          dy = 0;
          norm = 1;
        }
        numX += weight * (positions[j].x + (d * dx) / norm);
        numY += weight * (positions[j].y + (d * dy) / norm);
        den += weight;
      }
      if (den === 0) continue;
      const nextX = numX / den;
      const nextY = numY / den;
      maxMove = Math.max(maxMove, Math.hypot(nextX - positions[i].x, nextY - positions[i].y));
      positions[i] = { x: nextX, y: nextY };
    }
    if (maxMove < STRESS_EPSILON) break;
  }

  return positions;
}

// --- T: 成分の押し離し ---------------------------------------------------

/**
 * 成分の外接矩形が重なる場合に、最小限の移動で押し離すオフセットを求める
 * （sugiyama系の separateTrees と同じ手順。ペア順・軸選択が固定なので決定的）。
 */
function separateComponents(bboxes: Rect[]): { dx: number; dy: number }[] {
  const offsets = bboxes.map(() => ({ dx: 0, dy: 0 }));
  if (bboxes.length < 2) return offsets;
  const m = COMPONENT_MARGIN / 2; // 各矩形を全周mだけ膨らませる → 実効ギャップ COMPONENT_MARGIN

  for (let iter = 0; iter < SEPARATION_MAX_ITER; iter++) {
    let moved = false;
    for (let i = 0; i < bboxes.length; i++) {
      for (let j = i + 1; j < bboxes.length; j++) {
        const ai = shiftRect(
          { minX: bboxes[i].minX - m, minY: bboxes[i].minY - m, maxX: bboxes[i].maxX + m, maxY: bboxes[i].maxY + m },
          offsets[i].dx,
          offsets[i].dy
        );
        const aj = shiftRect(
          { minX: bboxes[j].minX - m, minY: bboxes[j].minY - m, maxX: bboxes[j].maxX + m, maxY: bboxes[j].maxY + m },
          offsets[j].dx,
          offsets[j].dy
        );
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

// --- エントリポイント ----------------------------------------------------

/**
 * 「hola-lite」アルゴリズムのエントリポイント。
 * D（分解）→ E（箱の合成）→ A（成分のストレス最適化）→ T（押し離し）の順に実行する
 * （E と A は実装上、箱のサイズが要るので順序が入れ替わっている）。
 */
export async function calculateHolaLiteLayout(
  nodes: MapNode[],
  edges: MapEdge[],
  direction: LayoutDirection
): Promise<LayoutResult> {
  if (nodes.length === 0) {
    return { nodes: [] };
  }

  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const coreIds = peelCore(nodes, edges);
  const forest = buildEnforcedForest(nodes, edges);

  // 兄弟の並び順は現在位置から決める（メンタルマップ保持・§26）。
  // 縦に積む面（右/左）は現在のy、横に並べる面（上/下）は現在のxで並べる
  const currentCenter = (id: string) => {
    const n = nodesById.get(id)!;
    return { x: n.position.x + nodeWidth(n) / 2, y: n.position.y + nodeHeight(n) / 2 };
  };
  const siblingOrder = (edgesOnSide: MapEdge[], side: HandleSide): MapEdge[] => {
    const vertical = side === 'top' || side === 'bottom';
    return edgesOnSide
      .map((edge, index) => ({ edge, index }))
      .sort((a, b) => {
        const ca = currentCenter(a.edge.target);
        const cb = currentCenter(b.edge.target);
        const key = vertical ? ca.x - cb.x : ca.y - cb.y;
        return key !== 0 ? key : a.index - b.index; // 同値はエッジ配列順（決定的）
      })
      .map((entry) => entry.edge);
  };

  // E: 各成分の箱を組み立てる
  const components: Component[] = forest.rootIds.map((rootId) => {
    const box = layoutSubtree(rootId, nodesById, forest, direction, siblingOrder);
    const root = nodesById.get(rootId)!;
    const centerOffset = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    return {
      rootId,
      nodeIds: [...box.positions.keys()],
      box,
      centerOffset,
      seed: { x: root.position.x + centerOffset.x, y: root.position.y + centerOffset.y },
      inStress: false,
      radius: Math.hypot(box.maxX - box.minX, box.maxY - box.minY) / 2,
    };
  });

  // A: 成分どうしの配置。対象は「core を含み、かつ他成分と繋がっている成分」だけ
  // （純粋な木のマップでは core が空になるのでこの段はまるごと飛ぶ）
  const componentOf = new Map<string, number>();
  components.forEach((component, index) => {
    for (const id of component.nodeIds) componentOf.set(id, index);
  });
  const links: { a: number; b: number }[] = [];
  const seenLinks = new Set<string>();
  for (const edge of edges) {
    const a = componentOf.get(edge.source);
    const b = componentOf.get(edge.target);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seenLinks.has(key)) continue;
    seenLinks.add(key);
    links.push({ a, b });
  }
  const linkedComponents = new Set<number>();
  for (const link of links) {
    linkedComponents.add(link.a);
    linkedComponents.add(link.b);
  }
  for (let i = 0; i < components.length; i++) {
    components[i].inStress =
      linkedComponents.has(i) && components[i].nodeIds.some((id) => coreIds.has(id));
  }
  const stressed = components.filter((c) => c.inStress).length;
  const centers =
    stressed >= 2 ? stressPositions(components, links) : components.map((c) => ({ ...c.seed }));

  // T: 箱を絶対座標へ置き、重なる箱だけを押し離す
  const placed = components.map((component, index) => {
    const originX = centers[index].x - component.centerOffset.x;
    const originY = centers[index].y - component.centerOffset.y;
    return {
      component,
      origin: { x: originX, y: originY },
      bbox: {
        minX: originX + component.box.minX,
        minY: originY + component.box.minY,
        maxX: originX + component.box.maxX,
        maxY: originY + component.box.maxY,
      } as Rect,
    };
  });
  const offsets = separateComponents(placed.map((p) => p.bbox));

  const finalPositions = new Map<string, { x: number; y: number }>();
  placed.forEach((entry, index) => {
    const { dx, dy } = offsets[index];
    for (const [id, pos] of entry.component.box.positions) {
      finalPositions.set(id, { x: entry.origin.x + pos.x + dx, y: entry.origin.y + pos.y + dy });
    }
  });

  return {
    nodes: nodes.map((n) => ({ id: n.id, position: finalPositions.get(n.id) || n.position })),
  };
}
