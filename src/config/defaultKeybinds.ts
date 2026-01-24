import { KeybindMap } from '../types';

export const defaultKeybinds: KeybindMap = {
  createChildNode: 'Tab',
  createSiblingNode: 'Enter',
  deleteNode: 'Delete',
  editNode: 'F2',
  finishEdit: 'Escape',
  selectParent: 'ArrowUp',
  selectChild: 'ArrowDown',
  selectPrevSibling: 'ArrowLeft',
  selectNextSibling: 'ArrowRight',
  undo: 'Ctrl+z',
  redo: 'Ctrl+Shift+z',
  save: 'Ctrl+s',
  zoomIn: 'Ctrl+=',
  zoomOut: 'Ctrl+-',
  fitView: 'Ctrl+0',
  toggleLayoutDirection: 'Ctrl+d',
};

export const keybindDescriptions: Record<keyof KeybindMap, string> = {
  createChildNode: '子ノード作成',
  createSiblingNode: '兄弟ノード作成',
  deleteNode: 'ノード削除',
  editNode: 'ノード編集',
  finishEdit: '編集終了',
  selectParent: '親ノードへ移動',
  selectChild: '子ノードへ移動',
  selectPrevSibling: '前の兄弟へ移動',
  selectNextSibling: '次の兄弟へ移動',
  undo: '元に戻す',
  redo: 'やり直し',
  save: '保存',
  zoomIn: '拡大',
  zoomOut: '縮小',
  fitView: '全体表示',
  toggleLayoutDirection: 'レイアウト方向切替',
};
