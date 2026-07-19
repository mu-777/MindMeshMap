import { useCallback, useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useReactFlow } from '@xyflow/react';
import { useMapStore } from '../../stores/mapStore';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { useConfirmStore } from '../../stores/confirmStore';
import { useToastStore } from '../../stores/toastStore';
import { useAutoLayout } from '../../hooks/useAutoLayout';
import { useSaveMap } from '../../hooks/useSaveMap';
import { useExportPng } from '../../hooks/useExportPng';
import { exportMapAsJson, parseImportedMap } from '../../utils/exportImport';
import { LayoutDirection } from '../../types';
import { LanguageSwitcher } from '../Common/LanguageSwitcher';

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

export function Toolbar() {
  const { t } = useTranslation();
  const {
    currentMap,
    isDirty,
    createNewMap,
    updateMap,
    setLayoutDirection,
    setCurrentMap,
    setDirty,
    undo,
    redo,
    history,
    historyIndex,
  } = useMapStore();
  const { toggleSidebar, setHelpModalOpen } = useUIStore();
  const { isSignedIn } = useAuthStore();
  const { requestConfirm } = useConfirmStore();
  const { addToast } = useToastStore();
  const { save, isLoading } = useSaveMap();
  const { applyLayout } = useAutoLayout();
  const { exportPng } = useExportPng();
  const { fitView } = useReactFlow();

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

  // デスクトップ用「ファイル」メニューのstate
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  useClickOutside(fileMenuRef as React.RefObject<HTMLElement>, () =>
    setIsFileMenuOpen(false)
  );

  // JSONインポート用の非表示file input
  const importInputRef = useRef<HTMLInputElement>(null);

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

  const handleNewMap = useCallback(async () => {
    if (isDirty) {
      const confirmed = await requestConfirm(t('dialogs.unsavedChangesNew'));
      if (!confirmed) return;
    }
    createNewMap();
  }, [isDirty, createNewMap, requestConfirm, t]);

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

  // JSONエクスポート
  const handleExportJson = useCallback(() => {
    if (!currentMap) return;
    exportMapAsJson(currentMap);
  }, [currentMap]);

  // PNGエクスポート
  const handleExportPng = useCallback(() => {
    if (!currentMap) return;
    exportPng();
  }, [currentMap, exportPng]);

  // JSONインポートのファイル選択ダイアログを開く
  const handleImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  // JSONインポート：ファイル選択後の処理
  const handleImportFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // 同じファイルを連続で選択してもchangeイベントが発火するように毎回リセットする
      e.target.value = '';
      if (!file) return;

      const text = await file.text();
      const importedMap = parseImportedMap(text);
      if (!importedMap) {
        addToast({ type: 'error', message: t('toast.importFailed') });
        return;
      }

      if (isDirty) {
        const confirmed = await requestConfirm(t('dialogs.unsavedChangesContinue'));
        if (!confirmed) return;
      }

      // インポートしたマップはDrive未保存の状態として扱う（fileIdなし・isDirty=true）
      setCurrentMap(importedMap, null);
      setDirty(true);
      addToast({ type: 'success', message: t('toast.importSuccess') });
      setTimeout(() => fitView(), 50);
    },
    [isDirty, requestConfirm, setCurrentMap, setDirty, addToast, t, fitView]
  );

  return (
    <div className="relative flex h-12 items-center justify-between border-b border-gray-700 bg-gray-800 px-2 md:px-4">
      {/* 左側：アプリ名・ファイル操作 */}
      <div className="z-10 flex flex-shrink-0 items-center gap-1 md:gap-2">
        <button
          onClick={toggleSidebar}
          className="rounded p-1.5 text-gray-400 hover:bg-gray-700 hover:text-white md:p-2"
          title={t('toolbar.toggleSidebar')}
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

        <div className="hidden items-center gap-1.5 md:flex">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="MindMeshMap" className="h-6 w-6" />
          <span className="font-semibold text-blue-400">MindMeshMap</span>
        </div>

        <div className="hidden h-6 w-px bg-gray-700 md:block" />

        <button
          onClick={handleNewMap}
          className="rounded p-1.5 text-gray-300 hover:bg-gray-700 hover:text-white md:px-3 md:py-1.5"
          title={t('toolbar.newMap')}
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
          <span className="hidden text-sm md:inline">{t('common.new')}</span>
        </button>

        {isSignedIn && (
          <button
            onClick={save}
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
            title={t('common.save')}
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
              {isLoading ? t('common.saving') : t('common.save')}
            </span>
          </button>
        )}

        {/* ファイルメニュー（デスクトップのみ。モバイルは⋮メニューに同項目がある） */}
        <div className="relative hidden md:block" ref={fileMenuRef}>
          <button
            onClick={() => setIsFileMenuOpen((open) => !open)}
            className="rounded px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
            title={t('toolbar.fileMenu')}
          >
            {t('toolbar.fileMenu')}
          </button>

          {isFileMenuOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 w-44 rounded-md border border-gray-600 bg-gray-800 py-1 shadow-lg">
              {/* エクスポート */}
              <div className="px-3 py-1 text-xs text-gray-500">
                {t('toolbar.sectionExport')}
              </div>
              <button
                onClick={() => {
                  handleExportJson();
                  setIsFileMenuOpen(false);
                }}
                disabled={!currentMap}
                className="flex w-full items-center px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('toolbar.itemJson')}
              </button>
              <button
                onClick={() => {
                  handleExportPng();
                  setIsFileMenuOpen(false);
                }}
                disabled={!currentMap}
                className="flex w-full items-center px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('toolbar.itemPng')}
              </button>

              <div className="my-1 h-px bg-gray-700" />

              {/* インポート */}
              <div className="px-3 py-1 text-xs text-gray-500">
                {t('toolbar.sectionImport')}
              </div>
              <button
                onClick={() => {
                  handleImportClick();
                  setIsFileMenuOpen(false);
                }}
                className="flex w-full items-center px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700"
              >
                {t('toolbar.itemJson')}
              </button>
            </div>
          )}
        </div>

        <div className="hidden h-6 w-px bg-gray-700 md:block" />

        <button
          onClick={() => undo()}
          disabled={!canUndo}
          className="rounded p-1.5 text-gray-400 hover:bg-gray-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 md:p-2"
          title={t('toolbar.undo')}
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
          title={t('toolbar.redo')}
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

      {/* 中央：マップ名（クリックで編集可能）- 絶対位置でブラウザ中央に配置 */}
      <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1 md:gap-2">
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
            title={t('toolbar.clickToEditTitle')}
          >
            {currentMap?.name || t('toolbar.untitledMap')}
          </button>
        )}
        {isDirty && <span className="flex-shrink-0 text-xs text-yellow-500">*</span>}
      </div>

      {/* 右側：レイアウト・ズーム・認証 */}
      {/* デスクトップ表示 */}
      <div className="z-10 hidden flex-shrink-0 items-center gap-2 md:flex">
        <select
          value={currentMap?.layoutDirection || 'DOWN'}
          onChange={handleLayoutDirectionChange}
          className="rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-gray-300 focus:border-blue-500 focus:outline-none"
        >
          <option value="DOWN">↓ {t('toolbar.layoutDown')}</option>
          <option value="RIGHT">→ {t('toolbar.layoutRight')}</option>
        </select>

        <button
          onClick={handleAutoLayout}
          className="rounded px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
          title={t('toolbar.autoLayout')}
        >
          {t('toolbar.align')}
        </button>

        <div className="h-6 w-px bg-gray-700" />

        <button
          onClick={() => setHelpModalOpen(true)}
          className="rounded p-2 text-gray-400 hover:bg-gray-700 hover:text-white"
          title={t('toolbar.helpShortcut')}
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

        <LanguageSwitcher />
      </div>

      {/* モバイル表示：⋮ドロップダウン */}
      <div className="relative z-10 flex-shrink-0 md:hidden" ref={toolMenuRef}>
        <button
          onClick={() => setIsToolMenuOpen(!isToolMenuOpen)}
          className="rounded p-2 text-gray-400 hover:bg-gray-700 hover:text-white"
          title={t('common.menu')}
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
                {t('toolbar.layoutDirection')}
              </label>
              <select
                value={currentMap?.layoutDirection || 'DOWN'}
                onChange={(e) => {
                  handleLayoutDirectionChange(e);
                  setIsToolMenuOpen(false);
                }}
                className="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-gray-300 focus:border-blue-500 focus:outline-none"
              >
                <option value="DOWN">↓ {t('toolbar.layoutDown')}</option>
                <option value="RIGHT">→ {t('toolbar.layoutRight')}</option>
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
              {t('toolbar.align')}
            </button>

            <div className="my-1 h-px bg-gray-700" />

            {/* エクスポート */}
            <div className="px-3 py-1 text-xs text-gray-500">
              {t('toolbar.sectionExport')}
            </div>
            <button
              onClick={() => {
                handleExportJson();
                setIsToolMenuOpen(false);
              }}
              disabled={!currentMap}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('toolbar.itemJson')}
            </button>
            <button
              onClick={() => {
                handleExportPng();
                setIsToolMenuOpen(false);
              }}
              disabled={!currentMap}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('toolbar.itemPng')}
            </button>

            <div className="my-1 h-px bg-gray-700" />

            {/* インポート */}
            <div className="px-3 py-1 text-xs text-gray-500">
              {t('toolbar.sectionImport')}
            </div>
            <button
              onClick={() => {
                handleImportClick();
                setIsToolMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700"
            >
              {t('toolbar.itemJson')}
            </button>

            <div className="my-1 h-px bg-gray-700" />

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
              {t('common.help')}
            </button>

            <div className="my-1 h-px bg-gray-700" />

            {/* 言語切替 */}
            <div className="px-3 py-2">
              <LanguageSwitcher />
            </div>
          </div>
        )}
      </div>

      {/* JSONインポート用の非表示file input（デスクトップ・モバイル共通） */}
      <input
        ref={importInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleImportFileChange}
        className="hidden"
      />
    </div>
  );
}
