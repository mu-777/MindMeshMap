// 矢印キーによるノード間ナビゲーションを検証する。
// - 選択(armed)状態から矢印キーで隣接ノードへフォーカス(.ProseMirror)が移ること
// - 移動の前後で全ノードのposition(transform)が一切変化しないこと
//   （React Flow標準のキーボードa11y機能=矢印キーでノードそのものが動く機能と、
//   アプリ独自のナビゲーションが二重に効いてノードが動いてしまう不具合の再発防止。
//   disableKeyboardA11yで対処済み。docs/decisions.md参照）
import {
  launchPage,
  closeBrowser,
  assertTrue,
  assertEqual,
  getNodeIds,
  getNodeTransforms,
  getActiveElementInfo,
  runStandalone,
} from './helpers.mjs';

export const name = 'arrow-navigation';

export async function run() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const nodeIds = await getNodeIds(page);
    const rootId = nodeIds[0];

    const beforeAll = await getNodeTransforms(page);

    await page.locator(`.react-flow__node[data-id="${rootId}"]`).click();
    await page.waitForTimeout(200);
    const active1 = await getActiveElementInfo(page);
    await assertTrue(page, active1.isProseMirror && active1.nodeDataId === rootId, 'クリックでarmed(フォーカスがProseMirrorに)なること');

    // ArrowRight = selectNextSibling: 隣接ノードへフォーカスが移ること
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    const active2 = await getActiveElementInfo(page);
    await assertTrue(
      page,
      active2.isProseMirror && active2.nodeDataId !== null && active2.nodeDataId !== rootId,
      'ArrowRight: フォーカスが別ノードの.ProseMirrorに移ること'
    );

    // ArrowUp = selectParent: 親ノードへ戻れること
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(200);
    const active3 = await getActiveElementInfo(page);
    await assertTrue(page, active3.isProseMirror, 'ArrowUp: フォーカスが.ProseMirrorのままであること');

    const afterAll = await getNodeTransforms(page);
    await assertEqual(
      page,
      JSON.stringify(afterAll),
      JSON.stringify(beforeAll),
      '矢印キーナビゲーションの前後で全ノードの位置(transform)が不変であること（disableKeyboardA11yの回帰確認）'
    );

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
