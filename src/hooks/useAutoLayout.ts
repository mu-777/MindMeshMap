import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useMapStore } from '../stores/mapStore';
import { calculateLayoutForAlign } from '../utils/alignAlgorithm';
import { useAlignAlgorithmDebug } from './useAlignAlgorithmDebug';
import { MapNode } from '../types';

export function useAutoLayout() {
  const { currentMap, updateNodePositions, saveToHistory } = useMapStore();
  // 整列アルゴリズム。本番ビルドでは常に既定（sugiyama-port）、devのみ切り替え可能（詳細はフック側参照）
  const [alignAlgorithm] = useAlignAlgorithmDebug();
  const { getNodes } = useReactFlow();

  // nodeIdsを2件以上指定すると、そのノード群（および両端が指定ノードに含まれるエッジ）だけを
  // ELKで整列し、非対象ノードは動かさない。整列結果は「元の選択ノード群の外接矩形の左上」に
  // 合わせて平行移動するため、画面外へ飛んだり無関係な位置に移動したりしない（fitViewもしない）。
  // nodeIdsを省略、または1件以下の場合は従来どおりマップ全体を整列する
  const applyLayout = useCallback(
    async (nodeIds?: string[]) => {
      if (!currentMap) return;

      // React Flowが実測したノード寸法（v12: node.measured）をMapNodeへマージする。
      // MapNode.width/heightは測定値が書き込まれないため、整列アルゴリズムは既定サイズ
      // （180x60）前提で計算しており、改行で高くなった/長文で幅広になったノードのサイズを
      // 知らずに詰めて重なってしまう不具合があった（docs/decisions.md参照）
      const measured = new Map(getNodes().map((n) => [n.id, n.measured]));
      const withMeasuredSize = (node: MapNode): MapNode => ({
        ...node,
        width: measured.get(node.id)?.width ?? node.width,
        height: measured.get(node.id)?.height ?? node.height,
      });

      if (nodeIds && nodeIds.length >= 2) {
        const targetIdSet = new Set(nodeIds);
        const targetNodes = currentMap.nodes.filter((node) => targetIdSet.has(node.id)).map(withMeasuredSize);
        if (targetNodes.length < 2) return;

        // 両端が対象ノードに含まれるエッジのみを使う（対象外ノードへつながるエッジを含めると
        // ELKがそのノードの方向まで考慮してレイアウトを歪めてしまうため）
        const targetEdges = currentMap.edges.filter(
          (edge) => targetIdSet.has(edge.source) && targetIdSet.has(edge.target)
        );

        // 元の対象ノード群の外接矩形の左上（ノードのposition＝左上座標のmin）
        const originalMinX = Math.min(...targetNodes.map((n) => n.position.x));
        const originalMinY = Math.min(...targetNodes.map((n) => n.position.y));

        const result = await calculateLayoutForAlign(
          targetNodes,
          targetEdges,
          currentMap.layoutDirection,
          alignAlgorithm
        );
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
        const result = await calculateLayoutForAlign(
          currentMap.nodes.map(withMeasuredSize),
          currentMap.edges,
          currentMap.layoutDirection,
          alignAlgorithm
        );

        saveToHistory();
        updateNodePositions(result.nodes);
      }
    },
    [currentMap, updateNodePositions, saveToHistory, alignAlgorithm, getNodes]
  );

  return { applyLayout };
}
