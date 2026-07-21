import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useMapStore } from '../stores/mapStore';
import { useUIStore } from '../stores/uiStore';
import { buildGraphRelations, getParentNodes } from '../utils/graphTraversal';
import { EMPTY_NODE_CONTENT } from '../utils/nodeContent';
import { MapNode } from '../types';

// ノード位置が既存のノードと重複しているかチェックし、重複している場合は位置をずらす
// offsetDirection: 'x' = X方向のみ, 'y' = Y方向のみ, 'both' = 両方向
function adjustPositionToAvoidOverlap(
  position: { x: number; y: number },
  existingNodes: MapNode[],
  offsetDirection: 'x' | 'y' | 'both' = 'both'
): { x: number; y: number } {
  let adjustedPosition = { ...position };
  let attempts = 0;
  const maxAttempts = 20;
  const offsetStep = 100; // ノードサイズを考慮したオフセット
  // ノードサイズに基づいた重複判定のしきい値
  const thresholdX = 150; // ノードの最小幅
  const thresholdY = 60;  // ノードの概算高さ

  while (attempts < maxAttempts) {
    const hasOverlap = existingNodes.some((node) => {
      const dx = Math.abs(node.position.x - adjustedPosition.x);
      const dy = Math.abs(node.position.y - adjustedPosition.y);

      // offsetDirectionに応じて重複判定の方向を決める
      if (offsetDirection === 'x') {
        // X方向にオフセットする場合、同じY座標帯にあるノードとのX方向の重複をチェック
        return dy < thresholdY && dx < thresholdX;
      } else if (offsetDirection === 'y') {
        // Y方向にオフセットする場合、同じX座標帯にあるノードとのY方向の重複をチェック
        return dx < thresholdX && dy < thresholdY;
      } else {
        // 両方向の場合
        return dx < thresholdX && dy < thresholdY;
      }
    });

    if (!hasOverlap) {
      break;
    }

    // 重複している場合は指定された方向に位置をずらす
    adjustedPosition = {
      x: adjustedPosition.x + (offsetDirection === 'y' ? 0 : offsetStep),
      y: adjustedPosition.y + (offsetDirection === 'x' ? 0 : offsetStep),
    };
    attempts++;
  }

  return adjustedPosition;
}

/**
 * 子ノード・兄弟ノード作成ロジック。
 * useKeyboardShortcuts（Tab/Enterキーバインド）とCustomNode（編集中Tab/Enterで確定して
 * ノードを作る操作）の両方から使われる共有ロジック。位置計算（レイアウト方向に応じた
 * ハンドル選択・重複回避）、作成、新ノードの選択、ビューポート外なら全体表示、までを担う
 */
export function useNodeCreation() {
  const { fitView, getViewport } = useReactFlow();
  const { currentMap, addNode } = useMapStore();
  const { setSelectedNodeId } = useUIStore();

  // ノードがビューポート内に表示されているかチェック
  const isNodeInViewport = useCallback(
    (nodePosition: { x: number; y: number }) => {
      const viewport = getViewport();
      // ビューポートの表示範囲を計算（おおよその値）
      const viewportWidth = window.innerWidth / viewport.zoom;
      const viewportHeight = window.innerHeight / viewport.zoom;
      const viewportX = -viewport.x / viewport.zoom;
      const viewportY = -viewport.y / viewport.zoom;

      const margin = 100; // マージンを設けて少し余裕を持たせる
      return (
        nodePosition.x >= viewportX - margin &&
        nodePosition.x <= viewportX + viewportWidth + margin &&
        nodePosition.y >= viewportY - margin &&
        nodePosition.y <= viewportY + viewportHeight + margin
      );
    },
    [getViewport]
  );

  // 子ノードを作成し、選択状態にする。新ノードのIDを返す（作成できなかった場合はundefined）
  const createChildNode = useCallback(
    (nodeId: string): string | undefined => {
      if (!currentMap) return undefined;
      const activeNode = currentMap.nodes.find((n) => n.id === nodeId);
      if (!activeNode) return undefined;

      // 子ノードの位置はレイアウト方向に応じて設定
      const direction = currentMap.layoutDirection;
      let childPosition = { x: activeNode.position.x, y: activeNode.position.y };
      let sourceHandle: string;
      let targetHandle: string;

      switch (direction) {
        case 'DOWN':
          childPosition = { x: activeNode.position.x, y: activeNode.position.y + 120 };
          sourceHandle = 'bottom';
          targetHandle = 'top';
          break;
        case 'RIGHT':
          childPosition = { x: activeNode.position.x + 200, y: activeNode.position.y };
          sourceHandle = 'right';
          targetHandle = 'left';
          break;
      }

      // 既存ノードとの重複を避ける
      const adjustedPosition = adjustPositionToAvoidOverlap(childPosition, currentMap.nodes);

      const newNodeId = addNode(
        {
          content: EMPTY_NODE_CONTENT,
          position: adjustedPosition,
        },
        nodeId,
        sourceHandle,
        targetHandle
      );

      if (newNodeId) {
        setSelectedNodeId(newNodeId);
        // ノードがビューポート外の場合は全体表示
        if (!isNodeInViewport(adjustedPosition)) {
          setTimeout(() => fitView({ padding: 0.2 }), 50);
        }
      }

      return newNodeId || undefined;
    },
    [currentMap, addNode, setSelectedNodeId, isNodeInViewport, fitView]
  );

  // 兄弟ノードを作成し、選択状態にする。新ノードのIDを返す（作成できなかった場合はundefined）
  const createSiblingNode = useCallback(
    (nodeId: string): string | undefined => {
      if (!currentMap) return undefined;
      const relations = buildGraphRelations(currentMap.nodes, currentMap.edges);
      const parents = getParentNodes(nodeId, relations, currentMap.nodes);
      const parentId = parents[0]?.id;
      const activeNode = currentMap.nodes.find((n) => n.id === nodeId);
      if (!activeNode) return undefined;

      // 兄弟ノードの位置はレイアウト方向に応じて設定
      const direction = currentMap.layoutDirection;
      let siblingPosition = { x: activeNode.position.x, y: activeNode.position.y };
      let sourceHandle: string | undefined;
      let targetHandle: string | undefined;
      let offsetDirection: 'x' | 'y';

      switch (direction) {
        case 'DOWN':
          // 縦方向レイアウトの場合、兄弟は横に配置
          siblingPosition = { x: activeNode.position.x + 200, y: activeNode.position.y };
          sourceHandle = 'bottom';
          targetHandle = 'top';
          offsetDirection = 'x'; // 重複時はX方向のみにオフセット
          break;
        case 'RIGHT':
          // 横方向レイアウトの場合、兄弟は縦に配置
          siblingPosition = { x: activeNode.position.x, y: activeNode.position.y + 100 };
          sourceHandle = 'right';
          targetHandle = 'left';
          offsetDirection = 'y'; // 重複時はY方向のみにオフセット
          break;
      }

      // 既存ノードとの重複を避ける（レイアウト方向に応じた方向にのみオフセット）
      const adjustedPosition = adjustPositionToAvoidOverlap(siblingPosition, currentMap.nodes, offsetDirection);

      const newNodeId = addNode(
        {
          content: EMPTY_NODE_CONTENT,
          position: adjustedPosition,
        },
        parentId, // 親がいない場合は undefined になり、独立ノードになる
        sourceHandle,
        targetHandle
      );

      if (newNodeId) {
        setSelectedNodeId(newNodeId);
        // ノードがビューポート外の場合は全体表示
        if (!isNodeInViewport(adjustedPosition)) {
          setTimeout(() => fitView({ padding: 0.2 }), 50);
        }
      }

      return newNodeId || undefined;
    },
    [currentMap, addNode, setSelectedNodeId, isNodeInViewport, fitView]
  );

  return { createChildNode, createSiblingNode };
}
