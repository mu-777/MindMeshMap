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
import { LayoutDirection } from '../types';

export function useKeyboardShortcuts() {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const { currentMap, addNode, deleteNode, undo, redo, setLayoutDirection } = useMapStore();
  const {
    selectedNodeId,
    lastSelectedNodeId,
    editingNodeId,
    setSelectedNodeId,
    setEditingNodeId,
    setHelpModalOpen,
  } = useUIStore();
  const { getActionForKey } = useKeybindStore();
  const { applyLayout } = useAutoLayout();

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

              switch (direction) {
                case 'DOWN':
                  childPosition = { x: activeNode.position.x, y: activeNode.position.y + 120 };
                  break;
                case 'UP':
                  childPosition = { x: activeNode.position.x, y: activeNode.position.y - 120 };
                  break;
                case 'RIGHT':
                  childPosition = { x: activeNode.position.x + 200, y: activeNode.position.y };
                  break;
                case 'LEFT':
                  childPosition = { x: activeNode.position.x - 200, y: activeNode.position.y };
                  break;
              }

              const newNodeId = addNode(
                {
                  content: JSON.stringify({
                    type: 'doc',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: '新しいノード' }] }],
                  }),
                  position: childPosition,
                },
                activeNodeId
              );
              if (newNodeId) {
                setSelectedNodeId(newNodeId);
                // レイアウトを適用して正しい位置に配置
                setTimeout(() => applyLayout(), 10);
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

              switch (direction) {
                case 'DOWN':
                case 'UP':
                  // 縦方向レイアウトの場合、兄弟は横に配置
                  siblingPosition = { x: activeNode.position.x + 200, y: activeNode.position.y };
                  break;
                case 'RIGHT':
                case 'LEFT':
                  // 横方向レイアウトの場合、兄弟は縦に配置
                  siblingPosition = { x: activeNode.position.x, y: activeNode.position.y + 100 };
                  break;
              }

              const newNodeId = addNode(
                {
                  content: JSON.stringify({
                    type: 'doc',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: '新しいノード' }] }],
                  }),
                  position: siblingPosition,
                },
                parentId // 親がいない場合は undefined になり、独立ノードになる
              );
              if (newNodeId) {
                setSelectedNodeId(newNodeId);
                // レイアウトを適用
                setTimeout(() => applyLayout(), 10);
              }
            }
          } else if (currentMap && currentMap.nodes.length > 0) {
            // 何も選択されていない場合は、最初のノードを選択
            setSelectedNodeId(currentMap.nodes[0].id);
          }
          break;
        }

        case 'deleteNode': {
          if (activeNodeId) {
            deleteNode(activeNodeId);
            setSelectedNodeId(null);
            applyLayout();
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
            const directions: LayoutDirection[] = ['DOWN', 'RIGHT', 'UP', 'LEFT'];
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
      lastSelectedNodeId,
      editingNodeId,
      getActionForKey,
      addNode,
      deleteNode,
      undo,
      redo,
      setLayoutDirection,
      setSelectedNodeId,
      setEditingNodeId,
      setHelpModalOpen,
      fitView,
      zoomIn,
      zoomOut,
      applyLayout,
    ]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
}
