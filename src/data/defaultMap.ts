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
 * 「曖昧な思いつきを発散し、構造を整理して全体像を掴む」
 * というツールの価値を、マップの構造自体で体感させる。
 *
 * 構造:
 *   "アイデアの種"
 *   ├──→ "発散する"
 *   │     ├──→ "連想" ─────────────┐
 *   │     └──→ "疑問" ─────────────┼──┐
 *   ├──→ "掘り下げる"              │  │
 *   │     └──→ "具体化" ←─────────┘  │ (2つの親)
 *   └──→ "つなげる"                   │
 *         └──→ "新しい視点" ←─具体化──┘ (3つの親)
 *                  │            │
 *                  └──→ "全体像が見える" ←┘ (2つの親)
 */
export function createDefaultMap(t: TFunction): MindMap {
  const rootId = generateId();
  const divergeId = generateId();
  const associationId = generateId();
  const questionId = generateId();
  const deepenId = generateId();
  const concretizeId = generateId();
  const connectId = generateId();
  const newPerspectiveId = generateId();
  const bigPictureId = generateId();

  const nodes = [
    { id: rootId, content: textContent(t('defaultMap.root')), position: { x: 0, y: 150 } },
    // レベル1: 3つのアプローチ
    { id: divergeId, content: textContent(t('defaultMap.diverge')), position: { x: 250, y: 0 } },
    { id: deepenId, content: textContent(t('defaultMap.deepen')), position: { x: 250, y: 150 } },
    { id: connectId, content: textContent(t('defaultMap.connect')), position: { x: 250, y: 300 } },
    // レベル2: 発散の成果
    { id: associationId, content: textContent(t('defaultMap.association')), position: { x: 500, y: -30 } },
    { id: questionId, content: textContent(t('defaultMap.question')), position: { x: 500, y: 40 } },
    // レベル2: DAGノード（具体化 ← 掘り下げる + 連想）
    { id: concretizeId, content: textContent(t('defaultMap.concretize')), position: { x: 500, y: 150 } },
    // レベル2: DAGノード（新しい視点 ← つなげる + 疑問 + 具体化）
    { id: newPerspectiveId, content: textContent(t('defaultMap.newPerspective')), position: { x: 500, y: 300 } },
    // レベル3: 収束（全体像 ← 具体化 + 新しい視点）
    { id: bigPictureId, content: textContent(t('defaultMap.bigPicture')), position: { x: 750, y: 220 } },
  ];

  const edges = [
    // ルート → 3つのアプローチ
    { id: generateId(), source: rootId, target: divergeId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: rootId, target: deepenId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: rootId, target: connectId, sourceHandle: 'right', targetHandle: 'left' },
    // 発散 → 連想・疑問
    { id: generateId(), source: divergeId, target: associationId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: divergeId, target: questionId, sourceHandle: 'right', targetHandle: 'left' },
    // 掘り下げる → 具体化
    { id: generateId(), source: deepenId, target: concretizeId, sourceHandle: 'right', targetHandle: 'left' },
    // つなげる → 新しい視点
    { id: generateId(), source: connectId, target: newPerspectiveId, sourceHandle: 'right', targetHandle: 'left' },
    // DAG: 連想 → 具体化（発散した連想が具体化を導く）
    { id: generateId(), source: associationId, target: concretizeId, sourceHandle: 'bottom', targetHandle: 'top' },
    // DAG: 疑問 → 新しい視点（問いが新たな視点を開く）
    { id: generateId(), source: questionId, target: newPerspectiveId, sourceHandle: 'bottom', targetHandle: 'top' },
    // DAG: 具体化 → 新しい視点（具体化が視点をつなげる）
    { id: generateId(), source: concretizeId, target: newPerspectiveId, sourceHandle: 'bottom', targetHandle: 'top' },
    // DAG: 具体化 + 新しい視点 → 全体像（収束）
    { id: generateId(), source: concretizeId, target: bigPictureId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: newPerspectiveId, target: bigPictureId, sourceHandle: 'right', targetHandle: 'left' },
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
