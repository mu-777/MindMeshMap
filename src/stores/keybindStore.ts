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
// ヘルプモーダルのキーバインド編集UI（KeyboardShortcutHelp）からも同じ正規化ロジックを使うためexportする
export const normalizeKey = (
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

// 照合用の正規形。実ブラウザでは Shift+文字 の event.key が大文字（'Z'）になる一方、
// 保存済みバインドは 'Ctrl+Shift+z' のように小文字の場合がある（過去のデフォルト値や
// localStorage に永続化済みのユーザー設定）。1文字キーのみ小文字に揃えて比較することで、
// 表記の大文字小文字によらず一致させる。ArrowUp / Tab / F2 等の複数文字キーはそのまま
const canonicalizeKeybind = (binding: string): string => {
  const parts = binding.split('+');
  const last = parts[parts.length - 1];
  if (last.length === 1) {
    parts[parts.length - 1] = last.toLowerCase();
  }
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
        const normalizedKey = canonicalizeKeybind(normalizeKey(key, modifiers));
        const { keybinds } = get();

        for (const [action, boundKey] of Object.entries(keybinds)) {
          if (canonicalizeKeybind(boundKey) === normalizedKey) {
            return action as KeybindAction;
          }
        }

        return null;
      },
    }),
    {
      name: 'mindmap-keybinds',
      // 既存ユーザーの localStorage には後から追加したアクション（createParentNode 等）が
      // 無いため、デフォルトの浅いマージだと新キーが欠落する。keybinds を
      // defaultKeybinds で下地にしてから永続値で上書きし、新デフォルトを補完しつつ
      // ユーザーのカスタマイズを保つ。
      merge: (persisted, current) => {
        const p = persisted as Partial<KeybindState> | undefined;
        return {
          ...current,
          ...(p ?? {}),
          keybinds: { ...defaultKeybinds, ...(p?.keybinds ?? {}) },
        };
      },
    }
  )
);
