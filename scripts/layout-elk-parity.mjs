#!/usr/bin/env node
// elk-port（elkjs本体）と elk-port-ext（ELK非依存の再実装）の**一致度**を測る。
//
// 他のアルゴリズムは「スコアが良いほど良い」だが、elk-port-ext だけは目標が
// 「elk-port と同じ結果を出すこと」なので、良し悪しではなく**近さ**で評価する必要がある。
// スコア表（layout-contact-sheet.mjs）では近さまでは分からないため、同じ入力を両方に
// 食わせてノード座標を直接突き合わせるこのスクリプトを別に用意している。
//
//   node scripts/layout-elk-parity.mjs                 # 43ケース（--scale込み）
//   node scripts/layout-elk-parity.mjs --cases=a-      # ケースIDの前方一致で絞る
//   node scripts/layout-elk-parity.mjs --verbose       # 一致しないノードを個別に表示
//
// 位置づけと結果の読み方は docs/layout-lab.md「ELK再現度」、
// 何をどこまで合わせたかは docs/align-algorithms.md §6.0 を参照。
import '../e2e/lib/ts-loader.mjs';
import { buildCases } from '../e2e/lib/layout-cases.mjs';

const args = process.argv.slice(2);
const prefix = (args.find((a) => a.startsWith('--cases=')) || '').replace('--cases=', '');
const verbose = args.includes('--verbose');

const { calculateElkPortLayout } = await import('../src/utils/elkPortLayout.ts');
const { calculateElkPortExtLayout } = await import('../src/utils/elkPortExtLayout.ts');
const { calculateElkPortPavaLayout } = await import('../src/utils/elkPortPavaLayout.ts');

// 一致とみなす許容差(px)。ELKは整数座標を返すので、丸め誤差だけを吸収する幅にしてある
const TOLERANCE = 0.5;

const cases = (await buildCases({ includeScale: true })).filter((c) => !prefix || c.id.startsWith(prefix));
if (cases.length === 0) {
  console.error(`--cases=${prefix} に一致するケースがありません`);
  process.exit(1);
}

/** 基準（elk-port）に対する一致度を測る */
function agreement(reference, candidate) {
  const ref = new Map(reference.nodes.map((n) => [n.id, n.position]));
  let max = 0;
  let sum = 0;
  let matched = 0;
  const misses = [];
  for (const n of candidate.nodes) {
    const p = ref.get(n.id);
    const d = Math.hypot(n.position.x - p.x, n.position.y - p.y);
    max = Math.max(max, d);
    sum += d;
    if (d < TOLERANCE) matched += 1;
    else misses.push({ id: n.id, elk: p, own: n.position, d });
  }
  const n = candidate.nodes.length;
  return { max, mean: sum / n, ratio: matched / n, misses };
}

const rows = [];
for (const c of cases) {
  const dir = c.direction || 'RIGHT';
  const reference = await calculateElkPortLayout(c.nodes, c.edges, dir);
  rows.push({
    id: c.id,
    n: c.nodes.length,
    ext: agreement(reference, calculateElkPortExtLayout(c.nodes, c.edges, dir)),
    pava: agreement(reference, calculateElkPortPavaLayout(c.nodes, c.edges, dir)),
  });
}

console.log('elk-port（elkjs本体）に対する一致度  ※ elk-port-pava は「寄せていない版」の参考値');
console.log('='.repeat(96));
console.log(
  'ケース'.padEnd(26) + ' ノード | ext 最大Δ  ext 平均Δ ext 一致率 | pava一致率'
);
console.log('-'.repeat(96));
for (const r of rows) {
  const flag = r.ext.max < TOLERANCE ? '✓' : ' ';
  console.log(
    `${flag} ${r.id.padEnd(24)} ${String(r.n).padStart(5)} | ` +
      `${r.ext.max.toFixed(0).padStart(9)} ${r.ext.mean.toFixed(0).padStart(9)} ` +
      `${(r.ext.ratio * 100).toFixed(0).padStart(9)}% | ${(r.pava.ratio * 100).toFixed(0).padStart(9)}%`
  );
  if (verbose) {
    for (const m of r.ext.misses) {
      console.log(
        `      ${m.id.padEnd(20)} elk=(${m.elk.x},${m.elk.y}) ext=(${m.own.x},${m.own.y}) Δ=${m.d.toFixed(0)}`
      );
    }
  }
}

const avg = (f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
const exact = (k) => rows.filter((r) => r[k].max < TOLERANCE).length;
console.log('-'.repeat(96));
console.log(`ケース完全一致    : elk-port-ext ${exact('ext')}/${rows.length}   （参考）elk-port-pava ${exact('pava')}/${rows.length}`);
console.log(`ノード一致率の平均: elk-port-ext ${(avg((r) => r.ext.ratio) * 100).toFixed(1)}%   （参考）elk-port-pava ${(avg((r) => r.pava.ratio) * 100).toFixed(1)}%`);
console.log(`平均Δの平均       : elk-port-ext ${avg((r) => r.ext.mean).toFixed(0)}px   （参考）elk-port-pava ${avg((r) => r.pava.mean).toFixed(0)}px`);
