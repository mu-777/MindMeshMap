import ELK, { ElkNode } from 'elkjs/lib/elk.bundled.js';
import { MapNode, MapEdge, LayoutDirection } from '../types';

const elk = new ELK();

// ELK方向マッピング
const directionMap: Record<LayoutDirection, string> = {
  DOWN: 'DOWN',
  UP: 'UP',
  RIGHT: 'RIGHT',
  LEFT: 'LEFT',
};

export interface LayoutResult {
  nodes: { id: string; position: { x: number; y: number } }[];
}

export async function calculateLayout(
  nodes: MapNode[],
  edges: MapEdge[],
  direction: LayoutDirection,
  nodeWidth: number = 180,
  nodeHeight: number = 60
): Promise<LayoutResult> {
  if (nodes.length === 0) {
    return { nodes: [] };
  }

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': directionMap[direction],
      'elk.spacing.nodeNode': '50',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      // 循環エッジの処理方法
      'elk.layered.cycleBreaking.strategy': 'GREEDY',
      // ノードの配置
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      // エッジのルーティング
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    },
    children: nodes.map((n) => ({
      id: n.id,
      width: n.width || nodeWidth,
      height: n.height || nodeHeight,
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
