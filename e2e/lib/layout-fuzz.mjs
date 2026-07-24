// ランダムなグラフを決定的に生成する（ファズ）。
//
// ケースコーパス（layout-cases.mjs）は軸に沿って手で組み立てたもので、「その軸の組み合わせ」に
// しか当たらない。ここでは**軸の上でランダムにサンプリング**して、人が思いつかない組み合わせを
// 機械に探させる。期待する配置は定義できないので、検証するのは**不変条件だけ**
// （layout-contracts.mjs の契約）。
//
// 生成はseedから完全に決定的なので、
//   - 回帰テスト（e2e/layout-quality.mjs）は固定のseed範囲を毎回まわす＝flakyにならない
//   - 探索（scripts/layout-fuzz.mjs）は範囲を広げて回し、違反したseedを再現できる
// の両方が同じ生成器で成り立つ。違反したケースは caseToMapJson() でエクスポート形式のJSONに
// 落として e2e/fixtures/maps/ へ昇格させる（＝恒久ケース化する）。
import { placeTidy, placeRandom, placeCollapsed, placeMirrored, shuffleNodeOrder } from './layout-cases.mjs';

const SIDES = ['right', 'left', 'top', 'bottom'];
const OPPOSITE = { right: 'left', left: 'right', top: 'bottom', bottom: 'top' };

/** 決定的な擬似乱数（mulberry32）。layout-cases.mjs と同じもの */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rand, items) => items[Math.floor(rand() * items.length)];
const int = (rand, min, max) => min + Math.floor(rand() * (max - min + 1));

/** 重み付きでハンドルを選ぶ。ケースごとに重みを変えるので「ほぼ右だけ」も「四方に散る」も出る */
function weightedSide(rand, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < SIDES.length; i++) {
    r -= weights[i];
    if (r < 0) return SIDES[i];
  }
  return 'right';
}

/**
 * seedからランダムなケースを1つ生成する。
 * maxNodes を小さくすると軽くなる（回帰テストでは小さめ、探索では大きめに使う）。
 */
export function generateFuzzCase(seed, { maxNodes = 24 } = {}) {
  const rand = rng(seed * 2654435761);

  const nodeCount = int(rand, 2, maxNodes);
  const direction = rand() < 0.8 ? 'RIGHT' : 'DOWN';
  // ハンドルの重み。1/4の確率で「ほぼ一方向」の木にする（実際の使われ方に近い偏り）
  const weights = rand() < 0.25 ? [8, 0.3, 1, 1] : SIDES.map(() => 0.2 + rand() * 2);
  // 親の選び方: 直近寄り＝深い木、一様＝浅く広い木
  const preferRecent = rand() < 0.5;
  const varySize = rand() < 0.35;
  const rootCount = rand() < 0.25 ? int(rand, 2, 3) : 1;

  const nodes = [];
  const edges = [];
  const addNode = (id) => {
    nodes.push({
      id,
      content: '',
      position: { x: 0, y: 0 },
      width: varySize ? int(rand, 90, 420) : 180,
      height: varySize ? int(rand, 45, 240) : 60,
    });
  };
  const addEdge = (source, target, side) => {
    edges.push({ id: `e${edges.length}`, source, target, sourceHandle: side, targetHandle: OPPOSITE[side] });
  };

  for (let i = 0; i < nodeCount; i++) addNode(`n${i}`);

  // 全域木（森）を作る: 各ノードは自分より前のノードのどれかにぶら下がる
  for (let i = rootCount; i < nodeCount; i++) {
    const parentIndex = preferRecent ? int(rand, Math.max(0, i - 4), i - 1) : int(rand, 0, i - 1);
    addEdge(`n${parentIndex}`, `n${i}`, weightedSide(rand, weights));
  }

  // 非木エッジ（循環・複数親・枝をまたぐリンク）を足す。このアプリの主題そのもの
  const extraCount = int(rand, 0, Math.max(1, Math.floor(nodeCount / 4)));
  for (let k = 0; k < extraCount; k++) {
    const a = int(rand, 0, nodeCount - 1);
    const b = int(rand, 0, nodeCount - 1);
    if (a === b) continue;
    addEdge(`n${a}`, `n${b}`, weightedSide(rand, weights));
  }

  // 自己ループ（まれ）
  if (rand() < 0.08) {
    const i = int(rand, 0, nodeCount - 1);
    addEdge(`n${i}`, `n${i}`, pick(rand, SIDES));
  }

  // 孤立ノード（まれ）
  if (rand() < 0.15) addNode(`iso${nodes.length}`);

  // 初期位置（差分安定なアルゴリズムでは入力の一部）
  const placement = pick(rand, ['tidy', 'random', 'collapsed', 'mirrored', 'shuffled']);
  let placed;
  switch (placement) {
    case 'random':
      placed = placeRandom(nodes, seed);
      break;
    case 'collapsed':
      placed = placeCollapsed(nodes);
      break;
    case 'mirrored':
      placed = placeMirrored(placeTidy(nodes, edges));
      break;
    case 'shuffled':
      placed = shuffleNodeOrder(placeTidy(nodes, edges), seed);
      break;
    default:
      placed = placeTidy(nodes, edges);
  }

  return {
    id: `fuzz-${seed}`,
    group: 'Z. ファズ',
    title: `seed=${seed}`,
    note: `${placed.length}ノード ${edges.length}エッジ / 初期位置=${placement} / ${preferRecent ? '深い木' : '広い木'}${varySize ? ' / サイズばらつき' : ''}`,
    direction,
    nodes: placed,
    edges,
    seed,
  };
}

/** seedの範囲からケースをまとめて生成する */
export function generateFuzzCases({ start = 1, count = 40, maxNodes = 24 } = {}) {
  const cases = [];
  for (let seed = start; seed < start + count; seed++) cases.push(generateFuzzCase(seed, { maxNodes }));
  return cases;
}

/**
 * ケースをアプリのエクスポートJSON（MindMap形式）に変換する。
 * 違反したファズケースをこの形で保存すれば、e2e/fixtures/maps/ に置いて恒久ケース化できるし、
 * アプリのインポートでそのまま開いて目で確かめられる
 */
export function caseToMapJson(testCase) {
  const stamp = new Date(0).toISOString(); // 差分ノイズを避けるため固定
  return {
    id: testCase.id,
    name: testCase.id,
    createdAt: stamp,
    updatedAt: stamp,
    layoutDirection: testCase.direction,
    nodes: testCase.nodes,
    edges: testCase.edges,
  };
}
