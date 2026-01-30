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
 * 「新サービスの企画」という実践的なテーマで、
 * ツリーでは表現できない依存関係を自然に含むDAG構造を示す。
 *
 * 構造:
 *   "新サービスの企画"
 *   ├──→ "課題を発見する"
 *   │     ├──→ "ユーザーヒアリング" ──────────┐
 *   │     └──→ "市場リサーチ" ─────────────────┤
 *   ├──→ "解決策を考える"                      │
 *   │     ├──→ "コンセプト設計" ←──────────────┘ (3つの親)
 *   │     │           │
 *   │     └──→ "技術検証" ─────────────────────┐
 *   ├──→ "計画を立てる"                         │
 *   │     ├──→ "ロードマップ" ←── コンセプト設計 │ (2つの親)
 *   │     │           │                         │
 *   │     └──→ "チーム編成"                     │
 *   └──→ "実行する"                             │
 *         └──→ "プロトタイプ開発" ←─────────────┘←── ロードマップ (3つの親)
 */
export function createDefaultMap(t: TFunction): MindMap {
  // ノードID生成
  const rootId = generateId();
  const discoverId = generateId();
  const userInterviewId = generateId();
  const marketResearchId = generateId();
  const solveId = generateId();
  const conceptId = generateId();
  const techValidationId = generateId();
  const planId = generateId();
  const roadmapId = generateId();
  const teamBuildingId = generateId();
  const executeId = generateId();
  const prototypeId = generateId();

  const nodes = [
    // ルート
    { id: rootId, content: textContent(t('defaultMap.root')), position: { x: 0, y: 250 } },
    // レベル1
    { id: discoverId, content: textContent(t('defaultMap.discover')), position: { x: 300, y: 30 } },
    { id: solveId, content: textContent(t('defaultMap.solve')), position: { x: 300, y: 180 } },
    { id: planId, content: textContent(t('defaultMap.plan')), position: { x: 300, y: 370 } },
    { id: executeId, content: textContent(t('defaultMap.execute')), position: { x: 300, y: 520 } },
    // レベル2 - 課題を発見する
    { id: userInterviewId, content: textContent(t('defaultMap.userInterview')), position: { x: 650, y: 0 } },
    { id: marketResearchId, content: textContent(t('defaultMap.marketResearch')), position: { x: 650, y: 60 } },
    // レベル2 - 解決策を考える（コンセプト設計は DAG ノード: 3つの親を持つ）
    { id: conceptId, content: textContent(t('defaultMap.concept')), position: { x: 650, y: 150 } },
    { id: techValidationId, content: textContent(t('defaultMap.techValidation')), position: { x: 650, y: 220 } },
    // レベル2 - 計画を立てる（ロードマップは DAG ノード: 2つの親を持つ）
    { id: roadmapId, content: textContent(t('defaultMap.roadmap')), position: { x: 650, y: 340 } },
    { id: teamBuildingId, content: textContent(t('defaultMap.teamBuilding')), position: { x: 650, y: 400 } },
    // レベル2 - 実行する（プロトタイプ開発は DAG ノード: 3つの親を持つ）
    { id: prototypeId, content: textContent(t('defaultMap.prototype')), position: { x: 650, y: 520 } },
  ];

  const edges = [
    // ルート -> レベル1
    { id: generateId(), source: rootId, target: discoverId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: rootId, target: solveId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: rootId, target: planId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: rootId, target: executeId, sourceHandle: 'right', targetHandle: 'left' },
    // レベル1 -> レベル2（ツリーエッジ）
    { id: generateId(), source: discoverId, target: userInterviewId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: discoverId, target: marketResearchId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: solveId, target: conceptId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: solveId, target: techValidationId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: planId, target: roadmapId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: planId, target: teamBuildingId, sourceHandle: 'right', targetHandle: 'left' },
    { id: generateId(), source: executeId, target: prototypeId, sourceHandle: 'right', targetHandle: 'left' },
    // DAGクロスリンク: "コンセプト設計" ← ユーザーヒアリング & 市場リサーチ
    { id: generateId(), source: userInterviewId, target: conceptId, sourceHandle: 'bottom', targetHandle: 'top' },
    { id: generateId(), source: marketResearchId, target: conceptId, sourceHandle: 'bottom', targetHandle: 'top' },
    // DAGクロスリンク: "ロードマップ" ← コンセプト設計
    { id: generateId(), source: conceptId, target: roadmapId, sourceHandle: 'bottom', targetHandle: 'top' },
    // DAGクロスリンク: "プロトタイプ開発" ← 技術検証 & ロードマップ
    { id: generateId(), source: techValidationId, target: prototypeId, sourceHandle: 'bottom', targetHandle: 'top' },
    { id: generateId(), source: roadmapId, target: prototypeId, sourceHandle: 'bottom', targetHandle: 'top' },
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
