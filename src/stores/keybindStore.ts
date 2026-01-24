import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { KeybindMap, KeybindAction } from '../types';
import { defaultKeybinds } from '../config/defaultKeybinds';

interface KeybindState {
  keybinds: KeybindMap;
  setKeybind: (action: KeybindAction, key: string) => void;
  resetKeybinds: () => void;
  getActionForKey: (key: string, modifiers: { ctrl: boolean; shift: boolean; alt: boolean }) => KeybindAction | null;
}

// キーの正規化（Ctrl+Shift+Zなど）
const normalizeKey = (
  key: string,
  modifiers: { ctrl: boolean; shift: boolean; alt: boolean }
): string => {
  const parts: string[] = [];
  if (modifiers.ctrl) parts.push('Ctrl');
  if (modifiers.shift) parts.push('Shift');
  if (modifiers.alt) parts.push('Alt');
  parts.push(key);
  return parts.join('+');
};

export const useKeybindStore = create<KeybindState>()(
  persist(
    (set, get) => ({
      keybinds: { ...defaultKeybinds },

      setKeybind: (action, key) => {
        set((state) => ({
          keybinds: {
            ...state.keybinds,
            [action]: key,
          },
        }));
      },

      resetKeybinds: () => {
        set({ keybinds: { ...defaultKeybinds } });
      },

      getActionForKey: (key, modifiers) => {
        const normalizedKey = normalizeKey(key, modifiers);
        const { keybinds } = get();

        for (const [action, boundKey] of Object.entries(keybinds)) {
          if (boundKey === normalizedKey) {
            return action as KeybindAction;
          }
        }

        return null;
      },
    }),
    {
      name: 'mindmap-keybinds',
    }
  )
);
