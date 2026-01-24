import { useCallback } from 'react';
import { useMapStore } from '../stores/mapStore';
import { useUIStore } from '../stores/uiStore';
import { calculateLayout } from '../utils/layout';

export function useAutoLayout() {
  const { currentMap, updateNodePositions } = useMapStore();
  const { selectedNodeId, selectedNodeIds } = useUIStore();

  const applyLayout = useCallback(async () => {
    if (!currentMap) return;

    // 選択されたノードIDを収集
    const selectedIds = new Set<string>();
    if (selectedNodeId) {
      selectedIds.add(selectedNodeId);
    }
    selectedNodeIds.forEach((id) => selectedIds.add(id));

    // 選択されたノードがある場合、選択されたノードとその関連ノードだけをレイアウト
    if (selectedIds.size > 0) {
      // 選択されたノードに関連するエッジを取得
      const relatedEdges = currentMap.edges.filter(
        (edge) => selectedIds.has(edge.source) || selectedIds.has(edge.target)
      );

      // 関連するノードIDを収集（選択されたノードと接続先のノード）
      const relatedNodeIds = new Set<string>(selectedIds);
      relatedEdges.forEach((edge) => {
        relatedNodeIds.add(edge.source);
        relatedNodeIds.add(edge.target);
      });

      // 関連ノードだけを抽出
      const relatedNodes = currentMap.nodes.filter((node) => relatedNodeIds.has(node.id));

      // 選択されたノードの位置を基準にしてオフセットを計算
      const firstSelectedNode = currentMap.nodes.find((n) => selectedIds.has(n.id));
      const offsetX = firstSelectedNode?.position.x || 0;
      const offsetY = firstSelectedNode?.position.y || 0;

      const result = await calculateLayout(
        relatedNodes,
        relatedEdges,
        currentMap.layoutDirection
      );

      // レイアウト結果のオフセットを調整（選択されたノードの元の位置を基準に）
      const layoutFirstNode = result.nodes.find((n) => selectedIds.has(n.id));
      const layoutOffsetX = layoutFirstNode?.position.x || 0;
      const layoutOffsetY = layoutFirstNode?.position.y || 0;

      // 選択されたノードのみ位置を更新（接続先のノードは動かさない）
      const updatedPositions = result.nodes
        .filter((node) => selectedIds.has(node.id))
        .map((node) => ({
          id: node.id,
          position: {
            x: node.position.x - layoutOffsetX + offsetX,
            y: node.position.y - layoutOffsetY + offsetY,
          },
        }));

      updateNodePositions(updatedPositions);
    } else {
      // 全ノードをレイアウト
      const result = await calculateLayout(
        currentMap.nodes,
        currentMap.edges,
        currentMap.layoutDirection
      );

      updateNodePositions(result.nodes);
    }
  }, [currentMap, updateNodePositions, selectedNodeId, selectedNodeIds]);

  return { applyLayout };
}
