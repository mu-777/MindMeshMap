// 整列アルゴリズムの品質を、ケースコーパス全体に対して検証する回帰テスト。
// ブラウザ・devサーバ不要の純Nodeテスト（src配下の.tsを直接importして実行する）。
// 設計の背景は docs/layout-lab.md、ケースの軸は e2e/lib/layout-cases.mjs 冒頭を参照。
//
// このテストが守るもの:
//   1. **検出器の陽性確認** — 「重なり」「向き」「貫通」「交差」の各検出器が、わざと壊した配置で
//      実際に反応すること。指標が壊れて常に0を返すと、以降の全チェックが「見せかけのOK」になる
//      （実際にLiang-Barskyの符号ミスで貫通検出が常に0だった。docs/testing.md「陽性確認」参照）
//   2. **コーパス整合性** — ケース定義自体が壊れていないこと
//   3. **全アルゴリズム共通の不変条件** — 全ノードの座標が有限で返る・2回実行で完全一致（決定性）
//   4. **アルゴリズムごとの契約** — 下記CONTRACTSに宣言した不変条件を破らないこと
//
// 契約に入っていない違反（例: flat-axisのノード重なり）は、そのアルゴリズムが保証していない
// ものなので失敗にはせず、件数を集計して最後に表示する。「どれを契約に入れるか」は
// docs/layout-lab.md の表で理由とともに管理する
import './lib/ts-loader.mjs';
import { assertTrue, assertEqual, runStandalone } from './helpers.mjs';
import { buildCases } from './lib/layout-cases.mjs';
import { checkInvariants, computeMetrics, siblingInversionRatio, INVARIANT_CODES } from './lib/layout-metrics.mjs';

const { calculateLayoutForAlign } = await import('../src/utils/alignAlgorithm.ts');

export const name = 'layout-quality';

const ALGORITHMS = ['uniform', 'branch', 'flat-axis', 'sugiyama-ext'];

// アルゴリズムごとに「破ってはいけない」不変条件。ここに無い違反は保証対象外として集計のみ行う。
// 追加・削除するときは docs/layout-lab.md の対応表も更新すること
const CONTRACTS = {
  // ELKに丸投げするため重なりは起きない（ELKのspacing設定の回帰検知になる）
  uniform: [INVARIANT_CODES.NODE_OVERLAP],
  // 方針A: クロスバケットの重なりが設計上の既知の制限（docs/align-branch-layout.md）
  branch: [],
  // 方針B: x/yを別々の最適化結果から寄せ集めるため、重なり回避も向きも保証しない軽量ベースライン
  'flat-axis': [],
  // 方針E（本番の既定）: ハンドルの向きどおりに配置し、ノードを重ねない
  'sugiyama-ext': [INVARIANT_CODES.NODE_OVERLAP, INVARIANT_CODES.HANDLE_DIRECTION],
};

const W = 180;
const H = 60;
const node = (id, x, y, w = W, h = H) => ({ id, content: '', position: { x, y }, width: w, height: h });
const codesOf = (violations) => violations.map((v) => v.code);

// --- 1. 検出器の陽性確認（＋反応してはいけない場合の陰性確認）---

async function testDetectorsFirePositively() {
  // (a) ノードの重なり
  {
    const nodes = [node('a', 0, 0), node('b', 90, 30)];
    const positions = new Map(nodes.map((n) => [n.id, n.position]));
    const codes = codesOf(checkInvariants({ nodes, edges: [], direction: 'RIGHT', positions }));
    await assertTrue(null, codes.includes(INVARIANT_CODES.NODE_OVERLAP), '[陽性確認] 重なった2ノードで重なり違反が検出されること');

    const apart = new Map([['a', { x: 0, y: 0 }], ['b', { x: 400, y: 0 }]]);
    const apartCodes = codesOf(checkInvariants({ nodes, edges: [], direction: 'RIGHT', positions: apart }));
    await assertTrue(null, !apartCodes.includes(INVARIANT_CODES.NODE_OVERLAP), '[陰性確認] 離れた2ノードでは重なり違反が出ないこと');
  }

  // (b) ハンドルの向き
  {
    const nodes = [node('p', 0, 0), node('c', -400, 0)];
    const edges = [{ id: 'e1', source: 'p', target: 'c', sourceHandle: 'right' }];
    const positions = new Map(nodes.map((n) => [n.id, n.position]));
    const codes = codesOf(checkInvariants({ nodes, edges, direction: 'RIGHT', positions }));
    await assertTrue(null, codes.includes(INVARIANT_CODES.HANDLE_DIRECTION), '[陽性確認] rightハンドルの子を左に置くと向き違反が検出されること');

    const right = new Map([['p', { x: 0, y: 0 }], ['c', { x: 400, y: 0 }]]);
    const okCodes = codesOf(checkInvariants({ nodes, edges, direction: 'RIGHT', positions: right }));
    await assertTrue(null, !okCodes.includes(INVARIANT_CODES.HANDLE_DIRECTION), '[陰性確認] rightハンドルの子を右に置けば向き違反が出ないこと');
  }

  // (c) エッジのノード貫通
  {
    const nodes = [node('n0', 0, 0), node('n1', 300, 0), node('n2', 600, 0)];
    const edges = [{ id: 'e1', source: 'n0', target: 'n2', sourceHandle: 'right' }];
    const positions = new Map(nodes.map((n) => [n.id, n.position]));
    const codes = codesOf(checkInvariants({ nodes, edges, direction: 'RIGHT', positions }));
    await assertTrue(null, codes.includes(INVARIANT_CODES.EDGE_THROUGH_NODE), '[陽性確認] 間に挟まったノードを通るエッジで貫通違反が検出されること');

    const moved = new Map(positions);
    moved.set('n1', { x: 300, y: 400 });
    const clearCodes = codesOf(checkInvariants({ nodes, edges, direction: 'RIGHT', positions: moved }));
    await assertTrue(null, !clearCodes.includes(INVARIANT_CODES.EDGE_THROUGH_NODE), '[陰性確認] 間のノードをどければ貫通違反が出ないこと');
  }

  // (d) エッジ交差（スコア指標側）
  {
    const nodes = [node('a', 0, 0), node('b', 600, 400), node('c', 0, 400), node('d', 600, 0)];
    const edges = [
      { id: 'e1', source: 'a', target: 'b', sourceHandle: 'right' },
      { id: 'e2', source: 'c', target: 'd', sourceHandle: 'right' },
    ];
    const positions = new Map(nodes.map((n) => [n.id, n.position]));
    const crossed = computeMetrics({ nodes, edges, direction: 'RIGHT', positions, before: positions });
    await assertTrue(null, crossed.edgeCrossings >= 1, `[陽性確認] X字に交わる2エッジで交差が検出されること（実際: ${crossed.edgeCrossings}）`);

    const parallel = new Map([['a', { x: 0, y: 0 }], ['b', { x: 600, y: 0 }], ['c', { x: 0, y: 400 }], ['d', { x: 600, y: 400 }]]);
    const notCrossed = computeMetrics({ nodes, edges, direction: 'RIGHT', positions: parallel, before: parallel });
    await assertEqual(null, notCrossed.edgeCrossings, 0, '[陰性確認] 平行な2エッジでは交差が0であること');
  }

  // (e) 兄弟順の反転
  {
    const nodes = [node('p', 0, 0), node('a', 300, 0), node('b', 300, 200)];
    const edges = [
      { id: 'e1', source: 'p', target: 'a', sourceHandle: 'right' },
      { id: 'e2', source: 'p', target: 'b', sourceHandle: 'right' },
    ];
    const before = new Map(nodes.map((n) => [n.id, n.position]));
    const swapped = new Map([['p', { x: 0, y: 0 }], ['a', { x: 300, y: 200 }], ['b', { x: 300, y: 0 }]]);
    await assertEqual(null, siblingInversionRatio({ nodes, edges, direction: 'RIGHT', positions: swapped, before }), 1, '[陽性確認] 兄弟の上下を入れ替えると反転率が1になること');
    await assertEqual(null, siblingInversionRatio({ nodes, edges, direction: 'RIGHT', positions: before, before }), 0, '[陰性確認] 並びが変わらなければ反転率が0であること');
  }
}

// --- 2. 「向きの期待を課してよいエッジ」の絞り込みが効いていること ---
// 複数親・循環のエッジまで向き違反に数えると、どのアルゴリズムも不当に減点される
// （どちらの親を採用するかはアルゴリズムごとに違い、非採用側は位置計算から外れるため）
async function testAmbiguousEdgesAreExcluded() {
  // 複数親: p1・p2の両方からdへ。dをどちらの右にも置かなくても向き違反にしない
  {
    const nodes = [node('p1', 0, 0), node('p2', 0, 300), node('d', -400, 150)];
    const edges = [
      { id: 'e1', source: 'p1', target: 'd', sourceHandle: 'right' },
      { id: 'e2', source: 'p2', target: 'd', sourceHandle: 'right' },
    ];
    const positions = new Map(nodes.map((n) => [n.id, n.position]));
    const codes = codesOf(checkInvariants({ nodes, edges, direction: 'RIGHT', positions }));
    await assertTrue(null, !codes.includes(INVARIANT_CODES.HANDLE_DIRECTION), '[曖昧さ除外] 複数親のエッジは向きの期待対象外であること');
  }

  // 循環を閉じる後退辺: a→b→c→a の c→a は位置計算から外れるので対象外
  {
    const nodes = [node('a', 0, 0), node('b', 300, 0), node('c', 600, 0)];
    const edges = [
      { id: 'e1', source: 'a', target: 'b', sourceHandle: 'right' },
      { id: 'e2', source: 'b', target: 'c', sourceHandle: 'right' },
      { id: 'e3', source: 'c', target: 'a', sourceHandle: 'right' },
    ];
    const positions = new Map(nodes.map((n) => [n.id, n.position]));
    const codes = codesOf(checkInvariants({ nodes, edges, direction: 'RIGHT', positions }));
    await assertTrue(null, !codes.includes(INVARIANT_CODES.HANDLE_DIRECTION), '[曖昧さ除外] 循環を閉じる後退辺は向きの期待対象外であること');
  }

  // 単一の親から出る木エッジは、ちゃんと対象になる（除外が効きすぎていないこと）
  {
    const nodes = [node('p', 0, 0), node('c', -400, 0)];
    const edges = [{ id: 'e1', source: 'p', target: 'c', sourceHandle: 'right' }];
    const positions = new Map(nodes.map((n) => [n.id, n.position]));
    const codes = codesOf(checkInvariants({ nodes, edges, direction: 'RIGHT', positions }));
    await assertTrue(null, codes.includes(INVARIANT_CODES.HANDLE_DIRECTION), '[曖昧さ除外] 親が1つだけの木エッジは向きの期待対象であること');
  }
}

// --- 3. ケースコーパス自体の整合性 ---
async function testCorpusIntegrity(cases) {
  await assertTrue(null, cases.length >= 20, `[コーパス] 十分な数のケースがあること（実際: ${cases.length}）`);
  for (const c of cases) {
    const ids = new Set(c.nodes.map((n) => n.id));
    await assertTrue(null, c.nodes.length > 0, `[コーパス] ${c.id} にノードがあること`);
    await assertEqual(null, ids.size, c.nodes.length, `[コーパス] ${c.id} のノードIDが重複していないこと`);
    await assertTrue(null, c.direction === 'RIGHT' || c.direction === 'DOWN', `[コーパス] ${c.id} のdirectionが有効であること`);
    for (const n of c.nodes) {
      await assertTrue(
        null,
        Number.isFinite(n.position.x) && Number.isFinite(n.position.y),
        `[コーパス] ${c.id} の ${n.id} に有限の初期位置があること`
      );
    }
    for (const e of c.edges) {
      await assertTrue(null, ids.has(e.source) && ids.has(e.target), `[コーパス] ${c.id} のエッジ ${e.id} の両端がノードとして存在すること`);
    }
  }
}

// --- 4. コーパス全体のスイープ（共通の不変条件＋アルゴリズムごとの契約）---
async function testCorpusSweep(cases) {
  // 契約外の違反は失敗にせず件数だけ集計し、最後に表示する
  const offContract = new Map(ALGORITHMS.map((a) => [a, new Map()]));

  for (const testCase of cases) {
    for (const algorithm of ALGORITHMS) {
      const label = `${testCase.id}/${algorithm}`;
      const before = new Map(testCase.nodes.map((n) => [n.id, { ...n.position }]));
      const result = await calculateLayoutForAlign(testCase.nodes, testCase.edges, testCase.direction, algorithm);

      // 共通: 全ノードの座標が返り、有限であること
      await assertEqual(null, result.nodes.length, testCase.nodes.length, `[${label}] 全ノードの位置が返ること`);
      const positions = new Map(result.nodes.map((n) => [n.id, n.position]));
      for (const n of testCase.nodes) {
        const p = positions.get(n.id);
        await assertTrue(null, p && Number.isFinite(p.x) && Number.isFinite(p.y), `[${label}] ${n.id} の座標が有限であること`);
      }

      // 共通: 決定性（同じ入力なら常に同じ結果。整列は編集のたびに走るため必須）
      const second = await calculateLayoutForAlign(testCase.nodes, testCase.edges, testCase.direction, algorithm);
      await assertEqual(null, JSON.stringify(result), JSON.stringify(second), `[${label}] 2回実行して結果が完全一致すること（決定性）`);

      // 共通: スコアが計算でき、NaNを含まないこと（指標側の破損検知）
      const metrics = computeMetrics({ nodes: testCase.nodes, edges: testCase.edges, direction: testCase.direction, positions, before });
      for (const [key, value] of Object.entries(metrics)) {
        await assertTrue(null, Number.isFinite(value), `[${label}] スコア ${key} が有限であること（実際: ${value}）`);
      }

      // アルゴリズムごとの契約
      const violations = checkInvariants({ nodes: testCase.nodes, edges: testCase.edges, direction: testCase.direction, positions });
      const contract = CONTRACTS[algorithm];
      for (const v of violations) {
        if (contract.includes(v.code)) {
          await assertTrue(null, false, `[${label}] 契約違反(${v.code}): ${v.message}`);
        }
        const counts = offContract.get(algorithm);
        counts.set(v.code, (counts.get(v.code) || 0) + 1);
      }
    }
  }

  // 保証対象外の違反の集計（失敗ではない。どこに伸びしろがあるかの可視化）
  console.log('  --- 契約対象外の違反件数（参考。コンタクトシートで目視するときの手がかり）---');
  for (const algorithm of ALGORITHMS) {
    const counts = [...offContract.get(algorithm)].map(([code, n]) => `${code}:${n}`);
    console.log(`  ${algorithm.padEnd(14)} ${counts.length === 0 ? 'なし' : counts.join(' ')}`);
  }
}

export async function run() {
  await testDetectorsFirePositively();
  await testAmbiguousEdgesAreExcluded();

  const cases = await buildCases({ includeScale: true });
  await testCorpusIntegrity(cases);
  await testCorpusSweep(cases);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
