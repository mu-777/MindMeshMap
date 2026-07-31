// 利用規約・プライバシーポリシー（public/terms.html・public/privacy.html。decisions.md §55）の回帰テスト。
//
// この2ページのURLはGoogle Cloud Consoleのブランディング設定に登録してあり、
// 「JSなしで全文が読めること」「アプリから辿れること」が壊れるとGoogle API側の要件を満たさなくなる
// （気づくのは審査に落ちたときになる）ため、他のE2Eと違って"URLの存在と中身"を守るのが目的。
//
// 検証すること:
//   (a) アプリのサイドバー下部から両ページへのリンクがあり、hrefが実在のURLを指していること
//   (b) **JavaScriptを無効にしたコンテキスト**で開いても、英語・日本語の全文と連絡先が読めること
//       （アプリ本体は#rootにJSで描画されるのでDOMに文字が残らない。この2ページはその例外である、という仕様の固定）
//   (c) index.htmlの<noscript>にも同じリンクがあること
//   (d) sitemap.xmlに2ページとも載っていること
//   (e) 狭い画面（390px）で横スクロールが出ないこと
import { chromium } from 'playwright';
import { BASE_URL, launchPage, closeBrowser, assertTrue, assertEqual, runStandalone } from './helpers.mjs';

export const name = 'legal-pages';

// 連絡先・言語見出しは terms.html / privacy.html の両方に同じものが入っている（decisions.md §55の「同期が必要な箇所」）
const CONTACT = 'mu777.labs@gmail.com';
const PAGES = [
  { file: 'terms.html', title: 'Terms of Service', jaTitle: '利用規約' },
  { file: 'privacy.html', title: 'Privacy Policy', jaTitle: 'プライバシーポリシー' },
];

/** (a) アプリのサイドバーから両ページへ辿れること */
async function testSidebarLinks() {
  const { browser, page, pageErrors } = await launchPage();
  try {
    for (const { file } of PAGES) {
      const link = page.locator(`a[href$="${file}"]`).first();
      await assertTrue(page, (await link.count()) > 0, `サイドバーに ${file} へのリンクがあること`);
      await assertTrue(page, await link.isVisible(), `${file} へのリンクが表示されていること`);

      const href = await link.getAttribute('href');
      // BASE_URL基準の絶対パス（import.meta.env.BASE_URL + ファイル名）になっていること。
      // 相対パスだと将来アプリ側にルーティングが入ったときに壊れる
      await assertEqual(page, href, `/MindMeshMap/${file}`, `${file} へのリンクのhrefがBASE_URL基準であること`);

      // 編集中の下書きを失わせないため別タブで開く
      await assertEqual(page, await link.getAttribute('target'), '_blank', `${file} へのリンクが別タブで開くこと`);

      // hrefが実在すること（ファイル名を変えたらここで落ちる）
      const res = await fetch(new URL(href, BASE_URL));
      await assertEqual(page, res.status, 200, `${file} が ${href} で配信されていること`);
    }

    await assertEqual(page, pageErrors.length, 0, `ページ内で未捕捉例外が出ていないこと: ${pageErrors.join(', ')}`);
  } finally {
    await closeBrowser(browser);
  }
}

/** (b)(e) JS無効でも全文が読めること・狭い画面で横スクロールが出ないこと */
async function testPagesReadableWithoutJs() {
  const browser = await chromium.launch();
  // javaScriptEnabled: false が本題。Googleの審査やJSを実行しないクローラと同じ条件で読めることを確認する
  const context = await browser.newContext({ viewport: { width: 390, height: 780 }, javaScriptEnabled: false });
  try {
    for (const { file, title, jaTitle } of PAGES) {
      const page = await context.newPage();
      const res = await page.goto(new URL(file, BASE_URL).href, { waitUntil: 'load', timeout: 15000 });
      await assertEqual(null, res.status(), 200, `${file} が200で返ること`);

      const h1 = (await page.locator('h1').first().innerText()).trim();
      await assertTrue(page, h1.includes(title), `${file} の見出しが「${title}」であること: ${h1}`);

      // 英語セクションが先（審査担当者が読む言語）・日本語セクションが後、の順で両方あること
      const sectionIds = await page.locator('h2[id]').evaluateAll((els) => els.map((el) => el.id));
      await assertEqual(page, sectionIds.join(','), 'english,japanese', `${file} が英語→日本語の順で両方を含むこと`);

      const bodyText = await page.locator('body').innerText();
      await assertTrue(page, bodyText.includes(CONTACT), `${file} に連絡先 ${CONTACT} が書かれていること`);
      await assertTrue(page, bodyText.includes(jaTitle), `${file} に日本語の全文（「${jaTitle}」）が含まれること`);
      // 本文がJSなしで実際に描画されていること（空のシェルが200で返るだけ、を弾く）
      await assertTrue(page, bodyText.length > 3000, `${file} の本文がJS無効でも読めること（${bodyText.length}文字）`);

      // もう一方のページ・アプリ本体への相互リンク
      const other = PAGES.find((p) => p.file !== file).file;
      await assertTrue(page, (await page.locator(`a[href$="${other}"]`).count()) > 0, `${file} から ${other} へのリンクがあること`);
      await assertTrue(page, (await page.locator('a[href="/MindMeshMap/"]').count()) > 0, `${file} からアプリ本体へ戻るリンクがあること`);

      // 狭い画面で横スクロールが出ないこと（表を含むため。スクロールは表の中だけに閉じ込める）
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      await assertTrue(page, overflow === false, `${file} が幅390pxで横スクロールしないこと`);

      await page.close();
    }
  } finally {
    await browser.close();
  }
}

/** (c)(d) noscriptフォールバックとsitemapに載っていること */
async function testNoscriptAndSitemap() {
  const indexHtml = await (await fetch(BASE_URL)).text();
  const noscript = indexHtml.match(/<noscript>([\s\S]*?)<\/noscript>/);
  await assertTrue(null, noscript !== null, 'index.htmlに<noscript>ブロックがあること');

  const sitemap = await (await fetch(new URL('sitemap.xml', BASE_URL))).text();

  for (const { file } of PAGES) {
    await assertTrue(null, noscript[1].includes(`/MindMeshMap/${file}`), `<noscript>内に ${file} へのリンクがあること`);
    await assertTrue(
      null,
      sitemap.includes(`https://mu-777.github.io/MindMeshMap/${file}`),
      `sitemap.xmlに ${file} のURLが載っていること`
    );
  }
}

export async function run() {
  await testSidebarLinks();
  await testPagesReadableWithoutJs();
  await testNoscriptAndSitemap();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStandalone(name, run);
}
