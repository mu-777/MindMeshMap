// モバイルビューポートでの表示・操作を検証する。
// - ツールバーが画面上端(y=0)から可視であること（.app-heightのdvhフォールバック対応の確認）
// - React Flow Controlsがビューポート内に完全に収まること（はみ出さないこと）
// - 1タップ目はノードを選択するだけで、Tiptapエディタにフォーカスが入らない
//   （armed-focus方式はタッチ操作直後は無効化している。誤ってソフトキーボードが開くのを防ぐため。
//   docs/decisions.md参照）
// - 2タップ目で編集モードに入ること（decisions.md §7の「1タップ選択→再タップ編集」）
import {
  launchPage,
  closeBrowser,
  assertTrue,
  assertEqual,
  getNodeIds,
  getActiveElementInfo,
  isNodeEditing,
  isNodeSelected,
  runStandalone,
} from './helpers.mjs';

export const name = 'mobile-viewport';

export async function run() {
  const { browser, page, pageErrors } = await launchPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  try {
    // --- (a) ツールバーがy=0から可視 ---
    const toolbar = page.locator('div.flex.h-12').first();
    const toolbarBox = await toolbar.boundingBox();
    await assertTrue(page, toolbarBox !== null, 'ツールバー要素が見つかること');
    await assertEqual(page, toolbarBox.y, 0, 'ツールバーが画面上端(y=0)から可視であること');

    // --- (b) React Flow Controlsがビューポート内に完全に収まる ---
    const controlsBox = await page.locator('.react-flow__controls').boundingBox();
    const vp = page.viewportSize();
    await assertTrue(page, controlsBox.x >= 0 && controlsBox.y >= 0, 'Controlsが左上にはみ出していないこと');
    await assertTrue(
      page,
      controlsBox.x + controlsBox.width <= vp.width + 0.5 && controlsBox.y + controlsBox.height <= vp.height + 0.5,
      'Controlsが右下にはみ出していないこと: ' + JSON.stringify({ controlsBox, vp })
    );

    // --- (c)(d) 1タップ目は選択のみ（エディタにフォーカスが入らない）、2タップ目で編集モード ---
    const rootId = (await getNodeIds(page))[0];
    const rootNode = page.locator(`.react-flow__node[data-id="${rootId}"]`);
    const box = await rootNode.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.touchscreen.tap(cx, cy);
    await page.waitForTimeout(250);
    const activeAfterTap1 = await getActiveElementInfo(page);
    await assertTrue(
      page,
      !activeAfterTap1.isProseMirror,
      '1タップ目ではTiptapエディタ(.ProseMirror)にフォーカスが入らないこと（armed-focusはタッチ操作直後は無効）'
    );
    await assertTrue(page, await isNodeSelected(page, rootId), '1タップ目でノードが選択状態になること');
    await assertTrue(page, !(await isNodeEditing(page, rootId)), '1タップ目では編集モードに入らないこと');

    await page.touchscreen.tap(cx, cy);
    await page.waitForTimeout(250);
    await assertTrue(page, await isNodeEditing(page, rootId), '2タップ目で編集モードに入ること');

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
