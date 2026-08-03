// ハンドルからエッジを引き伸ばして空白にドロップして新規ノードを作ったとき、
// 新規ノード側のどのハンドルにエッジが付くか・新規ノードがドロップ点のどちら側にできるかを
// 検証する（MindMapCanvas.tsx onConnectEnd）。
//
// 規則は**どのハンドルから引き伸ばしたかではなく、ドロップ点が開始ハンドルより
// primary 方向のどちら側か**で決まる:
//   forward 側（RIGHT:ハンドルより右 / DOWN:下）へ離した … 受け口=backward面、ドロップ点=新規ノードのbackward面
//   backward 側（RIGHT:ハンドルより左 / DOWN:上）へ離した … 受け口=forward面、 ドロップ点=新規ノードのforward面
// cross面（RIGHT:top/bottom）起点も同じ規則（ハンドルの primary 座標＝ノード中心が基準）。
//
// ハンドルの割り当ては DOM からは読めないため、localStorage のドラフト
// （mindmeshmap-draft。mapStore.ts が500msデバウンスで常時保存する）からエッジを読んで確認する。
//
// ケースごとに独立したページを使う。1ページで続けて何本も引くと、作られた新規ノードが
// 初期マップのノードと重なってハンドルが重なり、狙ったハンドルを掴めなくなる（実際に一度そうなった）。
import {
  launchPage,
  closeBrowser,
  assertTrue,
  assertEqual,
  getNodeIds,
  runStandalone,
} from './helpers.mjs';

export const name = 'edge-drop-handle-side';

/** ノード位置のズレ許容量（px）。ズーム倍率によるサブピクセル誤差ぶんだけ見る */
const POSITION_TOLERANCE = 4;
/** 開始ハンドルとドロップ点の primary 方向の最小距離（px）。判定が境界で揺れないように離す */
const DROP_MARGIN = 80;

/** ハンドルDOMの中心座標（画面座標） */
async function handleCenter(page, nodeId, handleId) {
  const box = await page
    .locator(`.react-flow__node[data-id="${nodeId}"] .react-flow__handle[data-handleid="${handleId}"]`)
    .boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** localStorageのドラフトからエッジ一覧を読む（デバウンス500msぶん待ってから呼ぶ） */
async function getDraftEdges(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('mindmeshmap-draft');
    if (!raw) return null;
    return JSON.parse(raw).map.edges;
  });
}

/** 全ノードの画面上の矩形 */
async function nodeBoxes(page) {
  const ids = await getNodeIds(page);
  const boxes = [];
  for (const id of ids) {
    boxes.push({ id, ...(await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox()) });
  }
  return boxes;
}

/** 初期マップのうち最も左のノード（周囲に空きがあり、どのハンドルからも引きやすい） */
async function pickSourceNode(page) {
  const boxes = await nodeBoxes(page);
  return boxes.reduce((best, b) => (b.x < best.x ? b : best)).id;
}

/**
 * ペイン内で、どのノードからも clearance px 以上離れていて accept(x, y) を満たす点を探す。
 * レイアウト方向・ドロップ方向でノード配置も狙う領域も変わるため、固定座標では空白を狙えない
 */
async function findBlankPoint(page, accept, clearance = 80) {
  const paneBox = await page.locator('.react-flow__pane').boundingBox();
  const boxes = await nodeBoxes(page);
  const step = 30;
  for (let y = paneBox.y + paneBox.height - 40; y > paneBox.y + 40; y -= step) {
    for (let x = paneBox.x + 40; x < paneBox.x + paneBox.width - 40; x += step) {
      if (!accept(x, y)) continue;
      const clear = boxes.every(
        (b) =>
          x < b.x - clearance || x > b.x + b.width + clearance || y < b.y - clearance || y > b.y + b.height + clearance
      );
      if (!clear) continue;
      const hitsPane = await page.evaluate(
        (p) => document.elementFromPoint(p.x, p.y)?.classList.contains('react-flow__pane') ?? false,
        { x, y }
      );
      if (hitsPane) return { x, y };
    }
  }
  return null;
}

/**
 * 独立したページで「handleId から空白へドラッグして新規ノードを作る」を1回だけ実行し、
 * エッジのハンドル割り当てと新規ノードの位置を検証する。
 *   dropSide: 'forward' | 'backward' … 開始ハンドルから見てどちら側へ離すか（primary方向）
 *   anchorX/anchorY: ドロップ点が新規ノードのどの面になるか（'left'/'right'、'top'/'bottom'）
 * ドロップ先が本当に空白であること・実際にノードが1個増えたことを併せてアサートするので、
 * 何も作られていないのに PASS することはない
 */
async function assertDropCase({
  direction,
  handleId,
  dropSide,
  expectedSourceHandle,
  expectedTargetHandle,
  anchorX,
  anchorY,
}) {
  // 既定(1280x800)より広いビューポートを使う。初期マップの左端ノードの**さらに左**にも
  // 空白が要る（backward側へ離すケース）ため、狭いと空きが見つからない
  const { browser, page, pageErrors } = await launchPage({ viewport: { width: 1600, height: 950 } });
  const label = `${direction} / ${handleId} から ${dropSide} 側へ`;
  try {
    if (direction === 'DOWN') {
      // 初期マップはRIGHT。方向を切り替えると整列が走るので、落ち着くまで待ってから測る
      await page.locator('select').first().selectOption('DOWN');
      await page.waitForTimeout(600);
    }

    // 初期表示はfitViewでマップが画面いっぱいに広がっており、端のノードの外側に
    // 「ハンドルより十分backward側の空白」が取れない。2段階ズームアウトして余白を作る。
    // ズーム倍率は判定にも位置アサートにも影響しない（どちらも実際の描画結果を見ている）
    for (let i = 0; i < 2; i++) {
      await page.locator('.react-flow__controls-zoomout').click();
      await page.waitForTimeout(250);
    }

    const sourceId = await pickSourceNode(page);
    const nodesBefore = await getNodeIds(page);

    // 開始ハンドルから見て dropSide 側（primary方向）の空白を探す。
    // 画面座標とflow座標は同じ向きなので、画面座標のまま比較してよい
    const from = await handleCenter(page, sourceId, handleId);
    const accept =
      direction === 'RIGHT'
        ? (x) => (dropSide === 'forward' ? x > from.x + DROP_MARGIN : x < from.x - DROP_MARGIN)
        : (_x, y) => (dropSide === 'forward' ? y > from.y + DROP_MARGIN : y < from.y - DROP_MARGIN);
    const drop = await findBlankPoint(page, accept);
    await assertTrue(page, !!drop, `${label}: ノードから十分離れた空白のドロップ先が見つかること（テスト前提）`);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(drop.x, drop.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(700); // ドラフト保存のデバウンス（500ms）ぶん待つ

    const nodesAfter = await getNodeIds(page);
    await assertEqual(
      page,
      nodesAfter.length,
      nodesBefore.length + 1,
      `${label}: 空白へのドラッグで新規ノードが1個作成されること`
    );
    const newNodeId = nodesAfter.find((id) => !nodesBefore.includes(id));

    const edges = await getDraftEdges(page);
    await assertTrue(page, Array.isArray(edges), 'localStorageのドラフトからエッジを読めること（テスト前提）');
    const edge = edges.find((e) => e.target === newNodeId);
    await assertTrue(page, !!edge, `${label}: 新規ノード(${newNodeId})を終点とするエッジが存在すること`);

    await assertEqual(
      page,
      edge.sourceHandle ?? null,
      expectedSourceHandle,
      `${label}: エッジのsourceHandle（掴んだハンドルがそのまま使われること）`
    );
    await assertEqual(
      page,
      edge.targetHandle ?? null,
      expectedTargetHandle,
      `${label}: 新規ノードは ${expectedTargetHandle} ハンドルで受けること`
    );

    // 新規ノードの位置: ドロップ点が新規ノードの anchorX / anchorY 側の面になること。
    // ドロップ点はビューポート内なのでfitViewは走らず、作成直後の位置がそのまま残る。
    // backward側ケースのズレは EMPTY_NODE_WIDTH/HEIGHT（nodeContent.ts）とCustomNodeの実寸のズレでも
    // あるので、CSSを変えて定数を更新し忘れたらここで落ちる
    const box = await page.locator(`.react-flow__node[data-id="${newNodeId}"]`).boundingBox();
    const actualX = anchorX === 'right' ? box.x + box.width : box.x;
    const actualY = anchorY === 'bottom' ? box.y + box.height : box.y;
    await assertTrue(
      page,
      Math.abs(actualX - drop.x) <= POSITION_TOLERANCE,
      `${label}: ドロップ点が新規ノードの${anchorX}端になること（ズレ ${Math.abs(actualX - drop.x).toFixed(1)}px）`
    );
    await assertTrue(
      page,
      Math.abs(actualY - drop.y) <= POSITION_TOLERANCE,
      `${label}: ドロップ点が新規ノードの${anchorY}端になること（ズレ ${Math.abs(actualY - drop.y).toFixed(1)}px）`
    );

    await assertEqual(page, pageErrors.length, 0, 'テスト中にページ内未捕捉例外が発生しないこと: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

export async function run() {
  // --- RIGHT（forward=right / backward=left。primary方向=x）---
  // 3面すべてについて forward 側・backward 側の両方へ離し、**開始ハンドルではなくドロップ方向で
  // 決まる**ことを確認する（開始ハンドルで決めていた頃の規則ならright/bottom起点のbackward側が落ちる）
  await assertDropCase({
    direction: 'RIGHT', handleId: 'right', dropSide: 'forward',
    expectedSourceHandle: 'right', expectedTargetHandle: 'left', anchorX: 'left', anchorY: 'top',
  });
  await assertDropCase({
    direction: 'RIGHT', handleId: 'right', dropSide: 'backward',
    expectedSourceHandle: 'right', expectedTargetHandle: 'right', anchorX: 'right', anchorY: 'top',
  });
  await assertDropCase({
    direction: 'RIGHT', handleId: 'left', dropSide: 'backward',
    expectedSourceHandle: 'left', expectedTargetHandle: 'right', anchorX: 'right', anchorY: 'top',
  });
  await assertDropCase({
    direction: 'RIGHT', handleId: 'left', dropSide: 'forward',
    expectedSourceHandle: 'left', expectedTargetHandle: 'left', anchorX: 'left', anchorY: 'top',
  });
  await assertDropCase({
    direction: 'RIGHT', handleId: 'bottom', dropSide: 'forward',
    expectedSourceHandle: 'bottom', expectedTargetHandle: 'left', anchorX: 'left', anchorY: 'top',
  });
  await assertDropCase({
    direction: 'RIGHT', handleId: 'bottom', dropSide: 'backward',
    expectedSourceHandle: 'bottom', expectedTargetHandle: 'right', anchorX: 'right', anchorY: 'top',
  });

  // --- DOWN（forward=bottom / backward=top。primary方向=y）: 90度回した規則になること ---
  await assertDropCase({
    direction: 'DOWN', handleId: 'top', dropSide: 'backward',
    expectedSourceHandle: 'top', expectedTargetHandle: 'bottom', anchorX: 'left', anchorY: 'bottom',
  });
  await assertDropCase({
    direction: 'DOWN', handleId: 'bottom', dropSide: 'forward',
    expectedSourceHandle: 'bottom', expectedTargetHandle: 'top', anchorX: 'left', anchorY: 'top',
  });
  await assertDropCase({
    direction: 'DOWN', handleId: 'right', dropSide: 'backward',
    expectedSourceHandle: 'right', expectedTargetHandle: 'bottom', anchorX: 'left', anchorY: 'bottom',
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
