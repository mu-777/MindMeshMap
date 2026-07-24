// 整列アルゴリズムのランダムファズ探索。
// seedから決定的にランダムなグラフを生成し（e2e/lib/layout-fuzz.mjs）、各アルゴリズムの
// **契約（layout-contracts.mjs）だけ**を検証する。期待する配置は定義できないので、
// 「壊れていないこと」だけを大量のケースで確かめる道具。
//
// 違反したケースはエクスポート形式のJSONとして保存されるので、
//   1. `e2e/fixtures/maps/` にコピーすれば恒久ケースになる（回帰テストに入る）
//   2. アプリのインポートでそのまま開いて目で確かめられる
//
// 実行:
//   node scripts/layout-fuzz.mjs                       # seed 1..200
//   node scripts/layout-fuzz.mjs --seeds=2000 --start=1000 --max-nodes=60
//   node scripts/layout-fuzz.mjs --algorithms=sugiyama-ext --seeds=5000
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../e2e/lib/ts-loader.mjs';
import { generateFuzzCase, caseToMapJson } from '../e2e/lib/layout-fuzz.mjs';
import { checkInvariants } from '../e2e/lib/layout-metrics.mjs';
import { ALGORITHMS, contractViolations } from '../e2e/lib/layout-contracts.mjs';

const { calculateLayoutForAlign } = await import('../src/utils/alignAlgorithm.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const seedCount = Number(flag('seeds', 200));
const startSeed = Number(flag('start', 1));
const maxNodes = Number(flag('max-nodes', 24));
const algorithms = flag('algorithms', ALGORITHMS.join(',')).split(',').filter(Boolean);
const outDir = path.resolve(flag('out', path.join(__dirname, '..', 'layout-lab-out', 'fuzz-failures')));
const checkDeterminism = !args.includes('--no-determinism');

for (const algo of algorithms) {
  if (!ALGORITHMS.includes(algo)) {
    console.error(`未知のアルゴリズム: ${algo}（有効: ${ALGORITHMS.join(', ')}）`);
    process.exit(1);
  }
}

console.log(`seed ${startSeed}..${startSeed + seedCount - 1}（最大${maxNodes}ノード）× ${algorithms.join(', ')} を検証します...\n`);

const failures = [];
const violationCounts = new Map(algorithms.map((a) => [a, new Map()]));
const started = Date.now();

for (let i = 0; i < seedCount; i++) {
  const seed = startSeed + i;
  const testCase = generateFuzzCase(seed, { maxNodes });

  for (const algorithm of algorithms) {
    let violations = [];
    try {
      const result = await calculateLayoutForAlign(testCase.nodes, testCase.edges, testCase.direction, algorithm);
      const positions = new Map(result.nodes.map((n) => [n.id, n.position]));

      if (result.nodes.length !== testCase.nodes.length) {
        violations.push({ code: 'node-count', message: `返ったノード数 ${result.nodes.length} が入力 ${testCase.nodes.length} と違う` });
      }
      if (checkDeterminism) {
        const second = await calculateLayoutForAlign(testCase.nodes, testCase.edges, testCase.direction, algorithm);
        if (JSON.stringify(result) !== JSON.stringify(second)) {
          violations.push({ code: 'non-deterministic', message: '2回実行して結果が一致しない' });
        }
      }
      violations = violations.concat(
        contractViolations(algorithm, checkInvariants({ nodes: testCase.nodes, edges: testCase.edges, direction: testCase.direction, positions }))
      );
    } catch (err) {
      violations = [{ code: 'exception', message: err.message }];
    }

    if (violations.length > 0) {
      failures.push({ seed, algorithm, testCase, violations });
      const counts = violationCounts.get(algorithm);
      for (const v of violations) counts.set(v.code, (counts.get(v.code) || 0) + 1);
    }
  }

  if ((i + 1) % 50 === 0) process.stdout.write(`  ${i + 1}/${seedCount} 完了（違反ケース ${failures.length}件）\n`);
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${seedCount} seed × ${algorithms.length} アルゴリズム を ${elapsed}秒で検証しました。\n`);

console.log('='.repeat(80));
console.log('アルゴリズム別の契約違反');
console.log('='.repeat(80));
for (const algorithm of algorithms) {
  const counts = [...violationCounts.get(algorithm)].map(([code, n]) => `${code}:${n}`);
  console.log(`  ${algorithm.padEnd(14)} ${counts.length === 0 ? '違反なし' : counts.join(' ')}`);
}

if (failures.length === 0) {
  console.log('\nすべてのseedで契約を満たしました。');
  process.exit(0);
}

// 違反したケースを保存する。同じseedで複数アルゴリズムが落ちてもグラフは1つなので1ファイル
mkdirSync(outDir, { recursive: true });
const savedSeeds = new Set();
for (const failure of failures) {
  if (savedSeeds.has(failure.seed)) continue;
  savedSeeds.add(failure.seed);
  writeFileSync(
    path.join(outDir, `fuzz-${failure.seed}.json`),
    JSON.stringify(caseToMapJson(failure.testCase), null, 2) + '\n'
  );
}

console.log(`\n違反の詳細（先頭20件）:`);
for (const failure of failures.slice(0, 20)) {
  console.log(`  seed=${failure.seed} ${failure.algorithm} (${failure.testCase.note})`);
  for (const v of failure.violations.slice(0, 3)) console.log(`      ${v.code}: ${v.message}`);
  if (failure.violations.length > 3) console.log(`      ... 他 ${failure.violations.length - 3}件`);
}
if (failures.length > 20) console.log(`  ... 他 ${failures.length - 20}件`);

console.log(`\n違反したグラフを ${savedSeeds.size} 件保存しました: ${outDir}`);
console.log('恒久ケースにするなら e2e/fixtures/maps/ へコピーしてください（アプリのインポートでも開けます）。');
console.log('単体で再現するには: node scripts/layout-contact-sheet.mjs 実行後に、同じseedを');
console.log(`  node -e "import('./e2e/lib/layout-fuzz.mjs').then(m=>console.log(JSON.stringify(m.generateFuzzCase(${failures[0].seed}),null,2)))"`);
process.exitCode = 1;
