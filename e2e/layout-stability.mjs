// 整列（ELKのINTERACTIVE戦略）が差分的レイアウトになっていることを検証する、
// ブラウザを起動しない純Nodeテスト。docs/decisions.md §26参照。
//
// 2段構えで検証する:
//   1. ドリフト検出: src/utils/layout.tsのソーステキストから実際のlayoutOptions・
//      position引き渡しを正規表現で抽出し、決定した戦略（3フェーズすべてINTERACTIVE）と
//      位置ヒントの引き渡しが実装からズレていないことを確認する
//   2. 安定性の数値検証: 抽出したオプションをそのままelkjsに渡し、「エッジ1本追加して
//      再整列」したときのノード移動量・兄弟順の維持を確認する（decisions.md §26の実験の
//      再現。実測は平均48〜150px、本テストの閾値250pxは十分な余裕を持たせている）
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ELK from 'elkjs/lib/elk.bundled.js';
import { assertTrue, assertEqual, runStandalone } from './helpers.mjs';

export const name = 'layout-stability';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LAYOUT_TS_PATH = path.join(__dirname, '../src/utils/layout.ts');

const STRATEGY_KEYS = [
  'elk.layered.cycleBreaking.strategy',
  'elk.layered.layering.strategy',
  'elk.layered.crossingMinimization.strategy',
];

/**
 * layout.tsのソースからlayoutOptionsの'elk.xxx': 'yyy'ペアとchildrenのx/y引き渡しを抽出する。
 * layout.ts側の書き方（キー・値の引用符、プロパティ名等）が変わると抽出できなくなるため、
 * その場合は「テスト側の抽出ロジックを同期せよ」という趣旨のメッセージで失敗させる
 */
function extractLayoutConfig() {
  const src = readFileSync(LAYOUT_TS_PATH, 'utf-8');

  const optionPairs = {};
  const optionRe = /'(elk\.[a-zA-Z.]+)':\s*'([A-Za-z_]+)'/g;
  let m;
  while ((m = optionRe.exec(src)) !== null) {
    optionPairs[m[1]] = m[2];
  }

  const missingKeys = STRATEGY_KEYS.filter((k) => !(k in optionPairs));
  if (missingKeys.length > 0) {
    throw new Error(
      `layout.tsからlayoutOptionsのキー ${missingKeys.join(', ')} を抽出できませんでした。` +
        `layout.tsの形式が変わったので、e2e/layout-stability.mjsの抽出ロジック(extractLayoutConfig)を同期してください。`
    );
  }

  const passesPositionX = /x:\s*n\.position\.x/.test(src);
  const passesPositionY = /y:\s*n\.position\.y/.test(src);
  if (!passesPositionX || !passesPositionY) {
    throw new Error(
      `layout.tsのchildrenにx: n.position.x / y: n.position.yの引き渡しが見つかりませんでした。` +
        `layout.tsの形式が変わったので、e2e/layout-stability.mjsの抽出ロジック(extractLayoutConfig)を同期してください。`
    );
  }

  return { optionPairs };
}

// --- テストグラフ: 12ノード（ツリー3分岐＋循環1つ。decisions.md §26の実験と同じ構造） ---
const NODE_IDS = ['root', 'a', 'b', 'c', 'a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'x', 'y'];
const BASE_EDGES = [
  ['root', 'a'],
  ['root', 'b'],
  ['root', 'c'],
  ['a', 'a1'],
  ['a', 'a2'],
  ['b', 'b1'],
  ['b', 'b2'],
  ['c', 'c1'],
  ['c', 'c2'],
  ['a2', 'x'],
  ['x', 'y'],
  ['y', 'a'], // 循環
];

// 初回の大雑把なスケッチ位置（ツリー状に手で並べた程度の座標。決定的な固定値）
const SKETCH_POSITIONS = {
  root: { x: 400, y: 0 },
  a: { x: 100, y: 150 },
  b: { x: 400, y: 150 },
  c: { x: 700, y: 150 },
  a1: { x: 0, y: 300 },
  a2: { x: 200, y: 300 },
  b1: { x: 300, y: 300 },
  b2: { x: 500, y: 300 },
  c1: { x: 600, y: 300 },
  c2: { x: 800, y: 300 },
  x: { x: 200, y: 450 },
  y: { x: 200, y: 600 },
};

const ADDED_EDGE_PATTERNS = [
  { label: 'b1→c を追加', extra: ['b1', 'c'] },
  { label: 'c2→x を追加', extra: ['c2', 'x'] },
  { label: 'a1→b2 を追加', extra: ['a1', 'b2'] },
];

const NODE_WIDTH = 180;
const NODE_HEIGHT = 60;
const AVG_DISPLACEMENT_THRESHOLD = 250;

function makeGraph(edges, options, positions) {
  return {
    id: 'root-graph',
    layoutOptions: options,
    children: NODE_IDS.map((id) => ({
      id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      ...(positions ? { x: positions[id].x, y: positions[id].y } : {}),
    })),
    edges: edges.map(([s, t], i) => ({ id: `e${i}`, sources: [s], targets: [t] })),
  };
}

function toPositions(layoutedGraph) {
  const p = {};
  for (const c of layoutedGraph.children) p[c.id] = { x: c.x, y: c.y };
  return p;
}

function averageDisplacement(p1, p2) {
  let total = 0;
  for (const id of NODE_IDS) {
    total += Math.hypot(p2[id].x - p1[id].x, p2[id].y - p1[id].y);
  }
  return total / NODE_IDS.length;
}

// ルート直下の兄弟a,b,cをx座標昇順に並べた順序（並び順の維持確認用）
function siblingOrder(positions) {
  return ['a', 'b', 'c'].sort((m, n) => positions[m].x - positions[n].x).join(',');
}

export async function run() {
  // --- 1. 実装との同期チェック（ドリフト検出） ---
  const { optionPairs } = extractLayoutConfig();

  for (const key of STRATEGY_KEYS) {
    await assertTrue(null, optionPairs[key] === 'INTERACTIVE', `${key} がINTERACTIVEであること（実際: ${optionPairs[key]}）`);
  }

  // --- 2. 安定性の数値検証（抽出したオプションをそのまま使う） ---
  const elk = new ELK();

  const initial = await elk.layout(makeGraph(BASE_EDGES, optionPairs, SKETCH_POSITIONS));
  const p0 = toPositions(initial);
  const p0SiblingOrder = siblingOrder(p0);

  for (const { label, extra } of ADDED_EDGE_PATTERNS) {
    const edges = [...BASE_EDGES, extra];
    const relaidOut = await elk.layout(makeGraph(edges, optionPairs, p0));
    const p1 = toPositions(relaidOut);

    const avgDisplacement = averageDisplacement(p0, p1);
    await assertTrue(
      null,
      avgDisplacement <= AVG_DISPLACEMENT_THRESHOLD,
      `[${label}] 平均移動量が${AVG_DISPLACEMENT_THRESHOLD}px以下であること（実際: ${avgDisplacement.toFixed(1)}px）`
    );

    await assertEqual(null, siblingOrder(p1), p0SiblingOrder, `[${label}] ルート直下の兄弟a,b,cのx座標順がP0と同一であること`);

    console.log(`  ${label}: 平均移動量=${avgDisplacement.toFixed(1)}px`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
