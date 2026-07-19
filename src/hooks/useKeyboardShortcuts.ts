import { useEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useReactFlow } from '@xyflow/react';
import { useMapStore } from '../stores/mapStore';
import { useUIStore } from '../stores/uiStore';
import { useKeybindStore } from '../stores/keybindStore';
import { useConfirmStore } from '../stores/confirmStore';
import { useAutoLayout } from './useAutoLayout';
import { useSaveMap } from './useSaveMap';
import { useNodeCreation } from './useNodeCreation';
import { getNearestNodeInDirection } from '../utils/graphTraversal';
import { LayoutDirection } from '../types';

export function useKeyboardShortcuts() {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const { currentMap, deleteNode, deleteNodes, deleteEdge, undo, redo, setLayoutDirection } = useMapStore();
  const { setSelectedNodeId, setSelectedEdgeId, setEditingNodeId, setPendingEditClear, setHelpModalOpen, clearMultiSelection } = useUIStore();
  const { getActionForKey } = useKeybindStore();
  const { isOpen: isConfirmDialogOpen } = useConfirmStore();
  const { applyLayout } = useAutoLayout();
  const { save } = useSaveMap();
  const { createChildNode, createSiblingNode } = useNodeCreation();

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // 常に最新のUI状態を読む（useUIStore()の分割代入だと、CustomNode側のeditorProps.handleKeyDown
      // がflushSyncで同じkeydownイベント処理中に状態を更新した場合、このコールバック自身の
      // 再生成（useCallbackの依存配列変更→useEffectでの再登録）が間に合わず、レンダー時点の
      // 古い値を参照し続けてしまう可能性がある。zustandのgetState()は常に最新値を同期的に返す
      const {
        selectedNodeId,
        selectedNodeIds,
        selectedEdgeId,
        lastSelectedNodeId,
        editingNodeId,
        isHelpModalOpen,
      } = useUIStore.getState();

      // ヘルプモーダル表示中（キーバインドキャプチャ含む）・確認ダイアログ表示中は
      // グローバルショートカットを無効化する（Delete等の誤発火を防ぐ）
      if (isHelpModalOpen || isConfirmDialogOpen) {
        return;
      }

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

      // 選択中のノードID（未選択の場合は直近選択されていたノード）
      const activeNodeId = selectedNodeId || lastSelectedNodeId;

      if (!action) {
        // ヘルプ表示（?キー）
        if (event.key === '?' || (event.shiftKey && event.key === '/')) {
          event.preventDefault();
          setHelpModalOpen(true);
          return;
        }

        // armed-focus方式（CustomNode）でノードのTiptapエディタに既にフォーカスがある場合は、
        // CustomNode側のeditorProps.handleKeyDownが既にこのキー入力の処理（編集モード開始）を
        // 済ませているため、ここでは二重に処理しない。以下のフォールバックは、armedになって
        // いないケース（タッチ選択後に物理キーボードで入力した場合等）専用
        const target = event.target as HTMLElement | null;
        const isTargetInEditor = !!target?.closest('.ProseMirror');

        // ノードが選択されている状態で、印刷可能文字が入力された場合、編集モードに入る
        // 条件: 単一文字、Ctrl/Alt/Metaキーなし、ノードが選択されている
        //
        // ここでは event.preventDefault() を呼ばない。代わりに flushSync で状態更新を
        // 同期的にフラッシュし、この同じ keydown イベントに対するブラウザのデフォルト処理
        // （Tiptapのcontenteditableへのテキスト入力/IME変換開始）が、フォーカス移動後の
        // エディタ要素に対して行われるようにする。こうすることで1文字目からIME変換が正しく効く
        // （文字を横取りしてinsertContentする方式だと、変換を経ない生のASCIIが入ってしまうため）
        if (
          activeNodeId &&
          event.key.length === 1 &&
          !modifiers.ctrl &&
          !modifiers.alt &&
          !isTargetInEditor
        ) {
          flushSync(() => {
            setSelectedNodeId(activeNodeId);
            setPendingEditClear(true);
            setEditingNodeId(activeNodeId);
          });
        }
        return;
      }

      event.preventDefault();

      switch (action) {
        case 'createChildNode': {
          if (activeNodeId) {
            createChildNode(activeNodeId);
          }
          break;
        }

        case 'createSiblingNode': {
          if (activeNodeId) {
            createSiblingNode(activeNodeId);
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
          } else if (selectedEdgeId) {
            // ノードが未選択でエッジが選択されている場合はエッジを削除する。
            // selectedNodeIdとselectedEdgeIdはuiStoreで排他管理されているため、
            // ここに到達する時点でselectedNodeIdは必ずnull（＝ノード未選択）。
            // activeNodeId（未選択時にlastSelectedNodeIdへフォールバックする値）による
            // ノード削除より、明示的に選択されたエッジの削除を優先する
            deleteEdge(selectedEdgeId);
            setSelectedEdgeId(null);
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
            // 選択されているノードがない場合は、まず直近選択されていたノードを選択
            if (!selectedNodeId && lastSelectedNodeId) {
              const lastNode = currentMap.nodes.find((n) => n.id === lastSelectedNodeId);
              if (lastNode) {
                setSelectedNodeId(lastSelectedNodeId);
                break;
              }
            }
            const nodeId = activeNodeId || currentMap.nodes[0].id;
            const targetNode = getNearestNodeInDirection(nodeId, 'up', currentMap.nodes);
            if (targetNode) {
              setSelectedNodeId(targetNode.id);
            }
          }
          break;
        }

        case 'selectChild': {
          if (currentMap && currentMap.nodes.length > 0) {
            // 選択されているノードがない場合は、まず直近選択されていたノードを選択
            if (!selectedNodeId && lastSelectedNodeId) {
              const lastNode = currentMap.nodes.find((n) => n.id === lastSelectedNodeId);
              if (lastNode) {
                setSelectedNodeId(lastSelectedNodeId);
                break;
              }
            }
            const nodeId = activeNodeId || currentMap.nodes[0].id;
            const targetNode = getNearestNodeInDirection(nodeId, 'down', currentMap.nodes);
            if (targetNode) {
              setSelectedNodeId(targetNode.id);
            }
          }
          break;
        }

        case 'selectPrevSibling': {
          if (currentMap && currentMap.nodes.length > 0) {
            // 選択されているノードがない場合は、まず直近選択されていたノードを選択
            if (!selectedNodeId && lastSelectedNodeId) {
              const lastNode = currentMap.nodes.find((n) => n.id === lastSelectedNodeId);
              if (lastNode) {
                setSelectedNodeId(lastSelectedNodeId);
                break;
              }
            }
            const nodeId = activeNodeId || currentMap.nodes[0].id;
            const targetNode = getNearestNodeInDirection(nodeId, 'left', currentMap.nodes);
            if (targetNode) {
              setSelectedNodeId(targetNode.id);
            }
          }
          break;
        }

        case 'selectNextSibling': {
          if (currentMap && currentMap.nodes.length > 0) {
            // 選択されているノードがない場合は、まず直近選択されていたノードを選択
            if (!selectedNodeId && lastSelectedNodeId) {
              const lastNode = currentMap.nodes.find((n) => n.id === lastSelectedNodeId);
              if (lastNode) {
                setSelectedNodeId(lastSelectedNodeId);
                break;
              }
            }
            const nodeId = activeNodeId || currentMap.nodes[0].id;
            const targetNode = getNearestNodeInDirection(nodeId, 'right', currentMap.nodes);
            if (targetNode) {
              setSelectedNodeId(targetNode.id);
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
          save();
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
      isConfirmDialogOpen,
      getActionForKey,
      createChildNode,
      createSiblingNode,
      deleteNode,
      deleteNodes,
      deleteEdge,
      undo,
      redo,
      save,
      setLayoutDirection,
      setSelectedNodeId,
      setSelectedEdgeId,
      setEditingNodeId,
      setPendingEditClear,
      setHelpModalOpen,
      clearMultiSelection,
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
