// armed-focus方式の中核検証:
// - ノードをクリックしただけ（ダブルクリックなし）でTiptapエディタにフォーカスが移ること（armed）
// - armedにするだけではノード位置(transform)が変化しないこと
// - armed状態からそのままタイプ開始すると、既存内容の末尾に追記されること
//   （以前は「置換」だったが、compositionを壊すclearContentを廃止したため追記になった。docs/decisions.md §13）
// - Escape + 1回のCtrl+Zで元の内容に戻ること
// （矢印キーでの選択移動・フォーカス追従はe2e/arrow-navigation.mjsで検証する）
//
// 経緯（docs/decisions.md参照）: 過去に「keydownハンドラ内でflushSyncによりフォーカスを移す」
// 方式を試したが、IMEは打鍵イベント発生時点でのフォーカス先を見てcomposition開始を判断するため
// 間に合わず失敗した。armed-focus方式は「打鍵の前から」フォーカスを当てておくことで解決している。
// 実IMEでの1文字目変換確認はCDPで完全再現できないため対象外（docs/testing.mdの手動確認項目参照）。
import {
  launchPage,
  closeBrowser,
  assertTrue,
  assertEqual,
  getNodeIds,
  getNodeText,
  getNodeTransforms,
  getActiveElementInfo,
  isNodeEditing,
  runStandalone,
} from './helpers.mjs';

export const name = 'armed-focus-typing';

export async function run() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const nodeIds = await getNodeIds(page);
    const rootId = nodeIds[0];
    const originalText = await getNodeText(page, rootId);

    const beforeTransforms = await getNodeTransforms(page);

    // クリックのみ（ダブルクリックしない）でarmedになること
    await page.locator(`.react-flow__node[data-id="${rootId}"]`).click();
    await page.waitForTimeout(200);
    const activeAfterClick = await getActiveElementInfo(page);
    await assertTrue(
      page,
      activeAfterClick.isProseMirror && activeAfterClick.nodeDataId === rootId,
      'クリックのみでフォーカスがクリックしたノードの.ProseMirrorに移ること（armed-focus）'
    );
    await assertTrue(page, !(await isNodeEditing(page, rootId)), 'armed状態はまだ編集モード（緑リング）ではないこと');

    // armedにしただけではノード位置は動かない
    const afterArmedTransforms = await getNodeTransforms(page);
    await assertEqual(
      page,
      JSON.stringify(afterArmedTransforms),
      JSON.stringify(beforeTransforms),
      'armedにするだけでは全ノードの位置(transform)が変化しないこと'
    );

    // armedから続けてタイプ → 編集モードに入り、既存内容の末尾に追記される
    await page.keyboard.type('abc');
    await page.waitForTimeout(200);
    const textAfterType = await getNodeText(page, rootId);
    await assertEqual(page, textAfterType.trim(), (originalText + 'abc').trim(), 'armedからのタイプ開始で既存内容の末尾に追記されること');
    await assertTrue(page, await isNodeEditing(page, rootId), 'タイプ開始後は編集モードになっていること');

    // Escapeで編集終了 → 1回のCtrl+Zで元の内容に戻る
    // （decisions.md「Undoはテキスト編集1セッション=1ステップ」の確認を兼ねる）
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const textAfterUndo = await getNodeText(page, rootId);
    await assertEqual(page, textAfterUndo.trim(), originalText.trim(), '1回のCtrl+Zで追記前の内容に戻ること');

    await assertEqual(page, pageErrors.length, 0, 'テスト中にページ内未捕捉例外が発生しないこと: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
