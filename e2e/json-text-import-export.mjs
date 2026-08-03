// JSONテキスト（クリップボード経由）のエクスポート／インポートを検証する。
//
// 検証する範囲:
//   1. エクスポート: ダイアログのテキストエリアに現在のマップのJSONが入り、
//      「Copy to clipboard」でクリップボードに同じ文字列が入ること
//   2. インポート（失敗）: 壊れたJSON・マップでないJSONではエラーが出て、
//      ダイアログが閉じず、キャンバスのマップも変わらないこと
//   3. インポート（成功）: 貼り付けたJSONでマップが置き換わり、ダイアログが閉じること
//   4. ダイアログ表示中はグローバルショートカットが止まっていること
//      （テキストエリアへの入力・Deleteキーでノードが編集モードに入ったり消えたりしない。
//       useKeyboardShortcutsのjsonTextDialogModeガードの回帰確認）
import {
  launchPage,
  closeBrowser,
  assertTrue,
  assertEqual,
  getNodeIds,
  isNodeEditing,
  runStandalone,
} from './helpers.mjs';

export const name = 'json-text-import-export';

// ノードのcontentはアプリが実際に書き出すのと同じTiptapのJSON文字列にする。
// プレーン文字列でも表示自体はできるが、Tiptapがマウント時に正規化して
// updateNodeContent(recordHistory=true)を呼ぶため、ノード数ぶん余計な履歴エントリが積まれ、
// 「1回の追加＝1履歴エントリ」の検証ができなくなる（実際に一度そうなった）
const tiptapDoc = (text) =>
  JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

// インポート用の最小マップ
const IMPORT_MAP = {
  id: 'e2e-imported-map',
  name: 'Imported By E2E',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  layoutDirection: 'RIGHT',
  nodes: [
    { id: 'e2e-n1', content: tiptapDoc('Alpha'), position: { x: 0, y: 0 } },
    { id: 'e2e-n2', content: tiptapDoc('Beta'), position: { x: 240, y: 0 } },
    { id: 'e2e-n3', content: tiptapDoc('Gamma'), position: { x: 240, y: 120 } },
  ],
  edges: [
    { id: 'e2e-e1', source: 'e2e-n1', target: 'e2e-n2' },
    { id: 'e2e-e2', source: 'e2e-n1', target: 'e2e-n3' },
  ],
};

export async function run() {
  await testExportCopiesJsonToClipboard();
  await testExportOnlySelectedNodes();
  await testImportRejectsInvalidJson();
  await testImportAppliesValidJson();
  await testImportAppendsToCurrentMap();
  await testGlobalShortcutsAreSuppressedWhileDialogIsOpen();
}

/** ファイルメニューを開いて、指定のtestidの項目をクリックする */
async function openFileMenuItem(page, testId) {
  await page.locator('button', { hasText: /^File$/ }).click();
  await page.waitForTimeout(150);
  await page.getByTestId(testId).click();
  await page.waitForSelector('[data-testid="json-text-area"]', { timeout: 5000 });
}

async function testExportCopiesJsonToClipboard() {
  // クリップボード読み書きはpermissionを明示的に許可しないとヘッドレスChromiumで拒否される
  const { browser, page, pageErrors } = await launchPage({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  try {
    const nodeIdsBefore = await getNodeIds(page);
    await openFileMenuItem(page, 'menu-export-json-text');

    const textareaValue = await page.getByTestId('json-text-area').inputValue();
    const parsed = JSON.parse(textareaValue);
    await assertEqual(
      page,
      parsed.nodes.map((n) => n.id).sort().join(','),
      [...nodeIdsBefore].sort().join(','),
      'エクスポートされたJSONのノードIDがキャンバス上のノードと一致すること'
    );
    await assertTrue(page, textareaValue.includes('\n  "name"'), 'JSONが整形（インデント付き）されていること');
    await assertEqual(
      page,
      await page.getByTestId('json-text-only-selected').count(),
      0,
      '選択が無いときは「選択したノードのみ」チェックボックスを出さないこと'
    );

    await page.getByTestId('json-text-copy').click();
    await page.waitForTimeout(200);
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    await assertEqual(page, clipboardText, textareaValue, 'クリップボードにテキストエリアと同じJSONが入ること');
    await assertEqual(
      page,
      await page.getByTestId('json-text-copy').innerText(),
      'Copied',
      'コピー成功のフィードバックがボタンに出ること'
    );

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

/**
 * localStorageのドラフト（mindmeshmap-draft）から現在のマップを読む。
 * ドラフトは500msデバウンスで書かれるため、書き込まれるまで待ってから読む
 * （待たないと初回ロード直後は空でflakyになる）
 */
async function readDraftMap(page) {
  await page.waitForFunction(() => !!localStorage.getItem('mindmeshmap-draft'), null, {
    timeout: 5000,
  });
  return page.evaluate(() => JSON.parse(localStorage.getItem('mindmeshmap-draft')).map);
}

/** ノードをCtrl+クリックして複数選択に追加する */
async function ctrlClickNode(page, nodeId) {
  const box = await page.locator(`.react-flow__node[data-id="${nodeId}"]`).boundingBox();
  await page.keyboard.down('Control');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.up('Control');
  await page.waitForTimeout(120);
}

async function testExportOnlySelectedNodes() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    // ドラフトから実際のマップを読み、「親と、その子1つ」を選ぶ。
    // こうすると選択内で閉じたエッジ（親→子）と、選択外へ出るエッジ（親→他の子）の両方が生まれ、
    // 誘導部分グラフの切り出しが効いていることを確認できる
    const map = await readDraftMap(page);
    await assertTrue(page, !!map, 'ドラフトから現在のマップを読めること');
    const seedEdge = map.edges[0];
    const selectedIds = [seedEdge.source, seedEdge.target];
    // 選択外へ出るエッジが実在することを前提としてアサートする（前提が崩れると
    // 「エッジを落とす」検証が素通りしてしまうため）
    const dropped = map.edges.filter(
      (e) => selectedIds.includes(e.source) !== selectedIds.includes(e.target)
    );
    await assertTrue(page, dropped.length > 0, '選択境界をまたぐエッジが存在すること（テストの前提）');
    // 期待する誘導部分グラフをテスト側で独立に計算する（本体のpickSubMapは使わない）
    const expectedEdgeIds = map.edges
      .filter((e) => selectedIds.includes(e.source) && selectedIds.includes(e.target))
      .map((e) => e.id)
      .sort();

    await ctrlClickNode(page, selectedIds[0]);
    await ctrlClickNode(page, selectedIds[1]);

    await openFileMenuItem(page, 'menu-export-json-text');
    const checkbox = page.getByTestId('json-text-only-selected');
    await assertEqual(page, await checkbox.count(), 1, '複数選択中はチェックボックスが表示されること');

    // 既定はOFF＝複数選択中でもマップ全体がエクスポートされる
    await assertEqual(page, await checkbox.isChecked(), false, 'チェックボックスが既定でOFFであること');
    const full = JSON.parse(await page.getByTestId('json-text-area').inputValue());
    await assertEqual(
      page,
      full.nodes.length,
      map.nodes.length,
      '既定（OFF）では選択中でもマップ全体がエクスポートされること'
    );

    // ONにすると即座に選択部分だけへ切り替わる
    await checkbox.check();
    await page.waitForTimeout(150);
    const partial = JSON.parse(await page.getByTestId('json-text-area').inputValue());
    await assertEqual(
      page,
      partial.nodes.map((n) => n.id).sort().join(','),
      [...selectedIds].sort().join(','),
      'ONのとき選択したノードだけがエクスポートされること'
    );
    await assertEqual(
      page,
      partial.edges.map((e) => e.id).sort().join(','),
      expectedEdgeIds.join(','),
      'ONのとき両端が選択内にあるエッジだけが残ること（選択境界をまたぐエッジは落ちる）'
    );

    // 部分エクスポートしたJSONがそのままインポートできること（参照切れエッジを作っていない証明）。
    // ここが崩れると「自分が出したJSONを自分で読めない」という最悪の不整合になる
    const partialText = await page.getByTestId('json-text-area').inputValue();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await openFileMenuItem(page, 'menu-import-json-text');
    await page.getByTestId('json-text-area').fill(partialText);
    await page.getByTestId('json-text-load').click();
    await page.waitForTimeout(400);
    await assertEqual(
      page,
      await page.getByTestId('json-text-area').count(),
      0,
      '部分エクスポートしたJSONがバリデーションを通ってインポートできること'
    );
    await assertEqual(
      page,
      (await getNodeIds(page)).sort().join(','),
      [...selectedIds].sort().join(','),
      'インポート後のキャンバスが選択していた2ノードだけになること'
    );

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

async function testImportRejectsInvalidJson() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const nodeIdsBefore = await getNodeIds(page);
    await openFileMenuItem(page, 'menu-import-json-text');
    const textarea = page.getByTestId('json-text-area');

    // (a) 空のまま読み込む
    await page.getByTestId('json-text-load').click();
    await page.waitForTimeout(150);
    await assertEqual(
      page,
      await page.getByTestId('json-text-error').innerText(),
      'The JSON text is empty',
      '空入力では「空です」のエラーが出ること'
    );

    // (b) JSONとして壊れている
    await textarea.fill('{ "name": ');
    await page.getByTestId('json-text-load').click();
    await page.waitForTimeout(150);
    await assertEqual(
      page,
      await page.getByTestId('json-text-error').innerText(),
      'Not valid JSON (syntax error)',
      '構文エラーのJSONでは構文エラーのメッセージが出ること'
    );

    // (c) JSONとしては正しいがマップの形ではない
    await textarea.fill('{ "hello": "world" }');
    await page.getByTestId('json-text-load').click();
    await page.waitForTimeout(150);
    await assertEqual(
      page,
      await page.getByTestId('json-text-error').innerText(),
      'Not a valid map (check name / nodes / edges)',
      'マップの形でないJSONでは形式エラーのメッセージが出ること'
    );

    // (d) 存在しないノードを参照するエッジ
    await textarea.fill(
      JSON.stringify({ ...IMPORT_MAP, edges: [{ id: 'bad', source: 'e2e-n1', target: 'missing' }] })
    );
    await page.getByTestId('json-text-load').click();
    await page.waitForTimeout(150);
    await assertEqual(
      page,
      await page.getByTestId('json-text-error').innerText(),
      'Some edges refer to nodes that do not exist',
      '参照切れエッジでは専用のメッセージが出ること'
    );

    // 失敗時はダイアログを閉じない（入力を捨てない）・マップも変わらない
    await assertEqual(page, await textarea.count(), 1, 'バリデーション失敗時はダイアログが開いたままであること');
    await assertEqual(
      page,
      (await getNodeIds(page)).join(','),
      nodeIdsBefore.join(','),
      'バリデーション失敗時はキャンバスのマップが変わらないこと'
    );

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

async function testImportAppliesValidJson() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    await openFileMenuItem(page, 'menu-import-json-text');
    await page.getByTestId('json-text-area').fill(JSON.stringify(IMPORT_MAP, null, 2));
    await page.getByTestId('json-text-load').click();
    await page.waitForTimeout(400);

    await assertEqual(
      page,
      await page.getByTestId('json-text-area').count(),
      0,
      'インポート成功でダイアログが閉じること'
    );
    await assertEqual(
      page,
      (await getNodeIds(page)).sort().join(','),
      ['e2e-n1', 'e2e-n2', 'e2e-n3'].join(','),
      'インポートしたJSONのノードがキャンバスに反映されること'
    );
    await assertEqual(
      page,
      await page.locator('.react-flow__edge').count(),
      2,
      'インポートしたJSONのエッジがキャンバスに反映されること'
    );
    await assertEqual(
      page,
      await page.locator('button', { hasText: 'Imported By E2E' }).count(),
      1,
      'インポートしたマップ名がツールバーのタイトルに反映されること'
    );

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

async function testImportAppendsToCurrentMap() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const before = await getNodeIds(page);
    const importText = JSON.stringify(IMPORT_MAP, null, 2);

    await openFileMenuItem(page, 'menu-import-json-text');
    // 既定は置き換え。「今のマップに追加」を明示的に選ぶ
    await assertEqual(
      page,
      await page.getByTestId('json-text-target-replace').isChecked(),
      true,
      'インポート先の既定が「置き換え」であること'
    );
    await page.getByTestId('json-text-target-append').check();
    await page.getByTestId('json-text-area').fill(importText);
    await page.getByTestId('json-text-load').click();
    await page.waitForTimeout(500);

    const after = await getNodeIds(page);
    await assertEqual(
      page,
      after.length,
      before.length + IMPORT_MAP.nodes.length,
      '既存ノードを残したままインポート分が追加されること'
    );
    await assertTrue(
      page,
      before.every((id) => after.includes(id)),
      '既存ノードが1つも消えていないこと'
    );
    // IDは振り直されるので、JSON中のIDがそのまま残っていてはいけない
    // （同じJSONを2回追加したときにID衝突・マージが起きないことの担保）
    await assertTrue(
      page,
      IMPORT_MAP.nodes.every((n) => !after.includes(n.id)),
      'インポート分のノードIDが新しいIDに振り直されていること'
    );

    // 追加分は選択状態になる（重なっていてもそのままドラッグ・整列で動かせるように）
    const selectedCount = await page.locator('.react-flow__node .border-blue-500').count();
    await assertEqual(
      page,
      selectedCount,
      IMPORT_MAP.nodes.length,
      '追加したノードだけが選択状態になること'
    );

    // Undo 1回で追加分がまとめて取り消せること（履歴を1エントリしか積んでいないことの検証）。
    // 「連続2アクション直後の最初のUndoが2ステップ戻る」という既知の不具合
    // （tuning.md「既知の未対応事項」）を踏まえ、**追加1回の直後**に確認する。
    // 追加直後は新ノードがarmedでProseMirrorにフォーカスがあるため、
    // キャンバス空白をクリックしてフォーカスを外してからCtrl+Zを送る
    const pane = await page.locator('.react-flow__pane').boundingBox();
    await page.mouse.click(pane.x + pane.width - 40, pane.y + pane.height - 40);
    await page.waitForTimeout(150);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    await assertEqual(
      page,
      (await getNodeIds(page)).sort().join(','),
      [...before].sort().join(','),
      'Undo 1回で追加分がまとめて取り消せること（1回の追加＝1履歴エントリ）'
    );

    // 同じJSONを2回続けて追加すると、マージされず独立した2つのツリーになる
    const edgesBefore = await page.locator('.react-flow__edge').count();
    for (let i = 0; i < 2; i++) {
      await openFileMenuItem(page, 'menu-import-json-text');
      await page.getByTestId('json-text-target-append').check();
      await page.getByTestId('json-text-area').fill(importText);
      await page.getByTestId('json-text-load').click();
      await page.waitForTimeout(500);
    }
    await assertEqual(
      page,
      (await getNodeIds(page)).length,
      before.length + IMPORT_MAP.nodes.length * 2,
      '同じJSONを2回追加するとマージされず2つ分のノードが増えること'
    );
    await assertEqual(
      page,
      await page.locator('.react-flow__edge').count(),
      edgesBefore + IMPORT_MAP.edges.length * 2,
      'エッジも2回分追加されていること（新IDへ張り替えられている）'
    );

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

async function testGlobalShortcutsAreSuppressedWhileDialogIsOpen() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const nodeIdsBefore = await getNodeIds(page);
    const rootId = nodeIdsBefore[0];

    // ノードを選択した状態でダイアログを開く（グローバルショートカットの発火条件を作る）
    const rootNode = page.locator(`.react-flow__node[data-id="${rootId}"]`);
    const box = await rootNode.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(150);

    await openFileMenuItem(page, 'menu-import-json-text');
    const textarea = page.getByTestId('json-text-area');
    await textarea.click();

    // 印刷可能文字: ガードがないと「選択中ノードの編集を開始」が発火する
    await page.keyboard.type('{"name');
    // Delete/Backspace: ガードがないと選択中ノードが削除される
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);

    await assertEqual(page, await textarea.inputValue(), '{"nam', 'タイプした文字がテキストエリアに入ること');
    await assertEqual(
      page,
      await isNodeEditing(page, rootId),
      false,
      'ダイアログ表示中の入力でノードが編集モードに入らないこと'
    );
    await assertEqual(
      page,
      (await getNodeIds(page)).join(','),
      nodeIdsBefore.join(','),
      'ダイアログ表示中のDelete/Backspaceでノードが削除されないこと'
    );

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
