// コンテキストメニュー・ファイルメニューの「外側クリックで閉じる」挙動を検証する。
//
// 背景（docs/decisions.md参照）: React Flowのパン/ズーム機能はd3-zoom/d3-dragが
// キャンバス上のmousedownでstopImmediatePropagationを呼ぶため、バブルフェーズの
// documentリスナーでは「キャンバスの空白をクリックした」イベントを検知できない
// （バブルする前にd3側が伝播を止めてしまう）。ContextMenu.tsx / Toolbar.tsxの
// useClickOutsideは、d3の影響を受けないキャプチャフェーズでリスナーを登録することで
// これに対処している。このテストはその回帰確認。
import {
  launchPage,
  closeBrowser,
  assertTrue,
  assertEqual,
  getNodeIds,
  runStandalone,
} from './helpers.mjs';

export const name = 'menu-outside-click';

const CONTEXT_MENU_SELECTOR = '.fixed.z-50.min-w-\\[120px\\]';

export async function run() {
  await testContextMenuClosesOnCanvasClick();
  await testFileMenuClosesOnCanvasClickAndOwnButtonStillWorks();
}

async function testContextMenuClosesOnCanvasClick() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const rootId = (await getNodeIds(page))[0];
    const rootNode = page.locator(`.react-flow__node[data-id="${rootId}"]`);
    const box = await rootNode.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await page.waitForTimeout(200);
    await assertEqual(page, await page.locator(CONTEXT_MENU_SELECTOR).count(), 1, '右クリックでコンテキストメニューが開くこと');

    // キャンバスの空白部分（ノードが無い座標）をクリック
    const pane = page.locator('.react-flow__pane');
    const paneBox = await pane.boundingBox();
    await page.mouse.click(paneBox.x + paneBox.width - 60, paneBox.y + paneBox.height - 60);
    await page.waitForTimeout(200);
    await assertEqual(page, await page.locator(CONTEXT_MENU_SELECTOR).count(), 0, 'キャンバス空白クリックでコンテキストメニューが閉じること');

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

async function testFileMenuClosesOnCanvasClickAndOwnButtonStillWorks() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const fileMenuButton = page.locator('button', { hasText: /^File$/ });
    await assertEqual(page, await fileMenuButton.count(), 1, 'デスクトップ表示でファイルメニューボタンが1つ存在すること');
    await fileMenuButton.click();
    await page.waitForTimeout(150);
    await assertEqual(page, await page.getByText('Export', { exact: true }).count(), 1, 'ファイルメニューが開き、Exportセクションが見えること');

    const pane = page.locator('.react-flow__pane');
    const paneBox = await pane.boundingBox();
    await page.mouse.click(paneBox.x + paneBox.width - 60, paneBox.y + paneBox.height - 60);
    await page.waitForTimeout(150);
    await assertEqual(page, await page.getByText('Export', { exact: true }).count(), 0, 'キャンバス空白クリックでファイルメニューが閉じること');

    // メニュー自身のボタンクリックは「外側クリック」と誤判定されず、引き続き機能することを確認する
    // （キャプチャフェーズ化がメニュー内部のクリックまで巻き込んでいないことの回帰確認）
    await fileMenuButton.click();
    await page.waitForTimeout(150);
    const pngMenuItem = page.getByText('PNG image', { exact: true });
    await assertEqual(page, await pngMenuItem.count(), 1, 'ファイルメニュー内のPNG項目が見えること');

    const downloadPromise = page.waitForEvent('download');
    await pngMenuItem.click();
    const download = await downloadPromise;
    await assertTrue(page, !!download, 'ファイルメニュー内のボタンクリックが引き続き機能し、PNGダウンロードが発生すること');

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
