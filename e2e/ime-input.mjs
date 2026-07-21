// 日本語IME入力の1文字目が英数字にならないことの回帰テスト。
//
// 過去の不具合: 「マウスでノードを作ってそのままキーボード入力すると1文字目だけ英数字になる」。
// 真因（docs/decisions.md §13）は「新規作成ノードにそのまま打鍵する各経路で、打鍵の前に
// ProseMirrorへDOMフォーカスが当たっていない」こと。原因は経路ごとに異なる:
//  - 経路B（ダブルクリック作成→即編集）: React Flowが新規ノードを寸法計測完了まで
//    visibility:hidden で描画するため作成直後の同期focus()が失敗し、フォーカスがbodyに抜けていた。
//  - 経路C（ハンドルドラッグ作成→即編集）: d3-dragのpointerup後の後始末が非同期でフォーカスを奪う。
//  - 経路A（クリック選択=armed→入力）: armed-focusでフォーカスは当たるが、clearContentがcomposition
//    を壊す潜在リスクがあった（新規ノードを空にしclearContent廃止で解消）。
// いずれも CustomNode の focusWithRetry（作成直後に一定フレーム、奪われたら取り戻すフォーカス監視）で対処。
//
// 各経路は独立したページ（launchPage）で検証する（同一ページで連続実行すると、前の経路で編集中に
// なったノードのフォーカスが次経路に干渉するため）。CDPでは実IMEのcomposition中断は完全再現できないが、
// 真因である「打鍵前にProseMirrorへフォーカスが当たっているか」は忠実に検証できる（実IME最終確認はdocs/testing.md）。
import {
  launchPage,
  closeBrowser,
  assertTrue,
  assertEqual,
  getNodeIds,
  getNodeText,
  getActiveElementInfo,
  typeJapaneseIME,
  runStandalone,
} from './helpers.mjs';

export const name = 'ime-input';

export async function run() {
  await testDoubleClickPath();
  await testHandleDragPath();
  await testArmedClickPath();
}

// 経路B: 空白をダブルクリックで新規ノード作成 → そのままIME入力
async function testDoubleClickPath() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const before = await getNodeIds(page);
    const pane = await page.locator('.react-flow__pane').boundingBox();
    await page.mouse.dblclick(pane.x + 200, pane.y + pane.height - 120);
    await page.waitForTimeout(400);

    const active = await getActiveElementInfo(page);
    await assertTrue(
      page,
      active.isProseMirror,
      '経路B（ダブルクリック作成）: 作成直後にProseMirrorへフォーカスが当たること（bodyに抜けない）'
    );
    await typeJapaneseIME(page, 'aiu', 'あいう');
    await page.waitForTimeout(200);
    const after = await getNodeIds(page);
    const newId = after.find((id) => !before.includes(id));
    await assertEqual(page, (await getNodeText(page, newId)).trim(), 'あいう', '経路B: IME入力が1文字目から正しく入ること');
    await assertEqual(page, pageErrors.length, 0, '未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

// 経路C: ノードのハンドルからエッジを引き伸ばして新規ノード作成 → そのままIME入力
async function testHandleDragPath() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const before = await getNodeIds(page);
    const rootBox = await page.locator(`.react-flow__node[data-id="${before[0]}"]`).boundingBox();
    const hx = rootBox.x + rootBox.width; // 右端 = rightハンドル付近
    const hy = rootBox.y + rootBox.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx + 260, hy + 40, { steps: 20 }); // 既存ノードと重ならない空白へ落とす
    await page.mouse.up();
    await page.waitForTimeout(100);

    // 実機ではドラッグのpointerupがpaneのclick(onPaneClick)を誘発し、作ったばかりのノードの
    // 選択・編集を解除してしまう（新ノードがどこにもフォーカスされない症状）。CDPではこの誘発が
    // 自動では起きないため、明示的にpaneをクリックして同じ状況を作り、justConnectedRefガードが
    // 新ノードの編集状態を守ることを検証する（docs/decisions.md §13）
    await page.mouse.click(hx + 420, hy + 40);
    await page.waitForTimeout(300);

    // まず新規ノードが実際に作成されたことを確認（ドロップ先がノード上だと作成されず、
    // フォーカス検証が「新ノードが無い」だけの理由で落ちて紛らわしくなるのを防ぐ）
    const afterDrag = await getNodeIds(page);
    await assertEqual(page, afterDrag.length, before.length + 1, '経路C: ハンドルドラッグで空白に新規ノードが1個作成されること');

    const active = await getActiveElementInfo(page);
    await assertTrue(
      page,
      active.isProseMirror,
      '経路C（ハンドルドラッグ作成）: pane click(onPaneClick)誘発後もProseMirrorへフォーカスが維持されること（onPaneClickガード＋フォーカス監視）'
    );
    await typeJapaneseIME(page, 'sasi', 'さし');
    await page.waitForTimeout(200);
    const after = await getNodeIds(page);
    const newId = after.find((id) => !before.includes(id));
    await assertEqual(page, (await getNodeText(page, newId)).trim(), 'さし', '経路C: IME入力が1文字目から正しく入ること');
    await assertEqual(page, pageErrors.length, 0, '未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

// 経路A: 既存ノードをクリック選択(armed) → そのままIME入力
async function testArmedClickPath() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const ids = await getNodeIds(page);
    const rootId = ids[0];
    const original = await getNodeText(page, rootId);

    await page.locator(`.react-flow__node[data-id="${rootId}"]`).click();
    await page.waitForTimeout(200);
    const active = await getActiveElementInfo(page);
    await assertTrue(
      page,
      active.isProseMirror && active.nodeDataId === rootId,
      '経路A（クリック選択armed）: クリックだけでProseMirrorへフォーカスが当たること'
    );
    await typeJapaneseIME(page, 'kaki', 'かき');
    await page.waitForTimeout(200);
    // clearContent廃止により既存内容の末尾に追記される（置換ではない。docs/decisions.md §13）
    await assertEqual(
      page,
      (await getNodeText(page, rootId)).trim(),
      (original + 'かき').trim(),
      '経路A: IME入力が1文字目から既存内容の末尾に追記されること'
    );
    await assertEqual(page, pageErrors.length, 0, '未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
