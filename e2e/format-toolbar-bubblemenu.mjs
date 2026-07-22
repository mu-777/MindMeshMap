// 書式パネル（キャンバス右上常設のFormatToolbar）の表示切替と選択範囲への書式適用を検証する
// （docs/decisions.md §40「BubbleMenuを廃止し、書式GUIを右上のFormatToolbarへ一本化」）。
// - 編集中のみFormatToolbarが表示され、編集終了で消えること
// - テキストを選択した状態でFormatToolbarのボタンを押すと、選択範囲に書式が適用されること
//   （BubbleMenu廃止後は、選択範囲への部分的な書式適用もFormatToolbarのみが担う。
//   onMouseDownでpreventDefaultして選択範囲を保持したままchain().focus()するため、
//   選択解除せずに適用できる実装であることの回帰確認）
// - 複数ノードで編集セッションの開始/終了を繰り返しても例外が発生しない
//   （BubbleMenu廃止前は@tiptap/extension-bubble-menuのプラグイン登録/解除を自前で
//   isEditingに応じて切り替えており、素朴な条件付きレンダーだとremoveChild例外で
//   クラッシュしたことがある領域だった。廃止後もこの種のクラッシュが再発しないことの回帰確認）
import {
  launchPage,
  closeBrowser,
  assertTrue,
  assertEqual,
  getNodeIds,
  runStandalone,
} from './helpers.mjs';

export const name = 'format-toolbar-bubblemenu';

export async function run() {
  await testFormatToolbarVisibilityFollowsEditing();
  await testFormatToolbarAppliesToSelection();
  await testRepeatedEditSessionsDoNotCrash();
}

// FormatToolbarはPanel(position="top-right")としてReact Flow上にレンダーされる。
// React Flowはposition="top-right"を空白区切りのクラス"top right"として付与する
const FORMAT_TOOLBAR_SELECTOR = '.react-flow__panel.top.right';

async function testFormatToolbarVisibilityFollowsEditing() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    await assertEqual(
      page,
      await page.locator(FORMAT_TOOLBAR_SELECTOR).count(),
      0,
      '編集前はFormatToolbarが表示されていないこと'
    );

    const rootId = (await getNodeIds(page))[0];
    await page.locator(`.react-flow__node[data-id="${rootId}"]`).dblclick();
    await page.waitForTimeout(200);
    await assertEqual(
      page,
      await page.locator(FORMAT_TOOLBAR_SELECTOR).count(),
      1,
      '編集中はFormatToolbarが表示されること'
    );

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await assertEqual(
      page,
      await page.locator(FORMAT_TOOLBAR_SELECTOR).count(),
      0,
      '編集終了でFormatToolbarが消えること'
    );

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

// BubbleMenu廃止後、テキスト選択範囲への部分的な書式適用はFormatToolbar（右上常設パネル）の
// ボタンのみが担う。ボタンはonMouseDownでpreventDefaultしてから chain().focus() するため、
// 選択範囲を保持したまま選択文字にだけ書式を適用できる実装になっている（docs/decisions.md §6, §40）
async function testFormatToolbarAppliesToSelection() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const rootId = (await getNodeIds(page))[0];
    await page.locator(`.react-flow__node[data-id="${rootId}"]`).dblclick();
    await page.waitForTimeout(200);

    // 全選択する
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);

    // FormatToolbar（キャンバス右上常設パネル）内の太字ボタン
    // (title=editor.bold、実際の表示文言は"Bold (Ctrl+B)")が可視状態で存在することを確認する
    const boldButton = page.locator(`${FORMAT_TOOLBAR_SELECTOR} [title^="Bold"]`);
    await assertTrue(page, (await boldButton.count()) > 0, 'テキスト選択中もFormatToolbar内の太字ボタンが存在すること');
    await assertTrue(page, await boldButton.first().isVisible(), 'FormatToolbarの太字ボタンが可視状態であること');

    // 太字ボタンをクリックして、選択範囲を保持したまま書式が適用されること
    await boldButton.first().click();
    await page.waitForTimeout(150);
    const html = await page.locator(`.react-flow__node[data-id="${rootId}"] .ProseMirror`).innerHTML();
    await assertTrue(
      page,
      html.includes('<strong>'),
      'FormatToolbarの太字ボタンで選択範囲に<strong>が適用されること: ' + html
    );

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

// BubbleMenu廃止前は@tiptap/extension-bubble-menuのプラグイン登録/解除をisEditingに応じて
// 自前で切り替えており、編集セッションを繰り返すとremoveChild例外でクラッシュしたことがある
// 領域だった（docs/decisions.md §17）。廃止後は単純なeditable切り替えのみになったが、
// 回帰確認として引き続きストレステストしておく
async function testRepeatedEditSessionsDoNotCrash() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const nodeIds = await getNodeIds(page);
    for (let round = 0; round < 3; round++) {
      for (const id of nodeIds.slice(0, 4)) {
        const locator = page.locator(`.react-flow__node[data-id="${id}"]`);
        await locator.dblclick();
        await page.waitForTimeout(50);
        await page.keyboard.press('Control+a');
        await page.waitForTimeout(50);
        await page.keyboard.type('x');
        await page.waitForTimeout(50);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(50);
      }
    }

    const remaining = await getNodeIds(page);
    await assertEqual(page, remaining.length, nodeIds.length, '繰り返し編集セッション後もノード数が変わらないこと');
    await assertEqual(
      page,
      pageErrors.length,
      0,
      '編集セッションの開始/終了を繰り返してもページ内未捕捉例外(removeChild等)が発生しないこと: ' +
        pageErrors.join(', ')
    );
  } finally {
    await closeBrowser(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
