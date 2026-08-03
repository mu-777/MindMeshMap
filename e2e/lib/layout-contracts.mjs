// アルゴリズムごとの「契約」＝破ってはいけない不変条件の宣言。
//
// layout-metrics.mjs は事実（違反の列挙）だけを返し、合否の判断はしない。その判断基準が
// このファイル。回帰テスト（e2e/layout-quality.mjs）とファズ（scripts/layout-fuzz.mjs）の
// 両方が同じ基準を使うため、判断が2箇所にぶれないようここへ一本化する。
//
// 契約に入っていない違反は「そのアルゴリズムが保証していないもの」として失敗にはせず、
// 件数の集計だけを行う。どれを契約に入れるか・その理由は docs/layout-lab.md の表で管理する。
import { INVARIANT_CODES } from './layout-metrics.mjs';

export const ALGORITHMS = [
  'uniform',
  'branch',
  'flat-axis',
  'sugiyama-ext',
  'sugiyama-port',
  'elk-port',
  'elk-port-ext',
  'elk-port-pava',
  'hola-lite',
];

export const CONTRACTS = {
  // ELKに丸投げするため重なりは起きない（ELKのspacing設定の回帰検知になる）
  uniform: [INVARIANT_CODES.NODE_OVERLAP],
  // 方針A: クロスバケットの重なりが設計上の既知の制限（docs/align-branch-layout.md）
  branch: [],
  // 方針B: x/yを別々の最適化結果から寄せ集めるため、重なり回避も向きも保証しない軽量ベースライン
  'flat-axis': [],
  // 方針E: ハンドルの向きどおりに配置し、ノードを重ねない
  'sugiyama-ext': [INVARIANT_CODES.NODE_OVERLAP, INVARIANT_CODES.HANDLE_DIRECTION],
  // 方針H（本番の既定）: 方針Eの派生。箱の再帰合成でノードを重ねず、バケットも同じくソース面の役割で
  // 決めるので契約は方針Eと同じ（docs/align-branch-layout.md「方針H」）
  'sugiyama-port': [INVARIANT_CODES.NODE_OVERLAP, INVARIANT_CODES.HANDLE_DIRECTION],
  // 方針F: uniformと同じくELKに配置を委ねるため重なりは起きない。ただしポート制約は
  // 「取り付き面」だけを制御し流れ方向は変えないため、HANDLE_DIRECTIONは契約に入れない
  // （docs/align-branch-layout.md「方針F」）
  'elk-port': [INVARIANT_CODES.NODE_OVERLAP],
  // 方針G: ELK layeredの忠実な再実装。Brandes–Köpfのバランス化後に最小間隔を復元するので
  // 重ならない。ポート制約は取り付き面だけを制御し流れ方向は変えないため、
  // HANDLE_DIRECTIONは契約に入れない（docs/align-branch-layout.md「方針G」）
  'elk-port-ext': [INVARIANT_CODES.NODE_OVERLAP],
  // 方針G': 層内はPAVAが最小間隔を守った配置を厳密に解き、層と層はLAYER_GAPで離れるので重ならない。
  // ポート制約は取り付き面だけを制御し流れ方向は変えないため、HANDLE_DIRECTIONは契約に入れない
  // （docs/align-branch-layout.md「方針G'」）
  'elk-port-pava': [INVARIANT_CODES.NODE_OVERLAP],
  // 方針I: HOLAの最小構成再実装。強制フォレスト（＝unambiguousTreeEdgesと同じ集合）を
  // ハンドルの向きどおりに置き、成分の箱は重ならないよう押し離すので、この2つを保証する
  // （docs/align-branch-layout.md「方針I」）
  'hola-lite': [INVARIANT_CODES.NODE_OVERLAP, INVARIANT_CODES.HANDLE_DIRECTION],
};

/** 全アルゴリズム共通で必ず守るもの（座標が返らない・壊れている、は契約以前の問題） */
export const UNIVERSAL_CONTRACT = [INVARIANT_CODES.MISSING_NODE, INVARIANT_CODES.NON_FINITE];

/** violations のうち、そのアルゴリズムの契約違反にあたるものだけを返す */
export function contractViolations(algorithm, violations) {
  const contract = [...UNIVERSAL_CONTRACT, ...(CONTRACTS[algorithm] || [])];
  return violations.filter((v) => contract.includes(v.code));
}
