// 書式パネル（キャンバス右上常設のFormatToolbar）とBubbleMenu（テキスト選択時のポップアップ）の
// 表示切替を検証する（docs/decisions.md §6, §17）。
// - 編集中のみFormatToolbarが表示され、編集終了で消えること
// - テキスト選択中はBubbleMenuが表示され、太字ボタンで装飾できること
// - 複数ノードで編集セッションの開始/終了を繰り返しても例外が発生しない
//   （@tiptap/extension-bubble-menuのプラグイン登録/解除を自前でisEditingに応じて
//   切り替えている実装のストレス確認。過去に素朴な条件付きレンダーで
//   removeChild例外によるクラッシュが起きたことがある領域）
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
  await testBubbleMenuAppearsOnTextSelection();
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

async function testBubbleMenuAppearsOnTextSelection() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const rootId = (await getNodeIds(page))[0];
    await page.locator(`.react-flow__node[data-id="${rootId}"]`).dblclick();
    await page.waitForTimeout(200);

    // 全選択してBubbleMenuを表示させる
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);

    // BubbleMenuの中身はCustomNode内に常時マウントされたdiv要素で、表示時のみ
    // isEditing用クラス(nodrag flex ...)が付き、tippy.jsがポップアップとして画面上に配置する。
    // 太字ボタン(title=editor.bold、実際の表示文言は"Bold (Ctrl+B)")が可視状態で存在することで判定する
    const boldButton = page.locator(`.react-flow__node[data-id="${rootId}"] [title^="Bold"]`);
    await assertTrue(page, (await boldButton.count()) > 0, 'テキスト選択中はBubbleMenu内の太字ボタンが存在すること');
    await assertTrue(page, await boldButton.first().isVisible(), 'BubbleMenuの太字ボタンが可視状態であること');

    // 太字ボタンをクリックして書式が適用されること
    await boldButton.first().click();
    await page.waitForTimeout(150);
    const html = await page.locator(`.react-flow__node[data-id="${rootId}"] .ProseMirror`).innerHTML();
    await assertTrue(page, html.includes('<strong>'), 'BubbleMenuの太字ボタンで<strong>が適用されること: ' + html);

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

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
      'BubbleMenuプラグインの登録/解除を繰り返してもページ内未捕捉例外(removeChild等)が発生しないこと: ' +
        pageErrors.join(', ')
    );
  } finally {
    await closeBrowser(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
