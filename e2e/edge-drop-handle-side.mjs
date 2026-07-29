// ハンドルからエッジを引き伸ばして空白にドロップして新規ノードを作ったとき、
// 新規ノード側のどのハンドルにエッジが付くか・新規ノードがドロップ点のどちら側にできるかを
// 検証する（MindMapCanvas.tsx onConnectEnd）。
//
// 既定は backward 面（RIGHT: left / DOWN: top）で受け、ドロップ点が新規ノードの backward 面になる。
// **引き伸ばし始めた面が backward だったときだけは forward 面（RIGHT: right / DOWN: bottom）で受け、
// ドロップ点も新規ノードの forward 面になる**（＝ポインタから引き伸ばした向きへノードが伸びる）。
// cross 面（RIGHT: top/bottom）から引き伸ばした場合は既定どおり。
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
 * ペイン内で、どのノードからも clearance px 以上離れた点を探す。
 * レイアウト方向を切り替えるとノードの配置が変わるため、固定座標では空白を狙えない
 */
async function findBlankPoint(page, clearance = 90) {
  const paneBox = await page.locator('.react-flow__pane').boundingBox();
  const boxes = await nodeBoxes(page);
  const step = 30;
  // 下 → 上の順に走査する（新規ノードを作っても既存ノードに重なりにくい下側を優先）
  for (let y = paneBox.y + paneBox.height - 60; y > paneBox.y + 60; y -= step) {
    for (let x = paneBox.x + 60; x < paneBox.x + paneBox.width - 60; x += step) {
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
 *   anchorX: 'left'  … ドロップ点が新規ノードの左端 / 'right'  … 右端
 *   anchorY: 'top'   … ドロップ点が新規ノードの上端 / 'bottom' … 下端
 * ドロップ先が本当に空白であること・実際にノードが1個増えたことを併せてアサートするので、
 * 何も作られていないのに PASS することはない
 */
async function assertDropCase({ direction, handleId, expectedSourceHandle, expectedTargetHandle, anchorX, anchorY }) {
  const { browser, page, pageErrors } = await launchPage();
  const label = `${direction} / ${handleId}`;
  try {
    if (direction === 'DOWN') {
      // 初期マップはRIGHT。方向を切り替えると整列が走るので、落ち着くまで待ってから測る
      await page.locator('select').first().selectOption('DOWN');
      await page.waitForTimeout(600);
    }

    const sourceId = await pickSourceNode(page);
    const nodesBefore = await getNodeIds(page);

    const drop = await findBlankPoint(page);
    await assertTrue(page, !!drop, `ノードから十分離れた空白のドロップ先が見つかること（テスト前提。${label}）`);

    const from = await handleCenter(page, sourceId, handleId);
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
    // backwardケースのズレは EMPTY_NODE_WIDTH/HEIGHT（nodeContent.ts）とCustomNodeの実寸のズレでも
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
  // --- RIGHT（forward=right / backward=left） ---
  // forward面から: 従来どおり新規ノードのbackward面（left）で受け、ドロップ点は左上
  await assertDropCase({
    direction: 'RIGHT',
    handleId: 'right',
    expectedSourceHandle: 'right',
    expectedTargetHandle: 'left',
    anchorX: 'left',
    anchorY: 'top',
  });
  // backward面から: 新規ノードのforward面（right）で受け、ドロップ点も右端になる
  await assertDropCase({
    direction: 'RIGHT',
    handleId: 'left',
    expectedSourceHandle: 'left',
    expectedTargetHandle: 'right',
    anchorX: 'right',
    anchorY: 'top',
  });
  // cross面（top / bottom）から: 既定どおりbackward面（left）で受け、ドロップ点は左上
  await assertDropCase({
    direction: 'RIGHT',
    handleId: 'bottom',
    expectedSourceHandle: 'bottom',
    expectedTargetHandle: 'left',
    anchorX: 'left',
    anchorY: 'top',
  });
  await assertDropCase({
    direction: 'RIGHT',
    handleId: 'top',
    expectedSourceHandle: 'top',
    expectedTargetHandle: 'left',
    anchorX: 'left',
    anchorY: 'top',
  });

  // --- DOWN（forward=bottom / backward=top）: 90度回した規則になること ---
  await assertDropCase({
    direction: 'DOWN',
    handleId: 'top',
    expectedSourceHandle: 'top',
    expectedTargetHandle: 'bottom',
    anchorX: 'left',
    anchorY: 'bottom',
  });
  await assertDropCase({
    direction: 'DOWN',
    handleId: 'bottom',
    expectedSourceHandle: 'bottom',
    expectedTargetHandle: 'top',
    anchorX: 'left',
    anchorY: 'top',
  });
  // DOWNではleft/rightがcross面なので、既定どおりbackward面（top）で受ける
  await assertDropCase({
    direction: 'DOWN',
    handleId: 'right',
    expectedSourceHandle: 'right',
    expectedTargetHandle: 'top',
    anchorX: 'left',
    anchorY: 'top',
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
