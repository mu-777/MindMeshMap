// 整列アルゴリズム「elk-port-ext」（方針G: ポート制約付き階層レイアウトの自前実装）。
// 設計の詳細・検討経緯はdocs/align-branch-layout.md「方針G」を参照。
//
// 位置づけ: `elk-port`（方針F）はelkjsにポートを渡すだけの薄いラッパーなので、中身を触って
// 改善することができない（ELKのオプションで表現できることしかできない）。本方式は
// **同じ枠組み（単一の流れ方向＋ポートで取り付き面を制約する階層レイアウト）を、
// ELKに依存せず必要最小限だけ自前で書いたもの**。ELKの実装を移植したのではなく、
// スギヤマ4フェーズ＋ポート制約という「考え方」を最小構成で実装している。
// これにより各フェーズを独立に差し替えて改善していける（＝`elk-port`の改善用の土台）。
//
// 右向き(RIGHT)を基準に説明する。下向き(DOWN)は primary/cross 軸を入れ替えるだけで
// 自然に90度回転して適用される（primarySize/crossSize/centerPC系が吸収する）。
//
// フェーズ（括弧内はELK layeredの対応する処理）:
//   1. 循環除去      (cycleBreaking: INTERACTIVE)
//        現在のprimary座標で全ノードを一列に並べ、その順に逆行するエッジを反転してDAG化する。
//   2. レイヤー割当  (layering: INTERACTIVE)
//        現在のprimary区間が重なるノードを同じ層にまとめ、そのあとエッジが必ず1層以上
//        前進するように押し出す。「現在の階層を保つ」差分性はここで担保する。
//   3. 仮想ノード    (hierarchy/long edge splitting)
//        2層以上をまたぐエッジを中間層のダミーで1層ずつに分解する。交差削減と
//        「エッジが無関係なノードを貫通する」対策の両方に効く、スギヤマ枠組みの必須要素。
//   4. 交差削減      (crossingMinimization: INTERACTIVE + バリセンタ掃引)
//        層内の初期順序は現在のcross座標。以後、隣接層のバリセンタで並べ替え、
//        交差数が最小だった順序を採用する。
//   5. 座標割当      (nodePlacement: BRANDES_KOEPFの代わりに重み付きPAVA)
//        「層内の順序と最小間隔を守った上で、希望位置との二乗誤差を最小化する」問題を
//        PAVA（pool adjacent violators）で厳密に解く掃引を数回まわす。
//
// **ポート制約がどこに効くか（この方式の中身そのもの）**:
// エッジの端点は「ノードの中心」ではなく「ハンドル（ポート）の位置」である、という一点を
// 4・5フェーズのバリセンタ計算に入れる。流れ方向の面（RIGHT時のright/left）に付いたポートは
// cross方向のオフセット0だが、直交方向の面（RIGHT時のtop/bottom）に付いたポートは
// ノードのcross方向の端＋スタブぶんだけずれる。結果として下ハンドルに繋いだ子は「親の下」へ
// 引っぱられる。ELKが北/南ポートのために同じ層へダミーノードを挿入して確保する空間を、
// ダミーを実体化せずオフセットで表現したもの。
//
// なお `elk-port`（ELK本体）と違い、**流れ方向そのものはやはり単一のまま**（下ハンドル子も
// 前方の層に置かれる）。ハンドルの向きどおりに層を変えるのは `sugiyama-ext`（方針E）の役割。
import { MapNode, MapEdge, LayoutDirection } from '../types';
import { LayoutResult } from './layout';
import { classifyEdgeSide, HandleSide } from './branchLayout';

// --- チューニング定数（意味・調整箇所は docs/tuning.md「整列アルゴリズム」参照）---
const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 60;
// 層と層の間隔（primary方向、px）。ELKの nodeNodeBetweenLayers=80 に合わせている
const LAYER_GAP = 80;
// 同じ層に並ぶ実ノード同士の最小間隔（cross方向、px）。ELKの nodeNode=50 に合わせている
const NODE_GAP = 50;
// 仮想ノード（長いエッジの通り道）に隣接する部分の最小間隔（cross方向、px）。
// 実ノード同士より狭くてよい（通り道は線1本ぶんの幅しか要らない）
const LANE_GAP = 16;
// 直交方向の面（RIGHT時のtop/bottom）に付いたポートの、ノード端からの張り出し量（px）。
// 大きくすると上/下ハンドルの子が親からより強く離れる。0にするとポートの効果はノードの
// 半分のサイズぶんだけになる
const PORT_STUB = 20;
// 座標割当の掃引回数。1回 = 前方向き＋後方向きの1往復
const PLACEMENT_SWEEPS = 4;
// 交差削減の掃引回数。1回 = 下向き＋上向きの1往復
const ORDERING_SWEEPS = 4;
// 仮想ノードの配置優先度（実ノードを1としたときの重み）。大きいほど長いエッジがまっすぐになる
const DUMMY_WEIGHT = 8;
// 交差削減のバリセンタは「層内の順序index」空間で計算するので、ポートのcrossオフセット(px)を
// 「およそ何ノードぶんか」に換算して足す。その換算に使う1ノードぶんの縦ピッチの目安(px)
const ORDER_PITCH = DEFAULT_NODE_HEIGHT + NODE_GAP;

// ポートの役割。レイアウト方向を基準にした相対的な向き
//   forward  : 流れ方向の面（RIGHT:right / DOWN:bottom）。エッジが自然に出ていく面
//   backward : 流れの逆の面（RIGHT:left / DOWN:top）。ELKでいう「反転ポート」
//   crossNeg : 直交方向の負側の面（RIGHT:top / DOWN:left）
//   crossPos : 直交方向の正側の面（RIGHT:bottom / DOWN:right）
// sugiyamaExtLayout.ts にも同名の概念があるが、あちらは「役割で層を変える」ために使い、
// こちらは「役割でcross方向の取り付き位置を変える」ために使う。用途が違うので独立に持つ
// （どちらかのアルゴリズムを削除するときに巻き込まれないようにするため）
type PortRole = 'forward' | 'backward' | 'crossNeg' | 'crossPos';

function portRole(side: HandleSide, direction: LayoutDirection): PortRole {
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

/** エッジの入力側（ターゲット）の面。無効・未設定ならソース面の反対面（elkPortLayout.tsと同じ規則） */
function targetSideOf(edge: MapEdge, sourceSide: HandleSide): HandleSide {
  const handle = edge.targetHandle;
  if (handle === 'top' || handle === 'bottom' || handle === 'left' || handle === 'right') {
    return handle;
  }
  return { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[sourceSide] as HandleSide;
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
  return direction === 'RIGHT'
    ? { p: node.position.x + w / 2, c: node.position.y + h / 2 }
    : { p: node.position.y + h / 2, c: node.position.x + w / 2 };
}

// --- レイアウト用の内部グラフ表現 ---

// 実ノードと仮想ノード（長いエッジの通り道）を同じ型で扱う
interface LNode {
  id: string; // 実ノードは元のID、仮想ノードは `~dummy~<n>`
  real: boolean;
  layer: number;
  order: number; // 層内の位置（0始まり）
  cross: number; // cross座標（中心）
  crossSize: number;
  primarySize: number;
  weight: number; // 座標割当での優先度
}

// 1層ぶんだけをまたぐ、内部表現でのエッジ。crossOffsetは端点のポート位置（中心からのずれ）
interface LEdge {
  from: number; // LNodeのindex
  to: number;
  fromOffset: number;
  toOffset: number;
}

/** ポート役割から、cross方向の取り付き位置（ノード中心からのずれ）を求める */
function portCrossOffset(role: PortRole, nodeCrossSize: number): number {
  switch (role) {
    case 'forward':
    case 'backward':
      // 流れ方向の面は、その面のcross方向の中央に付く（＝ずれなし）
      return 0;
    case 'crossNeg':
      return -(nodeCrossSize / 2 + PORT_STUB);
    case 'crossPos':
      return nodeCrossSize / 2 + PORT_STUB;
  }
}

/**
 * フェーズ1: 循環除去（ELKのINTERACTIVE cycleBreakingに相当）。
 * 現在のprimary座標（同値はノード配列順）で全ノードに全順序を与え、その順に逆行するエッジを
 * 反転する。全順序に沿って向き付けするので、結果は必ずDAGになる（追加の循環判定は不要）。
 * 反転したエッジは「向きだけ逆にして」レイアウトに使う（描画側は元のまま）。
 */
function breakCycles(
  nodes: MapNode[],
  edges: MapEdge[],
  direction: LayoutDirection
): { source: string; target: string; edge: MapEdge; reversed: boolean }[] {
  const rank = new Map<string, number>();
  const sorted = nodes
    .map((n, i) => ({ id: n.id, p: currentCenterPC(n, direction).p, i }))
    .sort((a, b) => a.p - b.p || a.i - b.i);
  sorted.forEach((n, i) => rank.set(n.id, i));

  const nodeIds = new Set(nodes.map((n) => n.id));
  const result: { source: string; target: string; edge: MapEdge; reversed: boolean }[] = [];
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    if (e.source === e.target) continue; // 自己ループは位置計算に寄与しない
    const reversed = rank.get(e.source)! > rank.get(e.target)!;
    result.push(
      reversed
        ? { source: e.target, target: e.source, edge: e, reversed: true }
        : { source: e.source, target: e.target, edge: e, reversed: false }
    );
  }
  return result;
}

/**
 * フェーズ2: レイヤー割当（ELKのINTERACTIVE layeringに相当）。
 * 1. 現在のprimary区間（左端〜右端）が重なるノードを同じ層にまとめる（＝見た目の階層を保つ）。
 * 2. 全エッジが1層以上前進するよう、トポロジ順に押し出す（layer[t] = max(layer[t], layer[s]+1)）。
 * 3. 空いた層番号を詰める。
 */
function assignLayers(
  nodes: MapNode[],
  dagEdges: { source: string; target: string }[],
  direction: LayoutDirection
): Map<string, number> {
  const sorted = nodes
    .map((n, i) => {
      const size = primarySize(n, direction);
      const center = currentCenterPC(n, direction).p;
      return { id: n.id, start: center - size / 2, end: center + size / 2, i };
    })
    .sort((a, b) => a.start - b.start || a.i - b.i);

  const layer = new Map<string, number>();
  let current = 0;
  let currentEnd = -Infinity;
  for (const n of sorted) {
    // 直前までの層のprimary範囲と重ならなくなったら次の層へ
    if (n.start >= currentEnd && layer.size > 0) {
      current += 1;
      currentEnd = n.end;
    } else {
      currentEnd = Math.max(currentEnd, n.end);
    }
    layer.set(n.id, current);
  }

  // エッジ制約を満たすまで押し出す。DAGなのでトポロジ順に1回なめれば収束する
  for (const id of topoOrder(nodes, dagEdges)) {
    for (const e of dagEdges) {
      if (e.source !== id) continue;
      const need = layer.get(e.source)! + 1;
      if (layer.get(e.target)! < need) layer.set(e.target, need);
    }
  }

  // 使われていない層番号を詰める
  const used = [...new Set([...layer.values()])].sort((a, b) => a - b);
  const remap = new Map(used.map((l, i) => [l, i]));
  for (const [id, l] of layer) layer.set(id, remap.get(l)!);
  return layer;
}

/** DAGのトポロジカル順（ノード配列順で決定的にKahn法。循環が残っていても必ず全件返す） */
function topoOrder(nodes: MapNode[], dagEdges: { source: string; target: string }[]): string[] {
  const inDeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const out = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of dagEdges) {
    out.get(e.source)!.push(e.target);
    inDeg.set(e.target, inDeg.get(e.target)! + 1);
  }
  const order: string[] = [];
  const remaining = new Set(nodes.map((n) => n.id));
  while (remaining.size > 0) {
    let picked: string | null = null;
    for (const n of nodes) {
      if (remaining.has(n.id) && inDeg.get(n.id) === 0) {
        picked = n.id;
        break;
      }
    }
    // 入次数0が見つからない＝想定外の循環。配列順で先頭を採って前へ進める（無限ループ防止）
    if (picked === null) for (const n of nodes) if (remaining.has(n.id)) { picked = n.id; break; }
    remaining.delete(picked!);
    order.push(picked!);
    for (const t of out.get(picked!)!) inDeg.set(t, inDeg.get(t)! - 1);
  }
  return order;
}

/** 隣接2層の交差数を数える（順序indexで判定する標準的な数え方。O(E^2)だがこの規模なら十分） */
function countCrossings(edges: LEdge[], lnodes: LNode[]): number {
  let count = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i];
      const b = edges[j];
      const da = lnodes[a.from].order - lnodes[b.from].order;
      const db = lnodes[a.to].order - lnodes[b.to].order;
      if (da * db < 0) count += 1;
    }
  }
  return count;
}

/**
 * 重み付きPAVA（pool adjacent violators）。
 * 「並び順を保ち、隣り合う要素が gaps[i] 以上離れている」制約のもとで、
 * sum w_i * (c_i - desired_i)^2 を最小にする中心座標 c を厳密に求める。
 *
 * 制約 c_{i+1} - c_i >= gaps[i] は、t_i = c_i - (gapsの累積) と置くと単なる単調非減少
 * （t_i <= t_{i+1}）になるので、等調回帰＝PAVAで解ける。座標割当の掃引1回ぶんに相当する。
 */
function solveOrderedPlacement(desired: number[], weights: number[], gaps: number[]): number[] {
  const n = desired.length;
  if (n === 0) return [];
  const offset: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) offset[i] = offset[i - 1] + gaps[i - 1];

  // ブロック単位でプールしていく（値はブロック内の重み付き平均）
  const blockStart: number[] = [];
  const blockW: number[] = [];
  const blockWV: number[] = [];
  for (let i = 0; i < n; i++) {
    blockStart.push(i);
    blockW.push(weights[i]);
    blockWV.push(weights[i] * (desired[i] - offset[i]));
    // 直前ブロックの平均のほうが大きい＝単調性が破れているのでマージ
    while (
      blockStart.length >= 2 &&
      blockWV[blockWV.length - 2] / blockW[blockW.length - 2] >= blockWV[blockWV.length - 1] / blockW[blockW.length - 1]
    ) {
      const w = blockW.pop()!;
      const wv = blockWV.pop()!;
      blockW[blockW.length - 1] += w;
      blockWV[blockWV.length - 1] += wv;
      blockStart.pop();
    }
  }

  const result: number[] = new Array(n).fill(0);
  for (let b = 0; b < blockStart.length; b++) {
    const from = blockStart[b];
    const to = b + 1 < blockStart.length ? blockStart[b + 1] : n;
    const value = blockWV[b] / blockW[b];
    for (let i = from; i < to; i++) result[i] = value + offset[i];
  }
  return result;
}

/**
 * 「elk-port-ext」アルゴリズムのエントリポイント。
 * ポート制約付き階層レイアウトを、ELKに依存せず自前で計算する（同期処理）
 */
export function calculateElkPortExtLayout(
  nodes: MapNode[],
  edges: MapEdge[],
  direction: LayoutDirection
): LayoutResult {
  if (nodes.length === 0) return { nodes: [] };

  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  // --- フェーズ1: 循環除去 ---
  const dagEdges = breakCycles(nodes, edges, direction);

  // --- フェーズ2: レイヤー割当 ---
  const layerOf = assignLayers(nodes, dagEdges, direction);
  const layerCount = Math.max(...[...layerOf.values()]) + 1;

  // --- 実ノードをLNodeにする ---
  const lnodes: LNode[] = [];
  const indexOf = new Map<string, number>();
  for (const n of nodes) {
    indexOf.set(n.id, lnodes.length);
    lnodes.push({
      id: n.id,
      real: true,
      layer: layerOf.get(n.id)!,
      order: 0,
      cross: currentCenterPC(n, direction).c,
      crossSize: crossSize(n, direction),
      primarySize: primarySize(n, direction),
      weight: 1,
    });
  }

  // --- フェーズ3: 仮想ノードで長いエッジを1層ずつに分解する ---
  // 端点のポートオフセットは、実ノード側の端だけに効かせる（間の仮想ノードは点として扱う）
  const ledges: LEdge[] = [];
  let dummySeq = 0;
  for (const e of dagEdges) {
    const srcNode = nodesById.get(e.source)!;
    const tgtNode = nodesById.get(e.target)!;
    // 反転したエッジは、レイアウト上のsource/targetと元のsourceHandle/targetHandleが入れ替わる
    const origSourceSide = classifyEdgeSide(e.edge, direction);
    const origTargetSide = targetSideOf(e.edge, origSourceSide);
    const fromSide = e.reversed ? origTargetSide : origSourceSide;
    const toSide = e.reversed ? origSourceSide : origTargetSide;
    const fromOffset = portCrossOffset(portRole(fromSide, direction), crossSize(srcNode, direction));
    const toOffset = portCrossOffset(portRole(toSide, direction), crossSize(tgtNode, direction));

    const fromIdx = indexOf.get(e.source)!;
    const toIdx = indexOf.get(e.target)!;
    const span = lnodes[toIdx].layer - lnodes[fromIdx].layer;

    if (span <= 1) {
      ledges.push({ from: fromIdx, to: toIdx, fromOffset, toOffset });
      continue;
    }
    // 中間層ごとに仮想ノードを1つ挿し、鎖状につなぐ。初期cross座標は両端のポート位置の線形補間
    const fromCross = lnodes[fromIdx].cross + fromOffset;
    const toCross = lnodes[toIdx].cross + toOffset;
    let prev = fromIdx;
    let prevOffset = fromOffset;
    for (let l = lnodes[fromIdx].layer + 1; l < lnodes[toIdx].layer; l++) {
      const dummyIdx = lnodes.length;
      lnodes.push({
        id: `~dummy~${dummySeq++}`,
        real: false,
        layer: l,
        order: 0,
        cross: fromCross + ((toCross - fromCross) * (l - lnodes[fromIdx].layer)) / span,
        crossSize: 0,
        primarySize: 0,
        weight: DUMMY_WEIGHT,
      });
      ledges.push({ from: prev, to: dummyIdx, fromOffset: prevOffset, toOffset: 0 });
      prev = dummyIdx;
      prevOffset = 0;
    }
    ledges.push({ from: prev, to: toIdx, fromOffset: prevOffset, toOffset });
  }

  // --- 層ごとのノード一覧と、隣接層をつなぐエッジの索引 ---
  const layers: number[][] = Array.from({ length: layerCount }, () => []);
  lnodes.forEach((n, i) => layers[n.layer].push(i));
  // edgesIntoLayer[l] = 層l-1 と 層l をつなぐエッジ
  const edgesIntoLayer: LEdge[][] = Array.from({ length: layerCount }, () => []);
  for (const le of ledges) {
    const l = lnodes[le.to].layer;
    if (l > 0 && lnodes[le.from].layer === l - 1) edgesIntoLayer[l].push(le);
  }

  // 初期順序（フェーズ4の入力）: 現在のcross座標に「ポートによる偏り」を足した値の昇順。
  // 偏り = 入辺ごとの (相手側ポートのずれ - 自分側ポートのずれ) の平均。下ハンドルで繋がれた子は
  // 正（下寄り）、上ハンドルなら負（上寄り）になる。**同じ面に繋がった兄弟同士は偏りが等しいので、
  // 現在の並び順はそのまま保たれる**（差分性を壊さずにポート制約だけを順序へ持ち込む）。
  // 同値はLNode追加順で決定的
  const orderBias = new Map<number, number>();
  for (let i = 0; i < lnodes.length; i++) {
    const values: number[] = [];
    for (const le of ledges) if (le.to === i) values.push(le.fromOffset - le.toOffset);
    orderBias.set(i, values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);
  }
  const applyOrder = () => layers.forEach((ids) => ids.forEach((id, i) => (lnodes[id].order = i)));
  for (const ids of layers) {
    ids.sort((a, b) => lnodes[a].cross + orderBias.get(a)! - (lnodes[b].cross + orderBias.get(b)!) || a - b);
  }
  applyOrder();

  // --- フェーズ4: 交差削減（バリセンタ掃引。最良の順序を採用する）---
  const totalCrossings = () => edgesIntoLayer.reduce((sum, es) => sum + countCrossings(es, lnodes), 0);
  let bestCrossings = totalCrossings();
  let bestOrder = layers.map((ids) => [...ids]);

  // ある層のノードを、隣接層の接続先バリセンタで並べ替える。
  // バリセンタにはポートのcrossオフセットを含める（＝ポート制約が順序に効く箇所）
  const sortByBarycenter = (layerIndex: number, fromPrev: boolean) => {
    const ids = layers[layerIndex];
    const bary = new Map<number, number>();
    for (const id of ids) {
      const related = fromPrev ? edgesIntoLayer[layerIndex] : edgesIntoLayer[layerIndex + 1] || [];
      const values: number[] = [];
      for (const le of related) {
        if (fromPrev && le.to === id) values.push(lnodes[le.from].order + le.fromOffset / ORDER_PITCH);
        if (!fromPrev && le.from === id) values.push(lnodes[le.to].order + le.toOffset / ORDER_PITCH);
      }
      // つながりが無いノードは動かさない（現在の順序を維持する）
      bary.set(id, values.length === 0 ? lnodes[id].order : values.reduce((a, b) => a + b, 0) / values.length);
    }
    ids.sort((a, b) => bary.get(a)! - bary.get(b)! || lnodes[a].order - lnodes[b].order);
    ids.forEach((id, i) => (lnodes[id].order = i));
  };

  for (let sweep = 0; sweep < ORDERING_SWEEPS; sweep++) {
    for (let l = 1; l < layerCount; l++) sortByBarycenter(l, true);
    for (let l = layerCount - 2; l >= 0; l--) sortByBarycenter(l, false);
    const c = totalCrossings();
    if (c < bestCrossings) {
      bestCrossings = c;
      bestOrder = layers.map((ids) => [...ids]);
    }
  }
  bestOrder.forEach((ids, l) => (layers[l] = ids));
  applyOrder();

  // --- フェーズ5: 座標割当（cross軸）---
  // 各層について「隣接層の接続点に合わせたい位置」を希望値とし、順序と最小間隔を守る中で
  // 二乗誤差最小の配置をPAVAで求める。前向き・後ろ向きに交互に掃引する
  const gapsFor = (ids: number[]) =>
    ids.slice(0, -1).map((id, i) => {
      const a = lnodes[id];
      const b = lnodes[ids[i + 1]];
      const gap = a.real && b.real ? NODE_GAP : LANE_GAP;
      return a.crossSize / 2 + b.crossSize / 2 + gap;
    });

  const placeLayer = (layerIndex: number, fromPrev: boolean) => {
    const ids = layers[layerIndex];
    if (ids.length === 0) return;
    const desired = ids.map((id) => {
      const related = fromPrev ? edgesIntoLayer[layerIndex] : edgesIntoLayer[layerIndex + 1] || [];
      const values: number[] = [];
      for (const le of related) {
        // 相手側のポート位置に、自分のポートオフセットを打ち消す形で合わせる
        if (fromPrev && le.to === id) values.push(lnodes[le.from].cross + le.fromOffset - le.toOffset);
        if (!fromPrev && le.from === id) values.push(lnodes[le.to].cross + le.toOffset - le.fromOffset);
      }
      return values.length === 0 ? lnodes[id].cross : values.reduce((a, b) => a + b, 0) / values.length;
    });
    const weights = ids.map((id) => lnodes[id].weight);
    const placed = solveOrderedPlacement(desired, weights, gapsFor(ids));
    ids.forEach((id, i) => (lnodes[id].cross = placed[i]));
  };

  // 初期配置: 現在のcross座標を希望値として、重なりだけ解消しておく
  for (let l = 0; l < layerCount; l++) {
    const ids = layers[l];
    const placed = solveOrderedPlacement(
      ids.map((id) => lnodes[id].cross),
      ids.map((id) => lnodes[id].weight),
      gapsFor(ids)
    );
    ids.forEach((id, i) => (lnodes[id].cross = placed[i]));
  }
  for (let sweep = 0; sweep < PLACEMENT_SWEEPS; sweep++) {
    for (let l = 1; l < layerCount; l++) placeLayer(l, true);
    for (let l = layerCount - 2; l >= 0; l--) placeLayer(l, false);
  }

  // --- primary軸: 層ごとに「その層の最大primaryサイズ + LAYER_GAP」で積む（ELKと同じ左揃え）---
  const layerStart: number[] = [];
  let cursor = 0;
  for (let l = 0; l < layerCount; l++) {
    layerStart.push(cursor);
    const maxSize = Math.max(0, ...layers[l].map((id) => lnodes[id].primarySize));
    cursor += maxSize + LAYER_GAP;
  }

  // --- (primary, cross) → (x, y) へ戻し、入力の外接矩形の左上に合わせて平行移動する ---
  // （ELK本体は原点付近へ正規化するためマップ全体が飛ぶ。自前実装ではその必要が無いので、
  //   メンタルマップ保持のために元の位置に留める）
  const laidOut = new Map<string, { x: number; y: number }>();
  for (const ln of lnodes) {
    if (!ln.real) continue;
    const node = nodesById.get(ln.id)!;
    const w = node.width || DEFAULT_NODE_WIDTH;
    const h = node.height || DEFAULT_NODE_HEIGHT;
    const p = layerStart[ln.layer];
    laidOut.set(
      ln.id,
      direction === 'RIGHT' ? { x: p, y: ln.cross - h / 2 } : { x: ln.cross - w / 2, y: p }
    );
  }

  const originalMinX = Math.min(...nodes.map((n) => n.position.x));
  const originalMinY = Math.min(...nodes.map((n) => n.position.y));
  const laidOutMinX = Math.min(...[...laidOut.values()].map((p) => p.x));
  const laidOutMinY = Math.min(...[...laidOut.values()].map((p) => p.y));
  const dx = originalMinX - laidOutMinX;
  const dy = originalMinY - laidOutMinY;

  return {
    nodes: nodes.map((n) => {
      const p = laidOut.get(n.id);
      return { id: n.id, position: p ? { x: p.x + dx, y: p.y + dy } : n.position };
    }),
  };
}
