// 整列アルゴリズム「branch」（方針A: 再帰的ブランチ合成）。
// ノードの右側についた子と下側についた子を別方向でレイアウトするための実装。
// 設計の詳細・検討経緯はdocs/align-branch-layout.mdを参照（このファイルは同メモの
// 「方針A: branch」節をそのまま実装したもの）。
//
// 概要:
//   1. 各エッジをsourceHandle（無ければマップのlayoutDirection）からtop/bottom/left/rightに分類する
//   2. BFSで全域木を構築し、各ノードの「主たる親」を確定する（複数親の場合のタイブレークもここで解決）
//   3. 各ノードについて、tree edgeの子をtop/bottom/left/rightの最大4バケットに分ける
//   4. ボトムアップ再帰: 子を先に再帰でレイアウトしサイズ確定済みの「箱」にしてから、
//      自分自身とバケット内の子をバケットの向きに対応するELK方向で1回レイアウトする
//   5. 結果からローカル原点(0,0)基準の相対オフセットを求め、親のローカル座標系に合成する
//   6. 複数root（森）の場合は、root同士をさらに1回ELKで配置してから絶対座標に変換する
import { MapNode, MapEdge, LayoutDirection } from '../types';
import { LayoutResult, runElkLayout } from './layout';

export type HandleSide = 'top' | 'bottom' | 'left' | 'right';

const SIDES: HandleSide[] = ['right', 'bottom', 'left', 'top'];

const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 60;

/**
 * エッジがノードのどちら側から出ているかを判定する。
 * sourceHandleがtop/bottom/left/rightのいずれかならそれをそのまま使い、
 * 無効・未設定（旧データ等）ならマップのlayoutDirectionにフォールバックする
 * （RIGHT→right、DOWN→bottom。docs/align-branch-layout.md「分類ルール」参照）
 */
export function classifyEdgeSide(edge: MapEdge, fallbackDirection: LayoutDirection): HandleSide {
  const handle = edge.sourceHandle;
  if (handle === 'top' || handle === 'bottom' || handle === 'left' || handle === 'right') {
    return handle;
  }
  return fallbackDirection === 'RIGHT' ? 'right' : 'bottom';
}

/** ハンドル側をELKのelk.direction値に対応させる（単純な1対1対応） */
export function sideToElkDirection(side: HandleSide): 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' {
  switch (side) {
    case 'top':
      return 'UP';
    case 'bottom':
      return 'DOWN';
    case 'left':
      return 'LEFT';
    case 'right':
      return 'RIGHT';
  }
}

// ボトムアップ再帰で確定する、あるノードを根とするサブツリーの「箱」。
// localPositionsは、このノード自身を原点(0,0)としたローカル座標系での
// 自分自身＋全子孫の相対位置（負の座標もありうる。正規化はしない）。
// minX/minYは、その原点(0,0)から見た箱の実際の左上のオフセット（LEFT/UP方向の
// 子孫を持つ場合は負になる＝非対称な箱になる）。箱を「原子ノード」としてELKへ渡す際に
// 位置ヒントを補正するために必要（下記computeSubtreeBox内のコメント参照）
interface SubtreeBox {
  width: number;
  height: number;
  minX: number;
  minY: number;
  localPositions: Map<string, { x: number; y: number }>;
}

/**
 * BFSで全域木（森）を構築する。
 * 採用ルール（docs/align-branch-layout.md「複数親の扱い」参照）:
 *   - 入次数0（全エッジ基準）のノードをnodes配列順でroot候補にする
 *   - 入次数0のノードが1つも無ければnodes[0]を仮rootにする
 *   - root群からの多元BFSで全域木を構築する。訪問順はキュー投入順（＝nodes/edges配列順）で
 *     決定的。各ノードについて最初に発見された経路の親エッジを「主たる親（tree edge）」とする
 *   - それでも訪問されないノードが残る場合（入次数0のノードが存在しない孤立循環コンポーネント）、
 *     nodes配列順で最初に見つかった未訪問ノードを仮rootとしてBFSをやり直す（複数残っていれば
 *     コンポーネントごとに繰り返す）
 * 主たる親に選ばれなかったエッジ（循環エッジ・複数親の非採用側）は「追加エッジ」として位置計算
 * から除外する。呼び出し元（currentMap.edges）にはそのまま残るため描画は維持される
 */
function buildSpanningForest(
  nodes: MapNode[],
  edges: MapEdge[]
): { rootIds: string[]; treeChildren: Map<string, MapEdge[]> } {
  const nodeIds = new Set(nodes.map((n) => n.id));

  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    }
  }

  // 出エッジ隣接リスト。edges配列に現れる順をそのまま保持する（決定的な辿り順のため）
  const outgoing = new Map<string, MapEdge[]>();
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source)!.push(edge);
  }

  const visited = new Set<string>();
  const treeChildren = new Map<string, MapEdge[]>();
  const rootIds: string[] = [];

  // seedIdsを同時にキューへ積む多元BFS（先に指定したroot群を対等に扱う。1つ目のrootの
  // 全子孫を先に辿り切ってから2つ目のrootに移る、という逐次処理ではないことに注意。
  // 複数親から到達可能なノードは、ホップ数がより短い経路を持つroot側に決定的に割り当てられる）
  function runBfs(seedIds: string[]) {
    const queue: string[] = [];
    for (const id of seedIds) {
      if (visited.has(id)) continue;
      visited.add(id);
      rootIds.push(id);
      queue.push(id);
    }
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of outgoing.get(current) || []) {
        if (visited.has(edge.target)) continue;
        visited.add(edge.target);
        if (!treeChildren.has(current)) treeChildren.set(current, []);
        treeChildren.get(current)!.push(edge);
        queue.push(edge.target);
      }
    }
  }

  const zeroIndegreeIds = nodes.filter((n) => inDegree.get(n.id) === 0).map((n) => n.id);
  runBfs(zeroIndegreeIds.length > 0 ? zeroIndegreeIds : [nodes[0].id]);

  // 孤立循環コンポーネントの掃き出し（実際に起こり得るため必須の分岐として実装する）
  for (const n of nodes) {
    if (!visited.has(n.id)) {
      runBfs([n.id]);
    }
  }

  return { rootIds, treeChildren };
}

/**
 * ノードnodeIdを根とするサブツリーを、子孫を先に再帰でレイアウトした上でボトムアップに合成する
 * （Eades & Feng方式。docs/align-branch-layout.md「実装方針の詳細」参照）
 */
async function computeSubtreeBox(
  nodeId: string,
  nodesById: Map<string, MapNode>,
  treeChildren: Map<string, MapEdge[]>,
  fallbackDirection: LayoutDirection
): Promise<SubtreeBox> {
  const node = nodesById.get(nodeId)!;
  const width0 = node.width || DEFAULT_NODE_WIDTH;
  const height0 = node.height || DEFAULT_NODE_HEIGHT;

  const localPositions = new Map<string, { x: number; y: number }>();
  localPositions.set(nodeId, { x: 0, y: 0 });

  const childEdges = treeChildren.get(nodeId) || [];
  if (childEdges.length > 0) {
    // 向きごとに最大4バケットへ分類（各バケット内はedges配列順を保つ）
    const buckets: Record<HandleSide, MapEdge[]> = { right: [], bottom: [], left: [], top: [] };
    for (const edge of childEdges) {
      buckets[classifyEdgeSide(edge, fallbackDirection)].push(edge);
    }

    for (const side of SIDES) {
      const bucketEdges = buckets[side];
      if (bucketEdges.length === 0) continue;

      // 子を先に再帰でレイアウトし、サイズ確定済みの「箱」にする
      const childBoxes = new Map<string, SubtreeBox>();
      for (const edge of bucketEdges) {
        childBoxes.set(edge.target, await computeSubtreeBox(edge.target, nodesById, treeChildren, fallbackDirection));
      }

      // 自分自身（実サイズ）とバケット内の子（確定済みの箱サイズ）を「原子ノード」として
      // このバケットの向きに対応するELK方向で1回レイアウトする。
      // 自分自身の位置ヒントはnode.position（現在の絶対座標）を使う。子の位置ヒントと
      // 同じ絶対座標系に揃えることで、INTERACTIVE戦略（現在位置ヒントに基づく決定的な
      // 並び順）が両者を一貫して解釈できるようにする
      const atomicNodes: MapNode[] = [
        { id: nodeId, content: '', position: node.position, width: width0, height: height0 },
        ...bucketEdges.map((edge) => {
          const childNode = nodesById.get(edge.target)!;
          const box = childBoxes.get(edge.target)!;
          return {
            id: edge.target,
            content: '',
            // 子のサブツリー箱は、子ノード自身のローカル原点(0,0)を基準に負方向へ
            // はみ出すことがある（LEFT/UP方向の子孫を持つ場合。box.minX/minYが負）。
            // ELKは「position=箱の左上、width/heightは右・下方向へ伸びる」という
            // 箱モデルで動作するため、子ノード自身の座標をそのまま渡すと、左・上方向への
            // はみ出しが間隔計算に一切反映されず兄弟ノードと重なりうる（Fableレビューで発見）。
            // 箱の実際の左上（子ノードの絶対座標 + はみ出し分box.minX/minY）を渡す
            position: { x: childNode.position.x + box.minX, y: childNode.position.y + box.minY },
            width: box.width,
            height: box.height,
          };
        }),
      ];
      const atomicEdges: MapEdge[] = bucketEdges.map((edge) => ({
        id: edge.id,
        source: nodeId,
        target: edge.target,
      }));

      const result = await runElkLayout(atomicNodes, atomicEdges, sideToElkDirection(side));
      const resultById = new Map(result.nodes.map((n) => [n.id, n.position]));
      const selfPos = resultById.get(nodeId) || { x: 0, y: 0 };

      // 親のローカル原点(0,0)を基準にした各子の相対オフセットを求め、子の子孫すべてに
      // そのオフセットを足して親のローカル座標系に統合する
      for (const edge of bucketEdges) {
        const childPos = resultById.get(edge.target) || { x: 0, y: 0 };
        const box = childBoxes.get(edge.target)!;
        // childPosはELK計算後の「箱の左上」の位置。上でposition側にbox.minX/minYを
        // 足して渡した分を差し引き、子ノード自身のローカル原点を基準にしたオフセットに戻す
        const offsetX = childPos.x - selfPos.x - box.minX;
        const offsetY = childPos.y - selfPos.y - box.minY;

        for (const [descId, pos] of box.localPositions) {
          localPositions.set(descId, { x: pos.x + offsetX, y: pos.y + offsetY });
        }
      }
    }
  }

  // バウンディングサイズの再計算。座標が負になる場合（LEFT/UP方向の子）もそのままでよく、
  // widthは実際のノード幅を使った外接矩形の幅（常に非負）として求める
  let minX = 0;
  let minY = 0;
  let maxX = width0;
  let maxY = height0;
  for (const [id, pos] of localPositions) {
    if (id === nodeId) continue;
    const descNode = nodesById.get(id);
    const w = descNode?.width || DEFAULT_NODE_WIDTH;
    const h = descNode?.height || DEFAULT_NODE_HEIGHT;
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + w);
    maxY = Math.max(maxY, pos.y + h);
  }

  return { width: maxX - minX, height: maxY - minY, minX, minY, localPositions };
}

/**
 * 「branch」アルゴリズムのエントリポイント。
 * ノードの右側についた子と下側についた子を別方向で再帰的にレイアウトする
 */
export async function calculateBranchLayout(
  nodes: MapNode[],
  edges: MapEdge[],
  direction: LayoutDirection
): Promise<LayoutResult> {
  if (nodes.length === 0) {
    return { nodes: [] };
  }

  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const { rootIds, treeChildren } = buildSpanningForest(nodes, edges);

  const rootBoxes = new Map<string, SubtreeBox>();
  for (const rootId of rootIds) {
    rootBoxes.set(rootId, await computeSubtreeBox(rootId, nodesById, treeChildren, direction));
  }

  const finalPositions = new Map<string, { x: number; y: number }>();

  if (rootIds.length === 1) {
    // 単一rootの場合は、そのroot自身の現在位置を基準に絶対座標へ変換する
    const rootId = rootIds[0];
    const rootNode = nodesById.get(rootId)!;
    const box = rootBoxes.get(rootId)!;
    for (const [id, pos] of box.localPositions) {
      finalPositions.set(id, { x: pos.x + rootNode.position.x, y: pos.y + rootNode.position.y });
    }
  } else {
    // 複数root（森）の場合は、root同士をさらに1回ELKで配置してから絶対座標に変換する。
    // 各rootの箱もLEFT/UP方向の子孫で非対称になりうるため、computeSubtreeBox内と同じ理由で
    // 位置ヒントには箱の実際の左上（root自身の絶対座標＋はみ出し分box.minX/minY）を渡す
    const rootAtomicNodes: MapNode[] = rootIds.map((rootId) => {
      const rootNode = nodesById.get(rootId)!;
      const box = rootBoxes.get(rootId)!;
      return {
        id: rootId,
        content: '',
        position: { x: rootNode.position.x + box.minX, y: rootNode.position.y + box.minY },
        width: box.width,
        height: box.height,
      };
    });
    const rootDirection = direction === 'RIGHT' ? 'RIGHT' : 'DOWN';
    const rootResult = await runElkLayout(rootAtomicNodes, [], rootDirection);
    const rootResultById = new Map(rootResult.nodes.map((n) => [n.id, n.position]));

    for (const rootId of rootIds) {
      const rootPos = rootResultById.get(rootId) || { x: 0, y: 0 };
      const box = rootBoxes.get(rootId)!;
      // rootPosはELK計算後の「箱の左上」の位置。root自身のローカル原点を基準にした
      // オフセットに戻すため、position側で足したbox.minX/minY分を差し引く
      const rootOriginX = rootPos.x - box.minX;
      const rootOriginY = rootPos.y - box.minY;
      for (const [id, pos] of box.localPositions) {
        finalPositions.set(id, { x: pos.x + rootOriginX, y: pos.y + rootOriginY });
      }
    }
  }

  return {
    nodes: nodes.map((n) => ({ id: n.id, position: finalPositions.get(n.id) || n.position })),
  };
}
