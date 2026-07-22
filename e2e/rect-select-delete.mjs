// Shift+ドラッグの矩形選択（React Flow標準機能）で選択したノードが、アプリ独自の選択状態
// （uiStore.selectedNodeIds）に反映され、Deleteキーでまとめて削除できることを検証する
// （docs/decisions.md §45）。
//
// 背景: 本アプリの選択状態はuiStore独自管理で、React Flow内部の選択状態（矩形選択でノードに
// 付く"selected"表示）とは別系統。矩形選択自体はReact Flowの標準機能でこれまでも見た目上は
// ノードがハイライトされていたが、uiStoreへ反映されておらずDelete（uiStore.selectedNodeIdsを
// 参照）が効かなかった（onSelectionChangeでuiStoreへ橋渡しする修正の回帰テスト）。
import {
  launchPage,
  closeBrowser,
  assertTrue,
  assertEqual,
  getNodeIds,
  isNodeSelected,
  runStandalone,
} from './helpers.mjs';

export const name = 'rect-select-delete';

// 表示中の全ノードのDOM矩形を包含する矩形（余白付き）を求める。矩形選択の開始/終了点を
// ハードコードせず実際のノード位置から動的に計算することで、レイアウトの変化に強くする
async function computeEncompassingRect(page) {
  return page.evaluate(() => {
    const rects = Array.from(document.querySelectorAll('.react-flow__node')).map((el) =>
      el.getBoundingClientRect()
    );
    const margin = 40;
    return {
      startX: Math.min(...rects.map((r) => r.left)) - margin,
      startY: Math.min(...rects.map((r) => r.top)) - margin,
      endX: Math.max(...rects.map((r) => r.right)) + margin,
      endY: Math.max(...rects.map((r) => r.bottom)) + margin,
    };
  });
}

export async function run() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const nodeIds = await getNodeIds(page);
    await assertTrue(page, nodeIds.length >= 2, 'デフォルトマップに2個以上のノードがあること（前提条件）');
    // defaultMap.tsのnodes配列順は[root, ...]（他のe2eテストでも前提にしている。
    // root（親を持たないノード）はmapStore側で保護され削除されない）
    const rootId = nodeIds[0];

    const rect = await computeEncompassingRect(page);
    const paneBox = await page.locator('.react-flow__pane').boundingBox();
    // 計算した矩形をペインの表示範囲内にクランプする（fitViewの余白次第でペイン外に
    // はみ出す場合の保険。Controls等のUI要素はペイン左下にあるため、右下寄りの終点は
    // 大きくクランプしすぎないよう最小限のインセットに留める）
    const inset = 5;
    const startX = Math.max(rect.startX, paneBox.x + inset);
    const startY = Math.max(rect.startY, paneBox.y + inset);
    const endX = Math.min(rect.endX, paneBox.x + paneBox.width - inset);
    const endY = Math.min(rect.endY, paneBox.y + paneBox.height - inset);

    // Shift+ドラッグで全ノードを囲む矩形選択を行う
    await page.keyboard.down('Shift');
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 20 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(300);

    // 矩形内の全ノードが選択状態(青枠)になっていること（React Flow標準の見た目）
    for (const id of nodeIds) {
      await assertTrue(page, await isNodeSelected(page, id), `矩形選択でノード${id}が選択状態になること`);
    }

    // Deleteキーで選択した全ノードがまとめて削除されること（uiStore.selectedNodeIdsへの
    // 反映が無いと、この時点でDeleteが無反応=ノード数が変化しないままになる）。
    // ルートノードのみmapStore側の保護ルールで削除されず残る
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    const remaining = await getNodeIds(page);
    await assertEqual(page, remaining.length, 1, 'Deleteで矩形選択したノードがまとめて削除され、保護されたルートノードのみ残ること');
    await assertEqual(page, remaining[0], rootId, '残ったノードがルートノードであること');

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
