import { useEffect, useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useMapStore } from '../stores/mapStore';
import { useUIStore } from '../stores/uiStore';
import { useKeybindStore } from '../stores/keybindStore';
import { useAutoLayout } from './useAutoLayout';
import {
  buildGraphRelations,
  getParentNodes,
  getNearestNodeInDirection,
} from '../utils/graphTraversal';
import { LayoutDirection, MapNode } from '../types';

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

export function useKeyboardShortcuts() {
  const { fitView, zoomIn, zoomOut, getViewport } = useReactFlow();
  const { currentMap, addNode, deleteNode, deleteNodes, undo, redo, setLayoutDirection } = useMapStore();
  const {
    selectedNodeId,
    selectedNodeIds,
    lastSelectedNodeId,
    editingNodeId,
    setSelectedNodeId,
    setEditingNodeId,
    setHelpModalOpen,
    clearMultiSelection,
  } = useUIStore();
  const { getActionForKey } = useKeybindStore();
  const { applyLayout } = useAutoLayout();

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

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // 編集中は特定のキーのみ処理
      if (editingNodeId) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setEditingNodeId(null);
        }
        return;
      }

      // モディファイアキーの状態
      const modifiers = {
        ctrl: event.ctrlKey || event.metaKey,
        shift: event.shiftKey,
        alt: event.altKey,
      };

      const action = getActionForKey(event.key, modifiers);

      if (!action) {
        // ヘルプ表示（?キー）
        if (event.key === '?' || (event.shiftKey && event.key === '/')) {
          event.preventDefault();
          setHelpModalOpen(true);
        }
        return;
      }

      event.preventDefault();

      // 選択中のノードID（未選択の場合は直近選択されていたノード）
      const activeNodeId = selectedNodeId || lastSelectedNodeId;

      switch (action) {
        case 'createChildNode': {
          if (activeNodeId && currentMap) {
            const activeNode = currentMap.nodes.find((n) => n.id === activeNodeId);
            if (activeNode) {
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
                  content: JSON.stringify({
                    type: 'doc',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: '新しいノード' }] }],
                  }),
                  position: adjustedPosition,
                },
                activeNodeId,
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
            }
          }
          break;
        }

        case 'createSiblingNode': {
          if (activeNodeId && currentMap) {
            const relations = buildGraphRelations(currentMap.nodes, currentMap.edges);
            const parents = getParentNodes(activeNodeId, relations, currentMap.nodes);
            const parentId = parents[0]?.id;
            const activeNode = currentMap.nodes.find((n) => n.id === activeNodeId);

            if (activeNode) {
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
                  content: JSON.stringify({
                    type: 'doc',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: '新しいノード' }] }],
                  }),
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
            }
          } else if (currentMap && currentMap.nodes.length > 0) {
            // 何も選択されていない場合は、最初のノードを選択
            setSelectedNodeId(currentMap.nodes[0].id);
          }
          break;
        }

        case 'deleteNode': {
          // 複数ノード選択時は複数削除
          if (selectedNodeIds.length > 0) {
            deleteNodes(selectedNodeIds);
            clearMultiSelection();
            setSelectedNodeId(null);
          } else if (activeNodeId) {
            deleteNode(activeNodeId);
            setSelectedNodeId(null);
          }
          break;
        }

        case 'editNode': {
          if (activeNodeId) {
            setSelectedNodeId(activeNodeId);
            setEditingNodeId(activeNodeId);
          }
          break;
        }

        case 'finishEdit': {
          setEditingNodeId(null);
          break;
        }

        case 'selectParent': {
          if (currentMap && currentMap.nodes.length > 0) {
            const nodeId = activeNodeId || currentMap.nodes[0].id;
            const targetNode = getNearestNodeInDirection(nodeId, 'up', currentMap.nodes);
            if (targetNode) {
              setSelectedNodeId(targetNode.id);
            } else if (!selectedNodeId && lastSelectedNodeId) {
              // 方向にノードがない場合、直近のノードを選択
              setSelectedNodeId(lastSelectedNodeId);
            }
          }
          break;
        }

        case 'selectChild': {
          if (currentMap && currentMap.nodes.length > 0) {
            const nodeId = activeNodeId || currentMap.nodes[0].id;
            const targetNode = getNearestNodeInDirection(nodeId, 'down', currentMap.nodes);
            if (targetNode) {
              setSelectedNodeId(targetNode.id);
            } else if (!selectedNodeId && lastSelectedNodeId) {
              setSelectedNodeId(lastSelectedNodeId);
            }
          }
          break;
        }

        case 'selectPrevSibling': {
          if (currentMap && currentMap.nodes.length > 0) {
            const nodeId = activeNodeId || currentMap.nodes[0].id;
            const targetNode = getNearestNodeInDirection(nodeId, 'left', currentMap.nodes);
            if (targetNode) {
              setSelectedNodeId(targetNode.id);
            } else if (!selectedNodeId && lastSelectedNodeId) {
              setSelectedNodeId(lastSelectedNodeId);
            }
          }
          break;
        }

        case 'selectNextSibling': {
          if (currentMap && currentMap.nodes.length > 0) {
            const nodeId = activeNodeId || currentMap.nodes[0].id;
            const targetNode = getNearestNodeInDirection(nodeId, 'right', currentMap.nodes);
            if (targetNode) {
              setSelectedNodeId(targetNode.id);
            } else if (!selectedNodeId && lastSelectedNodeId) {
              setSelectedNodeId(lastSelectedNodeId);
            }
          }
          break;
        }

        case 'undo': {
          undo();
          break;
        }

        case 'redo': {
          redo();
          break;
        }

        case 'save': {
          // Google Drive保存（Toolbar側で実装済み）
          console.log('Save triggered');
          break;
        }

        case 'zoomIn': {
          zoomIn();
          break;
        }

        case 'zoomOut': {
          zoomOut();
          break;
        }

        case 'fitView': {
          fitView({ padding: 0.2 });
          break;
        }

        case 'toggleLayoutDirection': {
          if (currentMap) {
            const directions: LayoutDirection[] = ['DOWN', 'RIGHT'];
            const currentIndex = directions.indexOf(currentMap.layoutDirection);
            const nextDirection = directions[(currentIndex + 1) % directions.length];
            setLayoutDirection(nextDirection);
            applyLayout();
          }
          break;
        }
      }
    },
    [
      currentMap,
      selectedNodeId,
      selectedNodeIds,
      lastSelectedNodeId,
      editingNodeId,
      getActionForKey,
      addNode,
      deleteNode,
      deleteNodes,
      undo,
      redo,
      setLayoutDirection,
      setSelectedNodeId,
      setEditingNodeId,
      setHelpModalOpen,
      clearMultiSelection,
      fitView,
      zoomIn,
      zoomOut,
      applyLayout,
      isNodeInViewport,
    ]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
}
