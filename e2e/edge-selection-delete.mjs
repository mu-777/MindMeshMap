// エッジ選択とDelete削除、およびノード選択との排他性を検証する。
import {
  launchPage,
  closeBrowser,
  assertTrue,
  assertEqual,
  getEdgePoint,
  getEdgePointNotTouchingNode,
  runStandalone,
} from './helpers.mjs';

export const name = 'edge-selection-delete';

async function isEdgeSelected(page, edgeId) {
  const cls = await page.locator(`.react-flow__edge[data-id="${edgeId}"]`).getAttribute('class');
  return (cls || '').split(/\s+/).includes('selected');
}

async function isNodeVisuallySelected(page, dataId) {
  return page.evaluate((id) => {
    const el = document.querySelector(`.react-flow__node[data-id="${id}"] > div`);
    return el?.className.includes('border-blue-500') ?? false;
  }, dataId);
}

export async function run() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const edgeCountBefore = await page.locator('.react-flow__edge').count();
    await assertTrue(page, edgeCountBefore > 0, 'デフォルトマップにエッジが存在すること（前提条件）');

    // --- (a) エッジクリックで選択状態になること ---
    const point = await getEdgePoint(page, 0, 0.25);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(200);
    await assertTrue(page, await isEdgeSelected(page, point.edgeId), 'エッジをクリックすると選択状態(selectedクラス)になること');

    // --- (b) Deleteキーで選択中のエッジが削除されること ---
    await page.keyboard.press('Delete');
    await page.waitForTimeout(250);
    const edgeCountAfterDelete = await page.locator('.react-flow__edge').count();
    await assertEqual(page, edgeCountAfterDelete, edgeCountBefore - 1, 'Deleteキーで選択中のエッジが削除されること');

    // --- (c) ノード選択 → 別のエッジ選択で、ノード選択が解除されること（排他） ---
    const firstNode = page.locator('.react-flow__node').first();
    const firstNodeId = await firstNode.getAttribute('data-id');
    await firstNode.click();
    await page.waitForTimeout(150);
    await assertTrue(page, await isNodeVisuallySelected(page, firstNodeId), 'ノードクリックで選択状態になること（前提）');

    // 選択したノードに接続していないエッジを使う（隣接するエッジは経路が短く、
    // クリック座標がノードの当たり判定と重なってしまうことがあるため）
    const point2 = await getEdgePointNotTouchingNode(page, firstNodeId, 0.25);
    await assertTrue(page, point2 !== null, '対象ノードに接続していないエッジが見つかること（前提）');
    await page.mouse.click(point2.x, point2.y);
    await page.waitForTimeout(150);
    await assertTrue(page, !(await isNodeVisuallySelected(page, firstNodeId)), 'エッジ選択でノード選択が解除されること（排他）');
    await assertTrue(page, await isEdgeSelected(page, point2.edgeId), 'エッジが選択状態になっていること');

    // --- (d) エッジ選択 → ノード選択で、エッジ選択が解除されること（逆方向の排他） ---
    await firstNode.click();
    await page.waitForTimeout(150);
    await assertTrue(page, !(await isEdgeSelected(page, point2.edgeId)), 'ノード選択でエッジ選択が解除されること（排他）');
    await assertTrue(page, await isNodeVisuallySelected(page, firstNodeId), 'ノードが選択状態になっていること');

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
