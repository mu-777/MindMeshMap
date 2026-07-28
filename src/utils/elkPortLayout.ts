// 整列アルゴリズム「elk-port」（方針F: ELK layeredのポート制約版）。
// 手順の詳細仕様はdocs/align-algorithms.md §5、採用理由・検討経緯はdocs/align-branch-layout.md「方針F」を参照。
//
// `uniform`（素のELK layered）はノードとエッジしかELKに渡さないため、どのハンドルから出た
// エッジかという情報は捨てられ、全エッジが単一の流れ方向で一様に流される。本方式は同じ
// ELK layeredに**ポート（=React Flowのハンドル）を明示的に渡す**版で、
// 「エッジがノードのどの面に取り付くか」を制約としてELKの交差最小化・エッジ配線に組み込む。
//   - 各ノードに、実際に使われているハンドル面ぶんだけポートを作る（上/下/左/右の最大4つ）。
//     React Flowのハンドルも各辺に1つずつ（CustomNode.tsx）なので、同じ面から出る複数の
//     エッジは同じポートを共有する＝実描画と同じモデルになる。
//   - ノードに `elk.portConstraints: FIXED_SIDE` を、各ポートに `elk.port.side` を与える。
//   - レイアウトオプションのそれ以外（INTERACTIVE戦略・spacing）は `uniform` と共有するため
//     （`ELK_BASE_LAYOUT_OPTIONS`）、差分安定性（docs/decisions.md §26）はそのまま引き継ぐ。
//
// **重要な限界（uniformとの違いは「取り付き面」だけで、伸びる向きではない）**:
// ELKのポート制約は単一の流れ方向（`elk.direction`）を保ったまま「エッジの取り付き面と順序」を
// 制御する仕組みで、「上ハンドルの枝だけ流れ方向を上向きに変える」ことはできない
// （docs/layout-prior-art.md P2・P3参照）。したがって下ハンドルに繋いだ子も RIGHT 方向では
// 右隣のレイヤーに置かれ、エッジだけが下面から出て回り込む。ハンドルの向きどおりに子を配置する
// のは `sugiyama-ext`（方針E）の役割であり、本方式はその契約（HANDLE_DIRECTION）を持たない。
import ELK, { ElkNode } from 'elkjs/lib/elk.bundled.js';
import { MapNode, MapEdge, LayoutDirection } from '../types';
import { LayoutResult, ELK_BASE_LAYOUT_OPTIONS } from './layout';
import { classifyEdgeSide, HandleSide } from './branchLayout';

const elk = new ELK();

const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 60;

// ポートを作る順序。ELKのポート順序そのものには影響しないが（FIXED_SIDEなので面だけが固定で、
// 面内の位置はELKが決める）、同じ入力に対して常に同じグラフを組むための決定的な順序
const SIDES: HandleSide[] = ['right', 'bottom', 'left', 'top'];

/**
 * ハンドル側 → ELKのポート面（`elk.port.side`）。描画上の実際の面に1対1で対応させる
 * （React Flowのハンドルは辺の位置そのものなので、方向で回転させたりはしない。
 * ELK側が `elk.direction` に応じた内部的な回転を吸収する）
 */
const PORT_SIDE: Record<HandleSide, 'NORTH' | 'SOUTH' | 'EAST' | 'WEST'> = {
  top: 'NORTH',
  bottom: 'SOUTH',
  left: 'WEST',
  right: 'EAST',
};

const OPPOSITE_SIDE: Record<HandleSide, HandleSide> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

// ポートの大きさ(px)。0にするとポート位置が辺上の1点になり、React Flowのハンドル位置
// （辺の中点）および評価環境のアンカー計算（e2e/lib/layout-metrics.mjsのanchorOf）と一致する。
// 正の値にするとポートがノードの外側に張り出し、そのぶんレイヤー間隔が広がる
const PORT_SIZE = 0;

/**
 * ポートIDはノードIDに面を接尾する。ELKは `sources`/`targets` をノードIDとポートIDの
 * どちらとしても解決するため、既存ノードIDと衝突しない形にする必要がある
 * （ノードIDは `generateId()` の `<epoch>-<英数字>` 形式でコロンを含まない）
 */
function portId(nodeId: string, side: HandleSide): string {
  return `${nodeId}::${side}`;
}

/**
 * エッジの入力側（ターゲット）がどの面に取り付くかを決める。
 * `targetHandle` が有効ならそれを使い、無効・未設定（旧データ等）ならソース側の面の
 * 反対面にフォールバックする（右から出た枝は相手の左面に入る、という自然な向き合い方。
 * MindMapCanvas.tsx のドラッグ接続・キーボード作成もこの向きで `targetHandle` を記録する）
 */
function resolveTargetSide(edge: MapEdge, sourceSide: HandleSide): HandleSide {
  const handle = edge.targetHandle;
  if (handle === 'top' || handle === 'bottom' || handle === 'left' || handle === 'right') {
    return handle;
  }
  return OPPOSITE_SIDE[sourceSide];
}

/**
 * 「elk-port」アルゴリズムのエントリポイント。
 * ELK layered にハンドルをポートとして渡し、取り付き面を制約に含めて配置する
 */
export async function calculateElkPortLayout(
  nodes: MapNode[],
  edges: MapEdge[],
  direction: LayoutDirection
): Promise<LayoutResult> {
  if (nodes.length === 0) {
    return { nodes: [] };
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  // 端点が欠けたエッジはELKがポートを解決できずレイアウト実行ごと失敗するため、ここで除外する
  const validEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  // 各エッジの取り付き面を先に確定し、ノードごとに「実際に使われている面」を集める。
  // 使われていない面のポートは作らない（空ポートはELKの間隔計算を無駄に膨らませるだけ）
  const edgeSides = validEdges.map((e) => {
    const source = classifyEdgeSide(e, direction);
    return { source, target: resolveTargetSide(e, source) };
  });
  const usedSides = new Map<string, Set<HandleSide>>(nodes.map((n) => [n.id, new Set<HandleSide>()]));
  validEdges.forEach((e, i) => {
    usedSides.get(e.source)!.add(edgeSides[i].source);
    usedSides.get(e.target)!.add(edgeSides[i].target);
  });

  // 現在のノード位置をヒントとして渡す点はuniform（runElkLayout）と同じ。
  // 差分的レイアウト（現在の階層・兄弟順・循環エッジの向きを保つ。docs/decisions.md §26）
  const graph = {
    id: 'root',
    layoutOptions: { ...ELK_BASE_LAYOUT_OPTIONS, 'elk.direction': direction },
    children: nodes.map((n) => {
      const sides = SIDES.filter((s) => usedSides.get(n.id)!.has(s));
      return {
        id: n.id,
        width: n.width || DEFAULT_NODE_WIDTH,
        height: n.height || DEFAULT_NODE_HEIGHT,
        x: n.position.x,
        y: n.position.y,
        // ポートを持つノードだけ面を固定する（孤立ノードには不要）
        layoutOptions: (sides.length > 0
          ? { 'elk.portConstraints': 'FIXED_SIDE' }
          : {}) as Record<string, string>,
        ports: sides.map((s) => ({
          id: portId(n.id, s),
          width: PORT_SIZE,
          height: PORT_SIZE,
          layoutOptions: { 'elk.port.side': PORT_SIDE[s] },
        })),
      };
    }),
    edges: validEdges.map((e, i) => ({
      id: e.id,
      sources: [portId(e.source, edgeSides[i].source)],
      targets: [portId(e.target, edgeSides[i].target)],
    })),
  };

  try {
    const layoutedGraph = await elk.layout(graph);

    const layoutedNodes = (layoutedGraph.children || []).map((node: ElkNode) => ({
      id: node.id,
      position: { x: node.x || 0, y: node.y || 0 },
    }));

    return { nodes: layoutedNodes };
  } catch (error) {
    console.error('Port-constrained layout calculation failed:', error);
    // フォールバック：元の位置を返す（runElkLayoutと同じ扱い）
    return { nodes: nodes.map((n) => ({ id: n.id, position: n.position })) };
  }
}
