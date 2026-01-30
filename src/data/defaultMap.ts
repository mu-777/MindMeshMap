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
 * 「アイデアを広げる」という抽象的な価値を、
 * マップ自体の構造で体感させる。
 *
 * 構造:
 *   "ひとつのアイデアから"
 *   ├──→ "問いを立てる"
 *   │     └──→ "気づき" ─────────→──┐
 *   ├──→ "調べる"          ↑         │
 *   │     └──→ "発見" ←────┘ ──→────┤
 *   ├──→ "人と話す"          ↑       ↓
 *   │     └──→ "ひらめき" ←──┘  "次のアイデアへ"
 *
 *   DAGノード:
 *   - "発見"（2つの親: 調べる + 気づき）
 *   - "ひらめき"（2つの親: 人と話す + 発見）
 *   - "次のアイデアへ"（3つの親: 気づき + 発見 + ひらめき）
 */
export function createDefaultMap(t: TFunction): MindMap {
  const rootId = generateId();
  const askId = generateId();
  const researchId = generateId();
  const talkId = generateId();
  const awarenessId = generateId();
  const discoveryId = generateId();
  const inspirationId = generateId();
  const nextIdeaId = generateId();

  const nodes = [
    { id: rootId, content: textContent(t('defaultMap.root')), position: { x: 0, y: 150 } },
    // 3つの探索パス
    { id: askId, content: textContent(t('defaultMap.ask')), position: { x: 250, y: 0 } },
    { id: researchId, content: textContent(t('defaultMap.research')), position: { x: 250, y: 150 } },
    { id: talkId, content: textContent(t('defaultMap.talk')), position: { x: 250, y: 300 } },
    // 各パスからの成果
    { id: awarenessId, content: textContent(t('defaultMap.awareness')), position: { x: 500, y: 0 } },
    { id: discoveryId, content: textContent(t('defaultMap.discovery')), position: { x: 500, y: 150 } },
    { id: inspirationId, content: textContent(t('defaultMap.inspiration')), position: { x: 500, y: 300 } },
    // 収束
    { id: nextIdeaId, content: textContent(t('defaultMap.nextIdea')), position: { x: 750, y: 150 } },
  ];

  const edges = [
    // ルート → 3つの探索パス
    { id: generateId(), source: rootId, target: askId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: rootId, target: researchId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: rootId, target: talkId, sourceHandle: 'right', targetHandle: 'left' },
    // 各パス → 成果（ツリーエッジ）
    { id: generateId(), source: askId, target: awarenessId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: researchId, target: discoveryId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: talkId, target: inspirationId, sourceHandle: 'right', targetHandle: 'left' },
    // DAG: 気づきが発見を導く
    { id: generateId(), source: awarenessId, target: discoveryId, sourceHandle: 'bottom', targetHandle: 'top' },
    // DAG: 発見がひらめきを生む
    { id: generateId(), source: discoveryId, target: inspirationId, sourceHandle: 'bottom', targetHandle: 'top' },
    // DAG: すべてが次のアイデアへ収束
    { id: generateId(), source: awarenessId, target: nextIdeaId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: discoveryId, target: nextIdeaId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: inspirationId, target: nextIdeaId, sourceHandle: 'right', targetHandle: 'left' },
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
