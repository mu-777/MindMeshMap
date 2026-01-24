import { Modal } from './Modal';
import { useKeybindStore } from '../../stores/keybindStore';
import { keybindDescriptions } from '../../config/defaultKeybinds';
import { KeybindAction } from '../../types';

interface KeyboardShortcutHelpProps {
  onClose: () => void;
}

const shortcutGroups: { title: string; actions: KeybindAction[] }[] = [
  {
    title: 'ノード操作',
    actions: [
      'createChildNode',
      'createSiblingNode',
      'deleteNode',
      'editNode',
      'finishEdit',
    ],
  },
  {
    title: 'ナビゲーション',
    actions: [
      'selectParent',
      'selectChild',
      'selectPrevSibling',
      'selectNextSibling',
    ],
  },
  {
    title: '編集',
    actions: ['undo', 'redo', 'save'],
  },
  {
    title: '表示',
    actions: ['zoomIn', 'zoomOut', 'fitView', 'toggleLayoutDirection'],
  },
];

export function KeyboardShortcutHelp({ onClose }: KeyboardShortcutHelpProps) {
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
    <Modal isOpen={true} onClose={onClose} title="キーボードショートカット">
      <div className="space-y-6">
        {shortcutGroups.map((group) => (
          <div key={group.title}>
            <h3 className="mb-3 text-sm font-medium text-gray-400">
              {group.title}
            </h3>
            <div className="space-y-2">
              {group.actions.map((action) => (
                <div
                  key={action}
                  className="flex items-center justify-between rounded bg-gray-700/50 px-3 py-2"
                >
                  <span className="text-sm text-gray-300">
                    {keybindDescriptions[action]}
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
            ? キーでこのヘルプを表示
          </p>
        </div>
      </div>
    </Modal>
  );
}
