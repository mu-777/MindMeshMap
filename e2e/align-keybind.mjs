// 整列（autoLayout）のキーバインド化と、選択ノードのみの部分整列を検証する。
//
// デフォルトマップ（7ノード、RIGHT方向。defaultMap.ts参照）を前提に、以下を確認する:
//   1. ノードを2個ドラッグでバラバラの位置に動かす
//   2. その2個をShift+クリックで選択 → Ctrl+Shift+L → 選択した2ノードだけ位置が変わり、
//      非選択ノードの位置は全て不変であること
//   3. Ctrl+Z 1回で選択していた2ノードの位置がドラッグ後の位置に戻ること
//      （＝useAutoLayout.applyLayoutがsaveToHistory()を1回だけ呼んでいることの検証）
//   4. 選択なし状態でCtrl+Shift+L → マップ全体が整列され複数ノードの位置が変わること
import {
  launchPage,
  closeBrowser,
  assertTrue,
  assertEqual,
  getNodeIds,
  nodeLocator,
  isNodeSelected,
  getNodeTransforms,
  runStandalone,
} from './helpers.mjs';

export const name = 'align-keybind';

// ノードの中心を(dx,dy)だけドラッグで動かす
async function dragNodeBy(page, nodeId, dx, dy) {
  const box = await nodeLocator(page, nodeId).boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 15 });
  await page.mouse.up();
}

// ノード・エッジ・Controls等のUI要素と重ならない、ペイン内の空白座標を探す（クリックで
// onPaneClickを確実に発火させ選択解除するため）。document.elementFromPointで実際にその点の
// 最前面要素を調べる方式にすることで、整列でノード位置が変わっても座標をハードコードせずに済む
async function findBlankPanePoint(page) {
  const paneBox = await page.locator('.react-flow__pane').boundingBox();
  return page.evaluate(
    ({ paneBox }) => {
      const cols = 12;
      const rows = 12;
      for (let i = 1; i < cols; i++) {
        for (let j = 1; j < rows; j++) {
          const x = paneBox.x + (paneBox.width * i) / cols;
          const y = paneBox.y + (paneBox.height * j) / rows;
          const el = document.elementFromPoint(x, y);
          if (!el) continue;
          const isBlank =
            el.closest('.react-flow__pane') &&
            !el.closest('.react-flow__node') &&
            !el.closest('.react-flow__edge') &&
            !el.closest('.react-flow__controls') &&
            !el.closest('.react-flow__minimap');
          if (isBlank) return { x, y };
        }
      }
      return null;
    },
    { paneBox }
  );
}

export async function run() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    const nodeIds = await getNodeIds(page);
    await assertTrue(page, nodeIds.length >= 5, 'デフォルトマップに5個以上のノードがあること（前提条件）');

    // defaultMap.tsのnodes配列順: [root, explore, question, findConnections, shape, discover, bigPicture]
    // explore→shapeは直接つながるエッジがある（両端が選択対象に含まれるエッジだけをELKに渡す仕様の
    // 確認を兼ねて、あえて接続済みの2ノードを選ぶ）
    const exploreId = nodeIds[1];
    const shapeId = nodeIds[4];
    const targetIds = new Set([exploreId, shapeId]);
    const otherIds = nodeIds.filter((id) => !targetIds.has(id));

    // --- (1) 2ノードをドラッグでバラバラの位置に動かす ---
    await dragNodeBy(page, exploreId, 320, -180);
    await page.waitForTimeout(200);
    await dragNodeBy(page, shapeId, -260, 220);
    await page.waitForTimeout(200);

    // 連続する2アクション（ドラッグ×2）の直後は、mapStore.undo()の既知の挙動
    // （docs/tuning.md「既知の未対応事項」参照。最初のUndo/Redoが1ステップ分ではなく
    // 2ステップ分巻き戻る/やり直すことがある）に巻き込まれ、この後の「整列→Undo1回」の
    // 検証が不正確になる。Undo→Redoを1往復させて履歴のダングリング状態を解消しておく
    // （中身は結果的に変わらない。tuning.mdの説明どおり、3アクション目以降は毎回1ステップずつ
    // 正しく動くようになるため、この1往復で十分）
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(200);

    const afterDrag = await getNodeTransforms(page);

    // --- (2) その2個をShift+クリックで選択 ---
    await nodeLocator(page, exploreId).click({ modifiers: ['Shift'] });
    await page.waitForTimeout(150);
    await nodeLocator(page, shapeId).click({ modifiers: ['Shift'] });
    await page.waitForTimeout(150);
    await assertTrue(page, await isNodeSelected(page, exploreId), 'Shift+クリックした1つ目のノードが選択状態になること');
    await assertTrue(page, await isNodeSelected(page, shapeId), 'Shift+クリックした2つ目のノードが選択状態になること');

    // --- Ctrl+Shift+Lで部分整列（選択した2ノードのみ） ---
    await page.keyboard.press('Control+Shift+L');
    await page.waitForTimeout(500);

    const afterAlign = await getNodeTransforms(page);

    await assertTrue(page, afterAlign[exploreId] !== afterDrag[exploreId], '選択した1つ目のノードの位置が整列で変わること');
    await assertTrue(page, afterAlign[shapeId] !== afterDrag[shapeId], '選択した2つ目のノードの位置が整列で変わること');
    for (const id of otherIds) {
      await assertEqual(page, afterAlign[id], afterDrag[id], `非選択ノード(${id})の位置は部分整列で変化しないこと`);
    }

    // --- (3) Ctrl+Z 1回で選択していた2ノードの位置がドラッグ後の位置に戻ること ---
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const afterUndo = await getNodeTransforms(page);
    await assertEqual(page, afterUndo[exploreId], afterDrag[exploreId], 'Ctrl+Z 1回で1つ目のノードがドラッグ後の位置に戻ること');
    await assertEqual(page, afterUndo[shapeId], afterDrag[shapeId], 'Ctrl+Z 1回で2つ目のノードがドラッグ後の位置に戻ること');
    for (const id of otherIds) {
      await assertEqual(page, afterUndo[id], afterDrag[id], `Undo後も非選択ノード(${id})の位置は変化しないこと`);
    }

    // --- (4) 選択なし状態でCtrl+Shift+L → マップ全体が整列される ---
    const blankPoint = await findBlankPanePoint(page);
    await assertTrue(page, blankPoint !== null, '空白のペイン座標が見つかること（前提）');
    await page.mouse.click(blankPoint.x, blankPoint.y);
    await page.waitForTimeout(150);
    await assertTrue(page, !(await isNodeSelected(page, exploreId)), '空白クリックで選択が解除されること');

    const beforeFullAlign = await getNodeTransforms(page);
    await page.keyboard.press('Control+Shift+L');
    await page.waitForTimeout(500);
    const afterFullAlign = await getNodeTransforms(page);

    const changedCount = nodeIds.filter((id) => afterFullAlign[id] !== beforeFullAlign[id]).length;
    await assertTrue(page, changedCount >= 2, `全体整列で複数ノードの位置が変わること（変化したノード数: ${changedCount}）`);

    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
