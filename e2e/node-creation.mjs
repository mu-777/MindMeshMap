// ノード作成: ダブルクリック / Tabキー / Enterキーの3経路を検証する。
import {
  launchPage,
  closeBrowser,
  assertTrue,
  assertEqual,
  getNodeIds,
  isNodeEditing,
  isNodeSelected,
  runStandalone,
} from './helpers.mjs';

export const name = 'node-creation';

export async function run() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    // --- (a) キャンバス空白のダブルクリックで独立ノードが作成され、即座に編集モードになる ---
    const before = await getNodeIds(page);
    const pane = page.locator('.react-flow__pane');
    const paneBox = await pane.boundingBox();
    // 既存ノードと重ならない空白部分（ペイン右下寄り）をダブルクリックする
    const blankX = paneBox.x + paneBox.width - 80;
    const blankY = paneBox.y + paneBox.height - 80;
    await page.mouse.dblclick(blankX, blankY);
    await page.waitForTimeout(300);

    const afterDblclick = await getNodeIds(page);
    await assertEqual(page, afterDblclick.length, before.length + 1, 'ダブルクリックでノードが1個作成されること');
    const newNodeId = afterDblclick.find((id) => !before.includes(id));
    await assertTrue(page, await isNodeEditing(page, newNodeId), 'ダブルクリックで作成したノードは即座に編集モードになること');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // --- (b) 既存ノードを選択（armed）した状態でTab → 子ノードが1個作成され、新ノードがarmed ---
    const rootId = before[0];
    await page.locator(`.react-flow__node[data-id="${rootId}"]`).click();
    await page.waitForTimeout(150);
    const beforeTab = await getNodeIds(page);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    const afterTab = await getNodeIds(page);
    await assertEqual(page, afterTab.length, beforeTab.length + 1, 'Tabキーで子ノードが1個作成されること');
    const childNodeId = afterTab.find((id) => !beforeTab.includes(id));
    await assertTrue(page, await isNodeSelected(page, childNodeId), 'Tabキーで作成した子ノードは選択状態(armed)になること');
    await assertTrue(page, !(await isNodeEditing(page, childNodeId)), 'Tabキーで作成した子ノードは編集モードではないこと（armedのみ）');

    // --- (c) 既存ノード（armed）でEnter → 兄弟ノードが1個作成され、新ノードがarmed ---
    // 直前に作成した子ノードは既にarmedなので、そのまま続けてEnterを押す
    const beforeEnter = await getNodeIds(page);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const afterEnter = await getNodeIds(page);
    await assertEqual(page, afterEnter.length, beforeEnter.length + 1, 'Enterキーで兄弟ノードが1個作成されること');
    const siblingNodeId = afterEnter.find((id) => !beforeEnter.includes(id));
    await assertTrue(page, await isNodeSelected(page, siblingNodeId), 'Enterキーで作成した兄弟ノードは選択状態(armed)になること');
    await assertTrue(page, !(await isNodeEditing(page, siblingNodeId)), 'Enterキーで作成した兄弟ノードは編集モードではないこと（armedのみ）');

    await assertEqual(page, pageErrors.length, 0, 'テスト中にページ内未捕捉例外が発生しないこと: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
