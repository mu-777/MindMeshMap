import ELK, { ElkNode } from 'elkjs/lib/elk.bundled.js';
import { MapNode, MapEdge, LayoutDirection } from '../types';

const elk = new ELK();

export interface LayoutResult {
  nodes: { id: string; position: { x: number; y: number } }[];
}

// ELKのlayoutOptionsのうち、方向（elk.direction）以外の共通部分。INTERACTIVE戦略・spacingは
// ここに一本化し、内容は変更しないこと（変えるとe2e/layout-stability.mjsがドリフト検出で
// 意図的にFAILする）。runElkLayoutだけでなく、独自にELKグラフを組み立てる
// elkPortLayout.ts（方針F: ポート制約版）もこの定数を共有し、§26の差分安定性を引き継ぐ
export const ELK_BASE_LAYOUT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.spacing.nodeNode': '50',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  // 循環エッジの逆転方向を現在座標から決める
  'elk.layered.cycleBreaking.strategy': 'INTERACTIVE',
  // レイヤー割り当てを現在位置に寄せる
  'elk.layered.layering.strategy': 'INTERACTIVE',
  // ノードの配置
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  // 兄弟ノードの並び順を現在の左右/上下関係から初期化する
  'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',
};

// ELKグラフの構築・layout()呼び出し・結果整形・エラー時フォールバックを行う低レベル関数。
// calculateLayout（マップ全体・部分整列向けの薄いラッパー）だけでなく、branchLayout.ts /
// flatAxisLayout.ts（docs/align-branch-layout.md参照）からも共通で使う
export async function runElkLayout(
  nodes: MapNode[],
  edges: MapEdge[],
  elkDirection: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT',
  nodeWidth: number = 180,
  nodeHeight: number = 60
): Promise<LayoutResult> {
  if (nodes.length === 0) {
    return { nodes: [] };
  }

  // 現在のノード位置をヒントとして渡し、整列前の配置（階層・兄弟順・循環エッジの向き）を
  // なるべく保つ差分的レイアウトにする（docs/decisions.md §26）
  const graph = {
    id: 'root',
    layoutOptions: { ...ELK_BASE_LAYOUT_OPTIONS, 'elk.direction': elkDirection },
    children: nodes.map((n) => ({
      id: n.id,
      width: n.width || nodeWidth,
      height: n.height || nodeHeight,
      x: n.position.x,
      y: n.position.y,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  };

  try {
    const layoutedGraph = await elk.layout(graph);

    const layoutedNodes = (layoutedGraph.children || []).map((node: ElkNode) => ({
      id: node.id,
      position: {
        x: node.x || 0,
        y: node.y || 0,
      },
    }));

    return { nodes: layoutedNodes };
  } catch (error) {
    console.error('Layout calculation failed:', error);
    // フォールバック：元の位置を返す
    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        position: n.position,
      })),
    };
  }
}

// 既存の公開シグネチャ（マップ全体・部分整列向け）を維持する薄いラッパー。
// LayoutDirection（'DOWN'|'RIGHT'）はrunElkLayoutが受け取るELK方向の部分集合なので、
// そのままelkDirectionとして渡せる
export async function calculateLayout(
  nodes: MapNode[],
  edges: MapEdge[],
  direction: LayoutDirection,
  nodeWidth: number = 180,
  nodeHeight: number = 60
): Promise<LayoutResult> {
  return runElkLayout(nodes, edges, direction, nodeWidth, nodeHeight);
}
