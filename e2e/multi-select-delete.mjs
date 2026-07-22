// Ctrl+クリックによるノード・エッジ混在の複数選択と、Deleteキーでの一括削除（Undo1回で全復元）を検証する。
//
// タスク2（複数選択のDelete一括削除）の仕様確認用。デフォルトマップ（defaultMap.ts）の構造
// （"Start with a thought"がルート、そこから3方向に分岐しDAGで"See the whole picture"に収束する）
// を前提に、ルートではない2ノード（"Shape your thinking" / "Discover new angles"）と、
// その2ノードに接続していない独立したエッジ（自動検出）を混在選択し、
// Deleteで一括削除されること・Ctrl+Z 1回で全部復元されること
// （＝mapStore.deleteNodesAndEdgesがsaveToHistory()を1回しか呼んでいないこと）を確認する。
//
// ノードの複数選択にはCtrl+クリック（単体トグル追加）を使う。Shift+クリックは
// 「アンカーからの無向最短経路をunion追加」の意味になっており（docs/decisions.md §36）、
// shape/discoverはどちらもbigPictureへ収束するエッジを持つため、Shift+クリックだと
// 経路上のbigPictureまで一緒に選択されてしまい「2ノードだけを選ぶ」というこのテストの
// 前提が崩れる。Ctrl+クリックなら常に単体トグルなので、意図通り2ノードだけを選択できる。
// エッジの複数選択（Shift+クリックでトグル）はこの変更の対象外なので従来通り。
import {
  launchPage,
  closeBrowser,
  assertTrue,
  assertEqual,
  getNodeIds,
  nodeLocator,
  isNodeSelected,
  runStandalone,
} from './helpers.mjs';

export const name = 'multi-select-delete';

async function isEdgeSelected(page, edgeId) {
  const cls = await page.locator(`.react-flow__edge[data-id="${edgeId}"]`).getAttribute('class');
  return (cls || '').split(/\s+/).includes('selected');
}

// 指定したノードのいずれにも接続していないエッジ上の座標を探す（複数選択したノードの削除に
// 連鎖して消えるエッジと、明示的にエッジとして選択して消すエッジを区別するため）。
// 接続の有無は各エッジの aria-label（React Flowが自動付与する"Edge from {source} to {target}"）
// から判定する。また、デフォルトマップはベジェ曲線のエッジが他のノードのすぐ近くを通ることがあり
// （例: findConnections→bigPictureのエッジがdiscoverノードのすぐ脇を通る）、固定fractionだと
// 意図せずノードをクリックしてしまうことがあるため、複数のfractionを試しながら
// どのノードのバウンディングボックスにも重ならない点を探す
async function findIndependentEdgePoint(page, excludeNodeIds) {
  return page.evaluate(
    ({ excludeNodeIds }) => {
      const margin = 20;
      const fractions = [0.15, 0.3, 0.5, 0.7, 0.85];
      const allNodeRects = Array.from(document.querySelectorAll('.react-flow__node')).map((el) =>
        el.getBoundingClientRect()
      );
      const edges = Array.from(document.querySelectorAll('.react-flow__edge'));
      for (const edge of edges) {
        const ariaLabel = edge.getAttribute('aria-label') || '';
        const touchesExcludedNode = excludeNodeIds.some((id) => ariaLabel.includes(id));
        if (touchesExcludedNode) continue;

        const path = edge.querySelector('path.react-flow__edge-path');
        if (!path) continue;
        const len = path.getTotalLength();
        for (const fraction of fractions) {
          const p = path.getPointAtLength(len * fraction);
          const ctm = path.getScreenCTM();
          const x = ctm.a * p.x + ctm.c * p.y + ctm.e;
          const y = ctm.b * p.x + ctm.d * p.y + ctm.f;
          const overlapsAnyNode = allNodeRects.some(
            (rect) =>
              x >= rect.left - margin &&
              x <= rect.right + margin &&
              y >= rect.top - margin &&
              y <= rect.bottom + margin
          );
          if (!overlapsAnyNode) {
            return { x, y, edgeId: edge.getAttribute('data-id') };
          }
        }
      }
      return null;
    },
    { excludeNodeIds }
  );
}

// Playwrightの低レベルMouse APIはclickにmodifiersを取れないため、Shift+クリックは
// keyboard.down/upで挟んで表現する
async function shiftClickAt(page, x, y) {
  await page.keyboard.down('Shift');
  await page.mouse.click(x, y);
  await page.keyboard.up('Shift');
}

export async function run() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const nodeIds = await getNodeIds(page);
    await assertEqual(page, nodeIds.length, 7, 'デフォルトマップのノード数が7であること（前提条件）');
    const edgeCountBefore = await page.locator('.react-flow__edge').count();
    await assertEqual(page, edgeCountBefore, 10, 'デフォルトマップのエッジ数が10であること（前提条件）');

    // defaultMap.tsのnodes配列順: [root, explore, question, findConnections, shape, discover, bigPicture]
    const shapeNodeId = nodeIds[4];
    const discoverNodeId = nodeIds[5];
    const rootNodeId = nodeIds[0];
    const findConnectionsNodeId = nodeIds[3];

    // --- (1) ノード2個をCtrl+クリックで複数選択 ---
    await nodeLocator(page, shapeNodeId).click({ modifiers: ['Control'] });
    await page.waitForTimeout(150);
    await nodeLocator(page, discoverNodeId).click({ modifiers: ['Control'] });
    await page.waitForTimeout(150);

    await assertTrue(page, await isNodeSelected(page, shapeNodeId), 'Ctrl+クリックした1つ目のノードが選択状態になること');
    await assertTrue(page, await isNodeSelected(page, discoverNodeId), 'Ctrl+クリックした2つ目のノードが選択状態になること');

    // --- エッジ1本をShift+クリックで選択（選択中の2ノードに接続していない独立したエッジを自動で探す） ---
    const edgePoint = await findIndependentEdgePoint(page, [shapeNodeId, discoverNodeId]);
    await assertTrue(page, edgePoint !== null, '選択中の2ノードに接続しない独立したエッジが見つかること（前提）');
    await shiftClickAt(page, edgePoint.x, edgePoint.y);
    await page.waitForTimeout(150);

    await assertTrue(page, await isEdgeSelected(page, edgePoint.edgeId), 'Shift+クリックしたエッジが選択状態になること');
    // ノードの選択がエッジのShift+クリックで解除されていないこと（ノード・エッジ混在選択）
    await assertTrue(page, await isNodeSelected(page, shapeNodeId), 'エッジのShift+クリック後もノードの選択が維持されること');
    await assertTrue(page, await isNodeSelected(page, discoverNodeId), 'エッジのShift+クリック後もノードの選択が維持されること');

    // --- (2) Deleteで選択したノード・エッジがすべて消える（非選択ノードは残る） ---
    await page.keyboard.press('Delete');
    await page.waitForTimeout(250);

    const nodeIdsAfterDelete = await getNodeIds(page);
    await assertEqual(page, nodeIdsAfterDelete.length, 5, '選択した2ノードが削除され、ノード数が5になること');
    await assertTrue(page, !nodeIdsAfterDelete.includes(shapeNodeId), '選択したノード(shape)が削除されること');
    await assertTrue(page, !nodeIdsAfterDelete.includes(discoverNodeId), '選択したノード(discover)が削除されること');
    await assertTrue(page, nodeIdsAfterDelete.includes(rootNodeId), '非選択のルートノードは残ること');
    await assertTrue(page, nodeIdsAfterDelete.includes(findConnectionsNodeId), '非選択のノード(findConnections)は残ること');

    await assertEqual(
      page,
      await page.locator(`.react-flow__edge[data-id="${edgePoint.edgeId}"]`).count(),
      0,
      '明示的に選択したエッジ（選択ノードに接続しない独立したエッジ）が削除されること'
    );

    // --- (3) Ctrl+Z 1回で全部復元される（履歴1エントリの検証） ---
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(250);

    const nodeIdsAfterUndo = await getNodeIds(page);
    await assertEqual(page, nodeIdsAfterUndo.length, 7, 'Ctrl+Z 1回でノード数が7に復元されること');
    await assertTrue(page, nodeIdsAfterUndo.includes(shapeNodeId), 'Ctrl+Z 1回で削除したノード(shape)が復元されること');
    await assertTrue(page, nodeIdsAfterUndo.includes(discoverNodeId), 'Ctrl+Z 1回で削除したノード(discover)が復元されること');

    const edgeCountAfterUndo = await page.locator('.react-flow__edge').count();
    await assertEqual(page, edgeCountAfterUndo, 10, 'Ctrl+Z 1回でエッジ数が10に復元されること');
    await assertEqual(
      page,
      await page.locator(`.react-flow__edge[data-id="${edgePoint.edgeId}"]`).count(),
      1,
      'Ctrl+Z 1回で削除したエッジも復元されること'
    );

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
