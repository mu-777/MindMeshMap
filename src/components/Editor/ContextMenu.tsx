import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { useMapStore } from '../../stores/mapStore';
import { getDescendantIds } from '../../utils/graphTraversal';

// メニューと対象（ノード矩形）/ビューポート端との間に空ける余白（px）
const CONTEXT_MENU_GAP = 8;

export function ContextMenu() {
  const { t } = useTranslation();
  const { contextMenu, closeContextMenu, selectedNodeId, selectedNodeIds, selectedEdgeIds, setSelectedNodeId, toggleNodeSelection, toggleEdgeSelection, setMultiSelection, clearEdgeSelection, setDeletedFocusAnchor } = useUIStore();
  const { deleteNode, deleteEdge, currentMap } = useMapStore();
  const menuRef = useRef<HTMLDivElement>(null);
  // 自サイズ計測が済むまでの初期位置（画面外0,0ではなくcontextMenu.x/yを暫定表示に使う）。
  // 計測後にanchorRect基準の最終位置へ更新する
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  // メニュー外クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };

    // キャプチャフェーズで登録する。React Flowのパン/ズーム（d3-drag/d3-zoom）は
    // キャンバス上のmousedownでstopImmediatePropagationを呼ぶため、バブルフェーズの
    // リスナーだとキャンバスクリックがdocumentまで届かずメニューが閉じない問題への対策。
    // キャプチャはdocument→要素の順で走るためd3側のstopPropagationの影響を受けない
    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside, { capture: true });
      document.addEventListener('touchstart', handleClickOutside, { capture: true });
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside, { capture: true });
      document.removeEventListener('touchstart', handleClickOutside, { capture: true });
    };
  }, [contextMenu, closeContextMenu]);

  // メニューの自サイズ（offsetWidth/Height）を計測し、対象に重ならずビューポート内に収まる
  // 表示位置を計算する。描画後・ペイント前に同期実行する必要があるためuseLayoutEffectを使う
  // （useEffectだと一瞬(contextMenu.x, contextMenu.y)位置で描画されてから飛ぶ、という
  // ちらつきが起きる）
  useLayoutEffect(() => {
    if (!contextMenu || !menuRef.current) {
      setPosition(null);
      return;
    }
    const el = menuRef.current;
    const menuW = el.offsetWidth;
    const menuH = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left: number;
    let top: number;

    if (contextMenu.anchorRect) {
      // ノードメニュー: 既定は「ノードの左側・上端揃え」。ノードに重ならない位置に出す
      const { left: anchorLeft, top: anchorTop, right: anchorRight } = contextMenu.anchorRect;
      left = anchorLeft - menuW - CONTEXT_MENU_GAP;
      top = anchorTop;
      // 左に入りきらない場合は右側へ
      if (left < 0) {
        left = anchorRight + CONTEXT_MENU_GAP;
      }
    } else {
      // anchorRectが無い場合（エッジ・フォールバック）: 従来通りタップ/クリック座標を左上に
      left = contextMenu.x;
      top = contextMenu.y;
    }

    // ビューポート内にクランプ（画面外に出さない）
    if (left + menuW > vw) left = vw - menuW;
    if (left < 0) left = 0;
    if (top + menuH > vh) top = vh - menuH;
    if (top < 0) top = 0;

    setPosition({ left, top });
  }, [contextMenu]);

  // 削除処理
  // 削除対象がuiStore側の選択状態（selectedNodeId/selectedNodeIds/selectedEdgeIds）と
  // 一致する場合は選択も一緒にクリアする。クリアしないと、次にDeleteキーを押したときに
  // 既に存在しないノード/エッジのIDが選択されたままになり、何も起きない
  // （無音のno-op）不具合になる
  const handleDelete = useCallback(() => {
    if (contextMenu) {
      if (contextMenu.type === 'node') {
        // useKeyboardShortcutsのDeleteキー削除と同様、削除実行前に対象ノードの位置を
        // 矢印キーナビゲーション用アンカーとして退避する（右クリック削除後も矢印キーで
        // 消したノードの位置から最寄りノードへフォーカスできるようにするため）
        const targetNode = currentMap?.nodes.find((n) => n.id === contextMenu.id);
        if (targetNode) {
          setDeletedFocusAnchor(targetNode.position);
        }
        deleteNode(contextMenu.id);
        if (selectedNodeId === contextMenu.id) {
          setSelectedNodeId(null);
        }
        if (selectedNodeIds.includes(contextMenu.id)) {
          // toggleNodeSelectionは選択済みIDを渡すと選択解除になる
          toggleNodeSelection(contextMenu.id);
        }
      } else {
        deleteEdge(contextMenu.id);
        if (selectedEdgeIds.includes(contextMenu.id)) {
          // toggleEdgeSelectionは選択済みIDを渡すと選択解除になる
          toggleEdgeSelection(contextMenu.id);
        }
      }
      closeContextMenu();
    }
  }, [
    contextMenu,
    currentMap,
    deleteNode,
    deleteEdge,
    closeContextMenu,
    selectedNodeId,
    selectedNodeIds,
    selectedEdgeIds,
    setSelectedNodeId,
    toggleNodeSelection,
    toggleEdgeSelection,
    setDeletedFocusAnchor,
  ]);

  // 対象ノードを根とするサブツリー（自身＋全子孫）をまとめて選択する。
  // 子孫の探索はgetDescendantIds（child方向へのDFS。循環があっても無限ループしない）に任せる。
  // 選択の反映にはsetMultiSelectionを使う（selectedNodeIdsに一括で入れ、selectedNodeIdはクリア）。
  // setMultiSelectionはノード・エッジ混在選択のためselectedEdgeIdsを維持する仕様なので、
  // ここでは先にclearEdgeSelectionを呼ぶ。呼ばないと「直前に選択していた無関係なエッジ」が
  // 選択に残り、続けてDeleteを押すとサブツリー外のエッジまで消える
  const handleSelectSubtree = useCallback(() => {
    if (!contextMenu || contextMenu.type !== 'node' || !currentMap) return;
    const ids = [contextMenu.id, ...getDescendantIds(contextMenu.id, currentMap.edges)];
    clearEdgeSelection();
    setMultiSelection(ids);
    closeContextMenu();
  }, [contextMenu, currentMap, clearEdgeSelection, setMultiSelection, closeContextMenu]);

  if (!contextMenu) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[120px] rounded-lg border border-gray-600 bg-gray-800 py-1 shadow-xl"
      style={{
        left: position?.left ?? contextMenu.x,
        top: position?.top ?? contextMenu.y,
      }}
    >
      {contextMenu.type === 'node' && (
        <button
          className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700"
          onClick={handleSelectSubtree}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            {/* サブツリー（1つの親から2つの子へ枝分かれ）を表すアイコン */}
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 7v3M5 13v-3h14v3"
            />
            <rect x="9" y="3" width="6" height="4" rx="1" strokeWidth={2} />
            <rect x="2" y="13" width="6" height="4" rx="1" strokeWidth={2} />
            <rect x="16" y="13" width="6" height="4" rx="1" strokeWidth={2} />
          </svg>
          {t('contextMenu.selectSubtree')}
        </button>
      )}
      <button
        className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-sm text-red-400 hover:bg-gray-700"
        onClick={handleDelete}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
          />
        </svg>
        {t('common.delete')}
      </button>
    </div>
  );
}
