// 整列アルゴリズム「elk-port-ext」（方針G: ELK layered のポート制約版を、elkjsに依存せず再実装）。
// フェーズごとの入出力を含む詳細仕様はdocs/align-algorithms.md §6、
// 採用理由・検討経緯はdocs/align-branch-layout.md「方針G」を参照。
//
// **位置づけ**: `elk-port`（方針F）は elkjs にポートを渡すだけの薄いラッパーなので、中身を触って
// 改善することができない（ELKのオプションで表現できることしかできない）。本方式は
// **`elk-port` と同じアルゴリズムを、同じ結果になることを狙って自前で書き直したもの**。
// elkjsのコンポーネントを使わないぶん、フェーズ単位で自由に差し替えて改善していける。
//
// **ELK 0.9.1 のソース（EPL-2.0）を読んで書いた**が、コードの移植ではなく、
// 「どのクラスが何をしているか」を読み取ったうえで**このアプリに要る部分だけをベタ書き**している。
// ELKの関数・データ型はimportせず、他アルゴリズムとの共通化のための抽象（ILayoutPhase・
// IGraphImporter・spacings プロバイダ・thresholdStrategy など）も持ち込んでいない。
//
// `elk-port` の実行時オプション（layout.ts の `ELK_BASE_LAYOUT_OPTIONS`）が選ぶ実装:
//   cycleBreaking=INTERACTIVE     → InteractiveCycleBreaker
//   layering=INTERACTIVE          → InteractiveLayerer
//   crossingMinimization=INTERACTIVE → **InteractiveCrossingMinimizer**
//   nodePlacement=BRANDES_KOEPF   → BKNodePlacer（+ BKAligner / BKCompactor）
//
// **いちばん効く事実**: `crossingMinimization=INTERACTIVE` のとき、ELKはバリセンタ掃引を行う
// `LayerSweepCrossingMinimizer` を**使わない**。`InteractiveCrossingMinimizer` は
// **各層を現在の座標で並べ替えるだけで、交差削減を一切しない**。
// ここを「よかれと思って」バリセンタ掃引にすると交差が 799 → 563 まで減ってしまい、
// ELKとは別物になる（＝この方式では改善が失敗を意味する）。
//
// **ソースと実測から確定した、素直に書くと外す点**:
//   - 出力は原点＋padding(12) へ正規化され、座標は整数に丸められる
//   - 層は左揃えで積まれ、層間は nodeNodeBetweenLayers=80、層内の実ノード同士は nodeNode=50、
//     ダミーが絡むと edgeNode/edgeEdge=10
//   - north/south面のポートは「そのノード自身の層に置かれる大きさ0のダミー」になる
//     （NorthSouthPortPreprocessor）。**ポート1つにつきダミー1つ**で、入力と出力を兼ねる
//     ポートも1つで済ませる（同じ面の複数エッジは共有）
//   - 連結成分は別々にレイアウトされ componentComponent=20 で積まれる。順序は現在位置でも
//     入力順でもなく**ノード数の少ない順**（同数なら入力配列の初出順。孤立ノードが先頭に来る）
//   - 位置の基準は `interactiveReferencePoint` の既定 CENTER（＝ノード中心。左上ではない）
//   - Brandes–Köpfの4パスは**平均せず、実行可能なもののうち広がり最小の1つを採る**
//     （balancedは fixedAlignment=NONE かつ favorStraightEdges=false のときだけで、
//      favorStraightEdges は edgeRouting=ORTHOGONAL（layeredの既定）なら true になる）
//
// **この方式の限界（`elk-port` と同じ。ポートは「取り付き面」であって「伸びる向き」ではない）**:
// 流れ方向は単一のまま。RIGHT方向では下ハンドルに繋いだ子も右隣の層に置かれ、cross方向に
// ずれるだけ。ハンドルの向きどおりに層を変えるのは `sugiyama-ext`（方針E）の役割。
//
// **未実装の既知の差分**: 逆向きポート（`InvertedPortProcessor`。RIGHT時に左面から出るエッジを
// 前後の層のダミーで回り込ませる処理）は入れておらず、流れ方向の面と同じ扱いにしている。
//
// 右向き(RIGHT)を基準に説明する。下向き(DOWN)は primary/cross 軸を入れ替えるだけで
// 自然に90度回転して適用される（ELKも GraphTransformer で同じことをする）。
import { MapNode, MapEdge, LayoutDirection } from '../types';
import { LayoutResult } from './layout';
import { classifyEdgeSide, HandleSide } from './branchLayout';

// --- ELKのレイアウトオプションに対応する定数（意味・調整箇所は docs/tuning.md「整列アルゴリズム」）---
const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 60;
// elk.layered.spacing.nodeNodeBetweenLayers（ELK_BASE_LAYOUT_OPTIONSで明示指定している値）
const LAYER_GAP = 80;
// elk.spacing.nodeNode（同上）。同じ層の実ノード同士の最小間隔
const NODE_GAP = 50;
// elk.spacing.edgeNode のELK既定値。実ノードとダミーの最小間隔
const EDGE_NODE_GAP = 10;
// elk.spacing.edgeEdge のELK既定値。ダミー同士の最小間隔
const EDGE_EDGE_GAP = 10;
// elk.spacing.componentComponent のELK既定値。連結成分同士の最小間隔
const COMPONENT_GAP = 20;
// elk.padding のELK既定値。正規化後、内容の左上がこの位置に来る
const PADDING = 12;
// elk.edgeThickness のELK既定値。長いエッジのダミーがcross方向に確保する通り道の幅。
// 通り道の隣に来るノードは「通り道の中心 ± 0.5 + EDGE_NODE_GAP」に置かれるので座標が .5 になる
// （ELKはそれを整数に丸めて返す。最終出力のMath.round参照）。edgeNodeを0/1/10/100と振って確認した
const EDGE_THICKNESS = 1;

/** ポートの面（描画上の実際の面）→ レイアウト方向を基準にした役割 */
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
/** ノードの現在位置(top-left)を、中心の (primary, cross) 座標へ変換する */
function currentCenterPC(node: MapNode, direction: LayoutDirection): { p: number; c: number } {
  const w = node.width || DEFAULT_NODE_WIDTH;
  const h = node.height || DEFAULT_NODE_HEIGHT;
  return direction === 'RIGHT'
    ? { p: node.position.x + w / 2, c: node.position.y + h / 2 }
    : { p: node.position.y + h / 2, c: node.position.x + w / 2 };
}

// --- レイアウト用の内部グラフ表現 ---

// 実ノードとダミー（長いエッジの通り道 / north-southポート）を同じ型で扱う。
// ELKが内部で作るダミーノードに1対1で対応する
type LKind = 'real' | 'longEdge' | 'nsPort';

interface LNode {
  index: number;
  id: string | null; // 実ノードは元のID、ダミーはnull
  kind: LKind;
  layer: number;
  pos: number; // 層内の順序（0始まり）
  crossSize: number;
  primarySize: number;
  cross: number; // 結果のcross座標（中心）
  /** 層内の並べ替えキー（フェーズ4）。longEdgeダミーだけは層の代表位置が要るので後から決まる */
  orderKey: number;
  /** 入力位置でのprimary始端。層の代表primary位置（pivot）の算出にだけ使う */
  inputPrimaryStart: number;
  /** nsPortダミーが属する実ノードのindex。順序の同値解決に使う */
  originIndex: number;
  /** nsPortダミーが実ノードのどちら側に付くか */
  nsSide: 'neg' | 'pos' | null;
  /** longEdgeダミーが通っている元エッジの端点アンカー（入力座標。orderKeyの補間に使う） */
  edgeSource: { p: number; c: number } | null;
  edgeTarget: { p: number; c: number } | null;
}

/** 1層ぶんだけをまたぐ、内部表現でのエッジ（ダミー展開後なので端点は必ず中心同士で揃う） */
interface LEdge {
  from: number;
  to: number;
  marked: boolean; // Brandes–Köpfのtype-1 conflictマーキング用
}

/** 内部グラフ（連結成分1つぶん） */
interface LGraph {
  lnodes: LNode[];
  ledges: LEdge[];
  layers: number[][];
}

/** 前処理済みのエッジ（端点が両方存在するもの） */
interface PreparedEdge {
  source: string;
  target: string;
  sourceRole: PortRole;
  targetRole: PortRole;
}

/**
 * 自己ループ。層やエッジには寄与しないが、**ポートのダミーは作られる**ので
 * そのぶんの場所を取る（ELKも同じ。自己ループだけを持つノードの位置がずれるのはこれが理由）
 */
interface SelfLoop {
  node: string;
  roles: PortRole[];
}

/** 層内で隣り合う2ノードに必要な最小の中心間距離 */
function minCenterDistance(a: LNode, b: LNode): number {
  const spacing =
    a.kind === 'real' && b.kind === 'real'
      ? NODE_GAP
      : a.kind !== 'real' && b.kind !== 'real'
        ? EDGE_EDGE_GAP
        : EDGE_NODE_GAP;
  return a.crossSize / 2 + b.crossSize / 2 + spacing;
}

/**
 * フェーズ1: 循環除去（ELKの `InteractiveCycleBreaker` と同じ手順）。
 * 1. 相手が**厳密に手前**にあるエッジ（targetの中心primary < sourceの中心primary）を反転する。
 * 2. それでも残る循環（primaryが同値のノード同士など）を、ノード配列順のDFSで見つけて後退辺を反転。
 *
 * 「全順序を作って逆行辺を全部反転する」ほうが実装は短いが、それだと**同値のときにも反転して
 * しまう**ためELKと結果が変わる。ELKは同値をそのまま通し、循環になった場合だけDFSで断つ。
 */
function breakCycles(
  nodes: MapNode[],
  edges: PreparedEdge[],
  direction: LayoutDirection
): PreparedEdge[] {
  const centerP = new Map(nodes.map((n) => [n.id, currentCenterPC(n, direction).p]));
  const result = edges.map((e) =>
    centerP.get(e.target)! < centerP.get(e.source)!
      ? { source: e.target, target: e.source, sourceRole: e.targetRole, targetRole: e.sourceRole }
      : e
  );

  // 残った循環をDFSで断つ。state: 1=未訪問 / -1=現在の経路上 / 0=探索済み
  const outgoing = new Map<string, number[]>(nodes.map((n) => [n.id, []]));
  result.forEach((e, i) => outgoing.get(e.source)!.push(i));
  const state = new Map<string, number>(nodes.map((n) => [n.id, 1]));
  const backEdges = new Set<number>();

  const visit = (start: string) => {
    // 明示スタックで再帰を回避する（大きなマップでのスタック溢れ対策）
    const stack: { id: string; next: number }[] = [{ id: start, next: 0 }];
    state.set(start, -1);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const edgeIndices = outgoing.get(top.id)!;
      if (top.next >= edgeIndices.length) {
        state.set(top.id, 0);
        stack.pop();
        continue;
      }
      const ei = edgeIndices[top.next++];
      if (backEdges.has(ei)) continue;
      const target = result[ei].target;
      if (target === top.id) continue;
      const s = state.get(target)!;
      if (s < 0) backEdges.add(ei); // 現在の経路上に戻った＝循環
      else if (s > 0) {
        state.set(target, -1);
        stack.push({ id: target, next: 0 });
      }
    }
  };
  for (const n of nodes) if (state.get(n.id)! > 0) visit(n.id);

  return result.map((e, i) =>
    backEdges.has(i)
      ? { source: e.target, target: e.source, sourceRole: e.targetRole, targetRole: e.sourceRole }
      : e
  );
}

/**
 * フェーズ2: レイヤー割当（ELKのINTERACTIVE layeringに相当）。
 * 1. 現在のprimary区間（左端〜右端）が重なるノードを同じ層にまとめる（＝見た目の階層を保つ）。
 * 2. 全エッジが1層以上前進するよう、トポロジ順に押し出す。
 * 3. 空いた層番号を詰める。
 */
function assignLayers(
  nodes: MapNode[],
  dagEdges: PreparedEdge[],
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

  const used = [...new Set([...layer.values()])].sort((a, b) => a - b);
  const remap = new Map(used.map((l, i) => [l, i]));
  for (const [id, l] of layer) layer.set(id, remap.get(l)!);
  return layer;
}

/** DAGのトポロジカル順（ノード配列順で決定的にKahn法。循環が残っていても必ず全件返す） */
function topoOrder(nodes: MapNode[], dagEdges: PreparedEdge[]): string[] {
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
    if (picked === null) for (const n of nodes) if (remaining.has(n.id)) { picked = n.id; break; }
    remaining.delete(picked!);
    order.push(picked!);
    for (const t of out.get(picked!)!) inDeg.set(t, inDeg.get(t)! - 1);
  }
  return order;
}

/**
 * フェーズ4: 層内の順序決め（ELKの `InteractiveCrossingMinimizer` と同じ手順）。
 *
 * **交差削減は一切行わない**。`crossingMinimization.strategy=INTERACTIVE` のとき、ELKは
 * バリセンタ掃引を使う `LayerSweepCrossingMinimizer` ではなく本クラスを選び、
 * **各層を「現在のcross座標」で並べ替えるだけ**で終わる（＝ユーザーが動かした位置を尊重する）。
 * ここをバリセンタ掃引にすると交差は減るがELKとは別物になる（実測で交差 799 → 563）。
 *
 * 並べ替えのキーは種類ごとに違う:
 *   - 実ノード      : 現在位置の中心cross（`interactiveReferencePoint` の既定が CENTER のため）
 *   - nsPortダミー  : 元ノードの**cross方向の端**（負側ダミー＝始端 / 正側ダミー＝終端）
 *   - longEdgeダミー: 元エッジを、その層の代表primary位置 `pivot` で線形補間したcross
 * キーが同値のときは「負側ダミー → 実ノード → 正側ダミー」の順序制約で解く
 * （ELKの `IN_LAYER_SUCCESSOR_CONSTRAINTS` に相当。ダミーが親の反対側へ回り込むのを防ぐ）。
 */
function orderLayersInteractive(graph: LGraph): void {
  const { lnodes, layers } = graph;

  for (const layer of layers) {
    // 代表primary位置: その層の実ノードのうち **primary始端が正のものだけ** の中心の平均。
    // 0以下を除くのはELKの `if (node.getPosition().x > 0)` をそのまま写したもの
    // （ダミーは入力位置を持たない＝0扱いなので自然に除外される）
    let sum = 0;
    let count = 0;
    for (const i of layer) {
      const n = lnodes[i];
      if (n.kind === 'real' && n.inputPrimaryStart > 0) {
        sum += n.inputPrimaryStart + n.primarySize / 2;
        count += 1;
      }
    }
    const pivot = count > 0 ? sum / count : 0;

    for (const i of layer) {
      const n = lnodes[i];
      if (n.kind === 'longEdge') {
        const s = n.edgeSource!;
        const t = n.edgeTarget!;
        // 元エッジの端点アンカーを pivot の位置で補間する（両端の外側なら端の値をそのまま使う）
        if (pivot <= s.p) n.orderKey = s.c;
        else if (t.p <= pivot) n.orderKey = t.c;
        else if (t.p === s.p) n.orderKey = s.c;
        else n.orderKey = s.c + ((pivot - s.p) / (t.p - s.p)) * (t.c - s.c);
      }
      // real / nsPort の orderKey はLNode生成時に確定済み
    }

    // 同値のときは「負側ダミー → 実ノード → 正側ダミー」。それ以外の同値は元の並び順を保つ
    const rank = (n: LNode) => (n.kind === 'nsPort' ? (n.nsSide === 'neg' ? -1 : 1) : 0);
    const origin = (n: LNode) => (n.kind === 'nsPort' ? n.originIndex : n.index);
    const initial = new Map(layer.map((idx, k) => [idx, k]));
    layer.sort((a, b) => {
      const na = lnodes[a];
      const nb = lnodes[b];
      if (na.orderKey !== nb.orderKey) return na.orderKey - nb.orderKey;
      if (origin(na) === origin(nb)) return rank(na) - rank(nb);
      return initial.get(a)! - initial.get(b)!;
    });
  }

  layers.forEach((layer) => layer.forEach((idx, i) => (lnodes[idx].pos = i)));
}

/**
 * type-1 conflict（内部セグメント＝ダミー同士のエッジと、それを跨ぐ非内部セグメントの交差）を
 * マークする。マークされたエッジは整列に使わない＝長いエッジがまっすぐ保たれる。
 */
function markType1Conflicts(graph: LGraph, predEdges: number[][]): void {
  const { lnodes, ledges, layers } = graph;
  const isInner = (ei: number) =>
    lnodes[ledges[ei].from].kind !== 'real' && lnodes[ledges[ei].to].kind !== 'real';

  for (let i = 0; i + 1 < layers.length; i++) {
    const upper = layers[i];
    const lower = layers[i + 1];
    let k0 = 0;
    let l = 0;
    for (let l1 = 0; l1 < lower.length; l1++) {
      const innerEdge = predEdges[lower[l1]].find(isInner);
      if (l1 === lower.length - 1 || innerEdge !== undefined) {
        const k1 = innerEdge !== undefined ? lnodes[ledges[innerEdge].from].pos : upper.length - 1;
        while (l <= l1) {
          for (const ei of predEdges[lower[l]]) {
            const k = lnodes[ledges[ei].from].pos;
            if (k < k0 || k > k1) ledges[ei].marked = true;
          }
          l += 1;
        }
        k0 = k1;
      }
    }
  }
}

/**
 * フェーズ5: 座標割当（Brandes & Köpf 2002 / ELKのBRANDES_KOEPFに相当）。
 * type-1 conflictをマークしたうえで (上下)×(左右) の4通りに整列＋圧縮し、
 * **cross方向の広がりが最小だったものをそのまま採用する**。
 *
 * 原論文は4つを「幅最小のものに揃えてから中央2値を平均する」バランス化で合成するが、ELKの
 * 既定は `nodePlacement.bk.fixedAlignment=NONE`＝4通りから最小のものを選ぶ方（BALANCEDは
 * 別の選択肢で既定ではない）。実測でも、平均ではなく単一パスの値がそのまま出ている
 * （43ケースでの一致: 平均合成 19/43 → 最小選択 22/43）ためこちらを採る。
 */
function placeBrandesKoepf(graph: LGraph): void {
  const { lnodes, ledges, layers } = graph;
  const n = lnodes.length;

  const predEdges: number[][] = lnodes.map(() => []);
  const succEdges: number[][] = lnodes.map(() => []);
  ledges.forEach((e, i) => {
    succEdges[e.from].push(i);
    predEdges[e.to].push(i);
  });
  // 隣接層側の順序でソート（medianを取るため）
  for (const list of predEdges) list.sort((a, b) => lnodes[ledges[a].from].pos - lnodes[ledges[b].from].pos);
  for (const list of succEdges) list.sort((a, b) => lnodes[ledges[a].to].pos - lnodes[ledges[b].to].pos);

  markType1Conflicts(graph, predEdges);

  // index順に (RIGHT,DOWN) (RIGHT,UP) (LEFT,DOWN) (LEFT,UP)（ELKのlayoutsの並びと同じ）
  const passes = [];
  for (const vertDown of [true, false]) {
    for (const horLeft of [true, false]) {
      passes.push(bkPass(graph, predEdges, succEdges, vertDown, horLeft));
    }
  }
  const results = passes.map((p) => p.cross);

  // --- 4パスから1つを選ぶ（ELKの `BKNodePlacer` の選び方をそのまま写す）---
  // ELKは「4パスを平均するバランス化」も持っているが、**この構成では使われない**:
  // `produceBalancedLayout = (fixedAlignment==NONE && !favorStraightEdges) || fixedAlignment==BALANCED`
  // で、`favorStraightEdges` は edgeRouting が ORTHOGONAL（layeredの既定）のとき true になるため。
  // したがって「層内の順序・間隔を破っていないパスのうち、cross方向の広がりが最小のもの」を採る。
  // 同値なら先に来たパスを優先（＝(RIGHT,DOWN) 優先）。どれも破っていたら先頭パス。
  // ※バランス化を有効にすると一致率が 72% → 66% に落ちることを実測で確認している
  const feasible = (xs: number[]) =>
    layers.every((layer) =>
      layer.every((idx, i) => {
        if (i === 0) return true;
        const prev = lnodes[layer[i - 1]];
        const cur = lnodes[idx];
        return xs[idx] - xs[prev.index] >= minCenterDistance(prev, cur) - EPSILON;
      })
    );

  // 広がりは**ブロック単位の外接**で測る（ELKの `layoutSize()`）。ブロック内の各ノードは中心が
  // 揃うので、ブロックの厚みはそこに含まれる最大ノードのサイズになる。座標だけで測ると
  // ノードの大きさが効かず、別のパスが選ばれてしまう
  const widths = passes.map(({ cross, root }) => {
    const half = new Map<number, number>();
    for (const ln of lnodes) {
      const r = root[ln.index];
      half.set(r, Math.max(half.get(r) ?? 0, ln.crossSize / 2));
    }
    let min = Infinity;
    let max = -Infinity;
    for (const ln of lnodes) {
      const r = root[ln.index];
      min = Math.min(min, cross[r] - half.get(r)!);
      max = Math.max(max, cross[r] + half.get(r)!);
    }
    return max - min;
  });
  let best = -1;
  for (let i = 0; i < results.length; i++) {
    if (!feasible(results[i])) continue;
    if (best < 0 || widths[i] < widths[best]) best = i;
  }
  const pick = results[best < 0 ? 0 : best];
  for (let v = 0; v < n; v++) lnodes[v].cross = pick[v];

  // 最後の保険: 上のどれも取れなかった場合に備えて順序どおりの間隔を復元する
  // （契約「ノードが重ならない」を満たすため。採用した配置がfeasibleなら何も動かない）
  for (const layer of layers) {
    for (let i = 1; i < layer.length; i++) {
      const prev = lnodes[layer[i - 1]];
      const cur = lnodes[layer[i]];
      const need = prev.cross + minCenterDistance(prev, cur);
      if (cur.cross < need) cur.cross = need;
    }
  }
}

/** 浮動小数の比較誤差の許容幅（間隔の充足判定に使う） */
const EPSILON = 1e-6;


/** Brandes–Köpfの1パス（垂直整列＋水平圧縮）。cross座標の配列を返す */
function bkPass(
  graph: LGraph,
  predEdges: number[][],
  succEdges: number[][],
  vertDown: boolean,
  horLeft: boolean
): { cross: number[]; root: number[] } {
  const { lnodes, ledges, layers } = graph;
  const n = lnodes.length;

  // 4通りを1つの実装で扱うため、層順・層内順を反転した「見え方」を作る。
  // 層内を反転したパスは最後に符号を反転して元の向きへ戻す
  const layersT = (vertDown ? layers : [...layers].reverse()).map((l) => [...l]);
  if (!horLeft) layersT.forEach((l) => l.reverse());
  const posT = new Array<number>(n).fill(0);
  const layerT = new Array<number>(n).fill(0);
  layersT.forEach((l, li) => l.forEach((v, k) => { posT[v] = k; layerT[v] = li; }));

  const neighborEdges = vertDown ? predEdges : succEdges;
  const otherEnd = (ei: number, v: number) => (ledges[ei].from === v ? ledges[ei].to : ledges[ei].from);

  // --- 垂直整列: 各ノードを隣接層の中央値の相手に揃えてブロックを作る ---
  const root = [...Array(n).keys()];
  const align = [...Array(n).keys()];
  for (let i = 1; i < layersT.length; i++) {
    let r = -1;
    for (const v of layersT[i]) {
      const nb = neighborEdges[v]
        .map((ei) => ({ ei, u: otherEnd(ei, v) }))
        .sort((a, b) => posT[a.u] - posT[b.u]);
      if (nb.length === 0) continue;
      // 中央値が2つある場合、左揃えパスは下位・右揃えパスは上位を優先する
      const lo = Math.floor((nb.length - 1) / 2);
      const hi = Math.ceil((nb.length - 1) / 2);
      for (const m of horLeft ? [lo, hi] : [hi, lo]) {
        if (align[v] !== v) break;
        const { ei, u } = nb[m];
        if (!ledges[ei].marked && r < posT[u]) {
          align[u] = v;
          root[v] = root[u];
          align[v] = root[v];
          r = posT[u];
        }
      }
    }
  }

  // --- 水平圧縮: ブロック単位に詰める ---
  // 別クラス（連結していないブロック群）同士の距離は、原論文のように単一のshiftで持たず、
  // **クラスグラフの辺**として溜めておき、あとでロンゲストパス的に伝播させる（ELKの `placeClasses`）。
  // 原論文の単純なshiftはノードサイズが一様で連結なグラフを前提にしており、
  // 大きさの違うノードや非連結成分があると詰めきれない
  const sink = [...Array(n).keys()];
  const x = new Array<number | undefined>(n).fill(undefined);
  const classEdges = new Map<number, { target: number; separation: number }[]>();
  const indegree = new Map<number, number>();

  const placeBlock = (v: number) => {
    if (x[v] !== undefined) return;
    x[v] = 0;
    let w = v;
    do {
      if (posT[w] > 0) {
        const pred = layersT[layerT[w]][posT[w] - 1];
        const u = root[pred];
        placeBlock(u);
        if (sink[v] === v) sink[v] = sink[u];
        const sep = minCenterDistance(lnodes[pred], lnodes[w]);
        if (sink[v] !== sink[u]) {
          // クラスをまたぐ隣接: 「この2クラスは最低これだけ離れている必要がある」を辺として記録
          const from = sink[v];
          const to = sink[u];
          const separation = x[v]! - x[u]! - sep;
          if (!classEdges.has(from)) classEdges.set(from, []);
          classEdges.get(from)!.push({ target: to, separation });
          indegree.set(to, (indegree.get(to) ?? 0) + 1);
          if (!indegree.has(from)) indegree.set(from, indegree.get(from) ?? 0);
        } else {
          x[v] = Math.max(x[v]!, x[u]! + sep);
        }
      }
      w = align[w];
    } while (w !== v);
  };

  for (let v = 0; v < n; v++) if (root[v] === v) placeBlock(v);

  // クラスグラフ上で入次数0から伝播させ、各クラスのずらし量を決める
  const classShift = new Map<number, number>();
  const queue: number[] = [];
  for (const [c, deg] of indegree) if (deg === 0) queue.push(c);
  while (queue.length > 0) {
    const c = queue.shift()!;
    if (!classShift.has(c)) classShift.set(c, 0);
    for (const e of classEdges.get(c) ?? []) {
      const candidate = classShift.get(c)! + e.separation;
      classShift.set(
        e.target,
        classShift.has(e.target) ? Math.min(classShift.get(e.target)!, candidate) : candidate
      );
      const deg = indegree.get(e.target)! - 1;
      indegree.set(e.target, deg);
      if (deg === 0) queue.push(e.target);
    }
  }

  const result = new Array<number>(n).fill(0);
  for (let v = 0; v < n; v++) {
    result[v] = x[root[v]]! + (classShift.get(sink[root[v]]) ?? 0);
  }
  return { cross: horLeft ? result : result.map((c) => -c), root };
}

/**
 * 連結成分1つぶんをレイアウトする。
 * 実ノードの (primary, cross) 中心座標に加えて、**ダミーを含む** cross方向の範囲を返す。
 * ELKの外接矩形はダミーノードも含む（＝長いエッジの通り道やnorth/southダミーが上端に来ると、
 * そのぶん実ノードが内側に入る）ため、正規化と成分パッキングにはこの範囲を使う
 */
function layoutComponent(
  nodes: MapNode[],
  prepared: PreparedEdge[],
  selfLoops: SelfLoop[],
  direction: LayoutDirection
): { centers: Map<string, { p: number; c: number }>; crossMin: number; crossMax: number } {
  const dagEdges = breakCycles(nodes, prepared, direction);
  const layerOf = assignLayers(nodes, dagEdges, direction);
  const layerCount = Math.max(...[...layerOf.values()]) + 1;

  const lnodes: LNode[] = [];
  const ledges: LEdge[] = [];
  const layers: number[][] = Array.from({ length: layerCount }, () => []);

  const addNode = (
    id: string | null, kind: LKind, layer: number, cs: number, ps: number,
    orderKey: number, inputPrimaryStart: number,
    originIndex: number, nsSide: 'neg' | 'pos' | null
  ): number => {
    const index = lnodes.length;
    lnodes.push({
      index, id, kind, layer, pos: 0, crossSize: cs, primarySize: ps,
      cross: orderKey, orderKey, inputPrimaryStart,
      originIndex: originIndex < 0 ? index : originIndex, nsSide,
      edgeSource: null, edgeTarget: null,
    });
    layers[layer].push(index);
    return index;
  };

  // 実ノードの並べ替えキーは現在位置の中心cross（ELKの interactiveReferencePoint 既定=CENTER）
  const realIndex = new Map<string, number>();
  for (const node of nodes) {
    const center = currentCenterPC(node, direction);
    const ps = primarySize(node, direction);
    realIndex.set(
      node.id,
      addNode(node.id, 'real', layerOf.get(node.id)!, crossSize(node, direction), ps,
        center.c, center.p - ps / 2, -1, null)
    );
  }

  /**
   * longEdgeダミーの並べ替えキーを補間するための、元エッジ端点のアンカー位置（入力座標）。
   * **ノードの左上**を使う。ELKはここで `LPort.getAbsoluteAnchor()`（= ノード位置 + ポート位置 +
   * ポートアンカー）を見るが、FIXED_SIDEのポート座標が決まるのはフェーズ4の直前なので、
   * この時点ではポート位置もアンカーも0＝実質ノードの左上になる。
   * 面ごとの位置（右端・下端など）を使うと通り道の上下が入れ替わってELKと結果が変わる
   */
  const anchorOf = (nodeId: string): { p: number; c: number } => {
    const n = nodes.find((x) => x.id === nodeId)!;
    const center = currentCenterPC(n, direction);
    return { p: center.p - primarySize(n, direction) / 2, c: center.c - crossSize(n, direction) / 2 };
  };

  // --- フェーズ3a: north/southポートのダミー（ELKのNorthSouthPortPreprocessorに相当）---
  // 「実ノード＋面」につき1つだけ作り、同じ面から出る複数のエッジは共有する
  // （elkPortLayout.tsが面ごとに1ポートしか作らないのと同じモデル）
  const nsDummy = new Map<string, number>();
  const endpointOf = (nodeId: string, role: PortRole): number => {
    if (role !== 'crossNeg' && role !== 'crossPos') return realIndex.get(nodeId)!;
    const key = `${nodeId}/${role}`;
    const existing = nsDummy.get(key);
    if (existing !== undefined) return existing;
    const owner = lnodes[realIndex.get(nodeId)!];
    const side = role === 'crossNeg' ? 'neg' : 'pos';
    // 並べ替えキーは元ノードの**cross方向の端**（ELKは北ダミーにノード上端、南ダミーに下端を使う）。
    // 元ノードのキー（中心）と必ず前後するので、同値解決に頼らず自然に上/下へ並ぶ
    const edge = owner.orderKey + (side === 'neg' ? -1 : 1) * (owner.crossSize / 2);
    const idx = addNode(null, 'nsPort', owner.layer, 0, 0, edge, 0, owner.index, side);
    nsDummy.set(key, idx);
    return idx;
  };

  // 自己ループはエッジにはならないが、ポートのダミーだけは作られて場所を取る
  for (const loop of selfLoops) for (const role of loop.roles) endpointOf(loop.node, role);

  // --- フェーズ3b: 長いエッジの分解（ELKのLongEdgeSplitterに相当）---
  for (const e of dagEdges) {
    const from = endpointOf(e.source, e.sourceRole);
    const to = endpointOf(e.target, e.targetRole);
    const fromLayer = lnodes[from].layer;
    const toLayer = lnodes[to].layer;
    if (toLayer - fromLayer <= 1) {
      ledges.push({ from, to, marked: false });
      continue;
    }
    // 通り道の並べ替えキーは、元エッジを層の代表primary位置で補間して後から決まる（フェーズ4）。
    // そのため両端のポートアンカー（入力座標）をダミーに持たせておく
    const srcAnchor = anchorOf(e.source);
    const tgtAnchor = anchorOf(e.target);
    let prev = from;
    for (let l = fromLayer + 1; l < toLayer; l++) {
      const d = addNode(null, 'longEdge', l, EDGE_THICKNESS, 0, 0, 0, -1, null);
      lnodes[d].edgeSource = srcAnchor;
      lnodes[d].edgeTarget = tgtAnchor;
      ledges.push({ from: prev, to: d, marked: false });
      prev = d;
    }
    ledges.push({ from: prev, to, marked: false });
  }

  const graph: LGraph = { lnodes, ledges, layers };
  orderLayersInteractive(graph);
  placeBrandesKoepf(graph);

  // --- 層のprimary座標: 層ごとに最大primaryサイズを積む（ELKと同じ左揃え）---
  const layerStart: number[] = [];
  let cursor = 0;
  for (let l = 0; l < layerCount; l++) {
    layerStart.push(cursor);
    cursor += Math.max(0, ...layers[l].map((i) => lnodes[i].primarySize)) + LAYER_GAP;
  }

  const centers = new Map<string, { p: number; c: number }>();
  for (const ln of lnodes) {
    if (ln.kind !== 'real') continue;
    centers.set(ln.id!, { p: layerStart[ln.layer] + ln.primarySize / 2, c: ln.cross });
  }
  return {
    centers,
    crossMin: Math.min(...lnodes.map((ln) => ln.cross - ln.crossSize / 2)),
    crossMax: Math.max(...lnodes.map((ln) => ln.cross + ln.crossSize / 2)),
  };
}

/**
 * 「elk-port-ext」アルゴリズムのエントリポイント。
 * ELK layered（ポート制約付き）と同じパイプラインを、elkjsに依存せず同期処理で計算する
 */
export function calculateElkPortExtLayout(
  nodes: MapNode[],
  edges: MapEdge[],
  direction: LayoutDirection
): LayoutResult {
  if (nodes.length === 0) return { nodes: [] };

  // --- フェーズ0: 前処理（端点欠け・自己ループの除外、ポート面の決定）---
  const nodeIds = new Set(nodes.map((n) => n.id));
  const prepared: PreparedEdge[] = [];
  const selfLoops: SelfLoop[] = [];
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    const sourceSide = classifyEdgeSide(e, direction);
    const sourceRole = portRole(sourceSide, direction);
    const targetRole = portRole(targetSideOf(e, sourceSide), direction);
    // 自己ループは層・順序・整列には寄与しないが、ポートのダミーは作られて場所を取る
    if (e.source === e.target) {
      selfLoops.push({ node: e.source, roles: [sourceRole, targetRole] });
      continue;
    }
    prepared.push({ source: e.source, target: e.target, sourceRole, targetRole });
  }

  // --- 連結成分の分離（ELKのseparateConnectedComponents=trueに相当）---
  // 成分の順序は入力配列での初出順。ELKも現在位置では並べ替えない（観測で確認済み）
  const parent = new Map<string, string>(nodes.map((n) => [n.id, n.id]));
  const find = (a: string): string => {
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(a) !== r) {
      const next = parent.get(a)!;
      parent.set(a, r);
      a = next;
    }
    return r;
  };
  for (const e of prepared) {
    const ra = find(e.source);
    const rb = find(e.target);
    if (ra !== rb) parent.set(ra, rb);
  }
  const componentOrder: string[] = [];
  const componentNodes = new Map<string, MapNode[]>();
  for (const n of nodes) {
    const r = find(n.id);
    if (!componentNodes.has(r)) {
      componentNodes.set(r, []);
      componentOrder.push(r);
    }
    componentNodes.get(r)!.push(n);
  }
  const componentEdges = new Map<string, PreparedEdge[]>(componentOrder.map((r) => [r, []]));
  for (const e of prepared) componentEdges.get(find(e.source))!.push(e);
  const componentLoops = new Map<string, SelfLoop[]>(componentOrder.map((r) => [r, []]));
  for (const l of selfLoops) componentLoops.get(find(l.node))!.push(l);

  // 成分を積む順は「ノード数の少ない順、同数なら入力配列の初出順」。現在位置では並べ替えない
  // （ELKの実挙動。孤立ノード1個の成分が、入力で最後にあっても先頭に来ることで確認した）
  const packOrder = [...componentOrder].sort(
    (a, b) =>
      componentNodes.get(a)!.length - componentNodes.get(b)!.length ||
      componentOrder.indexOf(a) - componentOrder.indexOf(b)
  );

  // --- 成分ごとにレイアウトし、cross方向に COMPONENT_GAP で積む（primaryは左揃え）---
  const centers = new Map<string, { p: number; c: number }>();
  let crossCursor = 0;
  for (const r of packOrder) {
    const compNodes = componentNodes.get(r)!;
    const laid = layoutComponent(compNodes, componentEdges.get(r)!, componentLoops.get(r)!, direction);
    const offset = crossCursor - laid.crossMin;
    for (const n of compNodes) {
      const pc = laid.centers.get(n.id)!;
      centers.set(n.id, { p: pc.p, c: pc.c + offset });
    }
    crossCursor += laid.crossMax - laid.crossMin + COMPONENT_GAP;
  }

  // --- (primary, cross) → (x, y) に戻す（ELK本体と同じく原点＋PADDINGへ正規化される）---
  // 成分パッキングの時点で cross の最小は0（ダミー込みの外接矩形基準）、primary の最小も
  // layerStart[0]=0 なので、ここでは PADDING を足すだけで正規化が完了する
  return {
    nodes: nodes.map((n) => {
      const c = centers.get(n.id)!;
      const w = n.width || DEFAULT_NODE_WIDTH;
      const h = n.height || DEFAULT_NODE_HEIGHT;
      const position =
        direction === 'RIGHT'
          ? { x: c.p - w / 2 + PADDING, y: c.c - h / 2 + PADDING }
          : { x: c.c - w / 2 + PADDING, y: c.p - h / 2 + PADDING };
      // ELKは最終座標を整数に丸めて返す。EDGE_THICKNESSが奇数なので通り道の隣は .5 刻みになり、
      // 丸めないと「ほぼ一致するが常に0.5ずれる」結果になる
      return { id: n.id, position: { x: Math.round(position.x), y: Math.round(position.y) } };
    }),
  };
}
