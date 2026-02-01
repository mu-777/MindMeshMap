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
 * ノードをつなげて読むと文章になるDAG構造で、
 * ツールの価値を体感させる。
 *
 * 全パスが英語の命令文として自然に読める:
 *   "Start with a thought, explore freely, shape your thinking, see the whole picture"
 *   "Start with a thought, question everything, shape your thinking, see the whole picture"
 *   "Start with a thought, question everything, discover new angles, see the whole picture"
 *   "Start with a thought, explore freely, discover new angles, see the whole picture"
 *   "Start with a thought, find connections, see the whole picture"
 *
 * 構造:
 *   "Start with a thought"
 *   ├──→ "Explore freely" ──→ "Shape your thinking" ──┐
 *   │                  ╲           ↑                    │
 *   ├──→ "Question everything" ──→╱                    ├──→ "See the whole picture"
 *   │                  ╲                                │
 *   └──→ "Find connections" ──→ "Discover new angles" ──┘
 *                        ╲            ↑
 *                         ╲──────────╱
 */
export function createDefaultMap(t: TFunction): MindMap {
  const rootId = generateId();
  const exploreId = generateId();
  const questionId = generateId();
  const findConnectionsId = generateId();
  const shapeId = generateId();
  const discoverId = generateId();
  const bigPictureId = generateId();

  const nodes = [
    { id: rootId, content: textContent(t('defaultMap.root')), position: { x: 0, y: 150 } },
    // レベル1: 3つのアプローチ
    { id: exploreId, content: textContent(t('defaultMap.explore')), position: { x: 250, y: 0 } },
    { id: questionId, content: textContent(t('defaultMap.question')), position: { x: 250, y: 150 } },
    { id: findConnectionsId, content: textContent(t('defaultMap.findConnections')), position: { x: 250, y: 300 } },
    // レベル2: DAGノード（複数の親を持つ）
    { id: shapeId, content: textContent(t('defaultMap.shape')), position: { x: 500, y: 50 } },
    { id: discoverId, content: textContent(t('defaultMap.discover')), position: { x: 500, y: 250 } },
    // レベル3: 収束
    { id: bigPictureId, content: textContent(t('defaultMap.bigPicture')), position: { x: 750, y: 150 } },
  ];

  const edges = [
    // ルート → レベル1
    { id: generateId(), source: rootId, target: exploreId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: rootId, target: questionId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: rootId, target: findConnectionsId, sourceHandle: 'right', targetHandle: 'left' },
    // レベル1 → レベル2（ツリーエッジ）
    { id: generateId(), source: exploreId, target: shapeId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: questionId, target: discoverId, sourceHandle: 'right', targetHandle: 'left' },
    // DAG: Question → Shape（問うことが思考を形づくる）
    { id: generateId(), source: questionId, target: shapeId, sourceHandle: 'right', targetHandle: 'left' },
    // DAG: Explore → Discover（自由な探索が新たな角度を見つける）
    { id: generateId(), source: exploreId, target: discoverId, sourceHandle: 'right', targetHandle: 'left' },
    // レベル2 → レベル3（収束）
    { id: generateId(), source: shapeId, target: bigPictureId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: discoverId, target: bigPictureId, sourceHandle: 'right', targetHandle: 'left' },
    // DAG: Find connections → See the whole picture（直接つながる短いパス）
    { id: generateId(), source: findConnectionsId, target: bigPictureId, sourceHandle: 'right', targetHandle: 'left' },
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
