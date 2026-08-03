import { useEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useReactFlow, useStoreApi } from '@xyflow/react';
import { useMapStore } from '../stores/mapStore';
import { useUIStore } from '../stores/uiStore';
import { useKeybindStore } from '../stores/keybindStore';
import { useConfirmStore } from '../stores/confirmStore';
import { useAutoLayout } from './useAutoLayout';
import { useSaveMap } from './useSaveMap';
import { useNodeCreation } from './useNodeCreation';
import { getNearestNodeInDirection, getNearestNodeInDirectionFromPoint } from '../utils/graphTraversal';
import { LayoutDirection } from '../types';

export function useKeyboardShortcuts() {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  // Controls左下の「Toggle interactivity」ロック状態を判定するため、React Flowストアに
  // 直接アクセスする（MindMapCanvas.tsxと同じ判定基準。docs/decisions.md参照）
  const store = useStoreApi();
  const { currentMap, deleteNodesAndEdges, undo, redo, setLayoutDirection } = useMapStore();
  const { setSelectedNodeId, setEditingNodeId, setHelpModalOpen, clearMultiSelection, clearEdgeSelection, setDeletedFocusAnchor } = useUIStore();
  const { getActionForKey } = useKeybindStore();
  const { isOpen: isConfirmDialogOpen } = useConfirmStore();
  const { applyLayout } = useAutoLayout();
  const { save } = useSaveMap();
  const { createChildNode, createSiblingNode, createOlderSiblingNode, createParentNode } = useNodeCreation();

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // 常に最新のUI状態を読む（useUIStore()の分割代入だと、CustomNode側のeditorProps.handleKeyDown
      // がflushSyncで同じkeydownイベント処理中に状態を更新した場合、このコールバック自身の
      // 再生成（useCallbackの依存配列変更→useEffectでの再登録）が間に合わず、レンダー時点の
      // 古い値を参照し続けてしまう可能性がある。zustandのgetState()は常に最新値を同期的に返す
      const {
        selectedNodeId,
        selectedNodeIds,
        selectedEdgeIds,
        lastSelectedNodeId,
        editingNodeId,
        isHelpModalOpen,
        jsonTextDialogMode,
        deletedFocusAnchor,
      } = useUIStore.getState();

      // ヘルプモーダル表示中（キーバインドキャプチャ含む）・確認ダイアログ表示中・
      // JSONテキスト入出力ダイアログ表示中はグローバルショートカットを無効化する
      // （Delete等の誤発火や、テキストエリアへの入力でノード編集が始まるのを防ぐ）
      if (isHelpModalOpen || isConfirmDialogOpen || jsonTextDialogMode) {
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
            setEditingNodeId(activeNodeId);
          });
        }
        return;
      }

      event.preventDefault();

      switch (action) {
        // ノード新規作成の4アクションは、Controls左下の「Toggle interactivity」ロック中は
        // 全て禁止する（ダブルクリック/長押し/ハンドルドラッグと同じ判定基準。docs/decisions.md参照）
        case 'createChildNode': {
          if (!store.getState().nodesConnectable) break;
          if (activeNodeId) {
            createChildNode(activeNodeId);
          }
          break;
        }

        case 'createSiblingNode': {
          if (!store.getState().nodesConnectable) break;
          if (activeNodeId) {
            createSiblingNode(activeNodeId);
          } else if (currentMap && currentMap.nodes.length > 0) {
            // 何も選択されていない場合は、最初のノードを選択
            setSelectedNodeId(currentMap.nodes[0].id);
          }
          break;
        }

        case 'createOlderSiblingNode': {
          if (!store.getState().nodesConnectable) break;
          if (activeNodeId) {
            createOlderSiblingNode(activeNodeId);
          }
          break;
        }

        case 'createParentNode': {
          if (!store.getState().nodesConnectable) break;
          if (activeNodeId) {
            createParentNode(activeNodeId);
          }
          break;
        }

        case 'deleteNode': {
          // 選択中のノード（selectedNodeIds、なければselectedNodeId単体）と
          // 選択中のエッジ（selectedEdgeIds）をまとめて削除する。
          // lastSelectedNodeIdへのフォールバック（activeNodeId）はここでは使わない
          // （キャンバス空白クリック等で明示的に選択解除された後の「直近選択ノード」を
          // Deleteキーで誤って削除してしまわないようにするため）
          const nodeIdsToDelete = selectedNodeIds.length > 0 ? selectedNodeIds : selectedNodeId ? [selectedNodeId] : [];
          const edgeIdsToDelete = selectedEdgeIds;
          if (nodeIdsToDelete.length === 0 && edgeIdsToDelete.length === 0) {
            break;
          }
          // ノードを1つ以上削除する場合、削除実行前に代表ノード（selectedNodeIdがあればそれ、
          // なければselectedNodeIdsの先頭）の位置を矢印キーナビゲーション用アンカーとして退避する。
          // 削除後はlastSelectedNodeIdが消えたノードIDのまま残りgetNearestNodeInDirectionが
          // 起点を見失うため、このアンカーが「消したノードの位置から矢印方向へフォーカス」の
          // フォールバックになる（エッジのみ削除時はセットしない）
          if (nodeIdsToDelete.length > 0) {
            const primaryId = selectedNodeId ?? selectedNodeIds[0];
            const primaryNode = currentMap?.nodes.find((n) => n.id === primaryId);
            if (primaryNode) {
              setDeletedFocusAnchor(primaryNode.position);
            }
          }
          deleteNodesAndEdges(nodeIdsToDelete, edgeIdsToDelete);
          setSelectedNodeId(null);
          clearMultiSelection();
          clearEdgeSelection();
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
            let targetNode = getNearestNodeInDirection(nodeId, 'up', currentMap.nodes);
            // ノード削除直後は消えたノードがnodeIdに残っており見つからない（null）ため、
            // 削除直前に退避した位置（deletedFocusAnchor）を起点に方向探索し直す
            if (!targetNode && deletedFocusAnchor) {
              targetNode = getNearestNodeInDirectionFromPoint(deletedFocusAnchor, 'up', currentMap.nodes);
            }
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
            let targetNode = getNearestNodeInDirection(nodeId, 'down', currentMap.nodes);
            if (!targetNode && deletedFocusAnchor) {
              targetNode = getNearestNodeInDirectionFromPoint(deletedFocusAnchor, 'down', currentMap.nodes);
            }
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
            let targetNode = getNearestNodeInDirection(nodeId, 'left', currentMap.nodes);
            if (!targetNode && deletedFocusAnchor) {
              targetNode = getNearestNodeInDirectionFromPoint(deletedFocusAnchor, 'left', currentMap.nodes);
            }
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
            let targetNode = getNearestNodeInDirection(nodeId, 'right', currentMap.nodes);
            if (!targetNode && deletedFocusAnchor) {
              targetNode = getNearestNodeInDirectionFromPoint(deletedFocusAnchor, 'right', currentMap.nodes);
            }
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

        case 'autoLayout': {
          // 2ノード以上選択中なら選択ノードだけを整列し、それ以外はマップ全体を整列する。
          // selectedNodeIdsはこのコールバックの先頭でuseUIStore.getState()から取得した最新値
          // （このファイル冒頭のコメント参照。stale closure対策）
          applyLayout(selectedNodeIds.length >= 2 ? selectedNodeIds : undefined);
          break;
        }
      }
    },
    [
      currentMap,
      isConfirmDialogOpen,
      store,
      getActionForKey,
      createChildNode,
      createSiblingNode,
      createOlderSiblingNode,
      createParentNode,
      deleteNodesAndEdges,
      undo,
      redo,
      save,
      setLayoutDirection,
      setSelectedNodeId,
      setEditingNodeId,
      setHelpModalOpen,
      clearMultiSelection,
      clearEdgeSelection,
      setDeletedFocusAnchor,
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
