// 整列アルゴリズムの「コンタクトシート」生成＋採点スクリプト。
// ケース（e2e/lib/layout-cases.mjs）× アルゴリズム（uniform/branch/flat-axis/sugiyama-ext）を
// 総当たりで実行し、
//   1. 1枚のSVGにグリッドで並べて描画する（＝目視で一望するためのコンタクトシート）
//   2. スコア指標（e2e/lib/layout-metrics.mjs）を表で出力する
//   3. scores.json に全数値を書き出す（前後比較・回帰検知用）
//   4. ベースライン（e2e/fixtures/layout-baseline.json）との差分表示・更新
// ブラウザもdevサーバも不要（src配下の.tsを直接importして実行する。docs/layout-lab.md参照）。
//
// 実行:
//   node scripts/layout-contact-sheet.mjs
//   node scripts/layout-contact-sheet.mjs --algorithms=sugiyama-ext,branch --cases=b- --scale
//   node scripts/layout-contact-sheet.mjs --out=/tmp/lab --no-svg
//   node scripts/layout-contact-sheet.mjs --scale --compare          # ベースラインとの全指標の差分
//   node scripts/layout-contact-sheet.mjs --scale --update-baseline  # ベースラインを更新
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../e2e/lib/ts-loader.mjs';
import { buildCases } from '../e2e/lib/layout-cases.mjs';
import {
  computeMetrics,
  checkInvariants,
  rectOf,
  edgeAnchors,
  METRIC_DEFS,
  INVARIANT_CODES,
} from '../e2e/lib/layout-metrics.mjs';
import { ALGORITHMS as ALL_ALGORITHMS } from '../e2e/lib/layout-contracts.mjs';
import { loadBaseline, saveBaseline, compareToBaseline, formatComparison, BASELINE_PATH } from '../e2e/lib/layout-baseline.mjs';

const { calculateLayoutForAlign } = await import('../src/utils/alignAlgorithm.ts');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- 引数 ---
const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => args.includes(`--${name}`);

const algorithms = (flag('algorithms') || ALL_ALGORITHMS.join(',')).split(',').filter(Boolean);
const caseFilter = flag('cases');
const outDir = path.resolve(flag('out') || path.join(__dirname, '..', 'layout-lab-out'));
const writeSvg = !has('no-svg');

for (const algo of algorithms) {
  if (!ALL_ALGORITHMS.includes(algo)) {
    console.error(`未知のアルゴリズム: ${algo}（有効: ${ALL_ALGORITHMS.join(', ')}）`);
    process.exit(1);
  }
}

// --- 実行 ---

/** 1ケース×1アルゴリズムを実行し、位置・指標・不変条件違反・決定性を返す */
export async function runOne(testCase, algorithm) {
  const before = new Map(testCase.nodes.map((n) => [n.id, { ...n.position }]));
  const started = performance.now();
  const result = await calculateLayoutForAlign(testCase.nodes, testCase.edges, testCase.direction, algorithm);
  const elapsedMs = performance.now() - started;
  const positions = new Map(result.nodes.map((n) => [n.id, n.position]));

  // 決定性: 同じ入力で2回目を実行し、完全一致するか
  const second = await calculateLayoutForAlign(testCase.nodes, testCase.edges, testCase.direction, algorithm);
  const deterministic = JSON.stringify(result) === JSON.stringify(second);

  const context = { nodes: testCase.nodes, edges: testCase.edges, direction: testCase.direction, positions, before };
  return {
    caseId: testCase.id,
    algorithm,
    positions,
    deterministic,
    violations: checkInvariants(context),
    metrics: computeMetrics({ ...context, elapsedMs }),
  };
}

const cases = (await buildCases({ includeScale: has('scale') })).filter(
  (c) => !caseFilter || c.id.includes(caseFilter)
);
if (cases.length === 0) {
  console.error(`条件に合うケースがありません（--cases=${caseFilter}）`);
  process.exit(1);
}

console.log(`${cases.length} ケース × ${algorithms.length} アルゴリズムを実行します...\n`);

const runs = new Map(); // `${caseId}|${algorithm}` → run
for (const testCase of cases) {
  for (const algorithm of algorithms) {
    let run;
    try {
      run = await runOne(testCase, algorithm);
    } catch (err) {
      run = {
        caseId: testCase.id,
        algorithm,
        error: err.message,
        positions: new Map(),
        deterministic: false,
        violations: [],
        metrics: null,
      };
    }
    runs.set(`${testCase.id}|${algorithm}`, run);
  }
  process.stdout.write('.');
}
process.stdout.write('\n\n');

// --- 表の出力 ---

const VIOLATION_LABELS = {
  [INVARIANT_CODES.MISSING_NODE]: '欠落',
  [INVARIANT_CODES.NON_FINITE]: '非有限',
  [INVARIANT_CODES.NODE_OVERLAP]: '重なり',
  [INVARIANT_CODES.HANDLE_DIRECTION]: '向き',
  [INVARIANT_CODES.EDGE_THROUGH_NODE]: '貫通',
};

function violationSummary(run) {
  if (run.error) return 'ERROR';
  const counts = new Map();
  for (const v of run.violations) counts.set(v.code, (counts.get(v.code) || 0) + 1);
  const parts = [...counts].map(([code, n]) => `${VIOLATION_LABELS[code] || code}:${n}`);
  if (!run.deterministic) parts.unshift('非決定的');
  return parts.length === 0 ? 'OK' : parts.join(' ');
}

function pad(text, width) {
  const str = String(text);
  // 全角文字を2桁として数え、日本語混じりでも列が揃うようにする
  const visualWidth = [...str].reduce((sum, ch) => sum + (/[^\x00-\xff]/.test(ch) ? 2 : 1), 0);
  return str + ' '.repeat(Math.max(0, width - visualWidth));
}

console.log('='.repeat(100));
console.log('ケース別の不変条件チェック（OK以外は「違反の種類:件数」）');
console.log('='.repeat(100));
console.log(pad('ケース', 26) + algorithms.map((a) => pad(a, 28)).join(''));
console.log('-'.repeat(100));
let lastGroup = null;
for (const testCase of cases) {
  if (testCase.group !== lastGroup) {
    lastGroup = testCase.group;
    console.log(`[${lastGroup}]`);
  }
  const row = algorithms.map((a) => pad(violationSummary(runs.get(`${testCase.id}|${a}`)), 28)).join('');
  console.log(pad(`  ${testCase.id}`, 26) + row);
}

console.log('\n' + '='.repeat(100));
console.log('スコア合計（全ケース合算。★=そのアルゴリズムが最良）');
console.log('='.repeat(100));
console.log(pad('指標', 26) + algorithms.map((a) => pad(a, 18)).join(''));
console.log('-'.repeat(100));
const totals = new Map(algorithms.map((a) => [a, {}]));
for (const def of METRIC_DEFS) {
  for (const a of algorithms) {
    const values = cases
      .map((c) => runs.get(`${c.id}|${a}`).metrics)
      .filter(Boolean)
      .map((m) => m[def.key]);
    // 比率・実行時間は平均、件数・面積は合計のほうが読みやすい
    const isAverage = ['aspectRatio', 'fillRatio', 'edgeLenCv', 'siblingInversion', 'moveMean'].includes(def.key);
    const value = values.length === 0 ? 0 : isAverage ? values.reduce((x, y) => x + y, 0) / values.length : values.reduce((x, y) => x + y, 0);
    totals.get(a)[def.key] = value;
  }
  const values = algorithms.map((a) => totals.get(a)[def.key]);
  const best = def.better === 'lower' ? Math.min(...values) : Math.max(...values);
  const cells = algorithms.map((a, i) => {
    const mark = values[i] === best ? '★' : ' ';
    return pad(`${values[i].toFixed(def.digits)}${mark}`, 18);
  });
  console.log(pad(`${def.label}${def.better === 'lower' ? '↓' : '↑'}`, 26) + cells.join(''));
}

// --- SVG コンタクトシート ---

const CELL_W = 460;
const CELL_H = 330;
const HEADER_H = 26;
const PADDING = 16;

function escapeXml(text) {
  return String(text).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
}

/** セルに描くノード矩形と、その外接矩形・単独で描いた場合の縮尺を求める */
function cellGeometry(testCase, run) {
  const rects = new Map();
  for (const n of testCase.nodes) {
    const p = run.positions.get(n.id);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) rects.set(n.id, rectOf(n, p));
  }
  if (rects.size === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects.values()) {
    minX = Math.min(minX, r.minX); minY = Math.min(minY, r.minY);
    maxX = Math.max(maxX, r.maxX); maxY = Math.max(maxY, r.maxY);
  }
  const drawW = CELL_W - PADDING * 2;
  const drawH = CELL_H - HEADER_H - PADDING;
  const fitScale = Math.min(drawW / Math.max(1, maxX - minX), drawH / Math.max(1, maxY - minY), 1);
  return { rects, minX, minY, maxX, maxY, fitScale };
}

/**
 * 1セル分（1ケース×1アルゴリズム）の描画。cellX/cellYはセル左上のシート座標。
 * scaleは行（同じケース）内で共通の縮尺。セルごとにフィットさせると
 * 「どのアルゴリズムがコンパクトか」が見た目から消えてしまうため、行内で揃える
 */
function renderCell(testCase, run, cellX, cellY, scale) {
  const parts = [];
  const label = run.error ? `${run.algorithm} — ERROR` : `${run.algorithm} — ${violationSummary(run)}`;
  const labelColor = run.error || violationSummary(run) !== 'OK' ? '#c0392b' : '#2d7a3e';
  parts.push(
    `<rect x="${cellX}" y="${cellY}" width="${CELL_W}" height="${CELL_H}" fill="#ffffff" stroke="#d0d0d0"/>`,
    `<text x="${cellX + 8}" y="${cellY + 17}" font-size="13" font-family="monospace" fill="${labelColor}">${escapeXml(label)}</text>`
  );
  if (run.error) {
    parts.push(
      `<text x="${cellX + 8}" y="${cellY + 40}" font-size="11" font-family="monospace" fill="#c0392b">${escapeXml(run.error.slice(0, 60))}</text>`
    );
    return parts.join('\n');
  }

  const geometry = cellGeometry(testCase, run);
  if (!geometry) return parts.join('\n');
  const { rects, minX, minY, maxX, maxY } = geometry;

  const drawW = CELL_W - PADDING * 2;
  const drawH = CELL_H - HEADER_H - PADDING;
  const offX = cellX + PADDING + (drawW - (maxX - minX) * scale) / 2;
  const offY = cellY + HEADER_H + (drawH - (maxY - minY) * scale) / 2;
  const tx = (x) => offX + (x - minX) * scale;
  const ty = (y) => offY + (y - minY) * scale;

  // 問題のあるノード・エッジを色分けするため、違反から対象idを引けるようにしておく
  const overlapping = new Set();
  const piercedEdges = new Set();
  for (const v of run.violations) {
    if (v.code === INVARIANT_CODES.NODE_OVERLAP) {
      const m = v.message.match(/^(\S+) と (\S+)/);
      if (m) { overlapping.add(m[1]); overlapping.add(m[2]); }
    } else if (v.code === INVARIANT_CODES.EDGE_THROUGH_NODE) {
      const m = v.message.match(/^エッジ (\S+)/);
      if (m) piercedEdges.add(m[1]);
    }
  }
  const misdirected = new Set(
    run.violations
      .filter((v) => v.code === INVARIANT_CODES.HANDLE_DIRECTION)
      .map((v) => (v.message.match(/^エッジ (\S+)/) || [])[1])
      .filter(Boolean)
  );

  // エッジ（React Flowと同様のベジェ曲線。制御点はハンドルの外向き法線方向へ伸ばす）
  const NORMAL = { right: [1, 0], left: [-1, 0], top: [0, -1], bottom: [0, 1] };
  for (const e of testCase.edges) {
    const s = rects.get(e.source);
    const t = rects.get(e.target);
    if (!s || !t) continue;
    if (e.source === e.target) continue; // 自己ループは曲線が潰れるため描画を省く
    const { from, to, side } = edgeAnchors(e, s, t, testCase.direction);
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const bend = Math.max(30, dist * 0.25);
    const [nx, ny] = NORMAL[side];
    const c1 = { x: from.x + nx * bend, y: from.y + ny * bend };
    const c2 = { x: to.x + (from.x - to.x) * 0.15, y: to.y + (from.y - to.y) * 0.15 };
    const color = piercedEdges.has(e.id) ? '#e67e22' : misdirected.has(e.id) ? '#c0392b' : '#9aa5b1';
    parts.push(
      `<path d="M ${tx(from.x).toFixed(1)} ${ty(from.y).toFixed(1)} C ${tx(c1.x).toFixed(1)} ${ty(c1.y).toFixed(1)}, ${tx(c2.x).toFixed(1)} ${ty(c2.y).toFixed(1)}, ${tx(to.x).toFixed(1)} ${ty(to.y).toFixed(1)}" fill="none" stroke="${color}" stroke-width="${piercedEdges.has(e.id) || misdirected.has(e.id) ? 1.8 : 1.1}"/>`
    );
  }

  // ノード
  for (const n of testCase.nodes) {
    const r = rects.get(n.id);
    if (!r) continue;
    const bad = overlapping.has(n.id);
    parts.push(
      `<rect x="${tx(r.minX).toFixed(1)}" y="${ty(r.minY).toFixed(1)}" width="${(r.w * scale).toFixed(1)}" height="${(r.h * scale).toFixed(1)}" rx="3" fill="${bad ? '#fdecea' : '#eef3f9'}" stroke="${bad ? '#c0392b' : '#5b7ba0'}" stroke-width="${bad ? 1.6 : 0.9}"/>`
    );
    if (scale > 0.28 && testCase.nodes.length <= 40) {
      parts.push(
        `<text x="${tx((r.minX + r.maxX) / 2).toFixed(1)}" y="${(ty((r.minY + r.maxY) / 2) + 3).toFixed(1)}" font-size="9" font-family="monospace" fill="#41546b" text-anchor="middle">${escapeXml(n.id)}</text>`
      );
    }
  }

  // 指標の抜粋（セル右下）
  const m = run.metrics;
  const summary = `交差${m.edgeCrossings} 貫通${m.edgeThroughNode} 面積${Math.round(m.areaKpx2)}k 移動${Math.round(m.moveMean)} ${Math.round(m.elapsedMs)}ms`;
  parts.push(
    `<text x="${cellX + CELL_W - 8}" y="${cellY + CELL_H - 7}" font-size="10" font-family="monospace" fill="#8a94a0" text-anchor="end">${escapeXml(summary)}</text>`
  );
  return parts.join('\n');
}

function renderSheet(groupCases) {
  const ROW_LABEL_H = 30;
  const rowH = CELL_H + ROW_LABEL_H;
  const width = CELL_W * algorithms.length + 8;
  const height = rowH * groupCases.length + 40;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="sans-serif">`,
    `<rect width="${width}" height="${height}" fill="#f7f8fa"/>`,
    `<text x="8" y="22" font-size="15" font-weight="bold" fill="#333">${escapeXml(groupCases[0].group)}</text>`,
  ];
  groupCases.forEach((testCase, row) => {
    const y = 40 + row * rowH;
    parts.push(
      `<text x="8" y="${y + 18}" font-size="13" fill="#333"><tspan font-family="monospace" font-weight="bold">${escapeXml(testCase.id)}</tspan>  ${escapeXml(testCase.title)}  <tspan font-size="11" fill="#7a828c">(${escapeXml(testCase.direction)}, ${testCase.nodes.length}ノード)  ${escapeXml(testCase.note)}</tspan></text>`
    );
    // 行内で最も縮尺の小さいセルに合わせ、同じ行のセルを同一縮尺で描く
    const rowRuns = algorithms.map((a) => runs.get(`${testCase.id}|${a}`));
    const scales = rowRuns.map((r) => cellGeometry(testCase, r)?.fitScale).filter((s) => s !== undefined);
    const rowScale = scales.length === 0 ? 1 : Math.min(...scales);
    rowRuns.forEach((run, col) => {
      parts.push(renderCell(testCase, run, 4 + col * CELL_W, y + ROW_LABEL_H, rowScale));
    });
  });
  parts.push('</svg>');
  return parts.join('\n');
}

mkdirSync(outDir, { recursive: true });
const scores = [];
for (const testCase of cases) {
  for (const algorithm of algorithms) {
    const run = runs.get(`${testCase.id}|${algorithm}`);
    scores.push({
      caseId: testCase.id,
      group: testCase.group,
      algorithm,
      deterministic: run.deterministic,
      error: run.error || null,
      violations: run.violations.reduce((acc, v) => ({ ...acc, [v.code]: (acc[v.code] || 0) + 1 }), {}),
      metrics: run.metrics,
    });
  }
}
writeFileSync(path.join(outDir, 'scores.json'), JSON.stringify({ generatedAt: new Date().toISOString(), algorithms, scores }, null, 2));

// --- ベースライン（前回値）との比較・更新 ---

// ベースラインは「全ケース×全アルゴリズム」で作られている前提。絞り込んだ実行で上書きすると
// 残りのケースがベースラインから消えて、以後の比較が素通りしてしまう
const isFullRun = !caseFilter && has('scale') && algorithms.length === ALL_ALGORITHMS.length;

if (has('update-baseline')) {
  if (!isFullRun) {
    console.error('\nベースラインの更新は全ケース・全アルゴリズムでの実行が必要です: node scripts/layout-contact-sheet.mjs --scale --update-baseline');
    process.exit(1);
  }
  saveBaseline(scores);
  console.log(`\nベースラインを更新しました: ${BASELINE_PATH}`);
} else if (has('compare')) {
  const baseline = loadBaseline();
  if (!baseline) {
    console.log(`\nベースラインがまだありません（${BASELINE_PATH}）。--update-baseline で作成できます`);
  } else {
    console.log(`\n${'='.repeat(100)}\nベースラインとの差分（${baseline.updatedAt} 時点）\n${'='.repeat(100)}`);
    for (const line of formatComparison(compareToBaseline(baseline, scores), { limit: 40 })) console.log(line);
    if (!isFullRun) console.log('（絞り込み実行のため、対象外のケースは「実行されなかった」として表示されます）');
  }
}

if (writeSvg) {
  const groups = [...new Set(cases.map((c) => c.group))];
  const files = [];
  for (const group of groups) {
    const groupCases = cases.filter((c) => c.group === group);
    const file = `${group.split('.')[0].trim().toLowerCase()}.svg`;
    // 同名ファイルの取り違えを防ぐため、生成前に古いSVGを消しておく
    rmSync(path.join(outDir, file), { force: true });
    writeFileSync(path.join(outDir, file), renderSheet(groupCases));
    files.push({ file, group, count: groupCases.length });
  }
  const html = [
    '<!doctype html><meta charset="utf-8"><title>整列コンタクトシート</title>',
    '<style>body{font-family:sans-serif;margin:24px;background:#f7f8fa;color:#222}img{max-width:100%;border:1px solid #ccc;background:#fff}h2{margin-top:32px}</style>',
    `<h1>整列アルゴリズム コンタクトシート</h1><p>生成: ${new Date().toISOString()} / アルゴリズム: ${algorithms.join(', ')} / ${cases.length}ケース</p>`,
    '<p>赤枠=ノードの重なり、赤線=ハンドルの向きと逆、橙線=ノードを貫通するエッジ。</p>',
    ...files.map((f) => `<h2>${escapeXml(f.group)}（${f.count}ケース）</h2><img src="${f.file}" alt="${escapeXml(f.group)}">`),
  ].join('\n');
  writeFileSync(path.join(outDir, 'index.html'), html);
  console.log(`\nコンタクトシート: ${path.join(outDir, 'index.html')}`);
}
console.log(`スコアJSON:       ${path.join(outDir, 'scores.json')}`);
