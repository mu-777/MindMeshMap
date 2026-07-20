import { useCallback } from 'react';
import { useMapStore } from '../stores/mapStore';
import { calculateLayout } from '../utils/layout';

export function useAutoLayout() {
  const { currentMap, updateNodePositions, saveToHistory } = useMapStore();

  // nodeIdsを2件以上指定すると、そのノード群（および両端が指定ノードに含まれるエッジ）だけを
  // ELKで整列し、非対象ノードは動かさない。整列結果は「元の選択ノード群の外接矩形の左上」に
  // 合わせて平行移動するため、画面外へ飛んだり無関係な位置に移動したりしない（fitViewもしない）。
  // nodeIdsを省略、または1件以下の場合は従来どおりマップ全体を整列する
  const applyLayout = useCallback(
    async (nodeIds?: string[]) => {
      if (!currentMap) return;

      if (nodeIds && nodeIds.length >= 2) {
        const targetIdSet = new Set(nodeIds);
        const targetNodes = currentMap.nodes.filter((node) => targetIdSet.has(node.id));
        if (targetNodes.length < 2) return;

        // 両端が対象ノードに含まれるエッジのみを使う（対象外ノードへつながるエッジを含めると
        // ELKがそのノードの方向まで考慮してレイアウトを歪めてしまうため）
        const targetEdges = currentMap.edges.filter(
          (edge) => targetIdSet.has(edge.source) && targetIdSet.has(edge.target)
        );

        // 元の対象ノード群の外接矩形の左上（ノードのposition＝左上座標のmin）
        const originalMinX = Math.min(...targetNodes.map((n) => n.position.x));
        const originalMinY = Math.min(...targetNodes.map((n) => n.position.y));

        const result = await calculateLayout(targetNodes, targetEdges, currentMap.layoutDirection);
        if (result.nodes.length === 0) return;

        // ELKレイアウト結果の外接矩形の左上
        const layoutMinX = Math.min(...result.nodes.map((n) => n.position.x));
        const layoutMinY = Math.min(...result.nodes.map((n) => n.position.y));

        // レイアウト結果の外接矩形の左上が、元の外接矩形の左上と一致するように平行移動する
        // （その場で整列させ、画面が飛ばないようにするため）
        const offsetX = originalMinX - layoutMinX;
        const offsetY = originalMinY - layoutMinY;

        const updatedPositions = result.nodes.map((node) => ({
          id: node.id,
          position: {
            x: node.position.x + offsetX,
            y: node.position.y + offsetY,
          },
        }));

        saveToHistory();
        updateNodePositions(updatedPositions);
      } else {
        // 全ノードをレイアウト
        const result = await calculateLayout(currentMap.nodes, currentMap.edges, currentMap.layoutDirection);

        saveToHistory();
        updateNodePositions(result.nodes);
      }
    },
    [currentMap, updateNodePositions, saveToHistory]
  );

  return { applyLayout };
}
