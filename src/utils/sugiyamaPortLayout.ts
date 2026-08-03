// 整列アルゴリズム「sugiyama-port」（方針H: 親子関係をハンドルの向きから決めるスギヤマ拡張）。
// `sugiyama-ext`（方針E）を出発点に、次の3点だけを変えたもの。書いていない部分
// （循環除去・箱のボトムアップ再帰合成・rootアンカー・ツリー分離）は方針Eと同じ。
// フェーズごとの入出力を含む詳細仕様はdocs/align-algorithms.md §8、
// 採用理由・検討経緯はdocs/align-branch-layout.md「方針H」を参照。
//
//   1. **主たる親をハンドルの向きで選ぶ**。方針Eはロンゲストパス（最も深い層になる入辺）だけで
//      親を決めるが、こちらは「エッジは *ソース=forward面 → ターゲット=backward面*（右向きなら
//      右ハンドル→左ハンドル）が正規の親子関係」という前提を第一基準にする。詳細は pickParents()。
//   2. **同点の親は「同列の複数親」としてそのまま扱う**（1つに決め打ちしない）。複数親のノードは
//      親たちの最小共通祖先(LCA)の箱に置き、cross方向は親たちのバリセンタ、primary方向は
//      重ならない最小の位置に置く。`elk-port-pava` の「複数親は平均で扱う／順序と最小間隔を
//      守った上で希望位置に最も近い場所へ置く」考え方を、箱モデルの中で実現したもの。
//   3. **crossNeg/crossPos（上/下ハンドル）の子の置き場所を、現在位置から読み取った意図で決める**。
//      方針Eは常にforward群の外側（cross方向）へ逃がすので、forward群が大きいほど上/下の子が
//      親から遠ざかる。こちらは cross群を親のすぐ隣に確保して、ぶつかったforward群を**cross方向では
//      なくprimary方向へ逃がす**のが基本（cross方向に広がるとforward群＝主線のまとまりが崩れるため）。
//      ただしこれはcross群が「親の補足情報」である前提の扱いなので、**ユーザーがそのcross群を
//      forward群の外側に置いている場合は「親と並ぶ別の情報」と解釈して方針Eの扱いに切り替える**
//      （docs/decisions.md §49・§50）。
//
// 右向き(RIGHT)レイアウトを基準に説明する。下向き(DOWN)は primary/cross 軸を入れ替えるだけで
// 自然に90度回転して適用される（primarySize/crossSize/currentCenterPC/centerPCtoTopLeft が吸収）。
import { MapNode, MapEdge, LayoutDirection } from '../types';
import { LayoutResult } from './layout';
import { classifyEdgeSide, HandleSide } from './branchLayout';

// --- チューニング定数（意味・調整箇所は docs/tuning.md「整列アルゴリズム」参照）---
// 方針Eと同じ値だが、片方を消すときに巻き込まれないよう sugiyamaExtLayout.ts とは共有しない
const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 60;
const PRIMARY_GAP = 60; // 層と層の間隔（primary方向、px）
const CROSS_GAP = 10; // 積み重ねる兄弟の間隔（cross方向、px）
const SIBLING_GAP = 8; // forward/backward群の兄弟サブツリー間の間隔（cross方向、px）
// cross(上/下)の子を親のprimary帯にどれだけ被せるか。0=全被り、0.5=前半分に被る、1=被らない。
// **この2つはここが唯一の定義**。e2e/branch-layout-algorithms.mjs は期待値をハードコードせず
// この値をimportして計算するので、変更はここだけで済む（docs/tuning.md の表だけ手で追従させる）
export const CROSS_OVERLAP_RATIO = 0.7;
// 同上。ただし**forward群の帯に入り込む子**（＝forward群をprimary方向へ押し出す子）だけに使う値。
// 被りを深くする＝子サブツリーの前端が手前に来るので、押し出す量がそのぶん減る。
// 押し出しが起きない子には効かせない（効かせても押し出し量は減らず、見た目だけ変わるため）
export const CROSS_OVERLAP_RATIO_INSIDE = 0.2;
// forward/backward群を cross群の前方(後方)へ逃がすときの単位。**目視比較のための切り替え**で、
// この1行を書き換えるだけで戻せる（実測の差は docs/align-branch-layout.md「方針H」の表）。
//   true  = 群ごと同じ線に揃えて逃がす。同じ層の兄弟のprimaryが揃うが、1つでもcross群と重なると
//           群全体が前へ出るため primary方向に長くなる（面積・交差・移動量は悪化する）
//   false = cross方向で実際に重なった子だけ逃がす。コンパクトだが層の前線が揃わない
// （e2e/branch-layout-algorithms.mjs がこの値を読んで期待値を切り替えるためexportしている）
export const ESCAPE_FORWARD_AS_GROUP = true;
// 複数ツリー（複数root）の外接矩形が重なる場合に空けるツリー間の最小マージン（px）
const TREE_MARGIN = 40;
// ツリー分離（押し離し）反復の上限。通常は数回で収束する
const TREE_SEPARATION_MAX_ITER = 200;

// ハンドルの役割。レイアウト方向を基準にした相対的な向き
//   forward  : 流れ方向（RIGHT:右 / DOWN:下）。エッジが自然に出ていく面
//   backward : 流れの逆（RIGHT:左 / DOWN:上）。エッジが自然に入ってくる面
//   crossNeg : 流れに直交する負側（RIGHT:上 / DOWN:左）
//   crossPos : 流れに直交する正側（RIGHT:下 / DOWN:右）
type Role = 'forward' | 'backward' | 'crossNeg' | 'crossPos';

function handleRole(side: HandleSide, direction: LayoutDirection): Role {
  if (direction === 'RIGHT') {
    switch (side) {
      case 'right':
        return 'forward';
      case 'left':
        return 'backward';
      case 'top':
        return 'crossNeg';
      case 'bottom':
        return 'crossPos';
    }
  }
  // DOWN
  switch (side) {
    case 'bottom':
      return 'forward';
    case 'top':
      return 'backward';
    case 'left':
      return 'crossNeg';
    case 'right':
      return 'crossPos';
  }
}

/** エッジのターゲット側の面。未設定・無効ならソース面の反対面（elkPortLayout.tsと同じ規則） */
function targetSideOf(edge: MapEdge, sourceSide: HandleSide): HandleSide {
  const handle = edge.targetHandle;
  if (handle === 'top' || handle === 'bottom' || handle === 'left' || handle === 'right') {
    return handle;
  }
  return { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[sourceSide] as HandleSide;
}

// primary=流れ方向のサイズ、cross=直交方向のサイズ
function primarySize(node: MapNode, direction: LayoutDirection): number {
  return direction === 'RIGHT' ? node.width || DEFAULT_NODE_WIDTH : node.height || DEFAULT_NODE_HEIGHT;
}
function crossSize(node: MapNode, direction: LayoutDirection): number {
  return direction === 'RIGHT' ? node.height || DEFAULT_NODE_HEIGHT : node.width || DEFAULT_NODE_WIDTH;
}

// ノードの現在位置(top-left)を、中心の (primary, cross) 座標へ変換する
function currentCenterPC(node: MapNode, direction: LayoutDirection): { p: number; c: number } {
  const w = node.width || DEFAULT_NODE_WIDTH;
  const h = node.height || DEFAULT_NODE_HEIGHT;
  if (direction === 'RIGHT') {
    return { p: node.position.x + w / 2, c: node.position.y + h / 2 };
  }
  return { p: node.position.y + h / 2, c: node.position.x + w / 2 };
}

// 中心の (primary, cross) 座標を、ノードの位置(top-left)へ戻す
function centerPCtoTopLeft(p: number, c: number, node: MapNode, direction: LayoutDirection): { x: number; y: number } {
  const w = node.width || DEFAULT_NODE_WIDTH;
  const h = node.height || DEFAULT_NODE_HEIGHT;
  if (direction === 'RIGHT') {
    return { x: p - w / 2, y: c - h / 2 };
  }
  return { x: c - w / 2, y: p - h / 2 };
}

// ノードの現在のcross座標（並び順の初期化に使う）
function currentCross(node: MapNode, direction: LayoutDirection): number {
  return currentCenterPC(node, direction).c;
}

// 採用された親子関係1本ぶん。role（＝ソース側ハンドルの役割）がそのまま配置バケットになる
interface ParentLink {
  edge: MapEdge;
  parentId: string;
  childId: string;
  role: Role;
}

/**
 * 辺を辿ったときのレイヤ深さの増分。ロンゲストパス（＝同順位の親が複数あるときの深さ比較）に使う。
 * 方針Eは「ソース面の役割」だけで決めていたが、こちらはターゲット面も見る:
 * cross面から出た辺でも、ターゲットのbackward面（右向きなら左ハンドル）に入っているなら
 * 「1段下がる親子」とみなして +0.5、そうでなければ純粋な上下並置とみなして ±0（同じ層）。
 */
function layerDelta(role: Role, targetRole: Role): number {
  switch (role) {
    case 'forward':
      return 1;
    case 'backward':
      return -1;
    case 'crossNeg':
    case 'crossPos':
      return targetRole === 'backward' ? 0.5 : 0;
  }
}

interface Hierarchy {
  rootIds: string[];
  /** 単一の親を持つ子（＝親のバケットへ入れて配置する子） */
  ownChildren: Map<string, ParentLink[]>;
  /** 複数の同順位な親を持つ子。親たちのLCAの箱で、親たちのバリセンタへ置く */
  sharedChildren: Map<string, string[]>;
  /** 子ID → 採用した親リンク（1本以上） */
  parentsOf: Map<string, ParentLink[]>;
  /** 親ID → forward役割で採用された子ID（バリセンタ計算に使う。木の所有関係とは独立） */
  forwardChildIds: Map<string, string[]>;
}

/**
 * 親子関係（森）を構築する。決定的（ノード配列順・エッジ配列順のみに依存）。
 *
 * 1. DFSで後退辺を除いてDAG化する（循環除去。方針Eと同じ）。
 * 2. トポロジカル順に各ノードの入辺を採点し、**最大スコアの入辺すべて**を親にする。
 *    スコアは辞書式の3要素:
 *      (a) ターゲット面がbackward（右向きなら左ハンドルに入っている）か … 1/0
 *      (b) ソース面がforward（右向きなら右ハンドルから出ている）か       … 1/0
 *      (c) ロンゲストパス（その辺を採ったときのレイヤ深さ）
 *    「エッジは *右ハンドル→左ハンドル* が正規の親子関係」という前提を(a)(b)で表し、
 *    決められないぶんだけ(c)で深さを見る。それでも同点なら複数親として全部残す。
 * 3. 親が1つの子は親のバケットへ、複数の子は親たちのLCAの「共有の子」へ登録する。
 *    トポロジカル順に処理するので、子を見る時点で親の木上の位置は確定している。
 */
function buildHierarchy(nodes: MapNode[], edges: MapEdge[], direction: LayoutDirection): Hierarchy {
  const nodeIds = new Set(nodes.map((n) => n.id));

  // 出辺隣接リスト（エッジ配列順を保持）と入次数
  const outgoing = new Map<string, MapEdge[]>();
  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source)!.push(edge);
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
  }

  // --- 1. DFSで後退辺を除きDAG化（自己ループもここで落ちる）---
  const color = new Map<string, 'white' | 'gray' | 'black'>(nodes.map((n) => [n.id, 'white']));
  const dagOut = new Map<string, MapEdge[]>();
  const dfs = (u: string) => {
    color.set(u, 'gray');
    for (const edge of outgoing.get(u) || []) {
      if (color.get(edge.target) === 'gray') continue; // 後退辺 → DAGから除外（循環を断つ）
      if (!dagOut.has(u)) dagOut.set(u, []);
      dagOut.get(u)!.push(edge);
      if (color.get(edge.target) === 'white') dfs(edge.target);
    }
    color.set(u, 'black');
  };
  for (const n of nodes) if (inDegree.get(n.id) === 0 && color.get(n.id) === 'white') dfs(n.id);
  for (const n of nodes) if (color.get(n.id) === 'white') dfs(n.id);

  // --- 2a. DAGのトポロジカル順（配列順で決定的にKahn法）---
  const workInDeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const incoming = new Map<string, MapEdge[]>(nodes.map((n) => [n.id, []]));
  for (const [, es] of dagOut) {
    for (const e of es) {
      workInDeg.set(e.target, (workInDeg.get(e.target) || 0) + 1);
      incoming.get(e.target)!.push(e);
    }
  }
  const topo: string[] = [];
  const remaining = new Set(nodes.map((n) => n.id));
  while (remaining.size > 0) {
    let picked: string | null = null;
    for (const n of nodes) {
      if (remaining.has(n.id) && (workInDeg.get(n.id) || 0) === 0) { picked = n.id; break; }
    }
    if (picked === null) for (const n of nodes) if (remaining.has(n.id)) { picked = n.id; break; }
    remaining.delete(picked!);
    topo.push(picked!);
    for (const e of dagOut.get(picked!) || []) workInDeg.set(e.target, (workInDeg.get(e.target) || 0) - 1);
  }

  // --- 2b+3. 入辺を採点して親を選び、そのまま木へ取り付ける ---
  const layer = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const treeParent = new Map<string, string | null>();
  const treeDepth = new Map<string, number>();
  const parentsOf = new Map<string, ParentLink[]>();
  const ownChildren = new Map<string, ParentLink[]>();
  const sharedChildren = new Map<string, string[]>();
  const rootIds: string[] = [];

  // 木の上での最小共通祖先。別ツリーどうしならnull
  const lcaOf = (ids: string[]): string | null => {
    let acc: string | null = ids[0];
    for (let i = 1; i < ids.length && acc !== null; i++) {
      let a: string | null = acc;
      let b: string | null = ids[i];
      while (a !== null && b !== null && a !== b) {
        if ((treeDepth.get(a) || 0) >= (treeDepth.get(b) || 0)) a = treeParent.get(a) ?? null;
        else b = treeParent.get(b) ?? null;
      }
      acc = a !== null && a === b ? a : null;
    }
    return acc;
  };

  const attach = (childId: string, parentId: string) => {
    treeParent.set(childId, parentId);
    treeDepth.set(childId, (treeDepth.get(parentId) || 0) + 1);
  };

  for (const id of topo) {
    const ins = incoming.get(id) || [];
    if (ins.length === 0) {
      rootIds.push(id);
      layer.set(id, 0);
      treeParent.set(id, null);
      treeDepth.set(id, 0);
      continue;
    }

    const scored = ins.map((e) => {
      const sourceSide = classifyEdgeSide(e, direction);
      const role = handleRole(sourceSide, direction);
      const targetRole = handleRole(targetSideOf(e, sourceSide), direction);
      return {
        edge: e,
        role,
        // (a)(b) ハンドルの向きが正規の親子関係にどれだけ合っているか
        inbound: targetRole === 'backward' ? 1 : 0,
        outbound: role === 'forward' ? 1 : 0,
        // (c) この辺を採ったときのレイヤ深さ
        depth: (layer.get(e.source) || 0) + layerDelta(role, targetRole),
      };
    });
    const better = (a: typeof scored[number], b: typeof scored[number]) =>
      a.inbound !== b.inbound ? a.inbound > b.inbound
        : a.outbound !== b.outbound ? a.outbound > b.outbound
        : a.depth > b.depth;
    let best = scored[0];
    for (const s of scored) if (better(s, best)) best = s;
    const chosen = scored.filter(
      (s) => s.inbound === best.inbound && s.outbound === best.outbound && s.depth === best.depth
    );

    layer.set(id, best.depth);
    const links: ParentLink[] = chosen.map((s) => ({ edge: s.edge, parentId: s.edge.source, childId: id, role: s.role }));
    parentsOf.set(id, links);

    // 親が1つ → 親のバケットへ。複数 → 親たちのLCAの共有の子へ
    // （LCAが無い＝親が別ツリーに散っている場合は、先頭の親のバケットへ落とす）
    const lca = links.length === 1 ? links[0].parentId : lcaOf(links.map((l) => l.parentId));
    if (links.length > 1 && lca !== null) {
      if (!sharedChildren.has(lca)) sharedChildren.set(lca, []);
      sharedChildren.get(lca)!.push(id);
      attach(id, lca);
    } else {
      const owner = links[0];
      if (!ownChildren.has(owner.parentId)) ownChildren.set(owner.parentId, []);
      ownChildren.get(owner.parentId)!.push(owner);
      attach(id, owner.parentId);
    }
  }

  // バリセンタ用: 木の所有関係と関係なく「forward役割で採用された子」を引けるようにする
  const forwardChildIds = new Map<string, string[]>();
  for (const links of parentsOf.values()) {
    for (const link of links) {
      if (link.role !== 'forward') continue;
      if (!forwardChildIds.has(link.parentId)) forwardChildIds.set(link.parentId, []);
      forwardChildIds.get(link.parentId)!.push(link.childId);
    }
  }

  return { rootIds, ownChildren, sharedChildren, parentsOf, forwardChildIds };
}

// あるノードを根とするサブツリーの箱。centersは、根の中心を原点(0,0)とした
// (primary, cross) ローカル座標での各ノード中心。p/cのmin/maxは箱の外接範囲
interface Box {
  centers: Map<string, { p: number; c: number }>;
  pMin: number;
  pMax: number;
  cMin: number;
  cMax: number;
}

// 箱を平行移動した後の外接範囲（重なり判定に使う）
interface Extent {
  pMin: number;
  pMax: number;
  cMin: number;
  cMax: number;
}

// childBoxを (offP, offC) だけ平行移動して parentへ取り込み、外接範囲を更新する
function mergeChildBox(parent: Box, child: Box, offP: number, offC: number): void {
  for (const [id, pos] of child.centers) {
    parent.centers.set(id, { p: pos.p + offP, c: pos.c + offC });
  }
  parent.pMin = Math.min(parent.pMin, offP + child.pMin);
  parent.pMax = Math.max(parent.pMax, offP + child.pMax);
  parent.cMin = Math.min(parent.cMin, offC + child.cMin);
  parent.cMax = Math.max(parent.cMax, offC + child.cMax);
}

/** cross方向の区間が重なるか（接しているだけは重なりとみなさない） */
function crossOverlaps(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  return aMax > bMin && bMax > aMin;
}

/**
 * ノードnodeIdを根とするサブツリーを、ボトムアップに箱として組み立てる。
 * 配置の順番が方針Eとの違いそのもの: **cross群（親のすぐ隣）→ forward/backward群（primaryへ逃がす）
 * → 複数親の共有の子（親たちのバリセンタ）** の順に確定させる。
 */
function layoutSubtree(
  nodeId: string,
  nodesById: Map<string, MapNode>,
  hierarchy: Hierarchy,
  direction: LayoutDirection
): Box {
  const node = nodesById.get(nodeId)!;
  const w = primarySize(node, direction);
  const h = crossSize(node, direction);

  const box: Box = {
    centers: new Map([[nodeId, { p: 0, c: 0 }]]),
    pMin: -w / 2,
    pMax: w / 2,
    cMin: -h / 2,
    cMax: h / 2,
  };

  // 子サブツリーの箱は複数回参照する（配置パターンの判定と実際の配置）ので、必ずメモしてから使う。
  // メモ無しで2回呼ぶと再帰が深さに対して指数的に増える
  const boxOf = new Map<string, Box>();
  const childBox = (id: string): Box => {
    let b = boxOf.get(id);
    if (b === undefined) {
      b = layoutSubtree(id, nodesById, hierarchy, direction);
      boxOf.set(id, b);
    }
    return b;
  };

  // 役割ごとにバケット分け（バケットは「ソース側ハンドルの役割」で決まる）
  const buckets: Record<Role, ParentLink[]> = { forward: [], backward: [], crossNeg: [], crossPos: [] };
  for (const link of hierarchy.ownChildren.get(nodeId) || []) buckets[link.role].push(link);

  // forward/backward群がcross方向に占める半幅（どちらも親のcross中心へ中央寄せするので ±fanHalf）
  const groupSpan = (links: ParentLink[]): number =>
    links.length === 0
      ? 0
      : links.reduce((sum, l) => {
          const b = childBox(l.childId);
          return sum + (b.cMax - b.cMin) + SIBLING_GAP;
        }, -SIBLING_GAP);
  const fanHalf = Math.max(groupSpan(buckets.forward), groupSpan(buckets.backward)) / 2;

  // --- cross群の配置パターンを「ユーザーが今どこに置いているか」から決める ---
  // 'hug'     : 親のすぐ隣に置く（＝親の補足情報。forward群はprimary方向へ逃がす）
  // 'outside' : forward群の外側に置く（＝親の subtree と並ぶ別の情報。方針Eと同じ扱い）
  // 判定は**そのバケットのうち親にいちばん近い子**（＝「トップ層」）だけを見る。親とforward/backward群の
  // 直接の子が作る「内側の枠」より外に置かれていれば 'outside'。
  //   なぜ「いちばん近い子」だけか: 2番目以降の子は1番目の外側に積まれるので、全員を見ると
  //   整列後に判定が反転してしまう（Alignを2回押すと結果が変わる）。
  //
  // **見るのは「cross群のサブツリーの根＝cross子ノード本体」の矩形**であって、サブツリー全体の
  // 広がりではない（docs/decisions.md §57）。「ユーザーがそのノードをどこに置いたか」が意図であって、
  // ぶら下がっている子の広がりは意図ではない、という判断。
  //   **代償**: 配置は箱ごと動かすので、cross子が自分の子をcross方向に持つと、箱が親にくっついていても
  //   ノード本体は親から離れた位置に来る。そのため**Alignの1回目と2回目で判定が 'hug'→'outside' に
  //   反転して配置が変わることがある**（3回目以降は安定。実測は f-scale50 相当で797px）。
  //   これは承知のうえで受け入れている既知の制限（docs/tuning.md「既知の未対応事項」）。
  //   判定と配置を揃えて冪等にすると `hug` と分類されるケースが増え、エッジのノード貫通が増える
  //   （91→104）ため、判定の素直さを取った。
  const crossPlacementMode = (links: ParentLink[], sign: 1 | -1): 'hug' | 'outside' => {
    if (links.length === 0) return 'hug';
    const pc = currentCross(node, direction);
    // signの向きを正とした、そのノードの外側の端(edgeSign=1)／親側の端(edgeSign=-1)
    const outerEdge = (link: ParentLink, edgeSign: 1 | -1): number => {
      const child = nodesById.get(link.childId)!;
      return sign * (currentCross(child, direction) - pc) + (edgeSign * crossSize(child, direction)) / 2;
    };
    // 内側の枠 = 親自身の端と、forward/backward群の直接の子の端のうち外側
    let inside = h / 2;
    for (const link of [...buckets.forward, ...buckets.backward]) {
      inside = Math.max(inside, outerEdge(link, 1));
    }
    // 群のうち親にいちばん近い子の、親側の端
    let nearest = Infinity;
    for (const link of links) nearest = Math.min(nearest, outerEdge(link, -1));
    return nearest >= inside ? 'outside' : 'hug';
  };
  const crossMode: Record<'crossNeg' | 'crossPos', 'hug' | 'outside'> = {
    crossNeg: crossPlacementMode(buckets.crossNeg, -1),
    crossPos: crossPlacementMode(buckets.crossPos, 1),
  };

  // --- crossNeg(上) / crossPos(下): 親のprimary帯に被せ、`from` からcross方向の外へ積む ---
  // 並び順は現在のcross位置の昇順（＝見た目の上→下）を保つ。crossNegは「下側の子ほど親に近い」
  // 必要があるので、反転して親側から積み上げる
  const crossExtents: Extent[] = [];
  const placeCrossBucket = (links: ParentLink[], sign: 1 | -1, from: number) => {
    const ordered = [...links].sort(
      (a, b) =>
        currentCross(nodesById.get(a.childId)!, direction) - currentCross(nodesById.get(b.childId)!, direction)
    );
    // 親に近い側から順に積む
    let edge = from;
    for (const link of sign === 1 ? ordered : ordered.reverse()) {
      const b = childBox(link.childId);
      const offC = sign === 1 ? edge - b.cMin : edge - b.cMax;
      // 子サブツリーの後端を「親の後端(-w/2)から primary幅×ratio だけ前方」に合わせる（＝親に被せる）。
      // **forward群の帯に入り込む子だけ被りを深くする**（forward群を前へ押し出す量を抑えるため）。
      // 押し出しが起きないときは効かせないので、判定が揺れうる「forward群が親より小さいケース」では
      // hug と outside が同じ結果になり、Alignを繰り返しても見た目が変わらない
      const insideFan = crossOverlaps(offC + b.cMin, offC + b.cMax, -fanHalf, fanHalf);
      const ratio = insideFan ? CROSS_OVERLAP_RATIO_INSIDE : CROSS_OVERLAP_RATIO;
      const offP = -w / 2 + w * ratio - b.pMin;
      mergeChildBox(box, b, offP, offC);
      crossExtents.push({ pMin: offP + b.pMin, pMax: offP + b.pMax, cMin: offC + b.cMin, cMax: offC + b.cMax });
      edge = sign === 1 ? offC + b.cMax + CROSS_GAP : offC + b.cMin - CROSS_GAP;
    }
  };

  // --- 1. 'hug' のcross群だけを先に置く（親のすぐ隣を確保する）---
  if (crossMode.crossPos === 'hug') placeCrossBucket(buckets.crossPos, 1, h / 2 + CROSS_GAP);
  if (crossMode.crossNeg === 'hug') placeCrossBucket(buckets.crossNeg, -1, -h / 2 - CROSS_GAP);

  // --- 2. forward / backward: 前方(後方)へ1層。cross方向に兄弟を積んで中央寄せ ---
  // primaryへ逃がす相手は 'hug' のcross群だけ（'outside' のcross群はこの後ろで外側に積むので競合しない）
  // 並び順は「その子＋その子のforward子」の現在cross座標のバリセンタ昇順（交差削減）。
  // 複数親の子もforward子として数えるので、共有の子は両方の親を引き寄せる
  const baryOf = (childId: string): number => {
    const crosses = [currentCross(nodesById.get(childId)!, direction)];
    for (const gid of hierarchy.forwardChildIds.get(childId) || []) {
      crosses.push(currentCross(nodesById.get(gid)!, direction));
    }
    return crosses.reduce((a, b) => a + b, 0) / crosses.length;
  };

  const placeForwardLike = (links: ParentLink[], primarySign: 1 | -1) => {
    const boxes = [...links]
      .sort((a, b) => baryOf(a.childId) - baryOf(b.childId))
      .map((l) => childBox(l.childId));

    // cross方向に順に積み、群全体を親のcross中心(0)へ中央寄せする
    let cursor = 0;
    const placed = boxes.map((b) => {
      const offC = cursor - b.cMin; // 箱の上端がcursorに来るように中心を決める
      cursor += b.cMax - b.cMin + SIBLING_GAP;
      return { b, offC };
    });
    const shift = -Math.max(0, cursor - SIBLING_GAP) / 2;

    // primaryの基準線（forward=箱の後端／backward=箱の前端を揃える線）。
    // **cross群と cross方向で重なるなら、その前(後)へ逃がす**。cross方向には広げない
    const base0 = primarySign === 1 ? w / 2 + PRIMARY_GAP : -(w / 2 + PRIMARY_GAP);
    const baseFor = ({ b, offC }: { b: Box; offC: number }): number => {
      let base = base0;
      for (const ext of crossExtents) {
        if (!crossOverlaps(offC + shift + b.cMin, offC + shift + b.cMax, ext.cMin, ext.cMax)) continue;
        base = primarySign === 1
          ? Math.max(base, ext.pMax + PRIMARY_GAP)
          : Math.min(base, ext.pMin - PRIMARY_GAP);
      }
      return base;
    };

    // 群ごとに揃えるなら、いちばん遠くまで逃げる必要がある子に合わせて全員を同じ線に置く
    const groupBase = ESCAPE_FORWARD_AS_GROUP
      ? placed.reduce(
          (acc, p) => (primarySign === 1 ? Math.max(acc, baseFor(p)) : Math.min(acc, baseFor(p))),
          base0
        )
      : null;

    for (const p of placed) {
      const base = groupBase ?? baseFor(p);
      mergeChildBox(box, p.b, primarySign === 1 ? base - p.b.pMin : base - p.b.pMax, p.offC + shift);
    }
  };

  if (buckets.forward.length > 0) placeForwardLike(buckets.forward, 1);
  if (buckets.backward.length > 0) placeForwardLike(buckets.backward, -1);

  // --- 3. 'outside' のcross群を、親＋forward群の外側へ積む（方針Eと同じ扱い）---
  // forward群の外に出るので、forward群をprimary方向へ押し出さない。
  // **複数親の子（4.）より先に置く**: 4. は「親の確定位置」を必要とするので、この箱に属する
  // ノードは4.より前にすべて置き終わっていなければならない（順序を逆にすると、outside群の中に
  // 親がいる子がアンカーを見つけられず座標が返らなくなる。ファズで検出済み）
  if (crossMode.crossPos === 'outside') placeCrossBucket(buckets.crossPos, 1, box.cMax + CROSS_GAP);
  if (crossMode.crossNeg === 'outside') placeCrossBucket(buckets.crossNeg, -1, box.cMin - CROSS_GAP);

  // --- 4. 複数の同順位な親を持つ子: 親たちのバリセンタへ置く ---
  // **親の集合が同じ子どうしは「同列の兄弟」**なので、forward群と同じように1つの群として
  // cross方向に積む。1つずつ独立に置くと、同じバリセンタを取り合って「cross方向に重なるものの
  // 前へ逃がす」規則が兄弟同士に効いてしまい、並ぶべき子がprimary方向へ押し出されてしまう
  // （A→B,A→C / B→D,C→D / B→E,C→E で D と E が前後に並んでしまう不具合）。
  const sharedGroups = new Map<string, string[]>();
  for (const childId of hierarchy.sharedChildren.get(nodeId) || []) {
    // 親のIDの集合をそのままキーにする（JSON化して区切り文字の曖昧さを避ける）
    const key = JSON.stringify(
      (hierarchy.parentsOf.get(childId) || []).map((l) => l.parentId).sort()
    );
    if (!sharedGroups.has(key)) sharedGroups.set(key, []);
    sharedGroups.get(key)!.push(childId);
  }

  // 親たちが望む「この箱の中心位置」と「後端の最小位置」を求める（親ごとの平均／最大）。
  // **必ず値を返す**（返さないと呼び出し側で子が落ち、その子の座標が返らないまま初期位置に
  // 取り残されて重なる）。親が1つもこの箱に居ないときは、この箱の主ノードのforward子として扱う
  const sharedAnchor = (childId: string, b: Box): { center: number; back: number } => {
    const halfSpan = (b.cMax - b.cMin) / 2;
    const width = b.pMax - b.pMin;
    let sumC = 0;
    let count = 0;
    let back = -Infinity;
    for (const link of hierarchy.parentsOf.get(childId) || []) {
      const anchor = box.centers.get(link.parentId);
      if (!anchor) continue; // LCAの箱に居ない親（別ツリー）は無視する
      const parent = nodesById.get(link.parentId)!;
      const pw = primarySize(parent, direction);
      const ph = crossSize(parent, direction);
      switch (link.role) {
        case 'forward':
          sumC += anchor.c;
          back = Math.max(back, anchor.p + pw / 2 + PRIMARY_GAP);
          break;
        case 'backward':
          sumC += anchor.c;
          back = Math.max(back, anchor.p - pw / 2 - PRIMARY_GAP - width);
          break;
        case 'crossNeg':
          sumC += anchor.c - ph / 2 - CROSS_GAP - halfSpan;
          back = Math.max(back, anchor.p - pw / 2 + pw * CROSS_OVERLAP_RATIO);
          break;
        case 'crossPos':
          sumC += anchor.c + ph / 2 + CROSS_GAP + halfSpan;
          back = Math.max(back, anchor.p - pw / 2 + pw * CROSS_OVERLAP_RATIO);
          break;
      }
      count += 1;
    }
    return count === 0
      ? { center: 0, back: w / 2 + PRIMARY_GAP }
      : { center: sumC / count, back };
  };

  for (const childIds of sharedGroups.values()) {
    // 重なり回避の相手は「この群を置く前に箱に入っているもの」だけ（群の中の兄弟は相手にしない）
    const obstacles = [...box.centers].map(([id, pos]) => {
      const other = nodesById.get(id)!;
      return {
        cMin: pos.c - crossSize(other, direction) / 2,
        cMax: pos.c + crossSize(other, direction) / 2,
        pFront: pos.p + primarySize(other, direction) / 2,
      };
    });

    const members = [...childIds]
      .sort((a, b) => baryOf(a) - baryOf(b))
      .map((childId) => {
        const b = childBox(childId);
        return { b, anchor: sharedAnchor(childId, b) };
      });
    if (members.length === 0) continue;

    // cross方向に積み、群の中心を「親たちが望む中心」の平均へ合わせる
    let cursor = 0;
    const placed = members.map((m) => {
      const offC = cursor - m.b.cMin;
      cursor += m.b.cMax - m.b.cMin + SIBLING_GAP;
      return { ...m, offC };
    });
    const span = Math.max(0, cursor - SIBLING_GAP);
    const wanted = members.reduce((sum, m) => sum + m.anchor.center, 0) / members.length;
    const shift = wanted - span / 2;

    // primaryの基準線は「親たちの要求」＋「cross方向に重なる既配置ノードの前へ出る」の最大。
    // 逃がす単位は forward群と同じ規則（ESCAPE_FORWARD_AS_GROUP）に合わせる
    const structural = members.reduce((acc, m) => Math.max(acc, m.anchor.back), -Infinity);
    const baseFor = ({ b, offC }: { b: Box; offC: number }): number => {
      let base = structural;
      for (const ext of obstacles) {
        if (!crossOverlaps(offC + shift + b.cMin, offC + shift + b.cMax, ext.cMin, ext.cMax)) continue;
        base = Math.max(base, ext.pFront + PRIMARY_GAP);
      }
      return base;
    };
    const groupBase = ESCAPE_FORWARD_AS_GROUP
      ? placed.reduce((acc, p) => Math.max(acc, baseFor(p)), structural)
      : null;

    for (const p of placed) {
      mergeChildBox(box, p.b, (groupBase ?? baseFor(p)) - p.b.pMin, p.offC + shift);
    }
  }

  return box;
}

interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * 複数ツリーの外接矩形が重なる場合に、最小限の移動で押し離すオフセットを求める（方針Eと同じ）。
 * 重ならないツリーは動かさない（オフセット0＝root位置を保つ）。ペア順・軸選択が固定なので決定的。
 */
function separateTrees(bboxes: Rect[]): { dx: number; dy: number }[] {
  const offsets = bboxes.map(() => ({ dx: 0, dy: 0 }));
  if (bboxes.length < 2) return offsets;
  const m = TREE_MARGIN / 2; // 各矩形を全周mだけ膨らませる → 実効ギャップ TREE_MARGIN

  for (let iter = 0; iter < TREE_SEPARATION_MAX_ITER; iter++) {
    let moved = false;
    for (let i = 0; i < bboxes.length; i++) {
      for (let j = i + 1; j < bboxes.length; j++) {
        const ai: Rect = {
          minX: bboxes[i].minX + offsets[i].dx - m,
          minY: bboxes[i].minY + offsets[i].dy - m,
          maxX: bboxes[i].maxX + offsets[i].dx + m,
          maxY: bboxes[i].maxY + offsets[i].dy + m,
        };
        const aj: Rect = {
          minX: bboxes[j].minX + offsets[j].dx - m,
          minY: bboxes[j].minY + offsets[j].dy - m,
          maxX: bboxes[j].maxX + offsets[j].dx + m,
          maxY: bboxes[j].maxY + offsets[j].dy + m,
        };
        const ox = Math.min(ai.maxX, aj.maxX) - Math.max(ai.minX, aj.minX);
        const oy = Math.min(ai.maxY, aj.maxY) - Math.max(ai.minY, aj.minY);
        if (ox <= 0 || oy <= 0) continue; // 重なっていない

        moved = true;
        if (ox <= oy) {
          const half = ox / 2;
          if ((ai.minX + ai.maxX) / 2 <= (aj.minX + aj.maxX) / 2) {
            offsets[i].dx -= half;
            offsets[j].dx += half;
          } else {
            offsets[i].dx += half;
            offsets[j].dx -= half;
          }
        } else {
          const half = oy / 2;
          if ((ai.minY + ai.maxY) / 2 <= (aj.minY + aj.maxY) / 2) {
            offsets[i].dy -= half;
            offsets[j].dy += half;
          } else {
            offsets[i].dy += half;
            offsets[j].dy -= half;
          }
        }
      }
    }
    if (!moved) break;
  }
  return offsets;
}

/**
 * 「sugiyama-port」アルゴリズムのエントリポイント。
 * 各rootのサブツリーを、そのrootの現在位置を基準に配置し（メンタルマップ保持）、
 * 最後にツリー同士が重なる場合だけ押し離す（重ならなければrootは動かさない）。方針Eと同じ。
 */
export async function calculateSugiyamaPortLayout(
  nodes: MapNode[],
  edges: MapEdge[],
  direction: LayoutDirection
): Promise<LayoutResult> {
  if (nodes.length === 0) {
    return { nodes: [] };
  }

  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const hierarchy = buildHierarchy(nodes, edges, direction);

  // 各ツリーを、そのrootの現在中心を基準に絶対座標へ配置し、外接矩形も求める
  const trees = hierarchy.rootIds.map((rootId) => {
    const box = layoutSubtree(rootId, nodesById, hierarchy, direction);
    const anchor = currentCenterPC(nodesById.get(rootId)!, direction);
    const positions = new Map<string, { x: number; y: number }>();
    const bbox: Rect = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const [id, pos] of box.centers) {
      const n = nodesById.get(id)!;
      const tl = centerPCtoTopLeft(pos.p + anchor.p, pos.c + anchor.c, n, direction);
      positions.set(id, tl);
      const nw = n.width || DEFAULT_NODE_WIDTH;
      const nh = n.height || DEFAULT_NODE_HEIGHT;
      bbox.minX = Math.min(bbox.minX, tl.x);
      bbox.minY = Math.min(bbox.minY, tl.y);
      bbox.maxX = Math.max(bbox.maxX, tl.x + nw);
      bbox.maxY = Math.max(bbox.maxY, tl.y + nh);
    }
    return { positions, bbox };
  });

  // ツリー間の重なりを解消（重ならないツリーは動かさない）
  const offsets = separateTrees(trees.map((t) => t.bbox));

  const finalTopLeft = new Map<string, { x: number; y: number }>();
  trees.forEach((tree, i) => {
    const { dx, dy } = offsets[i];
    for (const [id, tl] of tree.positions) {
      finalTopLeft.set(id, { x: tl.x + dx, y: tl.y + dy });
    }
  });

  return {
    nodes: nodes.map((n) => ({ id: n.id, position: finalTopLeft.get(n.id) || n.position })),
  };
}
