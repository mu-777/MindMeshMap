// エッジのクリック操作（ラベル編集input + ✕削除ボタンの一体化）を検証する。
//
// 旧仕様（クリックで選択状態→Deleteキーで削除、ファイル名は edge-selection-delete.mjs）は
// 実利用で「Deleteキーを押してもエッジが消えない」不具合の温床になっていたため撤去した。
// 原因は主に、エッジ中央クリックがラベルチップの編集inputにフォーカスを奪ってしまい、
// Delete/Backspaceキーがテキスト編集（文字削除）として処理されてしまうこと。加えて
// 「パスの端をクリックすると✕なしの編集input、中央（ラベルチップ）をクリックするとselected状態＋
// ✕付きチップ」という見た目・挙動が一貫していなかったことも要因だった。
// 新仕様は「エッジのどこをクリックしても（Shiftなし）ラベル編集input+✕ボタンが常に一体で表示される」
// に統一し、単独クリックでの選択状態（selectedEdgeId的な概念）自体を廃止した
// （複数選択はShift+クリックのselectedEdgeIds。multi-select-delete.mjsを参照）。
// 詳細はdocs/decisions.mdを参照。
import {
  launchPage,
  closeBrowser,
  assertTrue,
  assertEqual,
  getEdgePoint,
  getNodeIds,
  runStandalone,
} from './helpers.mjs';

export const name = 'edge-label-delete';

// ロケール（表示文言）に依存せず判定するため、テキストではなくDOM構造
// （input直後の兄弟がbuttonであること）で「input+✕が一体で表示されているか」を判定する
async function getEdgeEditorState(page) {
  return page.evaluate(() => {
    const input = document.querySelector('input[type="text"]');
    if (!input) return { visible: false, hasDeleteButton: false };
    const container = input.parentElement;
    const button = container ? container.querySelector('button') : null;
    return { visible: true, hasDeleteButton: !!button };
  });
}

export async function run() {
  await testClickNearEndShowsEditorWithDeleteButton();
  await testClickAtCenterShowsEditorWithDeleteButton();
  await testDeleteButtonRemovesEdgeKeepsNodes();
  await testLabelEditConfirmsOnEnter();
}

// (1) エッジのパスの端寄りをクリック → ラベルinputと✕ボタンが両方表示されること
async function testClickNearEndShowsEditorWithDeleteButton() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const point = await getEdgePoint(page, 0, 0.2);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(200);

    const state = await getEdgeEditorState(page);
    await assertTrue(page, state.visible, 'エッジの端寄りをクリックするとラベル編集inputが表示されること');
    await assertTrue(
      page,
      state.hasDeleteButton,
      '端寄りクリックでも✕削除ボタンがinputと一緒に表示されること（旧仕様の✕なしinput分岐が無いこと）'
    );

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

// (2) エッジの中央（ラベルチップ位置）をクリック → 同じくinput+✕が表示されること
async function testClickAtCenterShowsEditorWithDeleteButton() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const point = await getEdgePoint(page, 0, 0.5);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(200);

    const state = await getEdgeEditorState(page);
    await assertTrue(
      page,
      state.visible,
      'エッジの中央（ラベルチップ位置）をクリックするとラベル編集inputが表示されること'
    );
    await assertTrue(page, state.hasDeleteButton, '中央クリックでも✕削除ボタンがinputと一緒に表示されること');

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

// (3) ✕クリックでエッジが消える（ノードは残る）こと
async function testDeleteButtonRemovesEdgeKeepsNodes() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const nodeCountBefore = (await getNodeIds(page)).length;
    const edgeCountBefore = await page.locator('.react-flow__edge').count();
    await assertTrue(page, edgeCountBefore > 0, 'デフォルトマップにエッジが存在すること（前提条件）');

    const point = await getEdgePoint(page, 0, 0.2);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(200);

    // input直後の兄弟button = ✕削除ボタン（ロケール文言に依存しないセレクタ）
    const deleteButton = page.locator('input[type="text"] ~ button');
    await assertEqual(page, await deleteButton.count(), 1, '✕削除ボタンが1つ表示されること（前提）');
    await deleteButton.click();
    await page.waitForTimeout(200);

    const edgeCountAfter = await page.locator('.react-flow__edge').count();
    const nodeCountAfter = (await getNodeIds(page)).length;
    await assertEqual(page, edgeCountAfter, edgeCountBefore - 1, '✕クリックでエッジが1本削除されること');
    await assertEqual(page, nodeCountAfter, nodeCountBefore, 'エッジ削除でノードは削除されないこと');

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

// (4) ラベル入力→Enterで確定、表示されること
async function testLabelEditConfirmsOnEnter() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const point = await getEdgePoint(page, 0, 0.2);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(200);

    const input = page.locator('input[type="text"]');
    await assertEqual(page, await input.count(), 1, 'ラベル編集inputが表示されること（前提）');
    await input.fill('テストラベル');
    await input.press('Enter');
    await page.waitForTimeout(200);

    await assertEqual(page, await page.locator('input[type="text"]').count(), 0, 'Enterで編集モードを抜けinputが消えること');
    await assertEqual(page, await page.getByText('テストラベル', { exact: true }).count(), 1, '入力したラベルが表示されること');

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
