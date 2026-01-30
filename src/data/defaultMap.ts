import type { TFunction } from 'i18next';
import type { MindMap } from '../types';
import { generateId } from '../utils/idGenerator';

const FIRST_VISIT_KEY = 'mindmap-has-visited';

/** Tiptap JSON形式のテキストノードコンテンツを生成 */
function textContent(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
}

/** 初回訪問かどうかを判定 */
export function isFirstVisit(): boolean {
  return localStorage.getItem(FIRST_VISIT_KEY) === null;
}

/** 初回訪問フラグを設定 */
export function markAsVisited(): void {
  localStorage.setItem(FIRST_VISIT_KEY, 'true');
}

/** 初回ユーザー向けのデフォルトマップを生成 */
export function createDefaultMap(t: TFunction): MindMap {
  // ノードID生成
  const rootId = generateId();
  const addNodesId = generateId();
  const addChildId = generateId();
  const addSiblingId = generateId();
  const editId = generateId();
  const editStartId = generateId();
  const editEndId = generateId();
  const organizeId = generateId();
  const moveNodeId = generateId();
  const autoLayoutId = generateId();
  const saveId = generateId();
  const loginId = generateId();
  const saveShortcutId = generateId();

  // ノード定義（position は auto-layout 前の初期配置）
  const nodes = [
    // ルート
    { id: rootId, content: textContent(t('defaultMap.root')), position: { x: 0, y: 250 } },
    // レベル1
    { id: addNodesId, content: textContent(t('defaultMap.addNodes')), position: { x: 300, y: 50 } },
    { id: editId, content: textContent(t('defaultMap.edit')), position: { x: 300, y: 200 } },
    { id: organizeId, content: textContent(t('defaultMap.organize')), position: { x: 300, y: 350 } },
    { id: saveId, content: textContent(t('defaultMap.save')), position: { x: 300, y: 500 } },
    // レベル2 - ノードを追加する
    { id: addChildId, content: textContent(t('defaultMap.addChild')), position: { x: 650, y: 20 } },
    { id: addSiblingId, content: textContent(t('defaultMap.addSibling')), position: { x: 650, y: 80 } },
    // レベル2 - 編集する
    { id: editStartId, content: textContent(t('defaultMap.editStart')), position: { x: 650, y: 170 } },
    { id: editEndId, content: textContent(t('defaultMap.editEnd')), position: { x: 650, y: 230 } },
    // レベル2 - 整理する
    { id: moveNodeId, content: textContent(t('defaultMap.moveNode')), position: { x: 650, y: 320 } },
    { id: autoLayoutId, content: textContent(t('defaultMap.autoLayout')), position: { x: 650, y: 380 } },
    // レベル2 - 保存する
    { id: loginId, content: textContent(t('defaultMap.login')), position: { x: 650, y: 470 } },
    { id: saveShortcutId, content: textContent(t('defaultMap.saveShortcut')), position: { x: 650, y: 530 } },
  ];

  // エッジ定義（RIGHT レイアウト: right -> left）
  const edges = [
    // ルート -> レベル1
    { id: generateId(), source: rootId, target: addNodesId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: rootId, target: editId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: rootId, target: organizeId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: rootId, target: saveId, sourceHandle: 'right', targetHandle: 'left' },
    // レベル1 -> レベル2
    { id: generateId(), source: addNodesId, target: addChildId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: addNodesId, target: addSiblingId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: editId, target: editStartId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: editId, target: editEndId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: organizeId, target: moveNodeId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: organizeId, target: autoLayoutId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: saveId, target: loginId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: saveId, target: saveShortcutId, sourceHandle: 'right', targetHandle: 'left' },
  ];

  return {
    id: generateId(),
    name: t('defaultMap.name'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    layoutDirection: 'RIGHT',
    nodes,
    edges,
  };
}
