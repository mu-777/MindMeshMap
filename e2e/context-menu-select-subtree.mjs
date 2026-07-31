// 右クリック（PC）/長押し（モバイル）のコンテキストメニューにある「サブツリーを選択」を検証する。
//
// 期待仕様:
//   - ノードのメニューにのみ「サブツリーを選択」が出る（エッジのメニューには出ない）
//   - 押すと「対象ノード自身＋そこから子方向にたどれる全ノード（子孫）」だけが選択される。
//     DAG（複数の親を持つノード）でも、対象から到達できるノードはすべて含む
//   - 選択は見た目だけでなくuiStoreの選択状態として成立している（＝続けてDeleteキーを押すと
//     そのサブツリーだけがまとめて消える）
//
// 期待値の作り方についての注記: ノードのテキストで対象を決めると i18n の言語検出
// （Playwrightの既定ロケール）に依存して脆くなるため、React Flow がエッジに自動付与する
// aria-label（"Edge from {source} to {target}"）からグラフ構造をテスト側で組み直し、
// 「子孫が2つ以上あり、かつ非子孫も残るノード」を自動で選んで対象にする。
// 子孫集合の計算は本体（utils/graphTraversal.ts の getDescendantIds）とは独立に
// ここで書き下している（本体の実装をそのまま使うと同じバグを共有して検出できないため）
import {
  launchPage,
  closeBrowser,
  assertTrue,
  assertEqual,
  getNodeIds,
  nodeLocator,
  isNodeSelected,
  getEdgePoint,
  runStandalone,
} from './helpers.mjs';

export const name = 'context-menu-select-subtree';

const MENU_SELECTOR = '.fixed.z-50.min-w-\\[120px\\]';
// 削除だけが赤字（text-red-400）なので、それ以外のボタン＝サブツリー選択
const SUBTREE_BUTTON_SELECTOR = `${MENU_SELECTOR} button:not(.text-red-400)`;

export async function run() {
  await testSelectSubtreeFromNodeMenu();
  await testEdgeMenuHasNoSubtreeItem();
}

/** エッジのaria-labelから [source, target] の配列を組み立てる */
async function getEdgePairs(page) {
  return page.locator('.react-flow__edge').evaluateAll((els) =>
    els
      .map((el) => /^Edge from (\S+) to (\S+)$/.exec(el.getAttribute('aria-label') || ''))
      .filter(Boolean)
      .map((m) => [m[1], m[2]])
  );
}

/** nodeId から子方向にたどれるノードID集合（自身は含まない）。循環があっても止まる */
function descendantsOf(nodeId, edgePairs) {
  const result = new Set();
  const stack = [nodeId];
  while (stack.length > 0) {
    const cur = stack.pop();
    for (const [source, target] of edgePairs) {
      if (source === cur && target !== nodeId && !result.has(target)) {
        result.add(target);
        stack.push(target);
      }
    }
  }
  return result;
}

/** 対象ノードを右クリックしてコンテキストメニューを開く */
async function openNodeContextMenu(page, nodeId) {
  const target = nodeLocator(page, nodeId);
  // 先に左クリックで選択してから右クリックする
  // （右クリック単体は選択状態を変えず、メニューを開くだけの実装のため）
  await target.click();
  await page.waitForTimeout(150);
  const box = await target.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await page.waitForTimeout(200);
}

async function testSelectSubtreeFromNodeMenu() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const nodeIds = await getNodeIds(page);
    const edgePairs = await getEdgePairs(page);
    await assertTrue(page, edgePairs.length > 0, 'エッジのaria-labelからグラフ構造を取得できること');

    // 子孫が2つ以上あり、かつ選択されないノード（非子孫）も残る対象を選ぶ。
    // 「全部選択された」でも通ってしまう甘い検証にならないようにするため
    const targetId = nodeIds.find((id) => {
      const descendants = descendantsOf(id, edgePairs);
      return descendants.size >= 2 && descendants.size + 1 < nodeIds.length;
    });
    await assertTrue(page, !!targetId, '子孫が2つ以上あり非子孫も残るノードがデフォルトマップに存在すること');

    const expectedSelected = new Set([targetId, ...descendantsOf(targetId, edgePairs)]);
    const expectedUnselected = nodeIds.filter((id) => !expectedSelected.has(id));

    await openNodeContextMenu(page, targetId);

    const subtreeButton = page.locator(SUBTREE_BUTTON_SELECTOR);
    await assertEqual(page, await subtreeButton.count(), 1, 'ノードのメニューに「サブツリーを選択」が1つ表示されること');
    await subtreeButton.click();
    await page.waitForTimeout(200);

    await assertEqual(page, await page.locator(MENU_SELECTOR).count(), 0, '実行後にコンテキストメニューが閉じること');

    for (const id of expectedSelected) {
      await assertTrue(page, await isNodeSelected(page, id), `サブツリー内のノード(${id})が選択されること`);
    }
    for (const id of expectedUnselected) {
      await assertTrue(page, !(await isNodeSelected(page, id)), `サブツリー外のノード(${id})が選択されないこと`);
    }

    // 見た目だけでなくuiStoreの選択状態として成立していることの確認。
    // Deleteキーで「選択されたサブツリーだけ」がまとめて消えること
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);
    const remaining = await getNodeIds(page);
    await assertEqual(
      page,
      remaining.sort().join(','),
      [...expectedUnselected].sort().join(','),
      'Deleteキーでサブツリーのノードだけがまとめて削除されること'
    );

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

async function testEdgeMenuHasNoSubtreeItem() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const point = await getEdgePoint(page, 0, 0.25);
    // 座標クリックだと隣接エッジに奪われることがあるため、対象パスに直接発火させる
    // （context-menu-delete.mjs と同じ理由）
    const edgeInteractivePath = page.locator(`.react-flow__edge[data-id="${point.edgeId}"] path.edge-click-target`);
    await edgeInteractivePath.dispatchEvent('contextmenu', { clientX: point.x, clientY: point.y, button: 2 });
    await page.waitForTimeout(200);

    await assertEqual(page, await page.locator(MENU_SELECTOR).count(), 1, 'エッジのコンテキストメニューが開くこと');
    await assertEqual(
      page,
      await page.locator(SUBTREE_BUTTON_SELECTOR).count(),
      0,
      'エッジのメニューには「サブツリーを選択」が表示されないこと'
    );
    await assertEqual(
      page,
      await page.locator(`${MENU_SELECTOR} button`).count(),
      1,
      'エッジのメニューは削除のみ（1項目）であること'
    );

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
