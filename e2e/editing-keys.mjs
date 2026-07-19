// 編集中のTab/Enter/Shift+Enterの挙動を検証する。
// - Tab: 編集確定＋子ノード作成、新ノードはarmed（続けてタイプすると新ノードに入る）
// - Enter（非タッチ環境）: 編集確定＋兄弟ノード作成
// - Shift+Enter: 常に改行（ノード数は変わらず、編集は継続）
// - Enter（タッチ環境）: 改行のまま（スマホで改行手段を失わないための意図的な挙動。
//   採用理由はdocs/decisions.md参照）
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
  await testEnterConfirmsAndCreatesSibling();
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

async function testEnterConfirmsAndCreatesSibling() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const rootId = (await getNodeIds(page))[0];
    await page.locator(`.react-flow__node[data-id="${rootId}"]`).dblclick();
    await page.waitForTimeout(200);
    await page.keyboard.type('X');
    await page.waitForTimeout(150);

    const before = await getNodeIds(page);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const after = await getNodeIds(page);

    await assertEqual(page, after.length, before.length + 1, 'Enter（非タッチ）: 兄弟ノードが1個作成されること');
    await assertTrue(page, !(await isNodeEditing(page, rootId)), 'Enter: 元ノードの編集が確定していること');

    const active = await getActiveElementInfo(page);
    await assertTrue(
      page,
      active.isProseMirror && active.nodeDataId && active.nodeDataId !== rootId,
      'Enter: フォーカスが新しい兄弟ノードに移ること（armed）'
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
  // タッチ環境では「編集中にEnterで確定・兄弟ノード作成」を無効化し、常に改行にする。
  // 理由: スマホのソフトキーボードでは物理的な改行入力手段が他にないため、Enterを
  // 兄弟ノード作成に割り当てると改行できなくなってしまう（docs/decisions.md参照）
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
