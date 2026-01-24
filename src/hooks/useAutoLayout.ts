import { useCallback } from 'react';
import { useMapStore } from '../stores/mapStore';
import { calculateLayout } from '../utils/layout';

export function useAutoLayout() {
  const { currentMap, updateNodePositions } = useMapStore();

  const applyLayout = useCallback(async () => {
    if (!currentMap) return;

    const result = await calculateLayout(
      currentMap.nodes,
      currentMap.edges,
      currentMap.layoutDirection
    );

    updateNodePositions(result.nodes);
  }, [currentMap, updateNodePositions]);

  return { applyLayout };
}
