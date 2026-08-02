// ハンドルからエッジを引き伸ばしている最中にEscapeを押すと、接続がキャンセルされることを検証する
// （MindMapCanvas.tsx の connectionCancelledRef。decisions.md §55）。
//
// 検証する3つの経路:
//   1. 空白へ向かってドラッグ中のEscape → 接続線が消え、離しても新規ノードもエッジもできない
//   2. 既存ノードのハンドルへスナップした状態でのEscape → エッジもできない（onConnect側のガード）
//   3. キャンセルの直後に普通にドラッグすると従来どおり作成できる（フラグが残らない）
import {
  launchPage,
  closeBrowser,
  assertTrue,
  assertEqual,
  getNodeIds,
  runStandalone,
} from './helpers.mjs';

export const name = 'edge-drag-escape-cancel';

async function getEdgeCount(page) {
  return page.locator('.react-flow__edge').count();
}

/** 接続線（ドラッグ中に描かれる仮のエッジ）が表示されているか */
async function isConnectionLineVisible(page) {
  return page.evaluate(
    () => !!document.querySelector('.react-flow__connection, .react-flow__connectionline')
  );
}

/** ハンドルDOMの中心座標（画面座標） */
async function handleCenter(page, nodeId, handleId) {
  const box = await page
    .locator(`.react-flow__node[data-id="${nodeId}"] .react-flow__handle[data-handleid="${handleId}"]`)
    .boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function run() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    // --- 準備: 空白をダブルクリックして2個目のノードを作る（スナップ先として使う） ---
    const pane = page.locator('.react-flow__pane');
    const paneBox = await pane.boundingBox();
    await page.mouse.dblclick(paneBox.x + paneBox.width - 120, paneBox.y + paneBox.height - 100);
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    const nodesBefore = await getNodeIds(page);
    const edgesBefore = await getEdgeCount(page);
    const sourceId = nodesBefore[0];
    const targetId = nodesBefore[nodesBefore.length - 1];

    // --- 経路1: 空白へ向かってドラッグ中にEscape ---
    const blank = { x: paneBox.x + 80, y: paneBox.y + paneBox.height - 60 };
    const blankHitsPane = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('react-flow__pane') ?? false,
      blank
    );
    await assertTrue(page, blankHitsPane, 'ドロップ先が空のペインであること（テスト前提）');

    const from = await handleCenter(page, sourceId, 'bottom');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(blank.x, blank.y, { steps: 12 });
    await page.waitForTimeout(100);

    // ドラッグが実際に始まっている（接続線が出ている）ことを確認してからEscapeを押す。
    // ここを確認しないと「そもそも接続していなかった」状態でも通る常時PASSテストになる
    await assertTrue(page, await isConnectionLineVisible(page), 'Escape前: 接続線が表示されていること（テスト前提）');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await assertTrue(page, !(await isConnectionLineVisible(page)), 'Escape直後: 接続線が消えていること');

    // Escape後もドラッグを続けて離す（ユーザーの実際の動きに近い）
    await page.mouse.move(blank.x + 20, blank.y - 10, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    await assertEqual(
      page,
      (await getNodeIds(page)).length,
      nodesBefore.length,
      'Escapeでキャンセルしたドラッグでは新規ノードが作成されないこと'
    );
    await assertEqual(page, await getEdgeCount(page), edgesBefore, 'Escapeでキャンセルしたドラッグではエッジも作成されないこと');

    // --- 経路2: 既存ノードのハンドル上でEscape → エッジもできない ---
    const from2 = await handleCenter(page, sourceId, 'right');
    const targetHandle = await handleCenter(page, targetId, 'left');
    await page.mouse.move(from2.x, from2.y);
    await page.mouse.down();
    await page.mouse.move(targetHandle.x, targetHandle.y, { steps: 12 });
    await page.waitForTimeout(100);
    await assertTrue(page, await isConnectionLineVisible(page), 'Escape前（ハンドル上）: 接続線が表示されていること（テスト前提）');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(400);

    await assertEqual(
      page,
      await getEdgeCount(page),
      edgesBefore,
      'ハンドルにスナップした状態でEscapeを押したらエッジが作成されないこと'
    );
    await assertEqual(
      page,
      (await getNodeIds(page)).length,
      nodesBefore.length,
      'ハンドルにスナップした状態でEscapeを押してもノードが増えないこと'
    );

    // --- 経路3: キャンセル直後の通常のドラッグは従来どおり作成できる ---
    const from3 = await handleCenter(page, sourceId, 'bottom');
    await page.mouse.move(from3.x, from3.y);
    await page.mouse.down();
    await page.mouse.move(blank.x, blank.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    await assertEqual(
      page,
      (await getNodeIds(page)).length,
      nodesBefore.length + 1,
      'キャンセルの直後でも、通常のドラッグでは新規ノードが作成されること（キャンセルフラグが残らないこと）'
    );

    await assertEqual(page, pageErrors.length, 0, 'テスト中にページ内未捕捉例外が発生しないこと: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
