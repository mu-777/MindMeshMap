// 整列結果（グラフ → 座標）の品質を機械的に測るための、不変条件チェックとスコア指標。
// docs/layout-lab.md 参照。
//
// 設計の要点:
//   - **不変条件（invariant）** は「破れていたら壊れている」もの。checkInvariants()が違反の配列を返す。
//     どのコードをどのアルゴリズムに課すかは呼び出し側（e2e/layout-quality.mjs）が宣言する。
//     アルゴリズムごとに保証する範囲が違う（例: flat-axisは重なり回避を保証しない）ため、
//     この層では「事実の検出」だけを行い、合否の判断はしない。
//   - **スコア（metric）** は合否ではなく比較用の数値。値が良い/悪いの向きは METRIC_DEFS に持つ。
//     「期待座標をケースごとに人が書く」形式は、アルゴリズムを触るたびに全書き直しになり、
//     期待値自体の誤りを誰も検知できない（docs/testing.md の「流儀」参照）ため採らない。
//
// エッジの形状について: 実描画はReact Flowのベジェ曲線（CustomEdge.tsxのgetBezierPath）だが、
// 交差数・ノード貫通の判定はハンドル位置どうしを結ぶ**直線**で近似する。曲線の膨らみぶんの
// 誤差は出るが、決定的で高速、かつアルゴリズム間の相対比較には十分（同じ近似を全アルゴリズムに
// 適用するため）。
import './ts-loader.mjs';

// classifyEdgeSideは整列アルゴリズム本体（branchLayout.ts）と同じものを使う。
// 判定ルールを二重に実装すると、片方だけ変わったときに指標が静かに嘘をつくため
// （動的importの理由はts-loader.mjs冒頭を参照）
const { classifyEdgeSide } = await import('../../src/utils/branchLayout.ts');

export const DEFAULT_NODE_WIDTH = 180;
export const DEFAULT_NODE_HEIGHT = 60;

// --- 幾何ユーティリティ ---

export function rectOf(node, position) {
  const w = node.width || DEFAULT_NODE_WIDTH;
  const h = node.height || DEFAULT_NODE_HEIGHT;
  return { minX: position.x, minY: position.y, maxX: position.x + w, maxY: position.y + h, w, h };
}

export function centerOf(rect) {
  return { x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 };
}

function overlapArea(a, b) {
  const dx = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const dy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}

/** ハンドル（辺の中点）の座標。React Flowのハンドルは各辺の中央に置かれている */
function anchorOf(rect, side) {
  switch (side) {
    case 'top':
      return { x: (rect.minX + rect.maxX) / 2, y: rect.minY };
    case 'bottom':
      return { x: (rect.minX + rect.maxX) / 2, y: rect.maxY };
    case 'left':
      return { x: rect.minX, y: (rect.minY + rect.maxY) / 2 };
    case 'right':
      return { x: rect.maxX, y: (rect.minY + rect.maxY) / 2 };
  }
}

/** targetHandleが無い/無効なときに、相手側から見て自然に向き合う辺を選ぶ */
function facingSide(fromCenter, toRect) {
  const c = centerOf(toRect);
  const dx = fromCenter.x - c.x;
  const dy = fromCenter.y - c.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/** エッジの始点・終点（ハンドル位置）を求める */
export function edgeAnchors(edge, sourceRect, targetRect, direction) {
  const side = classifyEdgeSide(edge, direction);
  const from = anchorOf(sourceRect, side);
  const th = edge.targetHandle;
  const tSide =
    th === 'top' || th === 'bottom' || th === 'left' || th === 'right' ? th : facingSide(from, targetRect);
  return { from, to: anchorOf(targetRect, tSide), side };
}

function ccw(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** 2線分が「真に」交差するか（端点の接触・平行重なりは交差に数えない） */
function segmentsCross(p1, p2, p3, p4) {
  const d1 = ccw(p3, p4, p1);
  const d2 = ccw(p3, p4, p2);
  const d3 = ccw(p1, p2, p3);
  const d4 = ccw(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// 矩形をこのぶん内側に縮めてから判定する(px)。辺に接するだけ（かすっただけ）を
// 「貫通」に数えないための余裕
const PIERCE_INSET = 1;

/**
 * 線分が矩形の内部を通るか（Liang-Barskyのクリッピング。端点が矩形内にある場合も真）。
 * clip(den, num) は不等式 den*t <= num を [t0,t1] に反映する。den<0 は「入る側」の境界、
 * den>0 は「出る側」の境界。ここの符号を取り違えると常にfalse（＝貫通を1件も検出しない
 * 見せかけのOK）になるため、e2e/layout-quality.mjs で陽性確認している。
 */
function segmentIntersectsRect(p, q, rect) {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const minX = rect.minX + PIERCE_INSET;
  const maxX = rect.maxX - PIERCE_INSET;
  const minY = rect.minY + PIERCE_INSET;
  const maxY = rect.maxY - PIERCE_INSET;
  if (minX >= maxX || minY >= maxY) return false;

  let t0 = 0;
  let t1 = 1;
  const clip = (den, num) => {
    if (den === 0) return num >= 0; // 境界に平行。矩形の外側なら不通過
    const t = num / den;
    if (den < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-dx, p.x - minX) && clip(dx, maxX - p.x) && clip(-dy, p.y - minY) && clip(dy, maxY - p.y)
  );
}

// --- グラフの前処理 ---

/**
 * 「向きの期待を課してよいエッジ」の集合を返す。
 *
 * 整列アルゴリズムはどれも、循環エッジと複数親の非採用側を位置計算から除外する
 * （どちらを採用するかはアルゴリズムごとに違う: branchはBFS、sugiyama-extは最深レイヤ）。
 * そのため「sourceHandleの向きに子が置かれているか」を全エッジに課すのは不公平になる。
 * ここでは**どのアルゴリズムでも必ず木エッジになるもの**、すなわち
 *   - target の入次数が1（親候補が1つしかない＝採用/非採用の選択の余地がない）
 *   - かつ DFS の後退辺（循環を閉じる辺）でない
 * だけを抽出する。判定はnodes/edgesの配列順のみに依存する決定的な処理。
 */
export function unambiguousTreeEdges(nodes, edges) {
  const inDegree = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) {
    if (inDegree.has(e.target)) inDegree.set(e.target, inDegree.get(e.target) + 1);
  }

  const outgoing = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (outgoing.has(e.source) && outgoing.has(e.target)) outgoing.get(e.source).push(e);
  }

  // DFSで後退辺を検出する（color: 0=未訪問, 1=探索中, 2=完了）
  const color = new Map(nodes.map((n) => [n.id, 0]));
  const backEdges = new Set();
  const visit = (id) => {
    color.set(id, 1);
    for (const e of outgoing.get(id)) {
      const c = color.get(e.target);
      if (c === 1) backEdges.add(e.id);
      else if (c === 0) visit(e.target);
    }
    color.set(id, 2);
  };
  // 入次数0から始めると自然な向きの木になる。残り（孤立循環）は配列順で拾う
  for (const n of nodes) if (inDegree.get(n.id) === 0 && color.get(n.id) === 0) visit(n.id);
  for (const n of nodes) if (color.get(n.id) === 0) visit(n.id);

  return edges.filter(
    (e) => e.source !== e.target && inDegree.get(e.target) === 1 && !backEdges.has(e.id)
  );
}

// --- 不変条件 ---

export const INVARIANT_CODES = {
  MISSING_NODE: 'missing-node',
  NON_FINITE: 'non-finite',
  NODE_OVERLAP: 'node-overlap',
  HANDLE_DIRECTION: 'handle-direction',
  EDGE_THROUGH_NODE: 'edge-through-node',
};

// 「親より右」等の判定に使う許容誤差(px)。ちょうど同じ座標を違反にしない
const EPS = 0.5;

/**
 * 整列結果の不変条件違反を列挙する。合否は判断せず、事実（違反の配列）だけを返す。
 * 返り値: [{ code, message }]
 */
export function checkInvariants({ nodes, edges, direction, positions }) {
  const violations = [];
  const push = (code, message) => violations.push({ code, message });

  // 1. 全ノードの座標が返っていること・有限であること
  for (const n of nodes) {
    const p = positions.get(n.id);
    if (!p) {
      push(INVARIANT_CODES.MISSING_NODE, `ノード ${n.id} の座標が返っていない`);
      continue;
    }
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      push(INVARIANT_CODES.NON_FINITE, `ノード ${n.id} の座標が有限でない (${p.x}, ${p.y})`);
    }
  }
  if (violations.length > 0) return violations; // 以降の幾何計算が成立しないので打ち切る

  const rects = new Map(nodes.map((n) => [n.id, rectOf(n, positions.get(n.id))]));

  // 2. ノード同士が重ならないこと
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const area = overlapArea(rects.get(nodes[i].id), rects.get(nodes[j].id));
      if (area > 0) {
        push(
          INVARIANT_CODES.NODE_OVERLAP,
          `${nodes[i].id} と ${nodes[j].id} が重なっている (${Math.round(area)}px²)`
        );
      }
    }
  }

  // 3. ハンドルの向きと実際の配置が一致すること（曖昧さの無い木エッジのみ）
  for (const e of unambiguousTreeEdges(nodes, edges)) {
    const s = rects.get(e.source);
    const t = rects.get(e.target);
    if (!s || !t) continue;
    const side = classifyEdgeSide(e, direction);
    const sc = centerOf(s);
    const tc = centerOf(t);
    const ok =
      side === 'right' ? tc.x > sc.x + EPS
      : side === 'left' ? tc.x < sc.x - EPS
      : side === 'bottom' ? tc.y > sc.y + EPS
      : tc.y < sc.y - EPS;
    if (!ok) {
      push(
        INVARIANT_CODES.HANDLE_DIRECTION,
        `エッジ ${e.id} (${e.source}→${e.target}) は ${side} ハンドルなのに子がその向きにない`
      );
    }
  }

  // 4. エッジが無関係なノードを貫通しないこと
  for (const e of edges) {
    const s = rects.get(e.source);
    const t = rects.get(e.target);
    if (!s || !t) continue;
    const { from, to } = edgeAnchors(e, s, t, direction);
    for (const n of nodes) {
      if (n.id === e.source || n.id === e.target) continue;
      if (segmentIntersectsRect(from, to, rects.get(n.id))) {
        push(
          INVARIANT_CODES.EDGE_THROUGH_NODE,
          `エッジ ${e.id} (${e.source}→${e.target}) がノード ${n.id} を貫通している`
        );
      }
    }
  }

  return violations;
}

// --- スコア指標 ---

// key: computeMetricsの返り値のキー / better: 良い方向 / label: 表示名
export const METRIC_DEFS = [
  { key: 'nodeOverlapPairs', label: '重なりノード対', better: 'lower', digits: 0 },
  { key: 'nodeOverlapArea', label: '重なり面積', better: 'lower', digits: 0 },
  { key: 'handleMismatch', label: 'ハンドル向き不一致', better: 'lower', digits: 0 },
  { key: 'edgeCrossings', label: 'エッジ交差', better: 'lower', digits: 0 },
  { key: 'edgeThroughNode', label: 'エッジのノード貫通', better: 'lower', digits: 0 },
  { key: 'areaKpx2', label: '描画面積(千px²)', better: 'lower', digits: 0 },
  { key: 'aspectRatio', label: '縦横比', better: 'lower', digits: 2 },
  { key: 'fillRatio', label: '充填率', better: 'higher', digits: 3 },
  { key: 'edgeLenCv', label: 'エッジ長ばらつき', better: 'lower', digits: 3 },
  { key: 'moveMean', label: '平均移動量', better: 'lower', digits: 0 },
  { key: 'moveMax', label: '最大移動量', better: 'lower', digits: 0 },
  { key: 'siblingInversion', label: '兄弟順の反転率', better: 'lower', digits: 3 },
  { key: 'elapsedMs', label: '実行時間(ms)', better: 'lower', digits: 0 },
];

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * 整列結果のスコアを計算する。合否ではなく、アルゴリズム間の比較・回帰検知のための数値。
 * before は整列前（入力）の位置。差分安定性（メンタルマップ保持）の指標に使う。
 */
export function computeMetrics({ nodes, edges, direction, positions, before, elapsedMs = 0 }) {
  const rects = new Map();
  for (const n of nodes) {
    const p = positions.get(n.id);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) rects.set(n.id, rectOf(n, p));
  }

  // ノードの重なり
  let nodeOverlapPairs = 0;
  let nodeOverlapArea = 0;
  const ids = [...rects.keys()];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const area = overlapArea(rects.get(ids[i]), rects.get(ids[j]));
      if (area > 0) {
        nodeOverlapPairs += 1;
        nodeOverlapArea += area;
      }
    }
  }

  // ハンドル向きの不一致（不変条件と同じ判定。件数だけを取り出す）
  const handleMismatch = checkInvariants({ nodes, edges, direction, positions }).filter(
    (v) => v.code === INVARIANT_CODES.HANDLE_DIRECTION
  ).length;

  // エッジの幾何
  const segments = [];
  for (const e of edges) {
    const s = rects.get(e.source);
    const t = rects.get(e.target);
    if (!s || !t || e.source === e.target) continue;
    const { from, to } = edgeAnchors(e, s, t, direction);
    segments.push({ edge: e, from, to });
  }

  let edgeCrossings = 0;
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i];
      const b = segments[j];
      // 端点を共有するエッジ（同じ親から出た兄弟等）は必ず接触するので交差に数えない
      if (
        a.edge.source === b.edge.source ||
        a.edge.source === b.edge.target ||
        a.edge.target === b.edge.source ||
        a.edge.target === b.edge.target
      ) {
        continue;
      }
      if (segmentsCross(a.from, a.to, b.from, b.to)) edgeCrossings += 1;
    }
  }

  let edgeThroughNode = 0;
  for (const seg of segments) {
    for (const n of nodes) {
      if (n.id === seg.edge.source || n.id === seg.edge.target) continue;
      const r = rects.get(n.id);
      if (r && segmentIntersectsRect(seg.from, seg.to, r)) edgeThroughNode += 1;
    }
  }

  // 外接矩形・面積・充填率
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let nodeArea = 0;
  for (const r of rects.values()) {
    minX = Math.min(minX, r.minX);
    minY = Math.min(minY, r.minY);
    maxX = Math.max(maxX, r.maxX);
    maxY = Math.max(maxY, r.maxY);
    nodeArea += r.w * r.h;
  }
  const bboxW = Math.max(1, maxX - minX);
  const bboxH = Math.max(1, maxY - minY);
  const areaKpx2 = (bboxW * bboxH) / 1000;
  const aspectRatio = Math.max(bboxW, bboxH) / Math.min(bboxW, bboxH);
  const fillRatio = nodeArea / (bboxW * bboxH);

  // エッジ長のばらつき（変動係数）。値が揃っているほど整って見える
  const lengths = segments.map((s) => Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y));
  const lenMean = mean(lengths);
  const edgeLenCv = lenMean === 0 ? 0 : Math.sqrt(mean(lengths.map((l) => (l - lenMean) ** 2))) / lenMean;

  // メンタルマップ保持: 整列前からの移動量
  const moves = [];
  for (const n of nodes) {
    const a = before?.get(n.id);
    const b = positions.get(n.id);
    if (a && b && Number.isFinite(b.x) && Number.isFinite(b.y)) {
      moves.push(Math.hypot(b.x - a.x, b.y - a.y));
    }
  }

  return {
    nodeOverlapPairs,
    nodeOverlapArea: Math.round(nodeOverlapArea),
    handleMismatch,
    edgeCrossings,
    edgeThroughNode,
    areaKpx2,
    aspectRatio,
    fillRatio,
    edgeLenCv,
    moveMean: mean(moves),
    moveMax: moves.length === 0 ? 0 : Math.max(...moves),
    siblingInversion: siblingInversionRatio({ nodes, edges, direction, positions, before }),
    elapsedMs,
  };
}

/**
 * 兄弟ノードの並び順が整列前後で保たれた割合（0=完全保持, 1=全反転）。
 * 同じ親の同じハンドルに繋がった子を1グループとし、cross軸（RIGHT時はy、DOWN時はx）方向の
 * 順序について、整列前後で入れ替わった対の割合を数える。ELKのINTERACTIVE戦略が狙っている
 * 「現在の並びを保つ」がどれだけ効いているかの指標（docs/decisions.md §26）
 */
export function siblingInversionRatio({ nodes, edges, direction, positions, before }) {
  if (!before) return 0;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const groups = new Map();
  for (const e of edges) {
    if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue;
    const key = `${e.source}|${classifyEdgeSide(e, direction)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e.target);
  }

  const crossOf = (id, posMap) => {
    const p = posMap.get(id);
    const n = nodeById.get(id);
    if (!p || !n) return null;
    return direction === 'RIGHT'
      ? p.y + (n.height || DEFAULT_NODE_HEIGHT) / 2
      : p.x + (n.width || DEFAULT_NODE_WIDTH) / 2;
  };

  let pairs = 0;
  let inverted = 0;
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a0 = crossOf(members[i], before);
        const b0 = crossOf(members[j], before);
        const a1 = crossOf(members[i], positions);
        const b1 = crossOf(members[j], positions);
        if (a0 === null || b0 === null || a1 === null || b1 === null) continue;
        if (a0 === b0) continue; // 元の順序が決まっていない対は数えない
        pairs += 1;
        if (Math.sign(a1 - b1) !== Math.sign(a0 - b0)) inverted += 1;
      }
    }
  }
  return pairs === 0 ? 0 : inverted / pairs;
}
