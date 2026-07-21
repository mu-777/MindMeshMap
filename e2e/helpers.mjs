// E2Eテスト共通ヘルパ。
//
// 素のplaywright（@playwright/testではない）で自前ランナーを回す方針のため、
// テストファイルごとに「ブラウザ起動 → ページ準備 → アサーション」を揃えるための
// 最小限のユーティリティをここに集約する。採用理由はdocs/decisions.mdを参照。
//
// 各テストファイルは async function run() をexportし、
//   1. node e2e/<file>.mjs で単独実行（このファイル末尾のrunStandaloneで実行される）
//   2. e2e/run-all.mjs からimportされて一括実行
// の両方に対応する。テストごとに新しいブラウザコンテキストを使うため
// （launchPageがcontextを毎回新規作成）localStorage/sessionStorageは常に空 = 初回訪問状態から
// 始まり、テスト間で状態が漏れない・実行順に依存しない独立性を保っている。

import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

export const BASE_URL = 'http://localhost:5173/MindMeshMap/';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
mkdirSync(SCREENSHOT_DIR, { recursive: true });

/**
 * devサーバへの接続確認。応答がない場合、何をすればよいかが分かるメッセージで例外を投げる。
 * run-all.mjsの先頭、および launchPage の goto 失敗時のフォールバックとして使う。
 */
export async function ensureDevServerRunning() {
  try {
    const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTPステータス ${res.status}`);
  } catch (err) {
    throw new Error(
      `dev サーバ (${BASE_URL}) に接続できません。別ターミナルで \`npm run dev\` を起動してから再実行してください。\n` +
        `詳細: ${err.message}`
    );
  }
}

/**
 * テスト用にブラウザ・ページを1つ用意する。
 * viewport等はplaywrightのnewContextにそのまま渡すoptionsで指定する
 * （例: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }）。
 *
 * 戻り値の pageErrors 配列には、ページ内で発生した未捕捉例外のメッセージが溜まっていく。
 * テスト末尾で「pageErrorsが空であること」を確認すれば、Reactツリークラッシュ等の
 * 見落としを防げる（decisions.md §17のBubbleMenuクラッシュのような不具合の検出に有効）。
 */
export async function launchPage(options = {}) {
  const { viewport = { width: 1280, height: 800 }, ...contextOptions } = options;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, ...contextOptions });
  const page = await context.newPage();

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
  } catch (err) {
    await browser.close();
    await ensureDevServerRunning();
    // ensureDevServerRunningが例外を投げなかった（＝サーバは応答している）のに
    // gotoが失敗した場合は、別の原因なのでそのまま元のエラーを伝える
    throw err;
  }
  await page.waitForSelector('.react-flow__node', { timeout: 10000 });

  return { browser, context, page, pageErrors };
}

export async function closeBrowser(browser) {
  await browser.close();
}

let screenshotSeq = 0;

/** e2e/screenshots/ 配下に連番付きでスクリーンショットを保存する */
export async function saveScreenshot(page, name) {
  screenshotSeq += 1;
  const file = path.join(SCREENSHOT_DIR, `${String(screenshotSeq).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

/**
 * アサーション。失敗時は分かりやすいメッセージ（期待値・実際値）で例外を投げ、
 * pageが渡されていれば失敗時点のスクリーンショットも保存する（原因調査用）。
 */
export async function assertEqual(page, actual, expected, message) {
  if (actual !== expected) {
    const file = page ? await saveScreenshot(page, `FAIL-${sanitize(message)}`) : null;
    throw new Error(
      `${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}` +
        (file ? `\n  screenshot: ${file}` : '')
    );
  }
}

export async function assertTrue(page, condition, message) {
  if (!condition) {
    const file = page ? await saveScreenshot(page, `FAIL-${sanitize(message)}`) : null;
    throw new Error(`${message}${file ? `\n  screenshot: ${file}` : ''}`);
  }
}

function sanitize(message) {
  return message.replace(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 60);
}

// --- ノード操作系の共通ユーティリティ ---
// 複数のテストファイルで同じDOM構造（.react-flow__node、.ProseMirror、選択/編集中のクラス名）を
// 参照するため、ここに集約する。CustomNode.tsx側の実装（クラス名の意味）が変わったら
// ここも合わせて更新すること

export function nodeLocator(page, dataId) {
  return page.locator(`.react-flow__node[data-id="${dataId}"]`);
}

export async function getNodeIds(page) {
  return page.locator('.react-flow__node').evaluateAll((els) => els.map((el) => el.getAttribute('data-id')));
}

export async function getNodeText(page, dataId) {
  return nodeLocator(page, dataId).locator('.ProseMirror').innerText();
}

/** ノードが編集中か（CustomNode.tsxの緑リング ring-green-500 で判定） */
export async function isNodeEditing(page, dataId) {
  return page.evaluate((id) => {
    const el = document.querySelector(`.react-flow__node[data-id="${id}"] > div`);
    return el?.className.includes('ring-green-500') ?? false;
  }, dataId);
}

/** ノードが選択（armed含む）状態か（CustomNode.tsxの青枠 border-blue-500 で判定） */
export async function isNodeSelected(page, dataId) {
  return page.evaluate((id) => {
    const el = document.querySelector(`.react-flow__node[data-id="${id}"] > div`);
    return el?.className.includes('border-blue-500') ?? false;
  }, dataId);
}

/** document.activeElement が .ProseMirror かどうかと、それがどのノードに属するか */
export async function getActiveElementInfo(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    const nodeEl = el?.closest('.react-flow__node');
    return {
      isProseMirror: el?.classList.contains('ProseMirror') ?? false,
      nodeDataId: nodeEl?.getAttribute('data-id') ?? null,
      tag: el?.tagName ?? null,
    };
  });
}

/**
 * 全ノードのtransform（translate）をid→文字列のMapで取得する。
 * z-indexはReact Flowが選択/フォーカス中のノードを前面に出すために変更する（正常な挙動）ため
 * 比較対象に含めない。矢印ナビゲーションでノード位置が動かないことの確認に使う
 */
export async function getNodeTransforms(page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('.react-flow__node'));
    const result = {};
    for (const n of nodes) {
      const style = n.getAttribute('style') || '';
      const match = style.match(/translate\([^)]*\)/);
      result[n.getAttribute('data-id')] = match ? match[0] : style;
    }
    return result;
  });
}

/**
 * エッジのpath上、start(0〜1)の位置のスクリーン座標を返す。
 * パス中点(0.5)はラベルオーバーレイと重なりクリックが奪われるため、
 * エッジ本体をクリックしたい場合は0.25等ラベルと衝突しない位置を使うこと
 */
export async function getEdgePoint(page, edgeIndex = 0, fraction = 0.25) {
  return page.evaluate(
    ({ edgeIndex, fraction }) => {
      const edge = document.querySelectorAll('.react-flow__edge')[edgeIndex];
      if (!edge) return null;
      const path = edge.querySelector('path.react-flow__edge-path');
      const len = path.getTotalLength();
      const p = path.getPointAtLength(len * fraction);
      const ctm = path.getScreenCTM();
      return {
        x: ctm.a * p.x + ctm.c * p.y + ctm.e,
        y: ctm.b * p.x + ctm.d * p.y + ctm.f,
        edgeId: edge.getAttribute('data-id'),
      };
    },
    { edgeIndex, fraction }
  );
}

/**
 * 指定ノードに接続していないエッジのpath上の座標を返す。
 * ノードに隣接するエッジは経路が短く、ノードの当たり判定と重なって意図せずノードを
 * クリックしてしまうことがあるため、ノード選択との排他性テストのように「エッジだけを
 * 確実にクリックしたい」場面で使う
 */
export async function getEdgePointNotTouchingNode(page, excludeNodeId, fraction = 0.25) {
  return page.evaluate(
    ({ excludeNodeId, fraction }) => {
      const edges = Array.from(document.querySelectorAll('.react-flow__edge'));
      // エッジのsource/target情報はDOMから直接取れないため、
      // 「fraction地点の座標が対象ノードの矩形と重ならないか」で間接的に判定する
      const edge = edges.find((e) => {
        const path = e.querySelector('path.react-flow__edge-path');
        const len = path.getTotalLength();
        const p = path.getPointAtLength(len * fraction);
        const ctm = path.getScreenCTM();
        const x = ctm.a * p.x + ctm.c * p.y + ctm.e;
        const y = ctm.b * p.x + ctm.d * p.y + ctm.f;
        const excludeEl = document.querySelector(`.react-flow__node[data-id="${excludeNodeId}"]`);
        if (!excludeEl) return true;
        const rect = excludeEl.getBoundingClientRect();
        const margin = 20;
        const overlapsExcludedNode =
          x >= rect.left - margin && x <= rect.right + margin && y >= rect.top - margin && y <= rect.bottom + margin;
        return !overlapsExcludedNode;
      });
      if (!edge) return null;
      const path = edge.querySelector('path.react-flow__edge-path');
      const len = path.getTotalLength();
      const p = path.getPointAtLength(len * fraction);
      const ctm = path.getScreenCTM();
      return {
        x: ctm.a * p.x + ctm.c * p.y + ctm.e,
        y: ctm.b * p.x + ctm.d * p.y + ctm.f,
        edgeId: edge.getAttribute('data-id'),
      };
    },
    { excludeNodeId, fraction }
  );
}

/**
 * CDPで日本語IME入力を模擬する（keydown keyCode=229 → composition逐次 → 確定 insertText）。
 * 実IMEのcomposition中断挙動まではCDPでは完全再現できないが、「打鍵の前に
 * contenteditableへフォーカスが当たっているか（=IMEが1文字目からcomposition開始できる前提条件）」
 * は忠実に再現・検証できる。マウス作成ノードでフォーカスがbodyへ抜ける不具合の回帰検出に使う。
 * 詳細は docs/decisions.md §13 / docs/testing.md 参照。
 */
export async function typeJapaneseIME(page, romaji, kanji) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 229, key: 'Process' });
  for (let i = 1; i <= romaji.length; i++) {
    await cdp.send('Input.imeSetComposition', { text: romaji.slice(0, i), selectionStart: i, selectionEnd: i });
  }
  await cdp.send('Input.imeSetComposition', { text: kanji, selectionStart: kanji.length, selectionEnd: kanji.length });
  await cdp.send('Input.insertText', { text: kanji });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 229, key: 'Process' });
  await cdp.detach();
}

/**
 * name/run を受け取り、`node e2e/<file>.mjs` として直接実行された場合にのみテストを実行する。
 * 各テストファイルの末尾で
 *   if (import.meta.url === `file://${process.argv[1]}`) await runStandalone(name, run);
 * のように呼び出す
 */
export async function runStandalone(name, run) {
  console.log(`--- ${name} ---`);
  try {
    await run();
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
}
