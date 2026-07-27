import { useCallback, useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useReactFlow } from '@xyflow/react';
import { useMapStore } from '../../stores/mapStore';
import { useUIStore } from '../../stores/uiStore';
import { useConfirmStore } from '../../stores/confirmStore';
import { useToastStore } from '../../stores/toastStore';
import { useAutoLayout } from '../../hooks/useAutoLayout';
import { useAlignAlgorithmDebug } from '../../hooks/useAlignAlgorithmDebug';
import { useSaveMap } from '../../hooks/useSaveMap';
import { useExportPng } from '../../hooks/useExportPng';
import { exportMapAsJson, parseImportedMap } from '../../utils/exportImport';
import { LayoutDirection, AlignAlgorithm } from '../../types';
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
    // キャプチャフェーズで登録する。React Flowのパン/ズーム（d3-drag/d3-zoom）は
    // キャンバス上のmousedownでstopImmediatePropagationを呼ぶため、バブルフェーズの
    // リスナーだとキャンバスクリックがdocumentまで届かずメニューが閉じない問題への対策。
    // キャプチャはdocument→要素の順で走るためd3側のstopPropagationの影響を受けない
    document.addEventListener('mousedown', listener, { capture: true });
    document.addEventListener('touchstart', listener, { capture: true });
    return () => {
      document.removeEventListener('mousedown', listener, { capture: true });
      document.removeEventListener('touchstart', listener, { capture: true });
    };
  }, [ref, handler]);
}

// 中央タイトルと左右UIグループの間に追加で確保する余白（px）。
// タイトルのmaxWidthをツールバー幅から左右グループ幅を引いた残りに合わせてクランプする際、
// ぴったり隙間ゼロだと詰まって見えるため、見た目の余裕分として加える
const TITLE_SIDE_GAP = 40;

export function Toolbar() {
  const { t, i18n } = useTranslation();
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
  const { requestConfirm } = useConfirmStore();
  const { addToast } = useToastStore();
  const { save, isLoading } = useSaveMap();
  const { applyLayout } = useAutoLayout();
  // 整列アルゴリズムの切り替え（本番ビルドでは常に既定のsugiyama-ext、devのみ切り替え可。docs/align-branch-layout.md参照）
  const [alignAlgorithm, setAlignAlgorithm] = useAlignAlgorithmDebug();
  const { exportPng } = useExportPng();
  const { fitView } = useReactFlow();

  // タイトル編集用のstate
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  // モバイル用ツールメニューのstate
  const [isToolMenuOpen, setIsToolMenuOpen] = useState(false);
  // このrefはコールバックref（setRightMobileEl）で手動代入するため、書き込み可能な
  // MutableRefObjectを得られる `useRef<T | null>(null)` の形で宣言する
  const toolMenuRef = useRef<HTMLDivElement | null>(null);
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

  // 中央タイトルが左右UIグループと重ならないよう、タイトルのmaxWidthをツールバー幅・左右グループ
  // 幅の実測値から算出する。中央タイトルはウインドウ中央基準（absolute + -translate-x-1/2）の
  // ままなので、左右対称に「大きい方のグループ幅の2倍」を引くことでどちらとも重ならないようにする
  // （UI優先。タイトルは必要なら省略/実質非表示になってよい。docs/decisions.md参照）
  const toolbarRef = useRef<HTMLDivElement>(null);
  const leftGroupRef = useRef<HTMLDivElement>(null);
  const rightDesktopRef = useRef<HTMLDivElement>(null);
  const rightMobileRef = useRef<HTMLDivElement | null>(null);
  // モバイル右側グループのdivは、既存のtoolMenuRef（外側クリックで閉じる判定用）と
  // rightMobileRef（幅測定用）の2つのrefを同時に持たせる必要があるため、
  // 両方のcurrentを設定するコールバックrefにまとめる
  const setRightMobileEl = useCallback((node: HTMLDivElement | null) => {
    toolMenuRef.current = node;
    rightMobileRef.current = node;
  }, []);
  const [titleMaxWidth, setTitleMaxWidth] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const toolbarEl = toolbarRef.current;
    const leftEl = leftGroupRef.current;
    const rightDesktopEl = rightDesktopRef.current;
    const rightMobileEl = rightMobileRef.current;
    if (!toolbarEl || !leftEl || !rightDesktopEl || !rightMobileEl) return;

    const recalc = () => {
      const toolbarWidth = toolbarEl.offsetWidth;
      const leftWidth = leftEl.offsetWidth;
      // デスクトップ/モバイルは片方しか表示されない（もう片方はoffsetWidth=0になる）ので、
      // 表示されている方の実測値がそのまま使われる
      const rightWidth = Math.max(rightDesktopEl.offsetWidth, rightMobileEl.offsetWidth);
      const available = Math.max(0, toolbarWidth - 2 * Math.max(leftWidth, rightWidth) - TITLE_SIDE_GAP);
      setTitleMaxWidth(available);
    };

    recalc();

    const observer = new ResizeObserver(recalc);
    observer.observe(toolbarEl);
    observer.observe(leftEl);
    observer.observe(rightDesktopEl);
    observer.observe(rightMobileEl);
    return () => observer.disconnect();
    // currentMap?.nameやi18n.languageの変化でもタイトル文言の長さ・左右UIの文言幅が変わるため再計算する
  }, [currentMap?.name, i18n.language]);

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
    // クリック時点の最新の選択状態を取得する（キーバインド側のuseKeyboardShortcutsと
    // 挙動を揃えるため、stale closureを避けてgetState()で読む）。
    // 2ノード以上選択中なら選択ノードだけを整列し、それ以外はマップ全体を整列する
    const { selectedNodeIds } = useUIStore.getState();
    applyLayout(selectedNodeIds.length >= 2 ? selectedNodeIds : undefined);
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
    <div
      ref={toolbarRef}
      className="relative flex h-12 items-center justify-between border-b border-gray-700 bg-gray-800 px-2 md:px-4"
    >
      {/* 左側：アプリ名・ファイル操作 */}
      <div ref={leftGroupRef} className="z-10 flex flex-shrink-0 items-center gap-1 md:gap-2">
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
          <span className="font-semibold text-white">
            Mind<span className="text-blue-400">Mesh</span>Map
          </span>
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

        {/* 保存ボタンは常時表示（未ログイン時はこの端末へ、ログイン時はDriveへ。useSaveMapが
            内部で分岐する。docs/decisions.md参照） */}
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

      {/* 中央：マップ名（クリックで編集可能）- 絶対位置でブラウザ中央に配置。
          maxWidthは左右UIグループの実測幅から算出し、どのタイトル長・ウインドウ幅でも
          左右のボタン類に重ならないようにする（UI優先でタイトル側が縮む。上のuseLayoutEffect参照） */}
      <div
        className="absolute left-1/2 flex min-w-0 -translate-x-1/2 items-center gap-1 md:gap-2"
        style={{ maxWidth: titleMaxWidth }}
      >
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
      <div ref={rightDesktopRef} className="z-10 hidden flex-shrink-0 items-center gap-2 md:flex">
        <select
          value={currentMap?.layoutDirection || 'DOWN'}
          onChange={handleLayoutDirectionChange}
          className="rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-gray-300 focus:border-blue-500 focus:outline-none"
        >
          <option value="DOWN">↓ {t('toolbar.layoutDown')}</option>
          <option value="RIGHT">→ {t('toolbar.layoutRight')}</option>
        </select>

        {/* dev限定：整列アルゴリズム切り替え。本番ビルドでは表示しない
            （import.meta.env.DEVで出し分け。ユーザー向けUIと開発用機能を混ぜない方針） */}
        {import.meta.env.DEV && (
          <select
            value={alignAlgorithm}
            onChange={(e) => setAlignAlgorithm(e.target.value as AlignAlgorithm)}
            className="rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-gray-300 focus:border-blue-500 focus:outline-none"
            title="Align algorithm (dev only)"
          >
            <option value="uniform">uniform</option>
            <option value="branch">branch</option>
            <option value="flat-axis">flat-axis</option>
            <option value="sugiyama-ext">sugiyama-ext</option>
            <option value="elk-port">elk-port</option>
            <option value="elk-port-ext">elk-port-ext</option>
          </select>
        )}

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

      {/* モバイル表示：整列（常時表示）＋⋮ドロップダウン */}
      <div className="z-10 flex flex-shrink-0 items-center gap-1 md:hidden" ref={setRightMobileEl}>
        {/* 整列：⋮メニューには入れず、常に⋮の左に表示する（アイコンのみ） */}
        <button
          onClick={handleAutoLayout}
          className="rounded p-2 text-gray-400 hover:bg-gray-700 hover:text-white"
          title={t('toolbar.align')}
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
        </button>

        <div className="relative">
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
