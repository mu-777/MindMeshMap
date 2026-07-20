import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useReactFlow } from '@xyflow/react';
import { Modal } from './Modal';
import { useKeybindStore, normalizeKey } from '../../stores/keybindStore';
import { useMapStore } from '../../stores/mapStore';
import { useConfirmStore } from '../../stores/confirmStore';
import { createDefaultMap } from '../../data/defaultMap';
import { KeybindAction } from '../../types';

interface KeyboardShortcutHelpProps {
  onClose: () => void;
}

type HelpTab = 'basic' | 'format' | 'keyboard';

const tabs: HelpTab[] = ['basic', 'format', 'keyboard'];

// タブ1「基本操作」: マウス/タッチ操作の一覧。i18nキーは help.op{Key} / help.op{Key}Desc
const basicOperationKeys = [
  'createNode',
  'editNode',
  'selectNode',
  'multiSelect',
  'moveNode',
  'createEdge',
  'createConnectedNode',
  'selectEdge',
  'edgeLabel',
  'deleteMenu',
] as const;

// タブ2「書式」: Tiptap標準のショートカット（キーバインド編集の対象外の固定値）
const formatShortcuts: { labelKey: string; key: string }[] = [
  { labelKey: 'help.formatBold', key: 'Ctrl+B' },
  { labelKey: 'help.formatItalic', key: 'Ctrl+I' },
  { labelKey: 'help.formatStrike', key: 'Ctrl+Shift+S' },
  { labelKey: 'help.formatBulletList', key: 'Ctrl+Shift+8' },
  { labelKey: 'help.formatOrderedList', key: 'Ctrl+Shift+7' },
  { labelKey: 'help.formatNewLine', key: 'Shift+Enter' },
];

// タブ3「キーボード」冒頭に表示する、ノード編集中だけ意味が変わる固定ショートカット
// （キーバインド編集の対象外。CustomNode.tsxのeditorProps.handleKeyDownを参照）
const editingShortcuts: { labelKey: string; key: string }[] = [
  { labelKey: 'help.editingConfirmCreateChild', key: 'Tab' },
  { labelKey: 'help.editingConfirmCreateSibling', key: 'Enter' },
  { labelKey: 'help.editingNewLineTouch', key: 'Enter' },
];

// タブ3「キーボード」: 既存のショートカット一覧（クリックでキーバインド編集可能）
const shortcutGroups: { titleKey: string; actions: KeybindAction[] }[] = [
  {
    titleKey: 'shortcuts.nodeOperations',
    actions: [
      'createChildNode',
      'createSiblingNode',
      'deleteNode',
      'editNode',
      'finishEdit',
    ],
  },
  {
    titleKey: 'shortcuts.navigation',
    actions: [
      'selectParent',
      'selectChild',
      'selectPrevSibling',
      'selectNextSibling',
    ],
  },
  {
    titleKey: 'shortcuts.editing',
    actions: ['undo', 'redo', 'save'],
  },
  {
    titleKey: 'shortcuts.view',
    actions: ['zoomIn', 'zoomOut', 'fitView', 'toggleLayoutDirection', 'autoLayout'],
  },
];

// キャプチャ中に無視する修飾キー単独の入力
const MODIFIER_KEYS = ['Control', 'Shift', 'Alt', 'Meta'];

// キー名の表示用整形（矢印記号・Escなど）
function formatKeyForDisplay(key: string) {
  return key
    .replace('ArrowUp', '↑')
    .replace('ArrowDown', '↓')
    .replace('ArrowLeft', '←')
    .replace('ArrowRight', '→')
    .replace('Escape', 'Esc');
}

// snake/camel先頭大文字化。'createNode' -> 'CreateNode'（i18nキー組み立て用）
function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function KeyboardShortcutHelp({ onClose }: KeyboardShortcutHelpProps) {
  const { t } = useTranslation();
  const { keybinds, setKeybind, resetKeybinds, getActionForKey } = useKeybindStore();
  const { isDirty, setCurrentMap } = useMapStore();
  const { requestConfirm } = useConfirmStore();
  const { fitView } = useReactFlow();

  const [activeTab, setActiveTab] = useState<HelpTab>('basic');
  // 次のキー入力待ち（キャプチャ中）のアクション
  const [capturingAction, setCapturingAction] = useState<KeybindAction | null>(null);
  // 直近の割り当て失敗（競合）。対象アクションと競合先アクションを保持し、行の下に警告を出す
  const [conflict, setConflict] = useState<{ action: KeybindAction; withAction: KeybindAction } | null>(null);

  // キャプチャ中はwindowのcapture phaseでkeydownを先取りする。
  // これにより、Modal自体のEscapeキー処理（モーダルを閉じる）より先にキャプチャのキャンセルを処理できる
  useEffect(() => {
    if (!capturingAction) return;

    const handleCaptureKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        setCapturingAction(null);
        return;
      }

      // 修飾キー単独の入力は無視して待機を継続する
      if (MODIFIER_KEYS.includes(event.key)) return;

      const modifiers = {
        ctrl: event.ctrlKey || event.metaKey,
        shift: event.shiftKey,
        alt: event.altKey,
      };

      // 他のアクションに割当済みのキーは割り当てず、競合を警告する
      const existingAction = getActionForKey(event.key, modifiers);
      if (existingAction && existingAction !== capturingAction) {
        setConflict({ action: capturingAction, withAction: existingAction });
        setCapturingAction(null);
        return;
      }

      setKeybind(capturingAction, normalizeKey(event.key, modifiers));
      setConflict(null);
      setCapturingAction(null);
    };

    window.addEventListener('keydown', handleCaptureKeyDown, true);
    return () => window.removeEventListener('keydown', handleCaptureKeyDown, true);
  }, [capturingAction, getActionForKey, setKeybind]);

  const startCapture = useCallback((action: KeybindAction) => {
    setConflict(null);
    setCapturingAction(action);
  }, []);

  const handleResetKeybinds = useCallback(() => {
    resetKeybinds();
    setCapturingAction(null);
    setConflict(null);
  }, [resetKeybinds]);

  // サンプル（デフォルト）マップを開く
  const handleOpenSampleMap = useCallback(async () => {
    if (isDirty) {
      const confirmed = await requestConfirm(t('dialogs.unsavedChangesContinue'));
      if (!confirmed) return;
    }
    setCurrentMap(createDefaultMap(t), null);
    onClose();
    // モーダルを閉じるアニメーション・レイアウト確定を待ってから全体表示にフィットさせる
    setTimeout(() => fitView({ padding: 0.2 }), 100);
  }, [isDirty, requestConfirm, setCurrentMap, t, onClose, fitView]);

  return (
    <Modal isOpen={true} onClose={onClose} title={t('help.title')}>
      <div className="space-y-4">
        {/* タブ切り替え */}
        <div className="flex gap-1 border-b border-gray-700">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-2 text-sm font-medium ${
                activeTab === tab
                  ? 'border-b-2 border-blue-500 text-blue-400'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {t(`help.tab${capitalize(tab)}`)}
            </button>
          ))}
        </div>

        {/* タブ1: 基本操作（マウス/タッチ） */}
        {activeTab === 'basic' && (
          <div className="space-y-2">
            {basicOperationKeys.map((key) => (
              <div
                key={key}
                className="flex items-center justify-between gap-3 rounded bg-gray-700/50 px-3 py-2"
              >
                <span className="text-sm text-gray-300">
                  {t(`help.op${capitalize(key)}`)}
                </span>
                <span className="text-right text-xs text-gray-400">
                  {t(`help.op${capitalize(key)}Desc`)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* タブ2: 書式（リッチテキスト） */}
        {activeTab === 'format' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-400">{t('help.formatIntro')}</p>
            <div className="space-y-2">
              {formatShortcuts.map(({ labelKey, key }) => (
                <div
                  key={labelKey}
                  className="flex items-center justify-between rounded bg-gray-700/50 px-3 py-2"
                >
                  <span className="text-sm text-gray-300">{t(labelKey)}</span>
                  <kbd className="rounded bg-gray-600 px-2 py-1 font-mono text-xs text-gray-200">
                    {key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* タブ3: キーボード（キーバインド編集可能） */}
        {activeTab === 'keyboard' && (
          <div className="space-y-6">
            {/* ノード編集中だけTab/Enterの意味が変わる固定ショートカット（キーバインド編集の対象外） */}
            <div>
              <h3 className="mb-3 text-sm font-medium text-gray-400">{t('help.editingIntroTitle')}</h3>
              <p className="mb-2 text-xs text-gray-500">{t('help.editingIntro')}</p>
              <div className="space-y-2">
                {editingShortcuts.map(({ labelKey, key }) => (
                  <div
                    key={labelKey}
                    className="flex items-center justify-between rounded bg-gray-700/50 px-3 py-2"
                  >
                    <span className="text-sm text-gray-300">{t(labelKey)}</span>
                    <kbd className="rounded bg-gray-600 px-2 py-1 font-mono text-xs text-gray-200">{key}</kbd>
                  </div>
                ))}
              </div>
            </div>

            {shortcutGroups.map((group) => (
              <div key={group.titleKey}>
                <h3 className="mb-3 text-sm font-medium text-gray-400">
                  {t(group.titleKey)}
                </h3>
                <div className="space-y-2">
                  {group.actions.map((action) => (
                    <div key={action}>
                      <div className="flex items-center justify-between rounded bg-gray-700/50 px-3 py-2">
                        <span className="text-sm text-gray-300">
                          {t(`keybinds.${action}`)}
                        </span>
                        {capturingAction === action ? (
                          <span className="animate-pulse rounded bg-blue-600 px-2 py-1 font-mono text-xs text-white">
                            {t('help.pressKey')}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startCapture(action)}
                            className="rounded bg-gray-600 px-2 py-1 font-mono text-xs text-gray-200 hover:bg-gray-500"
                          >
                            {formatKeyForDisplay(keybinds[action])}
                          </button>
                        )}
                      </div>
                      {conflict?.action === action && (
                        <p className="mt-1 px-1 text-xs text-red-400">
                          {t('help.keyConflict', { action: t(`keybinds.${conflict.withAction}`) })}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="flex items-center justify-between border-t border-gray-700 pt-4">
              <p className="text-xs text-gray-500">{t('shortcuts.helpHint')}</p>
              <button
                type="button"
                onClick={handleResetKeybinds}
                className="rounded px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 hover:text-white"
              >
                {t('help.resetKeybinds')}
              </button>
            </div>
          </div>
        )}

        {/* フッター（タブ共通）：サンプルマップを開く */}
        <div className="border-t border-gray-700 pt-4">
          <button
            type="button"
            onClick={handleOpenSampleMap}
            className="w-full rounded bg-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-600"
          >
            {t('help.openSampleMap')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
