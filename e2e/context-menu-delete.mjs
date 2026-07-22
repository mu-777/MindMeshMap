// 右クリックのコンテキストメニューからのノード/エッジ削除を検証する。ノード側は、メニューが
// 対象ノードに重ならずビューポート内に収まって表示されること（anchorRect基準の位置決め。
// docs/decisions.md §47）も合わせて確認する。
// エッジ側は、削除時にuiStoreのselectedEdgeIds（複数選択。旧selectedEdgeIdから移行済み。
// docs/decisions.md参照）をクリアする修正の退行テストを兼ねる:
// 修正前はContextMenuの削除ハンドラがselectedEdgeIds/selectedNodeIdをクリアしないままだったため、
// 削除直後に何もない場所でDeleteキーを押すと「既に存在しないエッジID」に対して
// deleteNodesAndEdges()が呼ばれ、視覚的には何も起きないのにUndo履歴だけが1件余分に積まれていた
// （selectedEdgeIdsにはlastSelectedNodeId相当のフォールバックが無く、選択解除しない限り
// 直接そのIDを握り続けるため、この経路だけ確実に症状が再現する）。
//
// 検証方法についての注記: 「1回のCtrl+Zで元に戻るか」で判定しようとすると、
// mapStore.tsのundo()に別の既知の問題（連続する2アクション後の最初のUndoが
// 1アクション分ではなく2アクション分を巻き戻す。docs/tuning.md参照）が絡み、
// 「余分な履歴が1件積まれている」ケースと「積まれていない」ケースの最終的な
// ノード/エッジ数がたまたま一致してしまい判別できないことを確認済み。
// そのため、ここでは「Undoボタンが無効になるまでに何回押す必要があるか
// （＝実際に積まれた履歴の件数そのもの）」を直接数える方式で検証する。
// この回数はundo()の巻き戻し先の内容に依存せず、1回の押下ごとに必ず1減る
// （historyIndexの値そのもの）ため、上記の別バグの影響を受けない
import {
  launchPage,
  closeBrowser,
  assertTrue,
  assertEqual,
  getNodeIds,
  getEdgePoint,
  runStandalone,
} from './helpers.mjs';

export const name = 'context-menu-delete';

export async function run() {
  await testNodeDeleteViaContextMenu();
  await testEdgeDeleteViaContextMenuClearsSelection();
}

async function openContextMenuAndDelete(page) {
  const deleteButton = page.locator('.fixed.z-50.min-w-\\[120px\\] button');
  await assertTrue(page, (await deleteButton.count()) === 1, 'コンテキストメニューの削除ボタンが1つ表示されること');
  await deleteButton.click();
  await page.waitForTimeout(200);
}

async function testNodeDeleteViaContextMenu() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const nodeIds = await getNodeIds(page);
    // ルートノード（親を持たない唯一のノード）は削除できない仕様のため、それ以外を対象にする
    const targetId = nodeIds[1];
    const target = page.locator(`.react-flow__node[data-id="${targetId}"]`);

    // 先に左クリックで選択(armed)してから右クリックする
    // （右クリック単体は選択状態を変えず、メニューを開くだけの実装のため）
    await target.click();
    await page.waitForTimeout(150);
    const box = await target.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await page.waitForTimeout(200);

    // メニューが対象ノードに重ならない位置に、ビューポート内に収まって表示されること
    // （長押し/右クリックメニューをanchorRect基準に自己サイズ計測して配置する方式の回帰確認。
    // docs/decisions.md §47）
    const menuBox = await page.locator('.fixed.z-50.min-w-\\[120px\\]').boundingBox();
    const viewport = page.viewportSize();
    const overlapsNode =
      menuBox.x < box.x + box.width &&
      menuBox.x + menuBox.width > box.x &&
      menuBox.y < box.y + box.height &&
      menuBox.y + menuBox.height > box.y;
    await assertTrue(page, !overlapsNode, 'コンテキストメニューが対象ノードに重ならない位置に表示されること');
    await assertTrue(
      page,
      menuBox.x >= 0 &&
        menuBox.y >= 0 &&
        menuBox.x + menuBox.width <= viewport.width &&
        menuBox.y + menuBox.height <= viewport.height,
      'コンテキストメニューがビューポート内に収まって表示されること'
    );

    await openContextMenuAndDelete(page);

    const remaining = await getNodeIds(page);
    await assertTrue(page, !remaining.includes(targetId), '右クリックメニューの削除でノードがDOMから消えること');

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

async function testEdgeDeleteViaContextMenuClearsSelection() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const edgeCountBefore = await page.locator('.react-flow__edge').count();
    const point = await getEdgePoint(page, 0, 0.25);

    // バグ再現の前提条件として、先にShift+クリックでエッジをselectedEdgeIdsに選択させておく
    // （新仕様ではShiftなしクリックはラベル編集モードを開くだけで選択状態にはならないため。
    // 未選択のまま右クリック削除しても、selectedEdgeIdsはそもそも空のままなので
    // クリア漏れの有無に差が出ない＝退行テストとして意味をなさない）
    await page.keyboard.down('Shift');
    await page.mouse.click(point.x, point.y);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(150);
    // 右クリックは座標クリックではなくdispatchEventで直接エッジのDOM要素に発火させる。
    // デフォルトマップはノード付近で複数のエッジが密集しており、隣接エッジの当たり判定と
    // 座標が重なって、意図しない別要素に右クリックが奪われることがあったため
    // （座標依存の脆さを回避する）。
    // .edge-click-target はCustomEdge.tsx側の自前インタラクションパス専用のクラス
    // （BaseEdgeの可視パスと区別するため。両方ともpath要素なので単純な`path`セレクタでは
    // DOM順序に依存してしまい脆い）
    const edgeInteractivePath = page.locator(`.react-flow__edge[data-id="${point.edgeId}"] path.edge-click-target`);
    await edgeInteractivePath.dispatchEvent('contextmenu', { clientX: point.x, clientY: point.y, button: 2 });
    await page.waitForTimeout(200);
    await openContextMenuAndDelete(page);

    const edgeCountAfterDelete = await page.locator('.react-flow__edge').count();
    await assertEqual(page, edgeCountAfterDelete, edgeCountBefore - 1, '右クリックメニューの削除でエッジが1本消えること');

    // 退行テスト本体: 削除直後、何もない場所でDeleteキーを押す。
    // 選択がきちんとクリアされていれば何も起きない（対象がないため)。
    // クリアされていなければ、既に消えたエッジIDに対してdeleteEdge()が呼ばれ、
    // 見た目には変化がないままUndo履歴だけが1件余分に積まれる
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);
    const edgeCountAfterStrayDelete = await page.locator('.react-flow__edge').count();
    await assertEqual(
      page,
      edgeCountAfterStrayDelete,
      edgeCountAfterDelete,
      '削除直後の余分なDeleteキー押下で他のエッジが誤って消えないこと'
    );

    // Undoボタンが無効になるまでに必要な押下回数 = 実際に積まれた履歴の件数を数える。
    // このページ読み込み以降ここまでに行った「意味のある」操作は右クリックメニューでの
    // 削除1回だけのはずなので、選択がきちんとクリアされていれば1回で無効になる。
    // クリアされていなければ、上のDeleteキー押下でもう1件余分な履歴が積まれているため2回必要になる
    const undoButton = page.locator('button[title^="Undo"]');
    let undoPresses = 0;
    while (undoPresses < 5 && !(await undoButton.isDisabled())) {
      await undoButton.click();
      await page.waitForTimeout(200);
      undoPresses++;
    }
    await assertEqual(
      page,
      undoPresses,
      1,
      'Undoボタンが無効になるまでに必要な押下回数が1回（=右クリック削除の1操作分のみ）であること' +
        '（selectedEdgeIdのクリア漏れがあると、削除直後のDeleteキー押下が余分な履歴を積み、2回必要になる）'
    );
    const edgeCountAfterUndo = await page.locator('.react-flow__edge').count();
    await assertEqual(page, edgeCountAfterUndo, edgeCountBefore, 'Undoで右クリック削除したエッジが復元されること');

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
