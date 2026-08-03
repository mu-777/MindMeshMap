// dev限定の整列アルゴリズム（branch / flat-axis / sugiyama-ext / sugiyama-port / elk-port / elk-port-ext / elk-port-pava / hola-lite）の**個別の設計意図**を検証する、
// ブラウザを起動しない純Nodeテスト。docs/align-branch-layout.md参照。
//
// このファイルは「そのアルゴリズムが狙った配置になっているか」（右子は右へ、上/下子は親に被せて、等）を
// 手書きの小さなグラフで確認する。アルゴリズム共通の品質（不変条件・スコア指標）を
// ケースコーパス全体に対して見るのは e2e/layout-quality.mjs の担当（docs/layout-lab.md）。
//
// e2e/layout-stability.mjsはlayout.tsのソースを正規表現で読むだけで済んだが、本テストは
// 実際にcalculateBranchLayout / calculateFlatAxisLayout / calculateLayoutForAlign /
// calculateLayoutを呼び出して結果を検証する必要がある。素のNodeでsrc配下の.tsを直接importする
// ためのローダーは e2e/lib/ts-loader.mjs に集約してある（**動的importが必須**な理由もそちら参照）
import './lib/ts-loader.mjs';
import { assertTrue, assertEqual, runStandalone } from './helpers.mjs';

export const name = 'branch-layout-algorithms';

const { calculateBranchLayout } = await import('../src/utils/branchLayout.ts');
const { calculateFlatAxisLayout } = await import('../src/utils/flatAxisLayout.ts');
const { calculateSugiyamaExtLayout } = await import('../src/utils/sugiyamaExtLayout.ts');
const { calculateElkPortLayout } = await import('../src/utils/elkPortLayout.ts');
const { calculateElkPortExtLayout } = await import('../src/utils/elkPortExtLayout.ts');
const { calculateElkPortPavaLayout } = await import('../src/utils/elkPortPavaLayout.ts');
// 被り量は実装（sugiyamaPortLayout.ts）が唯一の定義。期待値はここで計算し、値をハードコードしない
const { calculateSugiyamaPortLayout, ESCAPE_FORWARD_AS_GROUP, CROSS_OVERLAP_RATIO, CROSS_OVERLAP_RATIO_INSIDE } =
  await import('../src/utils/sugiyamaPortLayout.ts');

// 被り量の期待値は定数からの計算なので、比の値によっては丸め誤差が出る（180×0.7=125.99999…）。
// 実装側は別の式で組み立てるぶん誤差の出方が違うので、両辺を丸めてから比べる
const round6 = (v) => Math.round(v * 1e6) / 1e6;
const { calculateHolaLiteLayout, GROWTH_GAP } = await import('../src/utils/holaLiteLayout.ts');
const { calculateLayoutForAlign } = await import('../src/utils/alignAlgorithm.ts');
const { calculateLayout } = await import('../src/utils/layout.ts');

function positionsById(result) {
  const map = new Map();
  for (const n of result.nodes) map.set(n.id, n.position);
  return map;
}

function variance(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
}

// ノードの矩形（position=左上、width/height）を求める
function rectOf(pos, node) {
  const w = node.width || 180;
  const h = node.height || 60;
  return { minX: pos.x, minY: pos.y, maxX: pos.x + w, maxY: pos.y + h };
}

// 2つの軸平行矩形が正の面積で重なっているか
function rectanglesOverlap(a, b) {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

// x方向（primary帯）だけで重なっているか（sugiyama-extの「親の後ろと子の前が被る」検証用）
function rectanglesOverlapX(a, b) {
  return a.minX < b.maxX && b.minX < a.maxX;
}

// --- 1. 横系/縦系の分離（branch） ---
async function testBranchSideSeparation() {
  const nodes = [
    { id: 'p', content: '', position: { x: 0, y: 0 } },
    { id: 'r1', content: '', position: { x: 300, y: -50 } },
    { id: 'r2', content: '', position: { x: 300, y: 50 } },
    { id: 'b1', content: '', position: { x: -50, y: 300 } },
    { id: 'b2', content: '', position: { x: 50, y: 300 } },
  ];
  const edges = [
    { id: 'e1', source: 'p', target: 'r1', sourceHandle: 'right' },
    { id: 'e2', source: 'p', target: 'r2', sourceHandle: 'right' },
    { id: 'e3', source: 'p', target: 'b1', sourceHandle: 'bottom' },
    { id: 'e4', source: 'p', target: 'b2', sourceHandle: 'bottom' },
  ];

  const result = await calculateBranchLayout(nodes, edges, 'RIGHT');
  const pos = positionsById(result);
  const p = pos.get('p');

  for (const id of ['r1', 'r2']) {
    await assertTrue(null, pos.get(id).x > p.x, `[branch側分離] ${id}のx座標が親より大きいこと（右方向）`);
  }
  for (const id of ['b1', 'b2']) {
    await assertTrue(null, pos.get(id).y > p.y, `[branch側分離] ${id}のy座標が親より大きいこと（下方向）`);
  }

  // 「y座標は親に近い」「x座標は親に近い」は、2人兄弟がいるとELKが兄弟を進行方向と垂直な軸に
  // 広げる（sibling spacing）ため、単純に「x方向の変化 < y方向の変化」を個々のノードで比較すると
  // 兄弟間隔がレイヤー間隔を上回るケースで不安定になる。そのためバケット単位（right群 vs bottom群）
  // の平均変位を比較する: right群はy方向の変位が小さく、bottom群はx方向の変位が小さいはず
  const avg = (values) => values.reduce((a, b) => a + b, 0) / values.length;
  const rightYDeltas = ['r1', 'r2'].map((id) => Math.abs(pos.get(id).y - p.y));
  const bottomYDeltas = ['b1', 'b2'].map((id) => Math.abs(pos.get(id).y - p.y));
  const rightXDeltas = ['r1', 'r2'].map((id) => Math.abs(pos.get(id).x - p.x));
  const bottomXDeltas = ['b1', 'b2'].map((id) => Math.abs(pos.get(id).x - p.x));

  await assertTrue(
    null,
    avg(rightYDeltas) < avg(bottomYDeltas),
    `[branch側分離] right群の平均y変位(${avg(rightYDeltas).toFixed(1)})がbottom群の平均y変位(${avg(bottomYDeltas).toFixed(1)})より小さいこと（y座標が親に近い）`
  );
  await assertTrue(
    null,
    avg(bottomXDeltas) < avg(rightXDeltas),
    `[branch側分離] bottom群の平均x変位(${avg(bottomXDeltas).toFixed(1)})がright群の平均x変位(${avg(rightXDeltas).toFixed(1)})より小さいこと（x座標が親に近い）`
  );
}

// --- 2. 再帰の検証（branch） ---
async function testBranchRecursion() {
  const nodes = [
    { id: 'root', content: '', position: { x: 0, y: 0 } },
    { id: 'c', content: '', position: { x: 300, y: 0 } },
    { id: 'g', content: '', position: { x: 300, y: 300 } },
  ];
  const edges = [
    { id: 'e1', source: 'root', target: 'c', sourceHandle: 'right' },
    { id: 'e2', source: 'c', target: 'g', sourceHandle: 'bottom' },
  ];

  const result = await calculateBranchLayout(nodes, edges, 'RIGHT');
  const pos = positionsById(result);
  const root = pos.get('root');
  const c = pos.get('c');
  const g = pos.get('g');

  await assertTrue(null, g.x > root.x, '[branch再帰] 孫のx座標がrootより大きいこと（右）');
  await assertTrue(null, g.y > root.y, '[branch再帰] 孫のy座標がrootより大きいこと（下）');
  await assertTrue(null, g.y > c.y, '[branch再帰] 孫のy座標がright子より大きいこと（下）');
  await assertTrue(
    null,
    Math.abs(g.x - c.x) < Math.abs(g.x - root.x),
    '[branch再帰] 孫のx座標はrootよりright子に近いこと（正しく再帰合成されていること）'
  );
}

// --- 2.5. 非対称な兄弟サブツリーが重ならないこと（branch。Fableレビューで発見した回帰バグ） ---
// 親pの'bottom'バケットにc1（葉）とc2（'left'方向の孫gを持つ）の2兄弟がいるケース。
// c2のサブツリー箱はgの分だけ左（負方向）にはみ出す非対称な形になるが、そのはみ出しを
// computeSubtreeBoxが親のELK呼び出しへの位置ヒントに正しく反映していないと、
// ELKの間隔計算がc2の実際の見た目の広がりを考慮できず、隣接するc1（またはgそのもの）と
// 実際に重なってしまう
async function testBranchAsymmetricSiblingNoOverlap() {
  const nodes = [
    { id: 'p', content: '', position: { x: 0, y: 0 }, width: 180, height: 60 },
    { id: 'c1', content: '', position: { x: -100, y: 300 }, width: 180, height: 60 },
    { id: 'c2', content: '', position: { x: 100, y: 300 }, width: 180, height: 60 },
    { id: 'g', content: '', position: { x: -100, y: 300 }, width: 180, height: 60 },
  ];
  const edges = [
    { id: 'e1', source: 'p', target: 'c1', sourceHandle: 'bottom' },
    { id: 'e2', source: 'p', target: 'c2', sourceHandle: 'bottom' },
    { id: 'e3', source: 'c2', target: 'g', sourceHandle: 'left' },
  ];

  const result = await calculateBranchLayout(nodes, edges, 'RIGHT');
  const pos = positionsById(result);
  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  const rectC1 = rectOf(pos.get('c1'), nodesById.get('c1'));
  const rectC2 = rectOf(pos.get('c2'), nodesById.get('c2'));
  const rectG = rectOf(pos.get('g'), nodesById.get('g'));

  await assertTrue(
    null,
    !rectanglesOverlap(rectC1, rectG),
    `[branch非対称兄弟] c1(${JSON.stringify(rectC1)})とg(${JSON.stringify(rectG)})が重ならないこと`
  );
  await assertTrue(
    null,
    !rectanglesOverlap(rectC1, rectC2),
    `[branch非対称兄弟] c1(${JSON.stringify(rectC1)})とc2(${JSON.stringify(rectC2)})が重ならないこと`
  );
}

// --- 3. 循環・孤立循環コンポーネントでクラッシュしないこと（branch） ---
async function testBranchPureCycle() {
  // 入次数0のノードが存在しない3ノードの純粋な循環グラフ（A→B→C→A）
  const nodes = [
    { id: 'a', content: '', position: { x: 0, y: 0 } },
    { id: 'b', content: '', position: { x: 200, y: 0 } },
    { id: 'c', content: '', position: { x: 100, y: 200 } },
  ];
  const edges = [
    { id: 'e1', source: 'a', target: 'b' },
    { id: 'e2', source: 'b', target: 'c' },
    { id: 'e3', source: 'c', target: 'a' },
  ];

  const result1 = await calculateBranchLayout(nodes, edges, 'RIGHT');
  await assertEqual(null, result1.nodes.length, 3, '[branch循環] 全ノードの位置が返ること（3件）');
  for (const n of result1.nodes) {
    await assertTrue(null, Number.isFinite(n.position.x) && Number.isFinite(n.position.y), `[branch循環] ${n.id}の座標が有限の数値であること`);
  }

  const result2 = await calculateBranchLayout(nodes, edges, 'RIGHT');
  await assertEqual(
    null,
    JSON.stringify(result1),
    JSON.stringify(result2),
    '[branch循環] 同じ入力を2回実行して結果が完全一致すること（決定性）'
  );
}

// --- 4. 複数親でクラッシュせず決定的であること（branch） ---
async function testBranchMultiParent() {
  const nodes = [
    { id: 'p1', content: '', position: { x: 0, y: 0 } },
    { id: 'p2', content: '', position: { x: 0, y: 300 } },
    { id: 'd', content: '', position: { x: 300, y: 150 } },
  ];
  // dはp1（right）とp2（bottom）の両方から到達可能（複数親）
  const edges = [
    { id: 'e1', source: 'p1', target: 'd', sourceHandle: 'right' },
    { id: 'e2', source: 'p2', target: 'd', sourceHandle: 'bottom' },
  ];

  const result1 = await calculateBranchLayout(nodes, edges, 'RIGHT');
  await assertEqual(null, result1.nodes.length, 3, '[branch複数親] 全ノードの位置が返ること（3件）');
  for (const n of result1.nodes) {
    await assertTrue(null, Number.isFinite(n.position.x) && Number.isFinite(n.position.y), `[branch複数親] ${n.id}の座標が有限の数値であること`);
  }

  const result2 = await calculateBranchLayout(nodes, edges, 'RIGHT');
  await assertEqual(
    null,
    JSON.stringify(result1),
    JSON.stringify(result2),
    '[branch複数親] 同じ入力を2回実行して結果が完全一致すること（決定性）'
  );
}

// --- 5. 横系/縦系の分離（flat-axis） ---
async function testFlatAxisSeparation() {
  const nodes = [
    { id: 'h1', content: '', position: { x: 0, y: 0 } },
    { id: 'h2', content: '', position: { x: 200, y: 10 } },
    { id: 'h3', content: '', position: { x: 400, y: -10 } },
    { id: 'h4', content: '', position: { x: 600, y: 5 } },
    { id: 'v1', content: '', position: { x: 0, y: 0 } },
    { id: 'v2', content: '', position: { x: 10, y: 200 } },
    { id: 'v3', content: '', position: { x: -10, y: 400 } },
    { id: 'v4', content: '', position: { x: 5, y: 600 } },
  ];
  const edges = [
    { id: 'eh1', source: 'h1', target: 'h2', sourceHandle: 'right' },
    { id: 'eh2', source: 'h2', target: 'h3', sourceHandle: 'right' },
    { id: 'eh3', source: 'h3', target: 'h4', sourceHandle: 'right' },
    { id: 'ev1', source: 'v1', target: 'v2', sourceHandle: 'bottom' },
    { id: 'ev2', source: 'v2', target: 'v3', sourceHandle: 'bottom' },
    { id: 'ev3', source: 'v3', target: 'v4', sourceHandle: 'bottom' },
  ];

  const result = await calculateFlatAxisLayout(nodes, edges, 'RIGHT');
  const pos = positionsById(result);

  const hXs = ['h1', 'h2', 'h3', 'h4'].map((id) => pos.get(id).x);
  const hYs = ['h1', 'h2', 'h3', 'h4'].map((id) => pos.get(id).y);
  const vXs = ['v1', 'v2', 'v3', 'v4'].map((id) => pos.get(id).x);
  const vYs = ['v1', 'v2', 'v3', 'v4'].map((id) => pos.get(id).y);

  // 大雑把な傾向確認：横系エッジのみで繋がったノード群はx方向に大きく広がり、
  // y方向にはほとんど広がらないこと（縦系はその逆）
  await assertTrue(
    null,
    variance(hXs) > variance(hYs) * 3,
    `[flat-axis分離] 横系ノード群はx座標の分散がy座標の分散よりはっきり大きいこと（x分散=${variance(hXs).toFixed(1)}, y分散=${variance(hYs).toFixed(1)}）`
  );
  await assertTrue(
    null,
    variance(vYs) > variance(vXs) * 3,
    `[flat-axis分離] 縦系ノード群はy座標の分散がx座標の分散よりはっきり大きいこと（y分散=${variance(vYs).toFixed(1)}, x分散=${variance(vXs).toFixed(1)}）`
  );
}

// --- 6. ディスパッチャの回帰確認（uniform） ---
async function testDispatcherUniformParity() {
  const nodes = [
    { id: 'root', content: '', position: { x: 400, y: 0 } },
    { id: 'a', content: '', position: { x: 100, y: 150 } },
    { id: 'b', content: '', position: { x: 400, y: 150 } },
    { id: 'c', content: '', position: { x: 700, y: 150 } },
    { id: 'a1', content: '', position: { x: 0, y: 300 } },
  ];
  const edges = [
    { id: 'e1', source: 'root', target: 'a' },
    { id: 'e2', source: 'root', target: 'b' },
    { id: 'e3', source: 'root', target: 'c' },
    { id: 'e4', source: 'a', target: 'a1' },
  ];

  const viaDispatcher = await calculateLayoutForAlign(nodes, edges, 'RIGHT', 'uniform');
  const viaDirect = await calculateLayout(nodes, edges, 'RIGHT');

  await assertEqual(
    null,
    JSON.stringify(viaDispatcher),
    JSON.stringify(viaDirect),
    '[ディスパッチャ回帰] uniformアルゴリズムが既存calculateLayoutと完全に同じ結果を返すこと'
  );
}

// --- 7. sugiyama-ext: ハンドル別の方向分離（右=前方、上/下=親に被せて上/下）---
async function testSugiyamaExtSideSeparation() {
  // 添付画像の構成: 親に右ハンドル子2つ、上ハンドル子1つ、下ハンドル子1つ
  const nodes = [
    { id: 'p', content: '', position: { x: 0, y: 0 } },
    { id: 'r1', content: '', position: { x: 300, y: -40 } },
    { id: 'r2', content: '', position: { x: 300, y: 40 } },
    { id: 'top', content: '', position: { x: 40, y: -200 } },
    { id: 'bottom', content: '', position: { x: 40, y: 200 } },
  ];
  const edges = [
    { id: 'e1', source: 'p', target: 'r1', sourceHandle: 'right' },
    { id: 'e2', source: 'p', target: 'r2', sourceHandle: 'right' },
    { id: 'e3', source: 'p', target: 'top', sourceHandle: 'top' },
    { id: 'e4', source: 'p', target: 'bottom', sourceHandle: 'bottom' },
  ];
  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  const result = await calculateSugiyamaExtLayout(nodes, edges, 'RIGHT');
  const pos = positionsById(result);
  const p = pos.get('p');

  // 右ハンドル子は前方（親より右）へ、y座標は親の近く
  for (const id of ['r1', 'r2']) {
    await assertTrue(null, pos.get(id).x > p.x + 100, `[sugiyama-ext] ${id}が親より十分右にあること（前方=1層）`);
  }
  // 上ハンドル子は親より上、下ハンドル子は親より下
  await assertTrue(null, pos.get('top').y < p.y, '[sugiyama-ext] 上ハンドル子が親より上にあること');
  await assertTrue(null, pos.get('bottom').y > p.y, '[sugiyama-ext] 下ハンドル子が親より下にあること');

  // 上/下ハンドル子は「約0.5層」＝右ハンドル子(1層)より手前。右子のxより明確に左にあること
  const rightX = Math.min(pos.get('r1').x, pos.get('r2').x);
  await assertTrue(null, pos.get('top').x < rightX, '[sugiyama-ext] 上ハンドル子は右ハンドル子より手前(左)にあること（0.5層<1層）');
  await assertTrue(null, pos.get('bottom').x < rightX, '[sugiyama-ext] 下ハンドル子は右ハンドル子より手前(左)にあること');

  // 上/下ハンドル子は親のprimary帯(x)に被ること（画像の「親の後ろと子の前が被る」）
  await assertTrue(
    null,
    rectanglesOverlapX(rectOf(pos.get('top'), nodesById.get('top')), rectOf(p, nodesById.get('p'))),
    '[sugiyama-ext] 上ハンドル子が親とx方向(primary帯)で被ること'
  );
  await assertTrue(
    null,
    rectanglesOverlapX(rectOf(pos.get('bottom'), nodesById.get('bottom')), rectOf(p, nodesById.get('p'))),
    '[sugiyama-ext] 下ハンドル子が親とx方向(primary帯)で被ること'
  );
}

// --- 8. sugiyama-ext: rootは現在位置を保つ（メンタルマップ保持）---
async function testSugiyamaExtRootStable() {
  const nodes = [
    { id: 'root', content: '', position: { x: 123, y: 456 } },
    { id: 'c', content: '', position: { x: 400, y: 456 } },
  ];
  const edges = [{ id: 'e1', source: 'root', target: 'c', sourceHandle: 'right' }];

  const result = await calculateSugiyamaExtLayout(nodes, edges, 'RIGHT');
  const pos = positionsById(result);
  await assertEqual(null, JSON.stringify(pos.get('root')), JSON.stringify({ x: 123, y: 456 }), '[sugiyama-ext] rootの位置が整列後も変わらないこと');
}

// --- 9. sugiyama-ext: 下向きレイアウトへの自然な回転 ---
async function testSugiyamaExtDownDirection() {
  // DOWN: bottom=前方(下), right=cross(右に被せる)
  const nodes = [
    { id: 'p', content: '', position: { x: 0, y: 0 } },
    { id: 'd1', content: '', position: { x: -40, y: 300 } },
    { id: 'd2', content: '', position: { x: 40, y: 300 } },
    { id: 'right', content: '', position: { x: 300, y: 40 } },
  ];
  const edges = [
    { id: 'e1', source: 'p', target: 'd1', sourceHandle: 'bottom' },
    { id: 'e2', source: 'p', target: 'd2', sourceHandle: 'bottom' },
    { id: 'e3', source: 'p', target: 'right', sourceHandle: 'right' },
  ];
  const result = await calculateSugiyamaExtLayout(nodes, edges, 'DOWN');
  const pos = positionsById(result);
  const p = pos.get('p');

  // bottomハンドル子は前方（親より下）へ
  for (const id of ['d1', 'd2']) {
    await assertTrue(null, pos.get(id).y > p.y + 40, `[sugiyama-ext DOWN] ${id}が親より十分下にあること（前方=1層）`);
  }
  // rightハンドル子は親より右、かつ前方(下)の子より手前(上)
  await assertTrue(null, pos.get('right').x > p.x, '[sugiyama-ext DOWN] rightハンドル子が親より右にあること');
  await assertTrue(null, pos.get('right').y < Math.min(pos.get('d1').y, pos.get('d2').y), '[sugiyama-ext DOWN] rightハンドル子は前方(下)の子より手前(上)にあること');
}

// --- 10. sugiyama-ext: 循環・複数親でクラッシュせず決定的 ---
async function testSugiyamaExtCycleAndMultiParent() {
  // 純粋な循環（入次数0が無い）
  const cycleNodes = [
    { id: 'a', content: '', position: { x: 0, y: 0 } },
    { id: 'b', content: '', position: { x: 200, y: 0 } },
    { id: 'c', content: '', position: { x: 100, y: 200 } },
  ];
  const cycleEdges = [
    { id: 'e1', source: 'a', target: 'b', sourceHandle: 'right' },
    { id: 'e2', source: 'b', target: 'c', sourceHandle: 'bottom' },
    { id: 'e3', source: 'c', target: 'a', sourceHandle: 'right' },
  ];
  const r1 = await calculateSugiyamaExtLayout(cycleNodes, cycleEdges, 'RIGHT');
  await assertEqual(null, r1.nodes.length, 3, '[sugiyama-ext循環] 全ノードの位置が返ること');
  for (const n of r1.nodes) {
    await assertTrue(null, Number.isFinite(n.position.x) && Number.isFinite(n.position.y), `[sugiyama-ext循環] ${n.id}の座標が有限であること`);
  }
  const r2 = await calculateSugiyamaExtLayout(cycleNodes, cycleEdges, 'RIGHT');
  await assertEqual(null, JSON.stringify(r1), JSON.stringify(r2), '[sugiyama-ext循環] 2回実行で結果が完全一致すること（決定性）');

  // 複数親（dはp1(right)とp2(bottom)の両方から到達可能）
  const mpNodes = [
    { id: 'p1', content: '', position: { x: 0, y: 0 } },
    { id: 'p2', content: '', position: { x: 0, y: 300 } },
    { id: 'd', content: '', position: { x: 300, y: 150 } },
  ];
  const mpEdges = [
    { id: 'e1', source: 'p1', target: 'd', sourceHandle: 'right' },
    { id: 'e2', source: 'p2', target: 'd', sourceHandle: 'bottom' },
  ];
  const m1 = await calculateSugiyamaExtLayout(mpNodes, mpEdges, 'RIGHT');
  const m2 = await calculateSugiyamaExtLayout(mpNodes, mpEdges, 'RIGHT');
  await assertEqual(null, m1.nodes.length, 3, '[sugiyama-ext複数親] 全ノードの位置が返ること');
  await assertEqual(null, JSON.stringify(m1), JSON.stringify(m2), '[sugiyama-ext複数親] 2回実行で結果が完全一致すること（決定性）');
}

// --- 11. sugiyama-ext: ディスパッチャ経由と直接呼び出しが一致 ---
async function testSugiyamaExtDispatcherParity() {
  const nodes = [
    { id: 'p', content: '', position: { x: 0, y: 0 } },
    { id: 'r', content: '', position: { x: 300, y: 0 } },
    { id: 't', content: '', position: { x: 0, y: -200 } },
  ];
  const edges = [
    { id: 'e1', source: 'p', target: 'r', sourceHandle: 'right' },
    { id: 'e2', source: 'p', target: 't', sourceHandle: 'top' },
  ];
  const viaDispatcher = await calculateLayoutForAlign(nodes, edges, 'RIGHT', 'sugiyama-ext');
  const viaDirect = await calculateSugiyamaExtLayout(nodes, edges, 'RIGHT');
  await assertEqual(null, JSON.stringify(viaDispatcher), JSON.stringify(viaDirect), '[sugiyama-extディスパッチャ] 経由と直接呼び出しが一致すること');
}

// --- 12. sugiyama-ext: 最深レイヤ採用（A1→B1→C1→D1 と A1→B2→D1 で D1 は C1 の後ろ）---
async function testSugiyamaExtDeepestLayer() {
  const nodes = [
    { id: 'A1', content: '', position: { x: 0, y: 0 } },
    { id: 'B1', content: '', position: { x: 200, y: -50 } },
    { id: 'B2', content: '', position: { x: 200, y: 50 } },
    { id: 'C1', content: '', position: { x: 400, y: -50 } },
    { id: 'D1', content: '', position: { x: 600, y: 0 } },
  ];
  const edges = [
    { id: 'e1', source: 'A1', target: 'B1', sourceHandle: 'right' },
    { id: 'e2', source: 'B1', target: 'C1', sourceHandle: 'right' },
    { id: 'e3', source: 'C1', target: 'D1', sourceHandle: 'right' },
    { id: 'e4', source: 'A1', target: 'B2', sourceHandle: 'right' },
    { id: 'e5', source: 'B2', target: 'D1', sourceHandle: 'right' },
  ];
  const result = await calculateSugiyamaExtLayout(nodes, edges, 'RIGHT');
  const pos = positionsById(result);
  // レイヤ: A1(0) < B1≈B2(1) < C1(2) < D1(3)。D1は浅いB2ではなく深いC1の後ろに来る
  await assertTrue(null, pos.get('C1').x > pos.get('B1').x, '[sugiyama-ext深さ] C1がB1より右（深い層）');
  await assertTrue(null, pos.get('D1').x > pos.get('C1').x, '[sugiyama-ext深さ] D1がC1より右（C1の子として最深層に配置される）');
  await assertTrue(null, pos.get('D1').x > pos.get('B2').x, '[sugiyama-ext深さ] D1がB2より右（浅いB2の後ろではない）');
}

// --- 13. sugiyama-ext: cross群とforward群が重ならない ---
async function testSugiyamaExtCrossForwardNoOverlap() {
  // forward子を3つ（縦に広がる）＋上ハンドル子1つ。上ハンドル子がforward子群と重ならないこと
  const nodes = [
    { id: 'p', content: '', position: { x: 0, y: 0 } },
    { id: 'f1', content: '', position: { x: 300, y: -150 } },
    { id: 'f2', content: '', position: { x: 300, y: 0 } },
    { id: 'f3', content: '', position: { x: 300, y: 150 } },
    { id: 'top', content: '', position: { x: 60, y: -320 } },
  ];
  const edges = [
    { id: 'e1', source: 'p', target: 'f1', sourceHandle: 'right' },
    { id: 'e2', source: 'p', target: 'f2', sourceHandle: 'right' },
    { id: 'e3', source: 'p', target: 'f3', sourceHandle: 'right' },
    { id: 'e4', source: 'p', target: 'top', sourceHandle: 'top' },
  ];
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const result = await calculateSugiyamaExtLayout(nodes, edges, 'RIGHT');
  const pos = positionsById(result);
  const topRect = rectOf(pos.get('top'), nodesById.get('top'));
  for (const id of ['f1', 'f2', 'f3']) {
    await assertTrue(
      null,
      !rectanglesOverlap(topRect, rectOf(pos.get(id), nodesById.get(id))),
      `[sugiyama-ext] 上ハンドル子がforward子(${id})と矩形で重ならないこと`
    );
  }
}

// --- 14. sugiyama-ext: 複数ツリーのマージン（重なり解消／離れていれば不動）---
async function testSugiyamaExtTreeSeparation() {
  const bboxOf = (pos, nodesById, ids) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
      const r = rectOf(pos.get(id), nodesById.get(id));
      minX = Math.min(minX, r.minX); minY = Math.min(minY, r.minY);
      maxX = Math.max(maxX, r.maxX); maxY = Math.max(maxY, r.maxY);
    }
    return { minX, minY, maxX, maxY };
  };

  // (a) ほぼ同じ位置に置いた2つの独立ツリー → 分離されること
  const overlapNodes = [
    { id: 'a', content: '', position: { x: 0, y: 0 } },
    { id: 'ac', content: '', position: { x: 200, y: 0 } },
    { id: 'x', content: '', position: { x: 20, y: 20 } },
    { id: 'xc', content: '', position: { x: 220, y: 20 } },
  ];
  const overlapEdges = [
    { id: 'e1', source: 'a', target: 'ac', sourceHandle: 'right' },
    { id: 'e2', source: 'x', target: 'xc', sourceHandle: 'right' },
  ];
  const obId = new Map(overlapNodes.map((n) => [n.id, n]));
  const oPos = positionsById(await calculateSugiyamaExtLayout(overlapNodes, overlapEdges, 'RIGHT'));
  await assertTrue(
    null,
    !rectanglesOverlap(bboxOf(oPos, obId, ['a', 'ac']), bboxOf(oPos, obId, ['x', 'xc'])),
    '[sugiyama-ext] 重なる2ツリーが分離されること'
  );

  // (b) 十分離れた2ツリー → rootは動かない
  const farNodes = [
    { id: 'a', content: '', position: { x: 0, y: 0 } },
    { id: 'x', content: '', position: { x: 2000, y: 0 } },
  ];
  const farPos = positionsById(await calculateSugiyamaExtLayout(farNodes, [], 'RIGHT'));
  await assertEqual(null, JSON.stringify(farPos.get('a')), JSON.stringify({ x: 0, y: 0 }), '[sugiyama-ext] 離れたツリーのrootは動かないこと(a)');
  await assertEqual(null, JSON.stringify(farPos.get('x')), JSON.stringify({ x: 2000, y: 0 }), '[sugiyama-ext] 離れたツリーのrootは動かないこと(x)');
}

// --- 15. elk-port: ハンドルがポートとしてELKに渡っている（uniformと結果が変わる）---
async function testElkPortDiffersFromUniform() {
  // 右ハンドル子2つ＋下ハンドル子1つ。ポートを渡さないuniformは全エッジを同一視するため、
  // 「下ハンドル子だけ取り付き面が違う」ことが結果に出ていればポートが効いている証拠になる
  const nodes = [
    { id: 'p', content: '', position: { x: 0, y: 0 } },
    { id: 'a', content: '', position: { x: 300, y: -80 } },
    { id: 'b', content: '', position: { x: 300, y: 80 } },
    { id: 'a1', content: '', position: { x: 600, y: -80 } },
  ];
  const edges = [
    { id: 'e1', source: 'p', target: 'a', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e2', source: 'p', target: 'b', sourceHandle: 'bottom', targetHandle: 'top' },
    { id: 'e3', source: 'a', target: 'a1', sourceHandle: 'right', targetHandle: 'left' },
  ];
  const viaUniform = await calculateLayoutForAlign(nodes, edges, 'RIGHT', 'uniform');
  const viaElkPort = await calculateElkPortLayout(nodes, edges, 'RIGHT');
  await assertTrue(
    null,
    JSON.stringify(viaUniform) !== JSON.stringify(viaElkPort),
    '[elk-port] ハンドル混在グラフでuniformと異なる結果になること（ポート制約が効いていること）'
  );
}

// --- 16. elk-port: ポートは「取り付き面」だけを制約し、流れ方向は変えない ---
async function testElkPortKeepsSingleFlowDirection() {
  // 仕様上の限界を明示的に固定するテスト（docs/align-branch-layout.md「方針F」）。
  // 下ハンドルに繋いだ子でもRIGHT方向では右隣のレイヤーに置かれる。ハンドルの向きどおりに
  // 子を配置するのはsugiyama-ext（方針E）の役割で、elk-portはそれを保証しない
  const nodes = [
    { id: 'p', content: '', position: { x: 0, y: 0 } },
    { id: 'bottom', content: '', position: { x: 0, y: 200 } },
  ];
  const edges = [{ id: 'e1', source: 'p', target: 'bottom', sourceHandle: 'bottom', targetHandle: 'top' }];
  const pos = positionsById(await calculateElkPortLayout(nodes, edges, 'RIGHT'));
  await assertTrue(
    null,
    pos.get('bottom').x > pos.get('p').x + 100,
    '[elk-port] 下ハンドル子でもRIGHT方向では前方(右)の層に置かれること（流れ方向は単一のまま）'
  );
}

// --- 17. elk-port: targetHandle無しはソース面の反対面にフォールバックする ---
async function testElkPortTargetHandleFallback() {
  const nodes = [
    { id: 'p', content: '', position: { x: 0, y: 0 } },
    { id: 'c', content: '', position: { x: 300, y: 0 } },
  ];
  const withHandle = [{ id: 'e1', source: 'p', target: 'c', sourceHandle: 'right', targetHandle: 'left' }];
  const withoutHandle = [{ id: 'e1', source: 'p', target: 'c', sourceHandle: 'right' }];
  const a = await calculateElkPortLayout(nodes, withHandle, 'RIGHT');
  const b = await calculateElkPortLayout(nodes, withoutHandle, 'RIGHT');
  await assertEqual(
    null,
    JSON.stringify(b),
    JSON.stringify(a),
    '[elk-port] targetHandle無し(旧データ)がsourceHandleの反対面(right→left)と同じ結果になること'
  );
}

// --- 18. elk-port: 端点が欠けたエッジを除外してレイアウトを続行する ---
async function testElkPortDanglingEdge() {
  // ELKは存在しないノード/ポートを参照するエッジでレイアウト実行ごと失敗する。除外し損ねると
  // catch節のフォールバック（＝入力位置をそのまま返す＝整列が何も起きない）に落ちる
  const nodes = [
    { id: 'p', content: '', position: { x: 0, y: 0 } },
    { id: 'a', content: '', position: { x: 300, y: -80 } },
    { id: 'b', content: '', position: { x: 300, y: 80 } },
  ];
  const edges = [
    { id: 'e1', source: 'p', target: 'a', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e2', source: 'p', target: 'b', sourceHandle: 'right', targetHandle: 'left' },
  ];
  const clean = await calculateElkPortLayout(nodes, edges, 'RIGHT');
  const withDangling = await calculateElkPortLayout(
    nodes,
    [...edges, { id: 'x', source: 'p', target: 'ghost', sourceHandle: 'right' }],
    'RIGHT'
  );
  await assertEqual(
    null,
    JSON.stringify(withDangling),
    JSON.stringify(clean),
    '[elk-port] 端点が欠けたエッジを除外し、そのエッジが無い場合と同じ結果になること'
  );
  await assertTrue(
    null,
    JSON.stringify(positionsById(withDangling).get('a')) !== JSON.stringify({ x: 300, y: -80 }),
    '[elk-port] 端点欠けエッジがあってもフォールバック（入力位置そのまま）に落ちていないこと'
  );
}

// --- 19. elk-port: 循環・複数親・孤立ノードでクラッシュせず決定的 ---
async function testElkPortCycleAndMultiParent() {
  const nodes = [
    { id: 'a', content: '', position: { x: 0, y: 0 } },
    { id: 'b', content: '', position: { x: 200, y: 0 } },
    { id: 'c', content: '', position: { x: 100, y: 200 } },
    { id: 'd', content: '', position: { x: 400, y: 100 } },
    { id: 'iso', content: '', position: { x: 0, y: 400 } }, // ポートを1つも持たない孤立ノード
  ];
  const edges = [
    { id: 'e1', source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e2', source: 'b', target: 'c', sourceHandle: 'bottom', targetHandle: 'top' },
    { id: 'e3', source: 'c', target: 'a', sourceHandle: 'right', targetHandle: 'left' }, // 循環
    { id: 'e4', source: 'b', target: 'd', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e5', source: 'c', target: 'd', sourceHandle: 'top', targetHandle: 'bottom' }, // 複数親
    { id: 'e6', source: 'd', target: 'd', sourceHandle: 'right', targetHandle: 'right' }, // 自己ループ
  ];
  const r1 = await calculateElkPortLayout(nodes, edges, 'RIGHT');
  await assertEqual(null, r1.nodes.length, 5, '[elk-port循環] 全ノードの位置が返ること');
  for (const n of r1.nodes) {
    await assertTrue(
      null,
      Number.isFinite(n.position.x) && Number.isFinite(n.position.y),
      `[elk-port循環] ${n.id}の座標が有限であること`
    );
  }
  const r2 = await calculateElkPortLayout(nodes, edges, 'RIGHT');
  await assertEqual(null, JSON.stringify(r1), JSON.stringify(r2), '[elk-port循環] 2回実行で結果が完全一致すること（決定性）');
}

// --- 20. elk-port: ディスパッチャ経由と直接呼び出しが一致 ---
async function testElkPortDispatcherParity() {
  const nodes = [
    { id: 'p', content: '', position: { x: 0, y: 0 } },
    { id: 'r', content: '', position: { x: 300, y: 0 } },
    { id: 't', content: '', position: { x: 0, y: -200 } },
  ];
  const edges = [
    { id: 'e1', source: 'p', target: 'r', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e2', source: 'p', target: 't', sourceHandle: 'top', targetHandle: 'bottom' },
  ];
  const viaDispatcher = await calculateLayoutForAlign(nodes, edges, 'RIGHT', 'elk-port');
  const viaDirect = await calculateElkPortLayout(nodes, edges, 'RIGHT');
  await assertEqual(
    null,
    JSON.stringify(viaDispatcher),
    JSON.stringify(viaDirect),
    '[elk-portディスパッチャ] 経由と直接呼び出しが一致すること'
  );
}

// --- 21. elk-port-ext: elk-port（elkjs本体）と同じ座標を返す（この方式の存在意義そのもの）---
async function testElkPortExtMatchesElkPort() {
  // elk-port-extの目標は「良い配置」ではなく「elk-portと同じ配置」。ここでは代表的な形を
  // 直接突き合わせて、再現できている形を固定する（コーパス全体の一致率は
  // `npm run layout:parity` で測る。docs/layout-lab.md「ELK再現度」）。
  // **ここが落ちたらELK側の挙動が変わったか、フェーズのどれかが壊れたかのどちらか**。
  const cases = [
    {
      name: '右ハンドルの子2つ',
      nodes: [
        { id: 'p', content: '', position: { x: 0, y: 0 } },
        { id: 'c1', content: '', position: { x: 300, y: -100 } },
        { id: 'c2', content: '', position: { x: 300, y: 100 } },
      ],
      edges: [
        { id: 'e1', source: 'p', target: 'c1', sourceHandle: 'right', targetHandle: 'left' },
        { id: 'e2', source: 'p', target: 'c2', sourceHandle: 'right', targetHandle: 'left' },
      ],
    },
    {
      name: '上/右/下ハンドルの混在',
      nodes: [
        { id: 'p', content: '', position: { x: 0, y: 0 } },
        { id: 't', content: '', position: { x: 300, y: -200 } },
        { id: 'r', content: '', position: { x: 300, y: 0 } },
        { id: 'b', content: '', position: { x: 300, y: 200 } },
      ],
      edges: [
        { id: 'e1', source: 'p', target: 't', sourceHandle: 'top', targetHandle: 'bottom' },
        { id: 'e2', source: 'p', target: 'r', sourceHandle: 'right', targetHandle: 'left' },
        { id: 'e3', source: 'p', target: 'b', sourceHandle: 'bottom', targetHandle: 'top' },
      ],
    },
    {
      name: '2分木（深さ2）',
      nodes: [
        { id: 'r', content: '', position: { x: 0, y: 0 } },
        { id: 'a', content: '', position: { x: 300, y: -100 } },
        { id: 'b', content: '', position: { x: 300, y: 100 } },
        { id: 'a1', content: '', position: { x: 600, y: -150 } },
        { id: 'a2', content: '', position: { x: 600, y: -50 } },
        { id: 'b1', content: '', position: { x: 600, y: 50 } },
        { id: 'b2', content: '', position: { x: 600, y: 150 } },
      ],
      edges: [
        { id: 'e1', source: 'r', target: 'a', sourceHandle: 'right', targetHandle: 'left' },
        { id: 'e2', source: 'r', target: 'b', sourceHandle: 'right', targetHandle: 'left' },
        { id: 'e3', source: 'a', target: 'a1', sourceHandle: 'right', targetHandle: 'left' },
        { id: 'e4', source: 'a', target: 'a2', sourceHandle: 'right', targetHandle: 'left' },
        { id: 'e5', source: 'b', target: 'b1', sourceHandle: 'right', targetHandle: 'left' },
        { id: 'e6', source: 'b', target: 'b2', sourceHandle: 'right', targetHandle: 'left' },
      ],
    },
    {
      name: '複数の連結成分＋孤立ノード（成分パッキング）',
      nodes: [
        { id: 't0', content: '', position: { x: 0, y: 0 } },
        { id: 't0a', content: '', position: { x: 300, y: 0 } },
        { id: 't1', content: '', position: { x: 0, y: 600 } },
        { id: 't1a', content: '', position: { x: 300, y: 600 } },
        { id: 'lonely', content: '', position: { x: 0, y: 1200 } },
      ],
      edges: [
        { id: 'e1', source: 't0', target: 't0a', sourceHandle: 'right', targetHandle: 'left' },
        { id: 'e2', source: 't1', target: 't1a', sourceHandle: 'right', targetHandle: 'left' },
      ],
    },
  ];

  // 位置を「id=(x,y)」の並びに落として比較する（差分がメッセージにそのまま出るように）
  const render = (result) =>
    result.nodes.map((n) => `${n.id}=(${n.position.x},${n.position.y})`).join(' ');

  for (const c of cases) {
    const viaElk = await calculateElkPortLayout(c.nodes, c.edges, 'RIGHT');
    const viaOwn = calculateElkPortExtLayout(c.nodes, c.edges, 'RIGHT');
    await assertEqual(
      null,
      render(viaOwn),
      render(viaElk),
      `[elk-port-ext] elk-portと同じ座標を返すこと（${c.name}）`
    );
  }
}

// --- 21b. elk-port-ext: 直交ポートのダミーが場所を取る（上/下ハンドルの子は親の外側に離れる）---
async function testElkPortExtCrossPorts() {
  // north/southポートは「同じ層に置かれる大きさ0のダミー」になり、実ノードとの間隔は
  // EDGE_NODE_GAP(10)。したがって上/下ハンドルの子は親の箱から 10×2=20px 離れた位置から始まる
  const nodes = [
    { id: 'p', content: '', position: { x: 0, y: 0 }, width: 180, height: 60 },
    { id: 'b', content: '', position: { x: 300, y: 200 }, width: 180, height: 60 },
  ];
  const edges = [{ id: 'e1', source: 'p', target: 'b', sourceHandle: 'bottom', targetHandle: 'top' }];
  const pos = positionsById(calculateElkPortExtLayout(nodes, edges, 'RIGHT'));
  await assertEqual(
    null,
    pos.get('b').y - (pos.get('p').y + 60),
    20,
    '[elk-port-ext] 下ハンドル子の上端が親の下端から20px（=edgeNode×2）離れること'
  );
  // 層は単一の流れ方向のまま（下ハンドル子も前方の層に置かれる）
  await assertTrue(
    null,
    pos.get('b').x > pos.get('p').x + 100,
    '[elk-port-ext] 下ハンドル子が前方(右)の層に置かれること'
  );
}

// --- 21c. elk-port-ext: 同じ層のノードが順序どおりに最小間隔を守る ---
async function testElkPortExtLayerSpacing() {
  const nodes = [{ id: 'p', content: '', position: { x: 0, y: 0 } }];
  const edges = [];
  for (let i = 0; i < 4; i++) {
    nodes.push({ id: `c${i}`, content: '', position: { x: 300, y: i * 100 } });
    edges.push({ id: `e${i}`, source: 'p', target: `c${i}`, sourceHandle: 'right', targetHandle: 'left' });
  }
  const pos = positionsById(calculateElkPortExtLayout(nodes, edges, 'RIGHT'));
  for (let i = 1; i < 4; i++) {
    await assertEqual(
      null,
      pos.get(`c${i}`).y - (pos.get(`c${i - 1}`).y + 60),
      50,
      `[elk-port-ext] 同じ層の兄弟がnodeNode=50の間隔で並ぶこと (c${i})`
    );
  }
}

// --- 21d. elk-port-ext: 層は単一方向のまま（旧テスト21の置き換え。仕様上の限界の固定）---
async function testElkPortExtSingleFlow() {
  const nodes = [
    { id: 'p', content: '', position: { x: 0, y: 0 } },
    { id: 'r', content: '', position: { x: 300, y: 0 } },
    { id: 't', content: '', position: { x: 300, y: 0 } },
    { id: 'b', content: '', position: { x: 300, y: 0 } },
  ];
  const edges = [
    { id: 'e1', source: 'p', target: 'r', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e2', source: 'p', target: 't', sourceHandle: 'top', targetHandle: 'bottom' },
    { id: 'e3', source: 'p', target: 'b', sourceHandle: 'bottom', targetHandle: 'top' },
  ];
  const pos = positionsById(calculateElkPortExtLayout(nodes, edges, 'RIGHT'));
  const p = pos.get('p');
  for (const id of ['r', 't', 'b']) {
    await assertTrue(null, pos.get(id).x > p.x + 100, `[elk-port-ext] ${id}が前方(右)の層に置かれること`);
  }
  const sameLayerX = [pos.get('r').x, pos.get('t').x, pos.get('b').x];
  await assertTrue(
    null,
    Math.max(...sameLayerX) - Math.min(...sameLayerX) < 1,
    '[elk-port-ext] 3つの子が同じ層（同じprimary座標）に揃うこと'
  );
}

// --- 22. elk-port-ext: 長いエッジは仮想ノードで分解され、途中の層に通り道を確保する ---
async function testElkPortExtLongEdge() {
  // root→a→b→c の鎖。ここに root→c の3層ぶんをまたぐ直通エッジを足すと、中間の層（a・bの層）に
  // 通り道ぶんの仮想ノードが入る。その結果レイアウトはcross方向に広がる。
  // 仮想ノードを作らない実装（＝長いエッジを無視する実装）だと、この広がりが起きない
  const nodes = [
    { id: 'root', content: '', position: { x: 0, y: 0 } },
    { id: 'a', content: '', position: { x: 300, y: 0 } },
    { id: 'b', content: '', position: { x: 600, y: 0 } },
    { id: 'c', content: '', position: { x: 900, y: 0 } },
  ];
  const chainEdges = [
    { id: 'e1', source: 'root', target: 'a', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e2', source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e3', source: 'b', target: 'c', sourceHandle: 'right', targetHandle: 'left' },
  ];
  const longEdge = { id: 'e4', source: 'root', target: 'c', sourceHandle: 'right', targetHandle: 'left' };

  const crossSpread = (pos) => {
    const ys = ['root', 'a', 'b', 'c'].map((id) => pos.get(id).y);
    return Math.max(...ys) - Math.min(...ys);
  };

  const chainPos = positionsById(calculateElkPortExtLayout(nodes, chainEdges, 'RIGHT'));
  // 4ノードが4つの層に分かれること（レイヤー割当がエッジ制約を満たしている）
  const xs = ['root', 'a', 'b', 'c'].map((id) => chainPos.get(id).x);
  for (let i = 1; i < xs.length; i++) {
    await assertTrue(null, xs[i] > xs[i - 1], `[elk-port-ext] 層が単調に前進すること (${i})`);
  }
  await assertTrue(
    null,
    crossSpread(chainPos) < 1,
    '[elk-port-ext] 直鎖だけならcross方向に広がらないこと（比較の基準）'
  );

  const withLongPos = positionsById(calculateElkPortExtLayout(nodes, [...chainEdges, longEdge], 'RIGHT'));
  await assertTrue(
    null,
    crossSpread(withLongPos) > 20,
    `[elk-port-ext] 3層をまたぐエッジを足すと仮想ノードが通り道を確保してcross方向に広がること（実測${crossSpread(withLongPos).toFixed(1)}px）`
  );
  // 層の構成そのものは変わらない（仮想ノードは実ノードの層を動かさない）
  for (const id of ['root', 'a', 'b', 'c']) {
    await assertEqual(
      null,
      withLongPos.get(id).x,
      chainPos.get(id).x,
      `[elk-port-ext] 仮想ノードが${id}の層(primary座標)を変えないこと`
    );
  }
}

// --- 23. elk-port-ext: 同じ層のノードが最小間隔を守る（PAVAの重なり回避）---
async function testElkPortExtNoOverlapInLayer() {
  // 1つの親に高さの違う子を6つぶら下げ、初期位置は全部同じ場所に潰しておく
  const nodes = [{ id: 'p', content: '', position: { x: 0, y: 0 }, width: 180, height: 60 }];
  const edges = [];
  for (let i = 0; i < 6; i++) {
    nodes.push({ id: `c${i}`, content: '', position: { x: 300, y: 0 }, width: 180, height: 40 + i * 40 });
    edges.push({ id: `e${i}`, source: 'p', target: `c${i}`, sourceHandle: 'right', targetHandle: 'left' });
  }
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const pos = positionsById(calculateElkPortExtLayout(nodes, edges, 'RIGHT'));
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i].id;
      const b = nodes[j].id;
      await assertTrue(
        null,
        !rectanglesOverlap(rectOf(pos.get(a), nodesById.get(a)), rectOf(pos.get(b), nodesById.get(b))),
        `[elk-port-ext] ${a}と${b}が重ならないこと`
      );
    }
  }
}

// --- 24. elk-port-ext: DOWN方向へ90度回転して同じ扱いになる ---
async function testElkPortExtDownDirection() {
  const nodes = [
    { id: 'p', content: '', position: { x: 0, y: 0 } },
    { id: 'd', content: '', position: { x: 0, y: 300 } }, // 下ハンドル＝DOWN時のforward
    { id: 'l', content: '', position: { x: 0, y: 300 } }, // 左ハンドル＝DOWN時のcrossNeg
  ];
  const edges = [
    { id: 'e1', source: 'p', target: 'd', sourceHandle: 'bottom', targetHandle: 'top' },
    { id: 'e2', source: 'p', target: 'l', sourceHandle: 'left', targetHandle: 'right' },
  ];
  const pos = positionsById(calculateElkPortExtLayout(nodes, edges, 'DOWN'));
  const p = pos.get('p');
  await assertTrue(null, pos.get('d').y > p.y + 50, '[elk-port-ext DOWN] forward(下)の子が親より下の層に置かれること');
  await assertTrue(null, pos.get('l').x < p.x, '[elk-port-ext DOWN] 左ハンドル(crossNeg)の子が親より左に置かれること');

  // DOWN方向でもelk-portと同じ座標になること（primary/crossの入れ替えが正しいことの確認）。
  // 上の2ノードは入力位置が同じでキーが同値になる退化ケースなので、位置を分けた形で突き合わせる
  const render = (r) => r.nodes.map((n) => `${n.id}=(${n.position.x},${n.position.y})`).join(' ');
  const parityCases = [
    {
      name: '下ハンドルの子2つ',
      nodes: [
        { id: 'p', content: '', position: { x: 0, y: 0 } },
        { id: 'a', content: '', position: { x: -200, y: 300 } },
        { id: 'b', content: '', position: { x: 200, y: 300 } },
      ],
      edges: [
        { id: 'e1', source: 'p', target: 'a', sourceHandle: 'bottom', targetHandle: 'top' },
        { id: 'e2', source: 'p', target: 'b', sourceHandle: 'bottom', targetHandle: 'top' },
      ],
    },
    {
      name: '下＋左ハンドル',
      nodes: [
        { id: 'p', content: '', position: { x: 0, y: 0 } },
        { id: 'd', content: '', position: { x: 0, y: 300 } },
        { id: 'l', content: '', position: { x: -300, y: 300 } },
      ],
      edges: [
        { id: 'e1', source: 'p', target: 'd', sourceHandle: 'bottom', targetHandle: 'top' },
        { id: 'e2', source: 'p', target: 'l', sourceHandle: 'left', targetHandle: 'right' },
      ],
    },
  ];
  for (const c of parityCases) {
    await assertEqual(
      null,
      render(calculateElkPortExtLayout(c.nodes, c.edges, 'DOWN')),
      render(await calculateElkPortLayout(c.nodes, c.edges, 'DOWN')),
      `[elk-port-ext DOWN] elk-portと同じ座標を返すこと（${c.name}）`
    );
  }
}

// --- 25. elk-port-ext: 循環・複数親・孤立ノード・自己ループで決定的、原点付近へ正規化される ---
async function testElkPortExtRobustness() {
  const nodes = [
    { id: 'a', content: '', position: { x: 1000, y: 500 } },
    { id: 'b', content: '', position: { x: 1200, y: 500 } },
    { id: 'c', content: '', position: { x: 1100, y: 700 } },
    { id: 'd', content: '', position: { x: 1400, y: 600 } },
    { id: 'iso', content: '', position: { x: 1000, y: 900 } },
  ];
  const edges = [
    { id: 'e1', source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e2', source: 'b', target: 'c', sourceHandle: 'bottom', targetHandle: 'top' },
    { id: 'e3', source: 'c', target: 'a', sourceHandle: 'right', targetHandle: 'left' }, // 循環
    { id: 'e4', source: 'b', target: 'd', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e5', source: 'c', target: 'd', sourceHandle: 'top', targetHandle: 'bottom' }, // 複数親
    { id: 'e6', source: 'd', target: 'd', sourceHandle: 'right', targetHandle: 'right' }, // 自己ループ
  ];
  const r1 = calculateElkPortExtLayout(nodes, edges, 'RIGHT');
  await assertEqual(null, r1.nodes.length, 5, '[elk-port-ext頑健性] 全ノードの位置が返ること');
  for (const n of r1.nodes) {
    await assertTrue(
      null,
      Number.isFinite(n.position.x) && Number.isFinite(n.position.y),
      `[elk-port-ext頑健性] ${n.id}の座標が有限であること`
    );
  }
  const r2 = calculateElkPortExtLayout(nodes, edges, 'RIGHT');
  await assertEqual(null, JSON.stringify(r1), JSON.stringify(r2), '[elk-port-ext頑健性] 2回実行で結果が完全一致すること（決定性）');

  // ELK本体と同じく原点＋padding(12)へ正規化する（＝整列するとマップ全体が原点付近へ飛ぶ）。
  // 元の位置に留まるのは elk-port-pava のほう（テスト27）で、両者を区別する性質そのもの
  const pos = positionsById(r1);
  const minX = Math.min(...r1.nodes.map((n) => n.position.x));
  const minY = Math.min(...r1.nodes.map((n) => n.position.y));
  await assertEqual(null, minX, 12, '[elk-port-ext] 外接矩形の左上xが原点＋paddingへ正規化されること');
  await assertEqual(null, minY, 12, '[elk-port-ext] 外接矩形の左上yが原点＋paddingへ正規化されること');
  await assertTrue(null, Number.isFinite(pos.get('iso').x), '[elk-port-ext] 孤立ノードにも座標が付くこと');
}

// --- 26. elk-port-ext: ディスパッチャ経由と直接呼び出しが一致 ---
async function testElkPortExtDispatcherParity() {
  const nodes = [
    { id: 'p', content: '', position: { x: 0, y: 0 } },
    { id: 'r', content: '', position: { x: 300, y: 0 } },
    { id: 't', content: '', position: { x: 0, y: -200 } },
  ];
  const edges = [
    { id: 'e1', source: 'p', target: 'r', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e2', source: 'p', target: 't', sourceHandle: 'top', targetHandle: 'bottom' },
  ];
  const viaDispatcher = await calculateLayoutForAlign(nodes, edges, 'RIGHT', 'elk-port-ext');
  const viaDirect = calculateElkPortExtLayout(nodes, edges, 'RIGHT');
  await assertEqual(
    null,
    JSON.stringify(viaDispatcher),
    JSON.stringify(viaDirect),
    '[elk-port-extディスパッチャ] 経由と直接呼び出しが一致すること'
  );
}

// --- 27. elk-port-pava: 原点へ正規化せず、入力の外接矩形の左上に留まる ---
async function testElkPortPavaKeepsPosition() {
  // elk-port-ext（ELK忠実版）との決定的な違い。ELKは必ず原点付近へ飛ばすが、こちらは
  // メンタルマップ保持のため元の位置に留める（docs/align-branch-layout.md「方針G'」）
  const nodes = [
    { id: 'a', content: '', position: { x: 1000, y: 500 } },
    { id: 'b', content: '', position: { x: 1200, y: 500 } },
    { id: 'iso', content: '', position: { x: 1000, y: 900 } },
  ];
  const edges = [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left' }];
  const r = calculateElkPortPavaLayout(nodes, edges, 'RIGHT');
  const minX = Math.min(...r.nodes.map((n) => n.position.x));
  const minY = Math.min(...r.nodes.map((n) => n.position.y));
  await assertEqual(null, minX, 1000, '[elk-port-pava] 外接矩形の左上xが元の位置に留まること');
  await assertEqual(null, minY, 500, '[elk-port-pava] 外接矩形の左上yが元の位置に留まること');

  // 同じ入力に対し elk-port-ext は原点＋paddingへ飛ばす（＝2方式が別物であることの陽性確認）
  const ext = calculateElkPortExtLayout(nodes, edges, 'RIGHT');
  await assertEqual(
    null,
    Math.min(...ext.nodes.map((n) => n.position.x)),
    12,
    '[elk-port-pava] 同じ入力でelk-port-extは原点＋paddingへ正規化されること（両者が別物であること）'
  );
}

// --- 28. elk-port-pava: 循環・自己ループで決定的、ディスパッチャ経由と直接呼び出しが一致 ---
async function testElkPortPavaRobustnessAndDispatcher() {
  const nodes = [
    { id: 'a', content: '', position: { x: 0, y: 0 } },
    { id: 'b', content: '', position: { x: 200, y: 0 } },
    { id: 'c', content: '', position: { x: 100, y: 200 } },
  ];
  const edges = [
    { id: 'e1', source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e2', source: 'b', target: 'c', sourceHandle: 'bottom', targetHandle: 'top' },
    { id: 'e3', source: 'c', target: 'a', sourceHandle: 'right', targetHandle: 'left' }, // 循環
    { id: 'e4', source: 'c', target: 'c', sourceHandle: 'right', targetHandle: 'right' }, // 自己ループ
  ];
  const r1 = calculateElkPortPavaLayout(nodes, edges, 'RIGHT');
  await assertEqual(null, r1.nodes.length, 3, '[elk-port-pava頑健性] 全ノードの位置が返ること');
  for (const n of r1.nodes) {
    await assertTrue(
      null,
      Number.isFinite(n.position.x) && Number.isFinite(n.position.y),
      `[elk-port-pava頑健性] ${n.id}の座標が有限であること`
    );
  }
  const r2 = calculateElkPortPavaLayout(nodes, edges, 'RIGHT');
  await assertEqual(null, JSON.stringify(r1), JSON.stringify(r2), '[elk-port-pava頑健性] 2回実行で結果が完全一致すること（決定性）');

  const viaDispatcher = await calculateLayoutForAlign(nodes, edges, 'RIGHT', 'elk-port-pava');
  await assertEqual(
    null,
    JSON.stringify(viaDispatcher),
    JSON.stringify(r1),
    '[elk-port-pavaディスパッチャ] 経由と直接呼び出しが一致すること'
  );
}

// --- 29. sugiyama-port: 主たる親は「ターゲットのLEFT面」が深さより優先される ---
async function testSugiyamaPortLeftHandleWins() {
  // 方針Eとの決定的な違い（docs/align-branch-layout.md「方針H」）。
  // x には2本の入辺がある: 深い鎖の先端 p2 から x の**上**ハンドルへ／浅い s から x の**左**ハンドルへ。
  // 方針E（ロンゲストパス）は深い p2 を親に選ぶが、方針Hは「左ハンドルに入っている」ほうを採る
  const nodes = [
    { id: 'p0', content: '', position: { x: 0, y: 0 } },
    { id: 'p1', content: '', position: { x: 300, y: 0 } },
    { id: 'p2', content: '', position: { x: 600, y: 0 } },
    { id: 's', content: '', position: { x: 0, y: 400 } },
    { id: 'x', content: '', position: { x: 900, y: 200 } },
  ];
  const edges = [
    { id: 'e1', source: 'p0', target: 'p1', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e2', source: 'p1', target: 'p2', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e3', source: 'p2', target: 'x', sourceHandle: 'right', targetHandle: 'top' }, // 深いが上ハンドル入り
    { id: 'e4', source: 's', target: 'x', sourceHandle: 'right', targetHandle: 'left' }, // 浅いが左ハンドル入り
  ];
  const pos = positionsById(await calculateSugiyamaPortLayout(nodes, edges, 'RIGHT'));
  await assertEqual(null, pos.get('x').y, pos.get('s').y, '[sugiyama-port] 左ハンドルに入る辺の親(s)の子として配置されること');
  await assertEqual(
    null,
    pos.get('x').x - pos.get('s').x,
    240,
    '[sugiyama-port] 親sの1層前方（180+PRIMARY_GAP=240）に置かれること'
  );

  // 陽性確認: 同じ入力で方針Eは深いp2を親に選ぶ（＝このテストが常にPASSするテストではない）
  const extPos = positionsById(await calculateSugiyamaExtLayout(nodes, edges, 'RIGHT'));
  await assertTrue(
    null,
    extPos.get('x').x > extPos.get('p2').x,
    '[sugiyama-port] 陽性確認: sugiyama-extは深いp2の子として配置すること'
  );
}

// --- 30. sugiyama-port: 左ハンドル入りが複数なら、ソースがRIGHT面のものを採る ---
async function testSugiyamaPortRightSourceWins() {
  // どちらも x の左ハンドルに入る。pb は下ハンドルから、pr は右ハンドルから出ている
  const nodes = [
    { id: 'pb', content: '', position: { x: 0, y: 0 } },
    { id: 'pr', content: '', position: { x: 0, y: 300 } },
    { id: 'x', content: '', position: { x: 400, y: 150 } },
  ];
  const edges = [
    { id: 'e1', source: 'pb', target: 'x', sourceHandle: 'bottom', targetHandle: 'left' },
    { id: 'e2', source: 'pr', target: 'x', sourceHandle: 'right', targetHandle: 'left' },
  ];
  const pos = positionsById(await calculateSugiyamaPortLayout(nodes, edges, 'RIGHT'));
  await assertEqual(null, pos.get('x').y, pos.get('pr').y, '[sugiyama-port] ソースが右ハンドルのpr側の子になること');
  await assertEqual(null, pos.get('x').x - pos.get('pr').x, 240, '[sugiyama-port] prの1層前方に置かれること');
}

// --- 31. sugiyama-port: 同順位の親が複数なら両方の親のバリセンタへ置く ---
async function testSugiyamaPortMultiParentBarycenter() {
  // ダイヤモンド a→b→d / a→c→d。b と c は同じ層・同じ向きなので d は「同列の複数親」を持つ。
  // 方針Eは片方（配列順で先着）の子に決め打ちするため d は b の真横に来るが、方針Hは中間に置く
  const nodes = [
    { id: 'a', content: '', position: { x: 0, y: 0 } },
    { id: 'b', content: '', position: { x: 300, y: -200 } },
    { id: 'c', content: '', position: { x: 300, y: 200 } },
    { id: 'd', content: '', position: { x: 600, y: 0 } },
  ];
  const edges = [
    { id: 'e1', source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e2', source: 'a', target: 'c', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e3', source: 'b', target: 'd', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e4', source: 'c', target: 'd', sourceHandle: 'right', targetHandle: 'left' },
  ];
  const pos = positionsById(await calculateSugiyamaPortLayout(nodes, edges, 'RIGHT'));
  await assertEqual(
    null,
    pos.get('d').y,
    (pos.get('b').y + pos.get('c').y) / 2,
    '[sugiyama-port] 複数親の子が親たちのバリセンタ（＝中間）に置かれること'
  );
  await assertTrue(
    null,
    pos.get('d').x >= Math.max(pos.get('b').x, pos.get('c').x) + 240,
    '[sugiyama-port] 複数親の子が両方の親より1層以上前方に置かれること'
  );

  // 陽性確認: 方針Eは片方の親の子として決め打ちするので、中間には来ない
  const extPos = positionsById(await calculateSugiyamaExtLayout(nodes, edges, 'RIGHT'));
  await assertTrue(
    null,
    Math.abs(extPos.get('d').y - (extPos.get('b').y + extPos.get('c').y) / 2) > 30,
    '[sugiyama-port] 陽性確認: sugiyama-extは片方の親の真横に置くこと'
  );
}

// --- 31b. sugiyama-port: 同じ親の集合を持つ複数親の子どうしは「兄弟」として同じ層に並ぶ ---
async function testSugiyamaPortSharedSiblings() {
  // A→B,A→C / B→D,C→D / B→E,C→E。D と E は同じ2つの親を持つので兄弟であり、
  // B・C と同じくcross方向に並ぶのが期待。**修正前は D と E が同じバリセンタを取り合い、
  // 「cross方向で重なるものの前へ逃がす」規則が兄弟同士に効いてEがDの1層前に押し出されていた**
  const nodes = [
    { id: 'A', content: '', position: { x: 0, y: 0 } },
    { id: 'B', content: '', position: { x: 300, y: -100 } },
    { id: 'C', content: '', position: { x: 300, y: 100 } },
    { id: 'D', content: '', position: { x: 600, y: -100 } },
    { id: 'E', content: '', position: { x: 600, y: 100 } },
  ];
  const link = (id, source, target) => ({ id, source, target, sourceHandle: 'right', targetHandle: 'left' });
  const edges = [
    link('e1', 'A', 'B'),
    link('e2', 'A', 'C'),
    link('e3', 'B', 'D'),
    link('e4', 'C', 'D'),
    link('e5', 'B', 'E'),
    link('e6', 'C', 'E'),
  ];
  const pos = positionsById(await calculateSugiyamaPortLayout(nodes, edges, 'RIGHT'));

  await assertEqual(null, pos.get('B').x, pos.get('C').x, '[sugiyama-port] BとCが同じ層に並ぶこと');
  await assertEqual(null, pos.get('D').x, pos.get('E').x, '[sugiyama-port] DとEも同じ層に並ぶこと（primary方向に前後しない）');
  await assertTrue(
    null,
    pos.get('D').x >= pos.get('B').x + 240,
    '[sugiyama-port] D/Eが親B/Cより1層以上前方に置かれること'
  );
  await assertTrue(
    null,
    Math.abs(pos.get('D').y - pos.get('E').y) >= 60,
    '[sugiyama-port] DとEがcross方向に重ならず並ぶこと'
  );
  // 2人兄弟の中心は親たちの中心（＝Aの中心）に揃う
  await assertEqual(
    null,
    (pos.get('D').y + pos.get('E').y) / 2,
    (pos.get('B').y + pos.get('C').y) / 2,
    '[sugiyama-port] D/E群の中心が親B/Cの中心に揃うこと'
  );
}

// 親pに forward子3つ（cross方向に広がる）＋ 上ハンドル子t（tはさらにforward子t2を持つ）。
// tの初期位置だけが違う2パターンを作る（cross群の配置パターン判定は現在位置から読む）
function sugiyamaPortCrossCase(topChildY) {
  const nodes = [
    { id: 'p', content: '', position: { x: 0, y: 0 } },
    { id: 'f0', content: '', position: { x: 300, y: -110 } },
    { id: 'f1', content: '', position: { x: 300, y: 0 } },
    { id: 'f2', content: '', position: { x: 300, y: 110 } },
    { id: 't', content: '', position: { x: 0, y: topChildY } },
    { id: 't2', content: '', position: { x: 300, y: topChildY } },
  ];
  const edges = [
    { id: 'e0', source: 'p', target: 'f0', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e1', source: 'p', target: 'f1', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e2', source: 'p', target: 'f2', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e3', source: 'p', target: 't', sourceHandle: 'top', targetHandle: 'bottom' },
    { id: 'e4', source: 't', target: 't2', sourceHandle: 'right', targetHandle: 'left' },
  ];
  return { nodes, edges };
}

async function assertNoOverlaps(nodes, pos, label) {
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i].id;
      const b = nodes[j].id;
      await assertTrue(
        null,
        !rectanglesOverlap(rectOf(pos.get(a), nodesById.get(a)), rectOf(pos.get(b), nodesById.get(b))),
        `${label} ${a}と${b}が重ならないこと`
      );
    }
  }
}

// --- 32. sugiyama-port: cross群を親に寄せるか外へ出すかを、ユーザーの現在位置から決める ---
async function testSugiyamaPortCrossHugPattern() {
  // パターン1: ユーザーが t を**親のすぐ上**（forward群の広がりの内側）に置いている
  //   → 「親の補足情報」と解釈し、tを親の隣に確保してforward群をprimary方向へ逃がす
  const { nodes, edges } = sugiyamaPortCrossCase(-80);
  const pos = positionsById(await calculateSugiyamaPortLayout(nodes, edges, 'RIGHT'));

  // (a) 上ハンドル子は親のすぐ上（CROSS_GAP=10）に来る
  await assertEqual(
    null,
    pos.get('p').y - (pos.get('t').y + 60),
    10,
    '[sugiyama-port hug] 上ハンドル子が親のすぐ上（CROSS_GAP=10）に来ること'
  );
  // (b) forward群の帯に入り込むので、被りは深いほう（CROSS_OVERLAP_RATIO_INSIDE）を使う
  //     ＝押し出す量を抑える
  await assertEqual(
    null,
    round6(pos.get('t').x - pos.get('p').x),
    round6(180 * CROSS_OVERLAP_RATIO_INSIDE),
    `[sugiyama-port hug] 被りがCROSS_OVERLAP_RATIO_INSIDE（180×${CROSS_OVERLAP_RATIO_INSIDE}=${round6(180 * CROSS_OVERLAP_RATIO_INSIDE)}px前方）になること`
  );
  // (c) tとcross方向で重なるf0が、tのサブツリー（t2の右端）の前方へ逃げる
  await assertTrue(
    null,
    pos.get('f0').x >= pos.get('t2').x + 180 + 60,
    `[sugiyama-port hug] cross群と重なるforward子がprimary方向へ逃げること（f0.x=${pos.get('f0').x}）`
  );
  // (d) 重ならないf1の扱いは ESCAPE_FORWARD_AS_GROUP（逃がす単位）で決まる
  if (ESCAPE_FORWARD_AS_GROUP) {
    await assertEqual(null, pos.get('f1').x, pos.get('f0').x, '[sugiyama-port hug] 群ごと逃がす設定では f1 も f0 と同じ線に揃うこと');
  } else {
    await assertEqual(null, pos.get('f1').x - pos.get('p').x, 240, '[sugiyama-port hug] 子ごとに逃がす設定では f1 は1層前方のまま');
  }
  await assertNoOverlaps(nodes, pos, '[sugiyama-port hug]');

  // 陽性確認: 方針Eはこの初期位置でも t を forward群の外側へ置く（＝親のすぐ上には来ない）
  const extPos = positionsById(await calculateSugiyamaExtLayout(nodes, edges, 'RIGHT'));
  await assertTrue(
    null,
    extPos.get('p').y - (extPos.get('t').y + 60) > 50,
    '[sugiyama-port hug] 陽性確認: sugiyama-extは初期位置に関係なくforward群の外側へ逃がすこと'
  );
}

async function testSugiyamaPortCrossOutsidePattern() {
  // パターン2: ユーザーが t を**forward群の外側**に置いている
  //   → 「親と並ぶ別の情報」と解釈し、方針Eと同じくforward群の外へ積む（forward群は押さない）
  const { nodes, edges } = sugiyamaPortCrossCase(-300);
  const pos = positionsById(await calculateSugiyamaPortLayout(nodes, edges, 'RIGHT'));

  // (a) forward群は押し出されない（＝primary方向に伸びない）
  await assertEqual(null, pos.get('f1').x - pos.get('p').x, 240, '[sugiyama-port outside] forward群が1層前方のままであること');
  await assertEqual(null, pos.get('f0').x, pos.get('f1').x, '[sugiyama-port outside] forward群が同じ層に揃うこと');
  // (b) tはforward群の外側（f0のさらに上）にCROSS_GAPで積まれる
  await assertEqual(
    null,
    pos.get('f0').y - (pos.get('t').y + 60),
    10,
    '[sugiyama-port outside] 上ハンドル子がforward群の外側にCROSS_GAP(10)で積まれること'
  );
  // (c) forward群と重ならないので、被りは通常の CROSS_OVERLAP_RATIO
  await assertEqual(
    null,
    round6(pos.get('t').x - pos.get('p').x),
    round6(180 * CROSS_OVERLAP_RATIO),
    `[sugiyama-port outside] 被りがCROSS_OVERLAP_RATIO（180×${CROSS_OVERLAP_RATIO}=${round6(180 * CROSS_OVERLAP_RATIO)}px前方）になること`
  );
  await assertNoOverlaps(nodes, pos, '[sugiyama-port outside]');
}

// --- 32c. sugiyama-port: 'outside' のcross群の中に親がいる複数親の子も必ず配置される ---
async function testSugiyamaPortSharedChildUnderOutsideCross() {
  // ファズ（seed 48）で見つけた不具合の回帰テスト。'outside' のcross群を複数親の子より**後**に
  // 置くと、cross群のサブツリーに親がいる子はアンカーを見つけられず**座標が返らないまま初期位置に
  // 取り残され**（＝他のノードと重なる）。sは初期位置を左端に置いてあるので、配置されなければ
  // 「親より前方」の判定で落ちる
  const nodes = [
    { id: 'p', content: '', position: { x: 0, y: 0 } },
    { id: 't', content: '', position: { x: 0, y: -600 } }, // 十分上＝'outside'と判定される
    { id: 'x1', content: '', position: { x: 300, y: -600 } },
    { id: 'x1b', content: '', position: { x: 600, y: -600 } },
    { id: 'f', content: '', position: { x: 300, y: 0 } },
    { id: 'x2', content: '', position: { x: 600, y: 0 } },
    { id: 's', content: '', position: { x: -2000, y: 0 } }, // 配置されなければここに残る
  ];
  const link = (id, source, target, sourceHandle = 'right', targetHandle = 'left') => ({
    id,
    source,
    target,
    sourceHandle,
    targetHandle,
  });
  const edges = [
    link('e1', 'p', 't', 'top', 'bottom'),
    link('e2', 't', 'x1'),
    link('e3', 'x1', 'x1b'),
    link('e4', 'p', 'f'),
    link('e5', 'f', 'x2'),
    link('e6', 'x1b', 's'), // x1b と x2 は同じ層・同じ向き → sは同順位の複数親を持つ
    link('e7', 'x2', 's'),
  ];
  const pos = positionsById(await calculateSugiyamaPortLayout(nodes, edges, 'RIGHT'));
  await assertTrue(
    null,
    pos.get('s').x >= Math.max(pos.get('x1b').x, pos.get('x2').x) + 240,
    `[sugiyama-port] outside群の中に親がいる複数親の子も配置されること（s.x=${pos.get('s').x}）`
  );
  await assertNoOverlaps(nodes, pos, '[sugiyama-port outside+shared]');
}

// --- 32b. sugiyama-port: 整列を繰り返しても結果が変わらない（配置パターン判定の冪等性）---
async function testSugiyamaPortReAlignStable() {
  // 配置パターンを「現在位置」から読むので、**整列後の位置が同じパターンに分類され続ける**
  // ことが必要（そうでないとAlignを押すたびに2つの配置を行き来する）。両パターンで確認する。
  //
  // **ここで守れるのは「cross群の子が葉のとき」だけ**。cross子が自分の子をcross方向に持つ場合は
  // 判定（ノード本体の矩形）と配置（サブツリーの箱）がズレるため、1回目と2回目のAlignで
  // 'hug'→'outside' に反転しうる。これは意図して受け入れた既知の制限で、テストにもしていない
  // （decisions.md §57 / tuning.md「既知の未対応事項」）。ここを冪等にするには判定を箱に
  // 揃える必要があり、そうすると `hug` が増えてエッジのノード貫通が悪化する（91→104）
  const cases = [
    ['hug', sugiyamaPortCrossCase(-80)],
    ['outside', sugiyamaPortCrossCase(-300)],
  ];
  for (const [label, { nodes, edges }] of cases) {
    let current = nodes;
    let previous = null;
    for (let i = 0; i < 3; i++) {
      const result = await calculateSugiyamaPortLayout(current, edges, 'RIGHT');
      const positions = positionsById(result);
      current = nodes.map((n) => ({ ...n, position: positions.get(n.id) }));
      const snapshot = JSON.stringify(current.map((n) => [n.id, n.position]));
      if (previous !== null) {
        await assertEqual(null, snapshot, previous, `[sugiyama-port ${label}] 整列を繰り返しても結果が変わらないこと（${i + 1}回目）`);
      }
      previous = snapshot;
    }
  }
}

// --- 33. sugiyama-port: 下向きレイアウトへの自然な回転 ---
async function testSugiyamaPortDownDirection() {
  // DOWN: bottom=前方(下)、right=crossPos(右に被せる)
  const nodes = [
    { id: 'p', content: '', position: { x: 0, y: 0 } },
    { id: 'd', content: '', position: { x: 0, y: 300 } },
    { id: 'r', content: '', position: { x: 300, y: 0 } },
  ];
  const edges = [
    { id: 'e1', source: 'p', target: 'd', sourceHandle: 'bottom', targetHandle: 'top' },
    { id: 'e2', source: 'p', target: 'r', sourceHandle: 'right', targetHandle: 'left' },
  ];
  const pos = positionsById(await calculateSugiyamaPortLayout(nodes, edges, 'DOWN'));
  await assertEqual(null, pos.get('d').y - pos.get('p').y, 120, '[sugiyama-port DOWN] bottom子が1層下（60+PRIMARY_GAP）に置かれること');
  await assertEqual(
    null,
    pos.get('r').x - (pos.get('p').x + 180),
    10,
    '[sugiyama-port DOWN] right子が親のすぐ右（CROSS_GAP=10）に来ること'
  );
  await assertTrue(null, pos.get('r').y < pos.get('d').y, '[sugiyama-port DOWN] cross子が前方(下)の子より手前に被ること');
}

// --- 34. sugiyama-port: 循環・自己ループ・孤立ノードで決定的、ディスパッチャ経由と一致 ---
async function testSugiyamaPortRobustnessAndDispatcher() {
  const nodes = [
    { id: 'a', content: '', position: { x: 0, y: 0 } },
    { id: 'b', content: '', position: { x: 200, y: 0 } },
    { id: 'c', content: '', position: { x: 100, y: 200 } },
    { id: 'iso', content: '', position: { x: 0, y: 600 } },
  ];
  const edges = [
    { id: 'e1', source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e2', source: 'b', target: 'c', sourceHandle: 'bottom', targetHandle: 'top' },
    { id: 'e3', source: 'c', target: 'a', sourceHandle: 'right', targetHandle: 'left' }, // 循環
    { id: 'e4', source: 'c', target: 'c', sourceHandle: 'right', targetHandle: 'right' }, // 自己ループ
  ];
  const r1 = await calculateSugiyamaPortLayout(nodes, edges, 'RIGHT');
  await assertEqual(null, r1.nodes.length, 4, '[sugiyama-port頑健性] 全ノードの位置が返ること');
  for (const n of r1.nodes) {
    await assertTrue(
      null,
      Number.isFinite(n.position.x) && Number.isFinite(n.position.y),
      `[sugiyama-port頑健性] ${n.id}の座標が有限であること`
    );
  }
  const r2 = await calculateSugiyamaPortLayout(nodes, edges, 'RIGHT');
  await assertEqual(null, JSON.stringify(r1), JSON.stringify(r2), '[sugiyama-port頑健性] 2回実行で結果が完全一致すること（決定性）');

  const viaDispatcher = await calculateLayoutForAlign(nodes, edges, 'RIGHT', 'sugiyama-port');
  await assertEqual(
    null,
    JSON.stringify(viaDispatcher),
    JSON.stringify(r1),
    '[sugiyama-portディスパッチャ] 経由と直接呼び出しが一致すること'
  );
}

// --- 35. hola-lite: 子はサブツリーごとその面の向きへ伸びる（大域的な流れ方向を持たない） ---
// sugiyama系は「上/下ハンドルの子は親のprimary帯に被せ、その子孫は流れ方向（右）へ進む」ので、
// 孫は親の帯に戻ってくる。hola-liteは面ごとに箱を成長させるため、上ハンドルのサブツリーは
// **孫まで含めて丸ごと親より上**に載る。これが方針Iの主眼（docs/align-branch-layout.md「方針I」）
async function testHolaLiteSubtreeGrowsWithHandle() {
  const nodes = [
    { id: 'p', content: '', position: { x: 0, y: 0 } },
    { id: 'c', content: '', position: { x: 0, y: -200 } },
    { id: 'g', content: '', position: { x: 300, y: -200 } },
  ];
  const edges = [
    { id: 'e1', source: 'p', target: 'c', sourceHandle: 'top', targetHandle: 'bottom' },
    { id: 'e2', source: 'c', target: 'g', sourceHandle: 'right', targetHandle: 'left' },
  ];
  const pos = positionsById(await calculateHolaLiteLayout(nodes, edges, 'RIGHT'));
  await assertTrue(null, pos.get('g').x > pos.get('c').x, '[hola-lite成長] 孫がその子の右にあること');
  // 「サブツリー丸ごと」なので、**子も孫も**親の上端からGROWTH_GAPぶん離れた帯に載る。
  // 同じグラフをsugiyama-portに食わせると孫の下端は親の上端の10px上（CROSS_GAP）にしか来ない
  // ＝この等値アサートは設計の違いを実際に判別する（常にPASSするテストではない）
  await assertEqual(
    null,
    pos.get('p').y - (pos.get('c').y + 60),
    GROWTH_GAP,
    '[hola-lite成長] top子の下端が親の上端からGROWTH_GAP(60)離れること'
  );
  await assertEqual(
    null,
    pos.get('p').y - (pos.get('g').y + 60),
    GROWTH_GAP,
    '[hola-lite成長] 孫も同じ帯に載ること（上のサブツリーが丸ごと親より上へ出る）'
  );
}

// --- 36. hola-lite: 大域的な流れ方向を持たない（ハンドルが明示されていればdirectionで結果が変わらない） ---
async function testHolaLiteNoGlobalFlowDirection() {
  const nodes = [
    { id: 'p', content: '', position: { x: 0, y: 0 } },
    { id: 'r', content: '', position: { x: 300, y: 0 } },
    { id: 'b', content: '', position: { x: 0, y: 200 } },
  ];
  const edges = [
    { id: 'e1', source: 'p', target: 'r', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e2', source: 'p', target: 'b', sourceHandle: 'bottom', targetHandle: 'top' },
  ];
  const right = await calculateHolaLiteLayout(nodes, edges, 'RIGHT');
  const down = await calculateHolaLiteLayout(nodes, edges, 'DOWN');
  await assertEqual(
    null,
    JSON.stringify(down),
    JSON.stringify(right),
    '[hola-lite方向非依存] sourceHandleが全て付いていればlayoutDirectionで結果が変わらないこと'
  );
}

// --- 37. hola-lite: 純粋な木ではストレス段が走らず、rootが現在位置から動かない ---
// peelでcoreが空になる（＝周辺ツリーだけ）ケース。§26の差分安定性の要。
async function testHolaLiteTreeKeepsRoot() {
  const nodes = [
    { id: 'root', content: '', position: { x: 137, y: 421 } },
    { id: 'a', content: '', position: { x: 400, y: 300 } },
    { id: 'b', content: '', position: { x: 400, y: 600 } },
  ];
  const edges = [
    { id: 'e1', source: 'root', target: 'a', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e2', source: 'root', target: 'b', sourceHandle: 'right', targetHandle: 'left' },
  ];
  const pos = positionsById(await calculateHolaLiteLayout(nodes, edges, 'RIGHT'));
  await assertEqual(null, pos.get('root').x, 137, '[hola-lite木] rootのx座標が動かないこと');
  await assertEqual(null, pos.get('root').y, 421, '[hola-lite木] rootのy座標が動かないこと');
}

// --- 38. hola-lite: 兄弟の並び順は現在位置から決まる（メンタルマップ保持） ---
async function testHolaLiteSiblingOrderFromCurrent() {
  const base = [
    { id: 'p', content: '', position: { x: 0, y: 0 } },
    { id: 'c1', content: '', position: { x: 300, y: 0 } },
    { id: 'c2', content: '', position: { x: 300, y: 400 } },
  ];
  const edges = [
    { id: 'e1', source: 'p', target: 'c1', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e2', source: 'p', target: 'c2', sourceHandle: 'right', targetHandle: 'left' },
  ];
  const posA = positionsById(await calculateHolaLiteLayout(base, edges, 'RIGHT'));
  await assertTrue(null, posA.get('c1').y < posA.get('c2').y, '[hola-lite兄弟順] 現在位置が上の子が上に来ること');

  // c1/c2の現在位置だけ入れ替える（グラフの構造・エッジ順は同じ）
  const swapped = base.map((n) =>
    n.id === 'c1' ? { ...n, position: { x: 300, y: 400 } } : n.id === 'c2' ? { ...n, position: { x: 300, y: 0 } } : n
  );
  const posB = positionsById(await calculateHolaLiteLayout(swapped, edges, 'RIGHT'));
  await assertTrue(null, posB.get('c2').y < posB.get('c1').y, '[hola-lite兄弟順] 現在位置を入れ替えると並びも入れ替わること');
}

// --- 39. hola-lite: coreを含む複数成分ではストレス段が働き、離れた成分を引き寄せる ---
// ダイヤモンド（a→b, a→c, b→d, c→d）はdの入次数が2なので、dは強制フォレストの外＝別成分になる。
// 全ノードがcoreに残るのでA段（成分どうしのストレス最適化）が走り、遠くに置かれたdが引き寄せられる
async function testHolaLiteStressPullsComponents() {
  const nodes = [
    { id: 'a', content: '', position: { x: 0, y: 0 } },
    { id: 'b', content: '', position: { x: 300, y: -100 } },
    { id: 'c', content: '', position: { x: 300, y: 100 } },
    { id: 'd', content: '', position: { x: 4000, y: 3000 } }, // 遠くに離れている
  ];
  const edges = [
    { id: 'e1', source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e2', source: 'a', target: 'c', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e3', source: 'b', target: 'd', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e4', source: 'c', target: 'd', sourceHandle: 'right', targetHandle: 'left' },
  ];
  const pos = positionsById(await calculateHolaLiteLayout(nodes, edges, 'RIGHT'));
  const before = Math.hypot(4000 - 300, 3000 - 0);
  const after = Math.hypot(pos.get('d').x - pos.get('b').x, pos.get('d').y - pos.get('b').y);
  await assertTrue(null, after < before / 2, `[hola-liteストレス] 別成分の複数親の子が引き寄せられること（${Math.round(before)}→${Math.round(after)}）`);
  await assertTrue(null, after > 100, '[hola-liteストレス] 引き寄せすぎて重ならないこと');
}

// --- 40. hola-lite: 循環・自己ループ・孤立ノードで決定的、ディスパッチャ経由と一致 ---
async function testHolaLiteRobustnessAndDispatcher() {
  const nodes = [
    { id: 'a', content: '', position: { x: 0, y: 0 } },
    { id: 'b', content: '', position: { x: 200, y: 0 } },
    { id: 'c', content: '', position: { x: 100, y: 200 } },
    { id: 'iso', content: '', position: { x: 0, y: 600 } },
  ];
  const edges = [
    { id: 'e1', source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left' },
    { id: 'e2', source: 'b', target: 'c', sourceHandle: 'bottom', targetHandle: 'top' },
    { id: 'e3', source: 'c', target: 'a', sourceHandle: 'right', targetHandle: 'left' }, // 循環
    { id: 'e4', source: 'c', target: 'c', sourceHandle: 'right', targetHandle: 'right' }, // 自己ループ
  ];
  const r1 = await calculateHolaLiteLayout(nodes, edges, 'RIGHT');
  await assertEqual(null, r1.nodes.length, 4, '[hola-lite頑健性] 全ノードの位置が返ること');
  for (const n of r1.nodes) {
    await assertTrue(
      null,
      Number.isFinite(n.position.x) && Number.isFinite(n.position.y),
      `[hola-lite頑健性] ${n.id}の座標が有限であること`
    );
  }
  const r2 = await calculateHolaLiteLayout(nodes, edges, 'RIGHT');
  await assertEqual(null, JSON.stringify(r1), JSON.stringify(r2), '[hola-lite頑健性] 2回実行で結果が完全一致すること（決定性）');

  const viaDispatcher = await calculateLayoutForAlign(nodes, edges, 'RIGHT', 'hola-lite');
  await assertEqual(
    null,
    JSON.stringify(viaDispatcher),
    JSON.stringify(r1),
    '[hola-liteディスパッチャ] 経由と直接呼び出しが一致すること'
  );
}

export async function run() {
  await testBranchSideSeparation();
  await testBranchRecursion();
  await testBranchAsymmetricSiblingNoOverlap();
  await testBranchPureCycle();
  await testBranchMultiParent();
  await testFlatAxisSeparation();
  await testDispatcherUniformParity();
  await testSugiyamaExtSideSeparation();
  await testSugiyamaExtRootStable();
  await testSugiyamaExtDownDirection();
  await testSugiyamaExtCycleAndMultiParent();
  await testSugiyamaExtDispatcherParity();
  await testSugiyamaExtDeepestLayer();
  await testSugiyamaExtCrossForwardNoOverlap();
  await testSugiyamaExtTreeSeparation();
  await testElkPortDiffersFromUniform();
  await testElkPortKeepsSingleFlowDirection();
  await testElkPortTargetHandleFallback();
  await testElkPortDanglingEdge();
  await testElkPortCycleAndMultiParent();
  await testElkPortDispatcherParity();
  await testElkPortExtMatchesElkPort();
  await testElkPortExtCrossPorts();
  await testElkPortExtLayerSpacing();
  await testElkPortExtSingleFlow();
  await testElkPortExtLongEdge();
  await testElkPortExtNoOverlapInLayer();
  await testElkPortExtDownDirection();
  await testElkPortExtRobustness();
  await testElkPortExtDispatcherParity();
  await testElkPortPavaKeepsPosition();
  await testElkPortPavaRobustnessAndDispatcher();
  await testSugiyamaPortLeftHandleWins();
  await testSugiyamaPortRightSourceWins();
  await testSugiyamaPortMultiParentBarycenter();
  await testSugiyamaPortSharedSiblings();
  await testSugiyamaPortCrossHugPattern();
  await testSugiyamaPortCrossOutsidePattern();
  await testSugiyamaPortSharedChildUnderOutsideCross();
  await testSugiyamaPortReAlignStable();
  await testSugiyamaPortDownDirection();
  await testSugiyamaPortRobustnessAndDispatcher();
  await testHolaLiteSubtreeGrowsWithHandle();
  await testHolaLiteNoGlobalFlowDirection();
  await testHolaLiteTreeKeepsRoot();
  await testHolaLiteSiblingOrderFromCurrent();
  await testHolaLiteStressPullsComponents();
  await testHolaLiteRobustnessAndDispatcher();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
