// 整列アルゴリズム「flat-axis」（方針B: 2パス軸射影）。
// 手順の詳細仕様はdocs/align-algorithms.md §3、採用理由はdocs/align-branch-layout.md「方針B」。branchLayout.tsより単純な
// 軽量ベースラインで、branch（方針A）との比較用に実装している。
//
// 概要:
//   1. 全エッジをclassifyEdgeSide→sideAxisで横系（left/right）・縦系（top/bottom）に分割する
//   2. マップ全体に対して横系エッジのみ・縦系エッジのみで、それぞれ独立にELKを1回ずつ実行する
//      （runElkLayoutを流用、方向は固定でRIGHT/DOWN）
//   3. 各ノードの「支配軸」（そのノードへの入エッジのうちedges配列で最初に現れるものの軸。
//      入エッジが無いノードはマップのlayoutDirectionにフォールバック）を決め、対応するパスの
//      座標を採用する
// x座標とy座標が別々の最適化結果からの寄せ集めになるため、重なり回避等の理論的な一貫性は
// 保証されない点に注意（doc参照）
import { MapNode, MapEdge, LayoutDirection } from '../types';
import { LayoutResult, runElkLayout } from './layout';
import { classifyEdgeSide, HandleSide } from './branchLayout';

type Axis = 'horizontal' | 'vertical';

function sideAxis(side: HandleSide): Axis {
  return side === 'left' || side === 'right' ? 'horizontal' : 'vertical';
}

/**
 * 「flat-axis」アルゴリズムのエントリポイント。
 * 横系（left/right）・縦系（top/bottom）それぞれでマップ全体をELKにかけ、
 * ノードごとの支配軸に応じてx/y座標を使い分ける
 */
export async function calculateFlatAxisLayout(
  nodes: MapNode[],
  edges: MapEdge[],
  direction: LayoutDirection
): Promise<LayoutResult> {
  if (nodes.length === 0) {
    return { nodes: [] };
  }

  const horizontalEdges: MapEdge[] = [];
  const verticalEdges: MapEdge[] = [];
  for (const edge of edges) {
    const side = classifyEdgeSide(edge, direction);
    (sideAxis(side) === 'horizontal' ? horizontalEdges : verticalEdges).push(edge);
  }

  const [horizontalResult, verticalResult] = await Promise.all([
    runElkLayout(nodes, horizontalEdges, 'RIGHT'),
    runElkLayout(nodes, verticalEdges, 'DOWN'),
  ]);
  const horizontalById = new Map(horizontalResult.nodes.map((n) => [n.id, n.position]));
  const verticalById = new Map(verticalResult.nodes.map((n) => [n.id, n.position]));

  // 各ノードの支配軸：そのノードへの入エッジのうちedges配列で最初に現れるものの軸。
  // 入エッジが無いノード（ルート等）はマップのlayoutDirectionにフォールバック
  // （RIGHT→horizontal, DOWN→vertical）
  const dominantAxisById = new Map<string, Axis>();
  for (const edge of edges) {
    if (dominantAxisById.has(edge.target)) continue;
    dominantAxisById.set(edge.target, sideAxis(classifyEdgeSide(edge, direction)));
  }
  const fallbackAxis: Axis = direction === 'RIGHT' ? 'horizontal' : 'vertical';

  return {
    nodes: nodes.map((n) => {
      const axis = dominantAxisById.get(n.id) || fallbackAxis;
      const pos = axis === 'horizontal' ? horizontalById.get(n.id) : verticalById.get(n.id);
      return { id: n.id, position: pos || n.position };
    }),
  };
}
