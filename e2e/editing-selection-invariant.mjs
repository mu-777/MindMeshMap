// 「編集中ノードは常に選択中」の不変条件（docs/decisions.md §27）を検証する。
// この不変条件が壊れると、枠グレー（未選択）＋緑リング（編集中）という操作不能状態
// （クリックしても再フォーカスされず、テキスト編集も選択もできない）が発生する。
// 過去に「ノードAを編集中に、Escape/Enter/Tabで確定せず別ノードBをクリックすると
// Aが緑リングのまま残る」不具合があったため、その回帰テストを恒久化する。
import {
  launchPage,
  closeBrowser,
  assertTrue,
  assertEqual,
  getNodeIds,
  nodeLocator,
  isNodeEditing,
  isNodeSelected,
  runStandalone,
} from './helpers.mjs';

export const name = 'editing-selection-invariant';

export async function run() {
  await testClickingAnotherNodeEndsEditing();
  await testDeselectingEditingNodeEndsEditing();
}

// 2ノードを用意する。rootを編集→Tabで子ノードを作り、rootと子の2ノードにする。
// 戻り値: { rootId, childId }
async function setupTwoNodes(page) {
  const rootId = (await getNodeIds(page))[0];
  await nodeLocator(page, rootId).dblclick();
  await page.waitForTimeout(200);
  await page.keyboard.type('A');
  await page.waitForTimeout(120);

  const before = await getNodeIds(page);
  await page.keyboard.press('Tab'); // 編集確定＋子ノード作成（子はarmed）
  await page.waitForTimeout(300);
  const after = await getNodeIds(page);
  const childId = after.find((id) => !before.includes(id));
  return { rootId, childId };
}

// 編集中に別ノードをクリックすると、元ノードの編集が終了する（緑リングが残らない）
async function testClickingAnotherNodeEndsEditing() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const { rootId, childId } = await setupTwoNodes(page);
    await assertTrue(page, !!childId, '前提: 子ノードが作成されていること');

    // rootを再度ダブルクリックして編集モードに入る
    await nodeLocator(page, rootId).dblclick();
    await page.waitForTimeout(200);
    await assertTrue(page, await isNodeEditing(page, rootId), '前提: rootが編集中（緑リング）であること');
    await assertTrue(page, await isNodeSelected(page, rootId), '前提: rootが選択中（青枠）であること');

    // 確定キーを押さずに別ノード（子）をクリックする
    await nodeLocator(page, childId).click();
    await page.waitForTimeout(200);

    // 不具合再現ポイント: 修正前はrootが「枠グレー＋緑リング」で残っていた
    await assertTrue(page, !(await isNodeEditing(page, rootId)), 'root: 別ノードクリックで編集が終了し緑リングが消えること');
    await assertTrue(page, !(await isNodeSelected(page, rootId)), 'root: 選択も外れていること（青枠が消えること）');
    await assertTrue(page, await isNodeSelected(page, childId), 'child: クリックしたノードが選択状態になること');

    // 「枠グレー＋緑リング」の同時成立が無いこと（不変条件そのもの）を全ノードで確認
    for (const id of [rootId, childId]) {
      const editing = await isNodeEditing(page, id);
      const selected = await isNodeSelected(page, id);
      await assertTrue(page, !(editing && !selected), `不変条件: ノード${id}が「未選択かつ編集中」になっていないこと`);
    }

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

// 編集中ノード自身をShift+クリックで選択解除すると、編集も終了する（緑リングが残らない）
async function testDeselectingEditingNodeEndsEditing() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const rootId = (await getNodeIds(page))[0];
    await nodeLocator(page, rootId).dblclick();
    await page.waitForTimeout(200);
    await page.keyboard.type('A');
    await page.waitForTimeout(120);
    await assertTrue(page, await isNodeEditing(page, rootId), '前提: rootが編集中（緑リング）であること');

    // 編集中ノード自身をShift+クリック → toggleNodeSelectionで選択解除される
    await nodeLocator(page, rootId).click({ modifiers: ['Shift'] });
    await page.waitForTimeout(200);

    // 選択が外れたら編集も終了していること（未選択かつ編集中の状態を作らない）
    if (!(await isNodeSelected(page, rootId))) {
      await assertTrue(page, !(await isNodeEditing(page, rootId)), 'root: 選択解除に伴い編集も終了し緑リングが消えること');
    }

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
