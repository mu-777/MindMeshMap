import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useMapStore } from '../../stores/mapStore';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { useAutoLayout } from '../../hooks/useAutoLayout';
import { useGoogleAuth } from '../../hooks/useGoogleAuth';
import { useGoogleDrive } from '../../hooks/useGoogleDrive';
import { LayoutDirection } from '../../types';

const layoutDirectionLabels: Record<LayoutDirection, string> = {
  DOWN: '↓ 下向き',
  UP: '↑ 上向き',
  RIGHT: '→ 右向き',
  LEFT: '← 左向き',
};

export function Toolbar() {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const {
    currentMap,
    currentFileId,
    isDirty,
    createNewMap,
    setLayoutDirection,
    undo,
    redo,
    history,
    historyIndex,
    setDirty,
  } = useMapStore();
  const { toggleSidebar, setHelpModalOpen, selectedNodeId } = useUIStore();
  const { isSignedIn, userName } = useAuthStore();
  const { signIn, signOut } = useGoogleAuth();
  const { saveMap, isLoading } = useGoogleDrive();
  const { applyLayout } = useAutoLayout();

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
    <div className="flex h-12 items-center justify-between border-b border-gray-700 bg-gray-800 px-4">
      {/* 左側：アプリ名・ファイル操作 */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleSidebar}
          className="rounded p-2 text-gray-400 hover:bg-gray-700 hover:text-white"
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

        <span className="font-semibold text-blue-400">MindMeshMap</span>

        <div className="h-6 w-px bg-gray-700" />

        <button
          onClick={handleNewMap}
          className="rounded px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
        >
          新規
        </button>

        {isSignedIn && (
          <button
            onClick={handleSave}
            disabled={isLoading || !isDirty}
            className={`
              rounded px-3 py-1.5 text-sm
              ${
                isDirty
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'text-gray-400 hover:bg-gray-700 hover:text-white'
              }
              disabled:cursor-not-allowed disabled:opacity-50
            `}
          >
            {isLoading ? '保存中...' : '保存'}
          </button>
        )}

        <div className="h-6 w-px bg-gray-700" />

        <button
          onClick={() => undo()}
          disabled={!canUndo}
          className="rounded p-2 text-gray-400 hover:bg-gray-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
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
          className="rounded p-2 text-gray-400 hover:bg-gray-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
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

      {/* 中央：マップ名 */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-300">
          {currentMap?.name || '無題のマップ'}
        </span>
        {isDirty && <span className="text-xs text-yellow-500">*</span>}
        {selectedNodeId && (
          <span className="text-xs text-gray-500">
            (ノード選択中)
          </span>
        )}
      </div>

      {/* 右側：レイアウト・ズーム・認証 */}
      <div className="flex items-center gap-2">
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
          onClick={() => zoomOut()}
          className="rounded p-2 text-gray-400 hover:bg-gray-700 hover:text-white"
          title="縮小"
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
              d="M20 12H4"
            />
          </svg>
        </button>

        <button
          onClick={() => zoomIn()}
          className="rounded p-2 text-gray-400 hover:bg-gray-700 hover:text-white"
          title="拡大"
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
              d="M12 4v16m8-8H4"
            />
          </svg>
        </button>

        <button
          onClick={() => fitView({ padding: 0.2 })}
          className="rounded p-2 text-gray-400 hover:bg-gray-700 hover:text-white"
          title="全体表示"
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
              d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
            />
          </svg>
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

        <div className="h-6 w-px bg-gray-700" />

        {isSignedIn ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">{userName}</span>
            <button
              onClick={signOut}
              className="rounded px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
            >
              ログアウト
            </button>
          </div>
        ) : (
          <button
            onClick={signIn}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            Googleでログイン
          </button>
        )}
      </div>
    </div>
  );
}
