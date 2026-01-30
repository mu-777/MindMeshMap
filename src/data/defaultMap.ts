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

/**
 * 初回ユーザー向けのデフォルトマップを生成（DAG構造）
 *
 * ツリーではなく、複数の親を持つノードを含めることで
 * MindMeshMap の「自由な構造」をデモンストレーションする。
 *
 * 構造:
 *   "MindMeshMap の使い方"
 *   ├──→ "ノードを追加する"
 *   │     ├──→ "Tab で子ノード追加"
 *   │     ├──→ "Enter で兄弟ノード追加"
 *   │     └──→ "ハンドルからドラッグで接続"  ←─┐
 *   ├──→ "ノードを編集する"                     │
 *   │     ├──→ "ダブルクリックで編集開始"        │
 *   │     ├──→ "Escape で編集完了"               │
 *   │     └──→ "Ctrl+S / Google Drive で保存" ←─┼─┐
 *   ├──→ "ノードをつなげる" ─────────────────────┘ │
 *   └──→ "整理・保存する" ────────────────────────┘
 *         └──→ "自動レイアウトで整理"
 */
export function createDefaultMap(t: TFunction): MindMap {
  // ノードID生成
  const rootId = generateId();
  const addNodesId = generateId();
  const addChildId = generateId();
  const addSiblingId = generateId();
  const editId = generateId();
  const editStartId = generateId();
  const editEndId = generateId();
  const connectId = generateId();
  const dragConnectId = generateId();
  const organizeId = generateId();
  const autoLayoutId = generateId();
  const saveId = generateId();

  // ノード定義（position は fitView 前の初期配置）
  const nodes = [
    // ルート
    { id: rootId, content: textContent(t('defaultMap.root')), position: { x: 0, y: 250 } },
    // レベル1
    { id: addNodesId, content: textContent(t('defaultMap.addNodes')), position: { x: 300, y: 30 } },
    { id: editId, content: textContent(t('defaultMap.edit')), position: { x: 300, y: 200 } },
    { id: connectId, content: textContent(t('defaultMap.connect')), position: { x: 300, y: 370 } },
    { id: organizeId, content: textContent(t('defaultMap.organize')), position: { x: 300, y: 500 } },
    // レベル2 - ノードを追加する
    { id: addChildId, content: textContent(t('defaultMap.addChild')), position: { x: 650, y: 0 } },
    { id: addSiblingId, content: textContent(t('defaultMap.addSibling')), position: { x: 650, y: 60 } },
    // レベル2 - ノードを編集する
    { id: editStartId, content: textContent(t('defaultMap.editStart')), position: { x: 650, y: 160 } },
    { id: editEndId, content: textContent(t('defaultMap.editEnd')), position: { x: 650, y: 220 } },
    // レベル2 - 共有ノード（DAGの要）
    { id: dragConnectId, content: textContent(t('defaultMap.dragConnect')), position: { x: 650, y: 330 } },
    { id: saveId, content: textContent(t('defaultMap.save')), position: { x: 650, y: 440 } },
    // レベル2 - 整理・保存する
    { id: autoLayoutId, content: textContent(t('defaultMap.autoLayout')), position: { x: 650, y: 530 } },
  ];

  // エッジ定義（RIGHT レイアウト: right -> left）
  const edges = [
    // ルート -> レベル1
    { id: generateId(), source: rootId, target: addNodesId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: rootId, target: editId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: rootId, target: connectId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: rootId, target: organizeId, sourceHandle: 'right', targetHandle: 'left' },
    // レベル1 -> レベル2（通常のツリーエッジ）
    { id: generateId(), source: addNodesId, target: addChildId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: addNodesId, target: addSiblingId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: editId, target: editStartId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: editId, target: editEndId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: organizeId, target: autoLayoutId, sourceHandle: 'right', targetHandle: 'left' },
    // DAGクロスリンク: "ドラッグで接続" は「追加する」と「つなげる」の両方から
    { id: generateId(), source: addNodesId, target: dragConnectId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: connectId, target: dragConnectId, sourceHandle: 'right', targetHandle: 'left' },
    // DAGクロスリンク: "保存" は「編集する」と「整理・保存する」の両方から
    { id: generateId(), source: editId, target: saveId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: organizeId, target: saveId, sourceHandle: 'right', targetHandle: 'left' },
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
