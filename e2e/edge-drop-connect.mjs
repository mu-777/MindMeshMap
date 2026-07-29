// ハンドルからドラッグして既存ノードのハンドルへ接続したとき、エッジだけができて
// 新規ノードは作られないことを検証する。
//
// React Flowは connectionRadius（既定20 flow単位）以内でドロップするとハンドルに
// スナップして接続を成立させる。このときポインタ自体はノードの外＝ペイン上に
// あることがあり、DOMのヒットテスト（elementFromPoint）だけで「空白へのドロップ」を
// 判定していると、エッジ接続と新規ノード作成が同時に起きてしまう
// （MindMapCanvas.tsx onConnectEnd の connectionState.toHandle ガード）。
import {
  launchPage,
  closeBrowser,
  assertTrue,
  assertEqual,
  getNodeIds,
  runStandalone,
} from './helpers.mjs';

export const name = 'edge-drop-connect';

/** 現在のビューポート倍率（.react-flow__viewport の scale）を読む */
async function getZoom(page) {
  return page.locator('.react-flow__viewport').evaluate((el) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return m.a;
  });
}

async function getEdgeCount(page) {
  return page.locator('.react-flow__edge').count();
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
    // --- 準備: 空白をダブルクリックして接続先ノードを1個作る ---
    const pane = page.locator('.react-flow__pane');
    const paneBox = await pane.boundingBox();
    await page.mouse.dblclick(paneBox.x + paneBox.width - 120, paneBox.y + paneBox.height - 100);
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    const nodesBefore = await getNodeIds(page);
    const edgesBefore = await getEdgeCount(page);
    const targetId = nodesBefore[nodesBefore.length - 1];
    const sourceId = nodesBefore[0];

    // --- ハンドルの「わずかに外側」（ノードDOMの外だがスナップ半径の内側）へドロップする ---
    const zoom = await getZoom(page);
    const from = await handleCenter(page, sourceId, 'right');
    const targetHandle = await handleCenter(page, targetId, 'left');
    // ハンドルDOMは12px四方でノード枠をまたいで描かれる（外側に6px * zoom はみ出す）。
    // それより外・connectionRadius(20 flow単位 = 20 * zoom px)より内側を狙う
    const offset = 12 * zoom;
    const drop = { x: targetHandle.x - offset, y: targetHandle.y };

    // このテストの前提（ドロップ点がノードDOMの外＝素朴なヒットテストでは「空白」に見える）を確認する。
    // ここが崩れると「常にPASSするテスト」になってしまうため、明示的にアサートしておく
    const dropTargetInfo = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return {
          isInsideNode: !!el?.closest('.react-flow__node'),
          className: el?.getAttribute('class') ?? null,
        };
      },
      drop
    );
    await assertTrue(
      page,
      !dropTargetInfo.isInsideNode,
      `ドロップ点はノードDOMの外側であること（テスト前提。実際: ${dropTargetInfo.className}）`
    );

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(drop.x, drop.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    // --- 検証: エッジは1本増え、ノードは増えていない ---
    const nodesAfter = await getNodeIds(page);
    const edgesAfter = await getEdgeCount(page);
    await assertEqual(
      page,
      nodesAfter.length,
      nodesBefore.length,
      'ハンドル近傍へのドロップでは新規ノードが作成されないこと'
    );
    await assertEqual(page, edgesAfter, edgesBefore + 1, 'ハンドル近傍へのドロップでエッジが1本だけ作成されること');

    // --- 空白（既存ハンドルから十分離れた場所）へのドロップでは従来どおり新規ノードを作る ---
    const blank = { x: paneBox.x + 80, y: paneBox.y + paneBox.height - 60 };
    const blankHitsPane = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('react-flow__pane') ?? false,
      blank
    );
    await assertTrue(page, blankHitsPane, 'ドロップ先が空のペインであること（テスト前提）');

    const from2 = await handleCenter(page, sourceId, 'bottom');
    await page.mouse.move(from2.x, from2.y);
    await page.mouse.down();
    await page.mouse.move(blank.x, blank.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    const nodesAfterBlank = await getNodeIds(page);
    await assertEqual(
      page,
      nodesAfterBlank.length,
      nodesAfter.length + 1,
      '空白へのドロップでは新規ノードが作成されること（ガードで潰していないこと）'
    );

    await assertEqual(page, pageErrors.length, 0, 'テスト中にページ内未捕捉例外が発生しないこと: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
