import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { useMapStore } from '../../stores/mapStore';

export function ContextMenu() {
  const { t } = useTranslation();
  const { contextMenu, closeContextMenu, selectedNodeId, selectedEdgeId, setSelectedNodeId, setSelectedEdgeId } = useUIStore();
  const { deleteNode, deleteEdge } = useMapStore();
  const menuRef = useRef<HTMLDivElement>(null);

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

  // 削除処理
  // 削除対象がuiStore側の選択状態（selectedNodeId/selectedEdgeId）と一致する場合は
  // 選択も一緒にクリアする。クリアしないと、次にDeleteキーを押したときに
  // 既に存在しないノード/エッジのIDが選択されたままになり、何も起きない
  // （無音のno-op）不具合になる
  const handleDelete = useCallback(() => {
    if (contextMenu) {
      if (contextMenu.type === 'node') {
        deleteNode(contextMenu.id);
        if (selectedNodeId === contextMenu.id) {
          setSelectedNodeId(null);
        }
      } else {
        deleteEdge(contextMenu.id);
        if (selectedEdgeId === contextMenu.id) {
          setSelectedEdgeId(null);
        }
      }
      closeContextMenu();
    }
  }, [contextMenu, deleteNode, deleteEdge, closeContextMenu, selectedNodeId, selectedEdgeId, setSelectedNodeId, setSelectedEdgeId]);

  if (!contextMenu) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[120px] rounded-lg border border-gray-600 bg-gray-800 py-1 shadow-xl"
      style={{
        left: contextMenu.x,
        top: contextMenu.y,
      }}
    >
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-400 hover:bg-gray-700"
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
