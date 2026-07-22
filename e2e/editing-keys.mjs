// 編集中のTab/Enter/Shift+Enterの挙動を検証する。
// - Tab: 編集確定＋子ノード作成、新ノードはarmed（続けてタイプすると新ノードに入る）
// - Enter（非タッチ環境）: 改行（Tiptapに委ねる。ノード数は変わらず編集は継続）。
//   弟ノード作成は、Escape/Tab等で編集を終えたarmed状態でEnterを押すと発火する
//   （useKeyboardShortcuts側のcreateSiblingNode）。挙動は「確定+弟作成」→「確定のみ」→
//   「改行」と変遷した。経緯はdocs/decisions.md §20「改訂」参照
// - Shift+Enter: 改行（ノード数は変わらず、編集は継続）
// - Enter（タッチ環境）: 改行（非タッチと同じ。スマホで改行手段を失わないためにも重要）
import {
  launchPage,
  closeBrowser,
  assertTrue,
  assertEqual,
  getNodeIds,
  getNodeText,
  getActiveElementInfo,
  isNodeEditing,
  isNodeSelected,
  runStandalone,
} from './helpers.mjs';

export const name = 'editing-keys';

export async function run() {
  await testTabConfirmsAndCreatesChild();
  await testEnterInsertsNewlineThenSiblingFromArmed();
  await testShiftEnterInsertsNewline();
  await testTouchEnterInsertsNewlineInstead();
}

async function testTabConfirmsAndCreatesChild() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const rootId = (await getNodeIds(page))[0];
    await page.locator(`.react-flow__node[data-id="${rootId}"]`).dblclick();
    await page.waitForTimeout(200);
    await page.keyboard.type('parent-node');
    await page.waitForTimeout(150);

    const before = await getNodeIds(page);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    const after = await getNodeIds(page);

    await assertEqual(page, after.length, before.length + 1, 'Tab: 子ノードが1個作成されること');
    await assertTrue(page, !(await isNodeEditing(page, rootId)), 'Tab: 元ノードの編集が確定していること');

    const active = await getActiveElementInfo(page);
    const newNodeId = active.nodeDataId;
    await assertTrue(page, active.isProseMirror && newNodeId && newNodeId !== rootId, 'Tab: フォーカスが新しい子ノードに移ること');
    await assertTrue(page, await isNodeSelected(page, newNodeId), 'Tab: 新しい子ノードが選択状態(armed)であること');
    await assertTrue(page, !(await isNodeEditing(page, newNodeId)), 'Tab: 新しい子ノードは編集モードではない（armedのみ）こと');

    // armedの新ノードに続けてタイプできることを確認
    await page.keyboard.type('child');
    await page.waitForTimeout(200);
    const newNodeText = await getNodeText(page, newNodeId);
    await assertEqual(page, newNodeText.trim(), 'child', 'Tab: armedになった新ノードにそのままタイプできること');

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

async function testEnterInsertsNewlineThenSiblingFromArmed() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const rootId = (await getNodeIds(page))[0];
    await page.locator(`.react-flow__node[data-id="${rootId}"]`).dblclick();
    await page.waitForTimeout(200);
    await page.keyboard.type('line1');
    await page.waitForTimeout(120);

    // 編集中のEnter（非タッチ）: 改行。ノードは増えず、編集は継続する
    const before = await getNodeIds(page);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(120);
    await page.keyboard.type('line2');
    await page.waitForTimeout(150);
    const afterEnter = await getNodeIds(page);

    await assertEqual(page, afterEnter.length, before.length, 'Enter（非タッチ）: 改行でノードは増えないこと');
    await assertTrue(page, await isNodeEditing(page, rootId), 'Enter（非タッチ）: 編集モードが継続していること');
    const html = await page.locator(`.react-flow__node[data-id="${rootId}"] .ProseMirror`).innerHTML();
    await assertTrue(
      page,
      (html.match(/<p/g) || []).length >= 2 || html.includes('<br'),
      'Enter（非タッチ）: 改行（段落分割またはbr）が入っていること: ' + html
    );

    // Escapeで編集終了（armedへ）。続けてEnterを押すと弟ノードが作成される（2ステップに分離）
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await assertTrue(page, !(await isNodeEditing(page, rootId)), 'Escape後: 元ノードの編集が終了していること');
    await assertTrue(page, await isNodeSelected(page, rootId), 'Escape後: 元ノードがarmed（選択状態）であること');

    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const afterSibling = await getNodeIds(page);

    await assertEqual(
      page,
      afterSibling.length,
      before.length + 1,
      'armed状態のEnter: 兄弟ノードが1個作成されること'
    );

    const active = await getActiveElementInfo(page);
    await assertTrue(
      page,
      active.isProseMirror && active.nodeDataId && active.nodeDataId !== rootId,
      'armed状態のEnter: フォーカスが新しい兄弟ノードに移ること（armed）'
    );

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

async function testShiftEnterInsertsNewline() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const rootId = (await getNodeIds(page))[0];
    await page.locator(`.react-flow__node[data-id="${rootId}"]`).dblclick();
    await page.waitForTimeout(200);
    await page.keyboard.type('line1');
    await page.waitForTimeout(120);

    const before = await getNodeIds(page);
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(120);
    await page.keyboard.type('line2');
    await page.waitForTimeout(150);
    const after = await getNodeIds(page);

    await assertEqual(page, after.length, before.length, 'Shift+Enter: ノード数が変化しないこと（新ノードを作らない）');
    await assertTrue(page, await isNodeEditing(page, rootId), 'Shift+Enter: 編集モードが継続していること');

    const html = await page.locator(`.react-flow__node[data-id="${rootId}"] .ProseMirror`).innerHTML();
    await assertTrue(
      page,
      (html.match(/<p/g) || []).length >= 2 || html.includes('<br'),
      'Shift+Enter: 改行（段落分割またはbr）が入っていること: ' + html
    );

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

async function testTouchEnterInsertsNewlineInstead() {
  // 編集中のEnterは（非タッチ・タッチとも）改行。特にタッチ環境ではソフトキーボードに
  // 物理的な改行入力手段が他に無いため、Enterで改行できることが重要（docs/decisions.md参照）
  const { browser, page, pageErrors } = await launchPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const rootId = (await getNodeIds(page))[0];
    const rootNode = page.locator(`.react-flow__node[data-id="${rootId}"]`);
    const box = await rootNode.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // 2タップ編集フロー（1タップ目=選択、2タップ目=編集）
    await page.touchscreen.tap(cx, cy);
    await page.waitForTimeout(200);
    await page.touchscreen.tap(cx, cy);
    await page.waitForTimeout(200);
    await assertTrue(page, await isNodeEditing(page, rootId), 'タッチ2タップ目で編集モードに入ること');

    await page.keyboard.type('tap-edit');
    await page.waitForTimeout(150);

    const before = await getNodeIds(page);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const after = await getNodeIds(page);

    await assertEqual(page, after.length, before.length, 'タッチ環境ではEnterでノードが増えない（改行のまま）こと');
    await assertTrue(page, await isNodeEditing(page, rootId), 'タッチ環境のEnter後も編集モードが継続していること');

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
