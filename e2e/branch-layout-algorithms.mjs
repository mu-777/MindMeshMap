// dev限定の整列アルゴリズム（branch / flat-axis）の挙動を検証する、ブラウザを起動しない純Nodeテスト。
// docs/align-branch-layout.md参照。
//
// e2e/layout-stability.mjsはlayout.tsのソースを正規表現で読むだけで済んだが、本テストは
// 実際にcalculateBranchLayout / calculateFlatAxisLayout / calculateLayoutForAlign /
// calculateLayoutを呼び出して結果を検証する必要がある。素のNode.jsは拡張子省略・
// ディレクトリindex解決（Vite/tscのbundlerモード解決）に対応しておらず、また型のみの
// import（例: `import ELK, { ElkNode } from 'elkjs/...'`）も素のNode実行では剥がせないため、
// 以下でesbuild（vite経由で既にnode_modulesに存在する）を使った最小限のカスタムモジュール
// ローダーをこのテストファイル内だけに登録する。src側の実装・importの書き方は一切変更しない
// （ビルド成果物ではなく開発時のソースをそのまま検証するため）
import { register } from 'node:module';
import { assertTrue, assertEqual, runStandalone } from './helpers.mjs';

export const name = 'branch-layout-algorithms';

const esbuildUrl = import.meta.resolve('esbuild');

// resolve: 拡張子省略・ディレクトリ import（'../types' → 'types/index.ts'）をesbuild実行前に解決する
// load: .ts/.tsxファイルをesbuild.transformでESMのJSに変換してから実行エンジンに渡す
const loaderSource = `
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import * as esbuild from ${JSON.stringify(esbuildUrl)};

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const baseDir = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : process.cwd();
    let resolved = path.resolve(baseDir, specifier);
    if (!path.extname(resolved)) {
      if (existsSync(resolved) && statSync(resolved).isDirectory()) {
        resolved = path.join(resolved, 'index.ts');
      } else if (existsSync(resolved + '.ts')) {
        resolved = resolved + '.ts';
      } else if (existsSync(resolved + '.tsx')) {
        resolved = resolved + '.tsx';
      }
    }
    return nextResolve(pathToFileURL(resolved).href, context);
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    const filePath = fileURLToPath(url);
    const source = readFileSync(filePath, 'utf-8');
    const result = await esbuild.transform(source, {
      loader: url.endsWith('.tsx') ? 'tsx' : 'ts',
      format: 'esm',
      target: 'es2022',
      sourcefile: filePath,
    });
    return { format: 'module', source: result.code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
`;

register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url);

const { calculateBranchLayout } = await import('../src/utils/branchLayout.ts');
const { calculateFlatAxisLayout } = await import('../src/utils/flatAxisLayout.ts');
const { calculateSugiyamaExtLayout } = await import('../src/utils/sugiyamaExtLayout.ts');
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
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
