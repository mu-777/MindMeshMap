import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { useKeybindStore } from '../../stores/keybindStore';
import { KeybindAction } from '../../types';

interface KeyboardShortcutHelpProps {
  onClose: () => void;
}

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
    actions: ['zoomIn', 'zoomOut', 'fitView', 'toggleLayoutDirection'],
  },
];

export function KeyboardShortcutHelp({ onClose }: KeyboardShortcutHelpProps) {
  const { t } = useTranslation();
  const { keybinds } = useKeybindStore();

  const formatKey = (key: string) => {
    return key
      .replace('ArrowUp', '↑')
      .replace('ArrowDown', '↓')
      .replace('ArrowLeft', '←')
      .replace('ArrowRight', '→')
      .replace('Escape', 'Esc');
  };

  return (
    <Modal isOpen={true} onClose={onClose} title={t('shortcuts.title')}>
      <div className="space-y-6">
        {shortcutGroups.map((group) => (
          <div key={group.titleKey}>
            <h3 className="mb-3 text-sm font-medium text-gray-400">
              {t(group.titleKey)}
            </h3>
            <div className="space-y-2">
              {group.actions.map((action) => (
                <div
                  key={action}
                  className="flex items-center justify-between rounded bg-gray-700/50 px-3 py-2"
                >
                  <span className="text-sm text-gray-300">
                    {t(`keybinds.${action}`)}
                  </span>
                  <kbd className="rounded bg-gray-600 px-2 py-1 font-mono text-xs text-gray-200">
                    {formatKey(keybinds[action])}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="border-t border-gray-700 pt-4">
          <p className="text-center text-xs text-gray-500">
            {t('shortcuts.helpHint')}
          </p>
        </div>
      </div>
    </Modal>
  );
}
