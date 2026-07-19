// e2e/配下の全テストファイルを順に実行し、PASS/FAILのサマリを表示するランナー。
// `npm run test:e2e` から呼ばれる。個別実行は `node e2e/<file>.mjs` を使うこと（docs/testing.md参照）。
//
// 各テストファイルは launchPage() のたびに新しいブラウザコンテキストを使う（helpers.mjs参照）ため
// 状態が独立しており、このランナーでの実行順は結果に影響しない
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDevServerRunning, BASE_URL } from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXCLUDED = new Set(['helpers.mjs', 'run-all.mjs']);

async function main() {
  console.log(`dev サーバ (${BASE_URL}) への接続を確認しています...`);
  try {
    await ensureDevServerRunning();
  } catch (err) {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }
  console.log('OK: dev サーバに接続できました。\n');

  const files = readdirSync(__dirname)
    .filter((f) => f.endsWith('.mjs') && !EXCLUDED.has(f))
    .sort();

  if (files.length === 0) {
    console.error('e2e/配下にテストファイルが見つかりませんでした。');
    process.exit(1);
  }

  const results = [];

  for (const file of files) {
    const start = Date.now();
    process.stdout.write(`--- ${file} ---\n`);
    try {
      const mod = await import(`./${file}`);
      if (typeof mod.run !== 'function') {
        throw new Error('run() がexportされていません（テストファイルの規約を確認してください）');
      }
      await mod.run();
      const ms = Date.now() - start;
      results.push({ file, status: 'PASS', ms });
      console.log(`PASS: ${mod.name ?? file} (${ms}ms)`);
    } catch (err) {
      const ms = Date.now() - start;
      results.push({ file, status: 'FAIL', ms, error: err.message });
      console.error(`FAIL: ${file} (${ms}ms)`);
      console.error(err.stack || err.message);
    }
    console.log('');
  }

  const passed = results.filter((r) => r.status === 'PASS');
  const failed = results.filter((r) => r.status === 'FAIL');

  console.log('='.repeat(60));
  console.log('E2Eテスト結果サマリ');
  console.log('='.repeat(60));
  for (const r of results) {
    const mark = r.status === 'PASS' ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${r.file}  (${r.ms}ms)`);
  }
  console.log('-'.repeat(60));
  console.log(`合計 ${results.length} 件: PASS ${passed.length} / FAIL ${failed.length}`);
  console.log('='.repeat(60));

  if (failed.length > 0) {
    console.error(`\n${failed.length} 件のテストが失敗しました。`);
    process.exit(1);
  }
  console.log('\n全テストがPASSしました。');
}

main().catch((err) => {
  console.error('ランナー自体でエラーが発生しました:', err);
  process.exit(1);
});
