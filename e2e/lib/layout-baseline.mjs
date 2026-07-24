// スコアのベースライン（前回値）との自動比較。
//
// 整列アルゴリズムは「良くしたつもりが別のところを悪くしていた」が起きやすい（重なりを消したら
// 交差が増えた等）。全ケース・全アルゴリズムのスコアを1ファイルに固定しておき、変更のたびに
// 突き合わせることで、意図しない悪化を機械的に検出する。
//
// 比較の強さを2段階に分けている:
//   - **STRICT_KEYS（品質の件数系）** — 1件でも増えたら悪化とみなす。ここは「良くなることはあっても
//     悪くなってはいけない」指標
//   - **それ以外の幾何指標** — 相対 GEOMETRY_TOLERANCE まで許容する。定数を少し触っただけで
//     面積や移動量は必ず微妙に動くため、そこまで失敗にすると調整のたびに赤くなって役に立たない
//   - **実行時間** — 実行環境に左右されるので比較対象から除外する
//
// 改善（ベースラインより良くなった）は失敗にせず報告のみ。確認したうえで
// `npm run layout:baseline` でベースラインを更新する運用。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { METRIC_DEFS } from './layout-metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BASELINE_PATH = path.join(__dirname, '..', 'fixtures', 'layout-baseline.json');

// 1件でも増えたら悪化とみなす指標（品質の根幹。良くなる方向にしか動いてはいけない）
export const STRICT_KEYS = ['nodeOverlapPairs', 'nodeOverlapArea', 'handleMismatch', 'edgeCrossings', 'edgeThroughNode'];
// 幾何指標の相対許容差（5%）
export const GEOMETRY_TOLERANCE = 0.05;
// 実行環境依存のため比較しない
const EXCLUDED_KEYS = ['elapsedMs'];

const COMPARED_KEYS = METRIC_DEFS.map((d) => d.key).filter((k) => !EXCLUDED_KEYS.includes(k));
const BETTER_BY_KEY = Object.fromEntries(METRIC_DEFS.map((d) => [d.key, d.better]));

function keyOf(caseId, algorithm) {
  return `${caseId}|${algorithm}`;
}

/** 実行結果（{caseId, algorithm, metrics}の配列）をベースライン形式へ変換する */
export function toBaseline(runs) {
  const entries = {};
  for (const run of runs) {
    if (!run.metrics) continue;
    const values = {};
    for (const key of COMPARED_KEYS) {
      // 浮動小数の表示ゆれで差分が出ないよう桁を丸める
      values[key] = Math.round(run.metrics[key] * 1e6) / 1e6;
    }
    entries[keyOf(run.caseId, run.algorithm)] = values;
  }
  return { version: 1, updatedAt: new Date().toISOString(), entries };
}

export function saveBaseline(runs, file = BASELINE_PATH) {
  writeFileSync(file, JSON.stringify(toBaseline(runs), null, 2) + '\n');
  return file;
}

export function loadBaseline(file = BASELINE_PATH) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf-8'));
}

/**
 * ベースラインと現在の結果を比較する。
 * 返り値: { regressions, improvements, added, missing } — regressionsが空でなければ悪化している
 */
export function compareToBaseline(baseline, runs) {
  const regressions = [];
  const improvements = [];
  const added = [];
  const seen = new Set();

  for (const run of runs) {
    if (!run.metrics) continue;
    const id = keyOf(run.caseId, run.algorithm);
    seen.add(id);
    const before = baseline.entries[id];
    if (!before) {
      added.push(id);
      continue;
    }
    for (const key of COMPARED_KEYS) {
      const prev = before[key];
      const now = Math.round(run.metrics[key] * 1e6) / 1e6;
      if (prev === undefined || prev === now) continue;

      const worse = BETTER_BY_KEY[key] === 'lower' ? now > prev : now < prev;
      const strict = STRICT_KEYS.includes(key);
      // 幾何指標は相対差が許容範囲なら「変化なし」とみなす
      const relative = prev === 0 ? (now === 0 ? 0 : Infinity) : Math.abs(now - prev) / Math.abs(prev);
      if (!strict && relative <= GEOMETRY_TOLERANCE) continue;

      const record = { caseId: run.caseId, algorithm: run.algorithm, key, before: prev, after: now, strict };
      (worse ? regressions : improvements).push(record);
    }
  }

  const missing = Object.keys(baseline.entries).filter((id) => !seen.has(id));
  return { regressions, improvements, added, missing };
}

/** 比較結果を人間向けの行の配列に整形する */
export function formatComparison({ regressions, improvements, added, missing }, { limit = 20 } = {}) {
  const lines = [];
  const format = (r) => `${r.caseId}/${r.algorithm} ${r.key}: ${r.before} → ${r.after}${r.strict ? '' : ' (幾何)'}`;

  if (regressions.length > 0) {
    lines.push(`悪化 ${regressions.length}件:`);
    for (const r of regressions.slice(0, limit)) lines.push(`  - ${format(r)}`);
    if (regressions.length > limit) lines.push(`  ... 他 ${regressions.length - limit}件`);
  }
  if (improvements.length > 0) {
    lines.push(`改善 ${improvements.length}件:`);
    for (const r of improvements.slice(0, limit)) lines.push(`  + ${format(r)}`);
    if (improvements.length > limit) lines.push(`  ... 他 ${improvements.length - limit}件`);
  }
  if (added.length > 0) lines.push(`ベースラインに無いケース ${added.length}件: ${added.slice(0, 5).join(', ')}${added.length > 5 ? ' ...' : ''}`);
  if (missing.length > 0) lines.push(`ベースラインにあるが今回実行されなかったケース ${missing.length}件: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' ...' : ''}`);
  if (lines.length === 0) lines.push('ベースラインと一致（変化なし）');
  return lines;
}
