import { useCallback, useState, useRef, useEffect } from 'react';
import { useMapStore } from '../../stores/mapStore';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { useAutoLayout } from '../../hooks/useAutoLayout';
import { useGoogleDrive } from '../../hooks/useGoogleDrive';
import { LayoutDirection } from '../../types';

// メニュー外クリックで閉じるためのカスタムフック
function useClickOutside(
  ref: React.RefObject<HTMLElement>,
  handler: () => void
) {
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) {
        return;
      }
      handler();
    };
    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);
    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
  }, [ref, handler]);
}

const layoutDirectionLabels: Record<LayoutDirection, string> = {
  DOWN: '↓ 下向き',
  RIGHT: '→ 右向き',
};

export function Toolbar() {
  const {
    currentMap,
    currentFileId,
    isDirty,
    createNewMap,
    updateMap,
    setLayoutDirection,
    undo,
    redo,
    history,
    historyIndex,
    setDirty,
  } = useMapStore();
  const { toggleSidebar, setHelpModalOpen } = useUIStore();
  const { isSignedIn } = useAuthStore();
  const { saveMap, isLoading } = useGoogleDrive();
  const { applyLayout } = useAutoLayout();

  // タイトル編集用のstate
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  // モバイル用ツールメニューのstate
  const [isToolMenuOpen, setIsToolMenuOpen] = useState(false);
  const toolMenuRef = useRef<HTMLDivElement>(null);
  useClickOutside(toolMenuRef as React.RefObject<HTMLElement>, () =>
    setIsToolMenuOpen(false)
  );

  // タイトル編集開始時にフォーカス
  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  const handleTitleClick = useCallback(() => {
    setEditingTitle(currentMap?.name || '');
    setIsEditingTitle(true);
  }, [currentMap?.name]);

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setEditingTitle(e.target.value);
    },
    []
  );

  const handleTitleSubmit = useCallback(() => {
    const trimmedTitle = editingTitle.trim();
    if (trimmedTitle && trimmedTitle !== currentMap?.name) {
      updateMap({ name: trimmedTitle });
    }
    setIsEditingTitle(false);
  }, [editingTitle, currentMap?.name, updateMap]);

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleTitleSubmit();
      } else if (e.key === 'Escape') {
        setIsEditingTitle(false);
      }
    },
    [handleTitleSubmit]
  );

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const handleNewMap = useCallback(() => {
    if (isDirty) {
      const confirm = window.confirm(
        '保存されていない変更があります。新しいマップを作成しますか？'
      );
      if (!confirm) return;
    }
    createNewMap();
  }, [isDirty, createNewMap]);

  const handleSave = useCallback(async () => {
    if (!currentMap || !isSignedIn) return;

    try {
      await saveMap(currentMap, currentFileId);
      setDirty(false);
      alert('保存しました');
    } catch (error) {
      console.error('Save failed:', error);
      alert('保存に失敗しました');
    }
  }, [currentMap, currentFileId, isSignedIn, saveMap, setDirty]);

  const handleLayoutDirectionChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setLayoutDirection(e.target.value as LayoutDirection);
      applyLayout();
    },
    [setLayoutDirection, applyLayout]
  );

  const handleAutoLayout = useCallback(() => {
    applyLayout();
  }, [applyLayout]);

  return (
    <div className="flex h-12 items-center justify-between border-b border-gray-700 bg-gray-800 px-2 md:px-4">
      {/* 左側：アプリ名・ファイル操作 */}
      <div className="flex flex-shrink-0 items-center gap-1 md:gap-2">
        <button
          onClick={toggleSidebar}
          className="rounded p-1.5 text-gray-400 hover:bg-gray-700 hover:text-white md:p-2"
          title="サイドバー切替"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>

        <span className="hidden font-semibold text-blue-400 md:inline">
          MindMeshMap
        </span>

        <div className="hidden h-6 w-px bg-gray-700 md:block" />

        <button
          onClick={handleNewMap}
          className="rounded p-1.5 text-gray-300 hover:bg-gray-700 hover:text-white md:px-3 md:py-1.5"
          title="新規マップ"
        >
          {/* モバイル：アイコン、デスクトップ：テキスト */}
          <svg
            className="h-4 w-4 md:hidden"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          <span className="hidden text-sm md:inline">新規</span>
        </button>

        {isSignedIn && (
          <button
            onClick={handleSave}
            disabled={isLoading || !isDirty}
            className={`
              rounded p-1.5 md:px-3 md:py-1.5
              ${
                isDirty
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'text-gray-400 hover:bg-gray-700 hover:text-white'
              }
              disabled:cursor-not-allowed disabled:opacity-50
            `}
            title="保存"
          >
            {/* モバイル：アイコン、デスクトップ：テキスト */}
            <svg
              className="h-4 w-4 md:hidden"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
              />
            </svg>
            <span className="hidden text-sm md:inline">
              {isLoading ? '保存中...' : '保存'}
            </span>
          </button>
        )}

        <div className="hidden h-6 w-px bg-gray-700 md:block" />

        <button
          onClick={() => undo()}
          disabled={!canUndo}
          className="rounded p-1.5 text-gray-400 hover:bg-gray-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 md:p-2"
          title="元に戻す (Ctrl+Z)"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
            />
          </svg>
        </button>

        <button
          onClick={() => redo()}
          disabled={!canRedo}
          className="rounded p-1.5 text-gray-400 hover:bg-gray-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 md:p-2"
          title="やり直し (Ctrl+Shift+Z)"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6"
            />
          </svg>
        </button>
      </div>

      {/* 中央：マップ名（クリックで編集可能） */}
      <div className="flex min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden px-2 md:gap-2">
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            type="text"
            value={editingTitle}
            onChange={handleTitleChange}
            onBlur={handleTitleSubmit}
            onKeyDown={handleTitleKeyDown}
            className="max-w-full rounded border border-blue-500 bg-gray-700 px-2 py-0.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        ) : (
          <button
            onClick={handleTitleClick}
            className="min-w-0 max-w-full truncate rounded px-2 py-0.5 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
            title="クリックしてタイトルを編集"
          >
            {currentMap?.name || '無題のマップ'}
          </button>
        )}
        {isDirty && <span className="flex-shrink-0 text-xs text-yellow-500">*</span>}
      </div>

      {/* 右側：レイアウト・ズーム・認証 */}
      {/* デスクトップ表示 */}
      <div className="hidden flex-shrink-0 items-center gap-2 md:flex">
        <select
          value={currentMap?.layoutDirection || 'DOWN'}
          onChange={handleLayoutDirectionChange}
          className="rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-gray-300 focus:border-blue-500 focus:outline-none"
        >
          {Object.entries(layoutDirectionLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <button
          onClick={handleAutoLayout}
          className="rounded px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
          title="自動レイアウト"
        >
          整列
        </button>

        <div className="h-6 w-px bg-gray-700" />

        <button
          onClick={() => setHelpModalOpen(true)}
          className="rounded p-2 text-gray-400 hover:bg-gray-700 hover:text-white"
          title="ヘルプ (?)"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </button>
      </div>

      {/* モバイル表示：⋮ドロップダウン */}
      <div className="relative flex-shrink-0 md:hidden" ref={toolMenuRef}>
        <button
          onClick={() => setIsToolMenuOpen(!isToolMenuOpen)}
          className="rounded p-2 text-gray-400 hover:bg-gray-700 hover:text-white"
          title="メニュー"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
            />
          </svg>
        </button>

        {isToolMenuOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-md border border-gray-600 bg-gray-800 py-1 shadow-lg">
            {/* レイアウト方向 */}
            <div className="px-3 py-2">
              <label className="mb-1 block text-xs text-gray-400">
                レイアウト方向
              </label>
              <select
                value={currentMap?.layoutDirection || 'DOWN'}
                onChange={(e) => {
                  handleLayoutDirectionChange(e);
                  setIsToolMenuOpen(false);
                }}
                className="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-gray-300 focus:border-blue-500 focus:outline-none"
              >
                {Object.entries(layoutDirectionLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="my-1 h-px bg-gray-700" />

            {/* 整列 */}
            <button
              onClick={() => {
                handleAutoLayout();
                setIsToolMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h7"
                />
              </svg>
              整列
            </button>

            {/* ヘルプ */}
            <button
              onClick={() => {
                setHelpModalOpen(true);
                setIsToolMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              ヘルプ
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
