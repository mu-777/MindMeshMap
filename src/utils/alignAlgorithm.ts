// 整列アルゴリズムのディスパッチャ。Reactに依存しない純粋関数のため、
// テストから直接importできる。dev限定の切り替え（useAlignAlgorithmDebug）と
// useAutoLayout.tsの間に挟まる薄い層。
// 各アルゴリズムが何をどう計算しているかは docs/align-algorithms.md（詳細仕様）、
// なぜその方式なのかは docs/align-branch-layout.md（設計メモ）を参照
import { MapNode, MapEdge, LayoutDirection, AlignAlgorithm } from '../types';
import { LayoutResult, calculateLayout } from './layout';
import { calculateBranchLayout } from './branchLayout';
import { calculateFlatAxisLayout } from './flatAxisLayout';
import { calculateSugiyamaExtLayout } from './sugiyamaExtLayout';
import { calculateElkPortLayout } from './elkPortLayout';
import { calculateElkPortExtLayout } from './elkPortExtLayout';

export async function calculateLayoutForAlign(
  nodes: MapNode[],
  edges: MapEdge[],
  direction: LayoutDirection,
  algorithm: AlignAlgorithm
): Promise<LayoutResult> {
  switch (algorithm) {
    case 'branch':
      return calculateBranchLayout(nodes, edges, direction);
    case 'flat-axis':
      return calculateFlatAxisLayout(nodes, edges, direction);
    case 'sugiyama-ext':
      return calculateSugiyamaExtLayout(nodes, edges, direction);
    case 'elk-port':
      return calculateElkPortLayout(nodes, edges, direction);
    case 'elk-port-ext':
      return calculateElkPortExtLayout(nodes, edges, direction);
    case 'uniform':
    default:
      return calculateLayout(nodes, edges, direction);
  }
}
