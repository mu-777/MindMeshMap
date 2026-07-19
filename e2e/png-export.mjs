// PNGエクスポート（useExportPng.ts）を検証する。
// - 出力画像の実寸が useExportPng.ts の計算式（bounds + EXPORT_PADDING_PX、MAX_IMAGE_SIZEクランプ）
//   と一致すること
// - 四辺に背景色の余白があり、ノードが画像端で見切れていないこと
//   （decisions.md §11: DOM実測(offsetWidth/offsetHeight)でboundsを組み立てている経緯を参照）
import fs from 'node:fs';
import { launchPage, closeBrowser, assertTrue, assertEqual, runStandalone, SCREENSHOT_DIR } from './helpers.mjs';
import path from 'node:path';

export const name = 'png-export';

// useExportPng.ts冒頭の定数と同じ値（tuning.md参照）。値を変更したら両方更新すること
const EXPORT_PADDING_PX = 40;
const MAX_IMAGE_SIZE = 4096;
const BG = { r: 0x11, g: 0x18, b: 0x27 }; // #111827

function readPngDimensions(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNGシグネチャが不正です');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export async function run() {
  const { browser, page, pageErrors } = await launchPage({ viewport: { width: 1400, height: 900 } });
  const downloadPath = path.join(SCREENSHOT_DIR, 'export-verify.png');
  try {
    // ノードを複数作成し、1つを大きく右下にドラッグして bounds を広げる
    // （見切れ・パディング崩れを再現しやすい配置にする）
    await page.locator('.react-flow__node').first().click();
    await page.waitForTimeout(150);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(150);
    }

    const lastNode = page.locator('.react-flow__node').last();
    const box = await lastNode.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 500, box.y + box.height / 2 + 400, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // アプリと同じ方法（DOM実測: transform + offsetWidth/offsetHeight）でboundsを算出し、
    // useExportPng.tsの計算式から期待される画像サイズを求める
    const bounds = await page.evaluate(() => {
      const nodeEls = Array.from(document.querySelectorAll('.react-flow__node'));
      const rects = nodeEls.map((el) => {
        const m = new DOMMatrixReadOnly(window.getComputedStyle(el).transform);
        return { left: m.e, top: m.f, right: m.e + el.offsetWidth, bottom: m.f + el.offsetHeight };
      });
      return {
        minX: Math.min(...rects.map((r) => r.left)),
        minY: Math.min(...rects.map((r) => r.top)),
        maxX: Math.max(...rects.map((r) => r.right)),
        maxY: Math.max(...rects.map((r) => r.bottom)),
      };
    });
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const scale = Math.min(1, MAX_IMAGE_SIZE / (width + 2 * EXPORT_PADDING_PX), MAX_IMAGE_SIZE / (height + 2 * EXPORT_PADDING_PX));
    const expectedWidth = Math.round((width + 2 * EXPORT_PADDING_PX) * scale);
    const expectedHeight = Math.round((height + 2 * EXPORT_PADDING_PX) * scale);

    // ファイルメニュー → PNG image でエクスポート
    await page.locator('button', { hasText: /^File$/ }).click();
    await page.waitForTimeout(150);
    const downloadPromise = page.waitForEvent('download');
    await page.getByText('PNG image', { exact: true }).click();
    const download = await downloadPromise;
    await download.saveAs(downloadPath);

    const buf = fs.readFileSync(downloadPath);
    const { width: actualWidth, height: actualHeight } = readPngDimensions(buf);
    await assertEqual(page, actualWidth, expectedWidth, 'PNG実寸(幅)がuseExportPng.tsの計算式と一致すること');
    await assertEqual(page, actualHeight, expectedHeight, 'PNG実寸(高さ)がuseExportPng.tsの計算式と一致すること');

    // 四辺（外周1px）が背景色のみで構成され、ノードが見切れていないことを確認する
    const verifyPage = await browser.newPage();
    await verifyPage.setContent('<canvas id="c"></canvas>');
    const base64 = buf.toString('base64');
    const edgeCheck = await verifyPage.evaluate(
      async ({ base64, bg }) => {
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = 'data:image/png;base64,' + base64;
        });
        const canvas = document.getElementById('c');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const isBg = (r, g, b) => Math.abs(r - bg.r) <= 4 && Math.abs(g - bg.g) <= 4 && Math.abs(b - bg.b) <= 4;

        function countNonBg(coords) {
          let nonBg = 0;
          for (const [x, y] of coords) {
            const d = ctx.getImageData(x, y, 1, 1).data;
            if (!isBg(d[0], d[1], d[2])) nonBg++;
          }
          return nonBg;
        }

        const top = [];
        const bottom = [];
        const left = [];
        const right = [];
        for (let x = 0; x < img.width; x++) {
          top.push([x, 0]);
          bottom.push([x, img.height - 1]);
        }
        for (let y = 0; y < img.height; y++) {
          left.push([0, y]);
          right.push([img.width - 1, y]);
        }
        return {
          top: countNonBg(top),
          bottom: countNonBg(bottom),
          left: countNonBg(left),
          right: countNonBg(right),
        };
      },
      { base64, bg: BG }
    );
    await verifyPage.close();

    await assertEqual(page, edgeCheck.top, 0, '画像上端に背景色以外のピクセルがない（見切れていない）こと: ' + JSON.stringify(edgeCheck));
    await assertEqual(page, edgeCheck.bottom, 0, '画像下端に背景色以外のピクセルがないこと: ' + JSON.stringify(edgeCheck));
    await assertEqual(page, edgeCheck.left, 0, '画像左端に背景色以外のピクセルがないこと: ' + JSON.stringify(edgeCheck));
    await assertEqual(page, edgeCheck.right, 0, '画像右端に背景色以外のピクセルがないこと: ' + JSON.stringify(edgeCheck));

    await assertTrue(page, fs.existsSync(downloadPath), 'エクスポートしたPNGファイルが保存されていること: ' + downloadPath);
    await assertEqual(page, pageErrors.length, 0, 'ページ内未捕捉例外なし: ' + pageErrors.join(', '));
  } finally {
    await closeBrowser(browser);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
