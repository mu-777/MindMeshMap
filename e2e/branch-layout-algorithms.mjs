// dev限定の整列アルゴリズム（branch / flat-axis / sugiyama-ext / elk-port / elk-port-ext）の**個別の設計意図**を検証する、
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

// --- 21. elk-port-ext: 直交ポートがcross方向の配置に効く（上ハンドル子は上、下ハンドル子は下）---
async function testElkPortExtCrossPorts() {
  // 方針Gの中身そのもの。流れ方向（層）は単一のままだが、cross方向の位置はポート面で決まる
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
  await assertTrue(null, pos.get('t').y < p.y, '[elk-port-ext] 上ハンドル子が親より上に置かれること');
  await assertTrue(null, pos.get('b').y > p.y, '[elk-port-ext] 下ハンドル子が親より下に置かれること');
  await assertTrue(
    null,
    Math.abs(pos.get('r').y - p.y) < Math.abs(pos.get('t').y - p.y),
    '[elk-port-ext] 右ハンドル子は上ハンドル子より親のcross位置に近いこと（流れ方向の面はオフセット0）'
  );
  // 層は単一の流れ方向のまま（上/下ハンドル子も前方の層に置かれる）
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
  await assertTrue(
    null,
    Math.abs(pos.get('d').x - p.x) < Math.abs(pos.get('l').x - p.x),
    '[elk-port-ext DOWN] forwardの子のほうがcross(左右)方向で親に近いこと'
  );
}

// --- 25. elk-port-ext: 循環・複数親・孤立ノード・自己ループで決定的、位置は元の場所に留まる ---
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

  // ELK版と違い原点付近へ正規化しない: 整列後の外接矩形の左上が元の左上と一致する
  const pos = positionsById(r1);
  const minX = Math.min(...r1.nodes.map((n) => n.position.x));
  const minY = Math.min(...r1.nodes.map((n) => n.position.y));
  await assertEqual(null, minX, 1000, '[elk-port-ext] 外接矩形の左上xが元の位置に留まること');
  await assertEqual(null, minY, 500, '[elk-port-ext] 外接矩形の左上yが元の位置に留まること');
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
  await testElkPortExtCrossPorts();
  await testElkPortExtLongEdge();
  await testElkPortExtNoOverlapInLayer();
  await testElkPortExtDownDirection();
  await testElkPortExtRobustness();
  await testElkPortExtDispatcherParity();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
