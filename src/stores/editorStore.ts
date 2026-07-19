import { create } from 'zustand';
import type { Editor } from '@tiptap/react';

// 現在編集中のTiptapエディタインスタンスを保持するストア（永続化不要）。
// キャンバス右上の常設書式パネル（FormatToolbar）が、編集中のノードのエディタを
// 操作対象として参照するために使う
interface EditorStoreState {
  activeEditor: Editor | null;
  setActiveEditor: (editor: Editor | null) => void;
}

export const useEditorStore = create<EditorStoreState>((set) => ({
  activeEditor: null,
  setActiveEditor: (editor) => set({ activeEditor: editor }),
}));
