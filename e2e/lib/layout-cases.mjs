// 整列アルゴリズムを評価するためのケースコーパス（テスト入力の集合）。
// docs/layout-lab.md 参照。
//
// **手で「あり得る接続パターン」を列挙しない**。接続パターンの空間は無限（任意のグラフ）で、
// 列挙したリストは「列挙した範囲でだけ良いアルゴリズム」を生む。代わりに、この問題設定を
// 特徴づける**直交する軸**を決め、その軸上でケースを生成する:
//
//   A. 使うハンドルの組み合わせ（right/left/top/bottom の非空部分集合15通り）
//   B. 深さ・非対称性（連鎖、片側だけ深い、cross子がさらにforward子を持つ）
//   C. グラフ性（複数親・循環・自己ループ・森・孤立ノード・枝をまたぐリンク）
//   D. ノードサイズのばらつき（改行で高くなった／長文で幅広になったノード）
//   E. 整列前の初期位置（整列済み／ランダム／1点に潰れている／上下反転／配列順のシャッフル）
//      ※このアプリの整列は差分安定（メンタルマップ保持）なので、同じグラフでも初期位置が
//        違えば別ケースになる。ここを外すと最も壊れやすい部分を見逃す
//   F. 規模（性能とスケール時の破綻）
//   G. 実マップ（合成ケースだけでは現実の形から外れるため）
//
// 「選択ノードのみの部分整列」は軸に入れていない。useAutoLayout.applyLayout の実装上、
// 部分整列は「選択ノードと両端が選択内に収まるエッジだけの部分グラフを整列し、結果を
// 平行移動する」処理なので、アルゴリズムから見れば通常のケースと同一だから
// （平行移動はアルゴリズムの外側で行われる）。
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './ts-loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'maps');

const W = 180;
const H = 60;
const SIDES = ['right', 'left', 'top', 'bottom'];

// --- 構造の組み立てヘルパ ---

/**
 * 木の仕様から nodes/edges を作る。
 * spec: { id, w?, h?, children?: [{ side, ...spec }] }
 */
function buildTree(spec) {
  const nodes = [];
  const edges = [];
  let edgeSeq = 0;
  const walk = (node) => {
    nodes.push({ id: node.id, content: '', position: { x: 0, y: 0 }, width: node.w || W, height: node.h || H });
    for (const child of node.children || []) {
      edges.push({
        id: `e${edgeSeq++}`,
        source: node.id,
        target: child.id,
        sourceHandle: child.side,
        targetHandle: oppositeSide(child.side),
      });
      walk(child);
    }
  };
  walk(spec);
  return { nodes, edges };
}

function oppositeSide(side) {
  return { right: 'left', left: 'right', top: 'bottom', bottom: 'top' }[side];
}

function connect(edges, source, target, side) {
  edges.push({
    id: `x${edges.length}`,
    source,
    target,
    sourceHandle: side,
    targetHandle: oppositeSide(side),
  });
}

/** 決定的な擬似乱数（mulberry32）。同じseedなら常に同じ列 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- 初期位置（整列前の配置）の生成 ---

const STEP = { right: [280, 0], left: [-280, 0], bottom: [0, 140], top: [0, -140] };

/**
 * 「だいたい整った」初期位置を与える。各ノードから、そのハンドル方向へ子を並べる素朴な配置。
 * 整列アルゴリズムはこの位置をヒントに使う（差分レイアウト）ため、初期位置は入力の一部。
 */
export function placeTidy(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map(nodes.map((n) => [n.id, []]));
  const hasParent = new Set();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) continue;
    if (hasParent.has(e.target)) continue; // 最初に見つかった親だけを配置に使う
    hasParent.add(e.target);
    childrenOf.get(e.source).push({ id: e.target, side: e.sourceHandle || 'right' });
  }

  const placed = new Map();
  let rootY = 0;
  const walk = (id, x, y) => {
    if (placed.has(id)) return;
    placed.set(id, { x, y });
    const counters = { right: 0, left: 0, top: 0, bottom: 0 };
    for (const child of childrenOf.get(id) || []) {
      const side = SIDES.includes(child.side) ? child.side : 'right';
      const [dx, dy] = STEP[side];
      const k = counters[side]++;
      // 進行方向と直交する向きに兄弟を並べる
      const spreadX = dx === 0 ? (k - 0.5) * 220 : 0;
      const spreadY = dy === 0 ? (k - 0.5) * 110 : 0;
      walk(child.id, x + dx + spreadX, y + dy + spreadY);
    }
  };
  for (const n of nodes) {
    if (!hasParent.has(n.id)) {
      walk(n.id, 0, rootY);
      rootY += 600;
    }
  }
  for (const n of nodes) if (!placed.has(n.id)) walk(n.id, 0, (rootY += 600)); // 孤立循環

  return nodes.map((n) => ({ ...n, position: placed.get(n.id) }));
}

/** ランダムに散らばった初期位置（seedで決定的） */
export function placeRandom(nodes, seed = 1) {
  const rand = rng(seed);
  const span = Math.max(800, nodes.length * 120);
  return nodes.map((n) => ({ ...n, position: { x: Math.round(rand() * span), y: Math.round(rand() * span) } }));
}

/** ほぼ1点に潰れた初期位置（差分レイアウトが位置ヒントを頼れない極端な入力） */
export function placeCollapsed(nodes) {
  return nodes.map((n, i) => ({ ...n, position: { x: i % 3, y: i % 2 } }));
}

/** cross軸（y）を反転した初期位置。兄弟の並び順が逆転して見えるはず */
export function placeMirrored(nodes) {
  return nodes.map((n) => ({ ...n, position: { x: n.position.x, y: -n.position.y } }));
}

/** ノード配列の順序だけを入れ替える（座標は変えない）。配列順への依存を炙り出す */
export function shuffleNodeOrder(nodes, seed = 7) {
  const rand = rng(seed);
  const copy = [...nodes];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// --- 各グループのケース生成 ---

function caseOf(id, group, title, note, nodes, edges, direction = 'RIGHT') {
  return { id, group, title, note, direction, nodes, edges };
}

// A. ハンドルの組み合わせ（非空部分集合15通り × 各側2子）
function groupHandleCombos() {
  const cases = [];
  for (let mask = 1; mask < 16; mask++) {
    const sides = SIDES.filter((_, i) => mask & (1 << i));
    const children = [];
    for (const side of sides) {
      for (let k = 0; k < 2; k++) children.push({ id: `${side}${k}`, side });
    }
    const { nodes, edges } = buildTree({ id: 'p', children });
    cases.push(
      caseOf(
        `a-${sides.join('-')}`,
        'A. ハンドル組み合わせ',
        `${sides.join('+')} に各2子`,
        '親1つに対し、指定したハンドルそれぞれへ子を2つずつ。ハンドル別の方向分離の基本形',
        placeTidy(nodes, edges),
        edges
      )
    );
  }
  // 子数の違い（right+bottomの組み合わせで1子/5子）
  for (const count of [1, 5]) {
    const children = [];
    for (const side of ['right', 'bottom']) {
      for (let k = 0; k < count; k++) children.push({ id: `${side}${k}`, side });
    }
    const { nodes, edges } = buildTree({ id: 'p', children });
    cases.push(
      caseOf(
        `a-count${count}`,
        'A. ハンドル組み合わせ',
        `right+bottom に各${count}子`,
        '同じハンドル構成で子数だけを変えたケース（兄弟が増えたときの広がり方）',
        placeTidy(nodes, edges),
        edges
      )
    );
  }
  // DOWN方向（primary/crossが90度回転しても同じ扱いになるか）
  {
    const children = [];
    for (const side of ['right', 'bottom', 'top']) {
      for (let k = 0; k < 2; k++) children.push({ id: `${side}${k}`, side });
    }
    const { nodes, edges } = buildTree({ id: 'p', children });
    cases.push(
      caseOf(
        'a-down-direction',
        'A. ハンドル組み合わせ',
        'right+bottom+top / DOWN方向',
        'マップのlayoutDirectionがDOWNのとき、primary/crossが90度回転して同じ扱いになるか',
        placeTidy(nodes, edges),
        edges,
        'DOWN'
      )
    );
  }
  // sourceHandle無し（旧データ）のフォールバック
  {
    const nodes = ['p', 'c0', 'c1', 'c2'].map((id) => ({ id, content: '', position: { x: 0, y: 0 }, width: W, height: H }));
    const edges = ['c0', 'c1', 'c2'].map((t, i) => ({ id: `e${i}`, source: 'p', target: t }));
    cases.push(
      caseOf(
        'a-no-handle',
        'A. ハンドル組み合わせ',
        'sourceHandle無し（旧データ）',
        'ハンドル情報を持たない旧データ。マップのlayoutDirectionへフォールバックする経路',
        placeTidy(nodes, edges),
        edges
      )
    );
  }
  return cases;
}

// B. 深さ・非対称性
function groupDepth() {
  const cases = [];

  {
    const { nodes, edges } = buildTree({
      id: 'n0',
      children: [{ id: 'n1', side: 'right', children: [{ id: 'n2', side: 'right', children: [{ id: 'n3', side: 'right' }] }] }],
    });
    cases.push(caseOf('b-chain4', 'B. 深さ・非対称', '直鎖4段', '最も単純な深さ。層の間隔が一定になるか', placeTidy(nodes, edges), edges));
  }

  {
    // 片方の子だけが深いサブツリーを持つ非対称な形（兄弟の箱サイズが大きく違う）
    const { nodes, edges } = buildTree({
      id: 'p',
      children: [
        { id: 'leaf', side: 'right' },
        {
          id: 'deep',
          side: 'right',
          children: [
            { id: 'd1', side: 'right', children: [{ id: 'd2', side: 'right' }] },
            { id: 'd3', side: 'right' },
            { id: 'd4', side: 'right' },
          ],
        },
      ],
    });
    cases.push(
      caseOf('b-asymmetric', 'B. 深さ・非対称', '非対称な兄弟サブツリー', '葉と大きなサブツリーが兄弟。箱サイズの差を考慮できているか', placeTidy(nodes, edges), edges)
    );
  }

  {
    // docs/align-branch-layout.md が「残る制限」として挙げているケース:
    // cross(上/下)側の子が、さらに深い階層でforward側の孫と近接する
    const { nodes, edges } = buildTree({
      id: 'p',
      children: [
        { id: 'f0', side: 'right', children: [{ id: 'f00', side: 'right' }, { id: 'f01', side: 'right' }] },
        { id: 'f1', side: 'right' },
        {
          id: 'b0',
          side: 'bottom',
          children: [{ id: 'b00', side: 'right', children: [{ id: 'b000', side: 'right' }] }, { id: 'b01', side: 'right' }],
        },
      ],
    });
    cases.push(
      caseOf(
        'b-cross-deep',
        'B. 深さ・非対称',
        'cross子がさらにforward子を持つ',
        'align-branch-layout.mdが「残る制限」として挙げている形。下の枝の子孫と右の枝の子孫が近接する',
        placeTidy(nodes, edges),
        edges
      )
    );
  }

  {
    // 階層ごとにハンドルが切り替わる（右→下→右→下）
    const { nodes, edges } = buildTree({
      id: 'p',
      children: [
        {
          id: 'r',
          side: 'right',
          children: [{ id: 'rb', side: 'bottom', children: [{ id: 'rbr', side: 'right', children: [{ id: 'rbrb', side: 'bottom' }] }] }],
        },
      ],
    });
    cases.push(caseOf('b-alternating', 'B. 深さ・非対称', '階層ごとに方向が交互', '右→下→右→下と方向が切り替わる連鎖', placeTidy(nodes, edges), edges));
  }

  {
    // 横に広い（同一層に兄弟が多い）
    const children = [];
    for (let i = 0; i < 6; i++) {
      children.push({ id: `c${i}`, side: 'right', children: [{ id: `c${i}a`, side: 'right' }, { id: `c${i}b`, side: 'right' }] });
    }
    const { nodes, edges } = buildTree({ id: 'p', children });
    cases.push(caseOf('b-wide', 'B. 深さ・非対称', '同一層に兄弟6つ（各2子）', '同じ層に多数の兄弟が並ぶときのcross方向の詰め方', placeTidy(nodes, edges), edges));
  }

  return cases;
}

// C. グラフ性（木でないもの）
function groupGraph() {
  const cases = [];

  {
    // 複数親（ダイヤ）。どちらの親の枝に属させるかの選択が発生する
    const { nodes, edges } = buildTree({
      id: 'p',
      children: [
        { id: 'a', side: 'right' },
        { id: 'b', side: 'bottom' },
      ],
    });
    nodes.push({ id: 'd', content: '', position: { x: 0, y: 0 }, width: W, height: H });
    connect(edges, 'a', 'd', 'right');
    connect(edges, 'b', 'd', 'right');
    cases.push(caseOf('c-diamond', 'C. グラフ性', '複数親（ダイヤ）', '右の枝と下の枝の両方から同じ子へ。主たる親の選び方が結果を分ける', placeTidy(nodes, edges), edges));
  }

  {
    // 深さの違う2経路から合流（sugiyama-extの「最深レイヤ採用」が効くか）
    const { nodes, edges } = buildTree({
      id: 'A1',
      children: [
        { id: 'B1', side: 'right', children: [{ id: 'C1', side: 'right' }] },
        { id: 'B2', side: 'right' },
      ],
    });
    nodes.push({ id: 'D1', content: '', position: { x: 0, y: 0 }, width: W, height: H });
    connect(edges, 'C1', 'D1', 'right');
    connect(edges, 'B2', 'D1', 'right');
    cases.push(caseOf('c-merge-depth', 'C. グラフ性', '深さの違う2経路が合流', '浅い親と深い親のどちらに合わせるか（最深レイヤ採用の検証）', placeTidy(nodes, edges), edges));
  }

  {
    // 3ノードの純粋な循環（入次数0のノードが1つも無い）
    const nodes = ['a', 'b', 'c'].map((id) => ({ id, content: '', position: { x: 0, y: 0 }, width: W, height: H }));
    const edges = [];
    connect(edges, 'a', 'b', 'right');
    connect(edges, 'b', 'c', 'bottom');
    connect(edges, 'c', 'a', 'left');
    cases.push(caseOf('c-pure-cycle', 'C. グラフ性', '純粋な循環（入次数0なし）', '全ノードが入次数1以上。BFS/DFSの入口が無い', placeTidy(nodes, edges), edges));
  }

  {
    // ルートからぶら下がった循環
    const nodes = ['root', 'a', 'b', 'c'].map((id) => ({ id, content: '', position: { x: 0, y: 0 }, width: W, height: H }));
    const edges = [];
    connect(edges, 'root', 'a', 'right');
    connect(edges, 'a', 'b', 'right');
    connect(edges, 'b', 'c', 'right');
    connect(edges, 'c', 'a', 'top');
    cases.push(caseOf('c-cycle-under-root', 'C. グラフ性', 'ルート配下の循環', '入次数0のルートから辿った先に循環がある（このアプリの主要ユースケース）', placeTidy(nodes, edges), edges));
  }

  {
    // 2ノードの相互リンク
    const nodes = ['a', 'b'].map((id) => ({ id, content: '', position: { x: 0, y: 0 }, width: W, height: H }));
    const edges = [];
    connect(edges, 'a', 'b', 'right');
    connect(edges, 'b', 'a', 'left');
    cases.push(caseOf('c-two-cycle', 'C. グラフ性', '相互リンク（2ノード循環）', 'A→BとB→Aが両方ある最小の循環', placeTidy(nodes, edges), edges));
  }

  {
    // 自己ループ
    const nodes = ['root', 'a'].map((id) => ({ id, content: '', position: { x: 0, y: 0 }, width: W, height: H }));
    const edges = [];
    connect(edges, 'root', 'a', 'right');
    connect(edges, 'a', 'a', 'bottom');
    cases.push(caseOf('c-self-loop', 'C. グラフ性', '自己ループ', '自分自身へのエッジ。無限ループ・NaNを踏まないかの堅牢性確認', placeTidy(nodes, edges), edges));
  }

  {
    // 森（独立した3つの木）＋孤立ノード
    const nodes = [];
    const edges = [];
    for (let t = 0; t < 3; t++) {
      const sub = buildTree({ id: `t${t}`, children: [{ id: `t${t}a`, side: 'right' }, { id: `t${t}b`, side: 'bottom' }] });
      nodes.push(...sub.nodes);
      for (const e of sub.edges) edges.push({ ...e, id: `t${t}${e.id}` });
    }
    nodes.push({ id: 'lonely', content: '', position: { x: 0, y: 0 }, width: W, height: H });
    cases.push(caseOf('c-forest', 'C. グラフ性', '独立した3つの木＋孤立ノード', '複数ツリーの相互配置（重なりの押し離しが効くか）', placeTidy(nodes, edges), edges));
  }

  {
    // 枝をまたぐリンク（木＋横断エッジ）
    const { nodes, edges } = buildTree({
      id: 'p',
      children: [
        { id: 'l', side: 'right', children: [{ id: 'l1', side: 'right' }, { id: 'l2', side: 'right' }] },
        { id: 'r', side: 'bottom', children: [{ id: 'r1', side: 'right' }, { id: 'r2', side: 'right' }] },
      ],
    });
    connect(edges, 'l1', 'r2', 'bottom');
    connect(edges, 'r1', 'l2', 'top');
    cases.push(caseOf('c-cross-links', 'C. グラフ性', '枝をまたぐリンク', '木構造に、別の枝へ渡る非木エッジが加わる（このアプリの「メッシュ」的な使い方）', placeTidy(nodes, edges), edges));
  }

  return cases;
}

// D. ノードサイズのばらつき
function groupSizes() {
  const cases = [];

  {
    const { nodes, edges } = buildTree({
      id: 'p',
      children: [
        { id: 'tall', side: 'right', h: 260 },
        { id: 'normal', side: 'right' },
        { id: 'tall2', side: 'bottom', h: 180 },
      ],
    });
    cases.push(caseOf('d-tall-nodes', 'D. サイズ', '背の高いノードが混在', '改行で高くなったノード。実測サイズを考慮しないと重なる', placeTidy(nodes, edges), edges));
  }

  {
    const { nodes, edges } = buildTree({
      id: 'p',
      children: [
        { id: 'wide', side: 'right', w: 460 },
        { id: 'narrow', side: 'right', w: 90 },
        { id: 'wideBottom', side: 'bottom', w: 420 },
      ],
    });
    cases.push(caseOf('d-wide-nodes', 'D. サイズ', '幅が大きく違うノード', '長文で幅広になったノードと短いノードの混在', placeTidy(nodes, edges), edges));
  }

  {
    const rand = rng(42);
    const children = [];
    for (let i = 0; i < 5; i++) {
      children.push({
        id: `c${i}`,
        side: i % 2 === 0 ? 'right' : 'bottom',
        w: 100 + Math.round(rand() * 300),
        h: 50 + Math.round(rand() * 200),
        children: [{ id: `c${i}a`, side: 'right', w: 100 + Math.round(rand() * 300), h: 50 + Math.round(rand() * 200) }],
      });
    }
    const { nodes, edges } = buildTree({ id: 'p', children });
    cases.push(caseOf('d-mixed-sizes', 'D. サイズ', 'サイズがばらばら', '幅も高さもばらつくノードの集合（実際のマップに近い状態）', placeTidy(nodes, edges), edges));
  }

  return cases;
}

// E. 整列前の初期位置（同じグラフ・異なる入力位置）
function groupInitialPosition() {
  const base = buildTree({
    id: 'p',
    children: [
      { id: 'r0', side: 'right', children: [{ id: 'r00', side: 'right' }, { id: 'r01', side: 'right' }] },
      { id: 'r1', side: 'right', children: [{ id: 'r10', side: 'right' }] },
      { id: 'b0', side: 'bottom', children: [{ id: 'b00', side: 'right' }] },
      { id: 't0', side: 'top' },
    ],
  });
  const tidy = placeTidy(base.nodes, base.edges);
  const variants = [
    ['e-init-tidy', '整列済みに近い初期位置', 'ほぼ整った状態から整列。ほとんど動かないのが望ましい', tidy],
    ['e-init-random', 'ランダムな初期位置', '位置ヒントが当てにならない状態。構造どおりに組み直せるか', placeRandom(base.nodes, 3)],
    ['e-init-collapsed', '1点に潰れた初期位置', '全ノードがほぼ同座標。位置ヒントが完全に無意味な極端な入力', placeCollapsed(base.nodes)],
    ['e-init-mirrored', '上下反転した初期位置', '兄弟の並びが逆転して見える状態。並び順の初期化が現在位置を見ているか', placeMirrored(tidy)],
    ['e-init-shuffled', '配列順のみシャッフル', '座標は整列済みのまま、nodes配列の順序だけを入れ替える。配列順への依存を炙り出す', shuffleNodeOrder(tidy, 11)],
  ];
  return variants.map(([id, title, note, nodes]) =>
    caseOf(id, 'E. 初期位置', title, note, nodes, base.edges)
  );
}

// F. 規模（既定では実行しない。--scale で有効化）
function groupScale() {
  const build = (count, seed) => {
    const rand = rng(seed);
    const nodes = [{ id: 'n0', content: '', position: { x: 0, y: 0 }, width: W, height: H }];
    const edges = [];
    for (let i = 1; i < count; i++) {
      const parent = `n${Math.floor(rand() * i)}`;
      const side = rand() < 0.7 ? 'right' : rand() < 0.5 ? 'bottom' : 'top';
      nodes.push({ id: `n${i}`, content: '', position: { x: 0, y: 0 }, width: W, height: H });
      connect(edges, parent, `n${i}`, side);
    }
    return { nodes, edges };
  };
  return [50, 150].map((count) => {
    const { nodes, edges } = build(count, count);
    return caseOf(`f-scale${count}`, 'F. 規模', `${count}ノードのランダム木`, '規模が増えたときの実行時間と破綻の確認', placeTidy(nodes, edges), edges);
  });
}

// G. 実マップ
async function groupRealMaps() {
  const cases = [];

  // 実際に初回訪問時に表示されるデフォルトマップ（DAG構造）。
  // createDefaultMapのidはDate.now()+乱数で毎回変わるため、生成順で決定的なidへ振り直す
  const { createDefaultMap } = await import('../../src/data/defaultMap.ts');
  const map = createDefaultMap((key) => key);
  const idMap = new Map(map.nodes.map((n, i) => [n.id, `d${i}`]));
  cases.push(
    caseOf(
      'g-default-map',
      'G. 実マップ',
      'デフォルトマップ（初回訪問時に表示されるDAG）',
      'src/data/defaultMap.ts の実データ。複数親を持つ現実的なDAG',
      map.nodes.map((n) => ({ ...n, id: idMap.get(n.id), width: W, height: H })),
      map.edges.map((e, i) => ({ ...e, id: `g${i}`, source: idMap.get(e.source), target: idMap.get(e.target) })),
      map.layoutDirection
    )
  );

  // e2e/fixtures/maps/*.json に置いたエクスポート済みマップを自動で取り込む
  if (existsSync(FIXTURE_DIR)) {
    for (const file of readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).sort()) {
      const raw = JSON.parse(readFileSync(path.join(FIXTURE_DIR, file), 'utf-8'));
      if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) continue;
      cases.push(
        caseOf(
          `g-${path.basename(file, '.json')}`,
          'G. 実マップ',
          raw.name || file,
          `e2e/fixtures/maps/${file}（エクスポートした実マップ）`,
          raw.nodes.map((n) => ({ ...n, width: n.width || W, height: n.height || H })),
          raw.edges,
          raw.layoutDirection === 'DOWN' ? 'DOWN' : 'RIGHT'
        )
      );
    }
  }

  return cases;
}

/**
 * コーパス全体を組み立てる。
 * includeScale=true で規模ケース（F）も含める（実行時間が伸びるため既定では除外）。
 */
export async function buildCases({ includeScale = false } = {}) {
  const cases = [
    ...groupHandleCombos(),
    ...groupDepth(),
    ...groupGraph(),
    ...groupSizes(),
    ...groupInitialPosition(),
    ...(includeScale ? groupScale() : []),
    ...(await groupRealMaps()),
  ];

  const seen = new Set();
  for (const c of cases) {
    if (seen.has(c.id)) throw new Error(`ケースIDが重複しています: ${c.id}`);
    seen.add(c.id);
  }
  return cases;
}
