import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useMapStore } from '../stores/mapStore';
import { useUIStore } from '../stores/uiStore';
import { buildGraphRelations, getParentNodes, getDescendantIds } from '../utils/graphTraversal';
import { EMPTY_NODE_CONTENT } from '../utils/nodeContent';
import { MapNode, MindMap, LayoutDirection } from '../types';
import {
  PRIMARY_GAP,
  SIBLING_GAP,
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
} from '../utils/sugiyamaExtLayout';

type Axis = 'x' | 'y';

function getAxisValue(position: { x: number; y: number }, axis: Axis): number {
  return axis === 'x' ? position.x : position.y;
}

function setAxisValue(
  position: { x: number; y: number },
  axis: Axis,
  value: number
): { x: number; y: number } {
  return axis === 'x' ? { ...position, x: value } : { ...position, y: value };
}

// React Flowの実測サイズ(node.measured)から、指定ノードのprimary/cross方向サイズを求める。
// sugiyamaExtLayout.tsのprimarySize/crossSizeと同じ定義（RIGHT: primary=幅・cross=高さ、
// DOWN: primary=高さ・cross=幅）に揃えることで、手動作成（Enter/Shift+Enter/Tab）の間隔を
// 自動レイアウト(sugiyama-ext / 既定のsugiyama-port。定数は同値)と一致させる（docs/decisions.md参照）。
// 実測が無ければDEFAULTにフォールバック
function measuredPrimarySize(
  node: { measured?: { width?: number; height?: number } } | undefined,
  direction: LayoutDirection
): number {
  return direction === 'RIGHT'
    ? node?.measured?.width ?? DEFAULT_NODE_WIDTH
    : node?.measured?.height ?? DEFAULT_NODE_HEIGHT;
}

function measuredCrossSize(
  node: { measured?: { width?: number; height?: number } } | undefined,
  direction: LayoutDirection
): number {
  return direction === 'RIGHT'
    ? node?.measured?.height ?? DEFAULT_NODE_HEIGHT
    : node?.measured?.width ?? DEFAULT_NODE_WIDTH;
}

interface SiblingInsertionPlan {
  position: { x: number; y: number };
  parentId: string | undefined;
  sourceHandle: string;
  targetHandle: string;
  shifts: { id: string; position: { x: number; y: number } }[];
}

// 兄弟ノード（弟/兄）挿入の位置計算。対象のすぐ隣（1スロット先）に新ノードを置き、
// 押し出す側（遠い側）の兄弟をサブツリーごと平行移動する分を shifts として返す。
// targetCrossSize: 対象ノードのcross方向実測サイズ（呼び出し側=useNodeCreationがReact Flowの
// node.measuredから渡す）。cross方向の間隔は自動レイアウト(sugiyama-ext / 既定のsugiyama-port)の兄弟サブツリー間隔と
// 同じ式（boxGap = targetCross/2 + SIBLING_GAP + newNodeCross/2）にすることで、手動作成した
// 兄弟の間隔がAlign後も（葉ノードなら）ほぼ動かないようにする（docs/decisions.md参照）
function computeSiblingInsertion(
  side: 'younger' | 'older',
  targetId: string,
  currentMap: MindMap,
  targetCrossSize: number
): SiblingInsertionPlan | undefined {
  const target = currentMap.nodes.find((n) => n.id === targetId);
  if (!target) return undefined;

  const dir = currentMap.layoutDirection;
  const mainAxis: Axis = dir === 'RIGHT' ? 'y' : 'x';
  // 新規ノードは常に空ノード（EMPTY_NODE_CONTENT）でReact Flow実測がまだ無いため、既定サイズを使う
  const newNodeCrossSize = dir === 'RIGHT' ? DEFAULT_NODE_HEIGHT : DEFAULT_NODE_WIDTH;
  const boxGap = targetCrossSize / 2 + SIBLING_GAP + newNodeCrossSize / 2;
  const delta = side === 'younger' ? boxGap : -boxGap;

  const relations = buildGraphRelations(currentMap.nodes, currentMap.edges);
  const parents = getParentNodes(targetId, relations, currentMap.nodes);
  const parentId = parents[0]?.id;

  // 親がいない場合（ルート等で兄弟グループが無い）: boxGap・既定ハンドル（forward固定）で
  // 正/負方向に配置するのみ
  if (!parentId) {
    const position = setAxisValue(
      target.position,
      mainAxis,
      getAxisValue(target.position, mainAxis) + delta
    );
    const sourceHandle = dir === 'RIGHT' ? 'right' : 'bottom';
    const targetHandle = dir === 'RIGHT' ? 'left' : 'top';
    return { position, parentId: undefined, sourceHandle, targetHandle, shifts: [] };
  }

  // 対象の「親→対象」エッジのハンドルを継承する。これにより上/下ハンドル接続
  // （crossNeg/crossPos）の兄弟も同じ接続で作られる（forward固定だと崩れていた不具合の修正）
  const parentEdge = currentMap.edges.find((e) => e.target === targetId && e.source === parentId);
  const sourceHandle = parentEdge?.sourceHandle ?? (dir === 'RIGHT' ? 'right' : 'bottom');
  const targetHandle = parentEdge?.targetHandle ?? (dir === 'RIGHT' ? 'left' : 'top');

  const siblingIds = relations.children.get(parentId) ?? [];
  const siblings = currentMap.nodes.filter((n) => siblingIds.includes(n.id));
  const targetMain = getAxisValue(target.position, mainAxis);

  // 押し出す（遠い）側の兄弟＋その子孫をdeltaだけ平行移動する。相互距離は保持され、
  // 対象↔新規ノードの間隔のみboxGapになる
  const farSide: MapNode[] =
    side === 'younger'
      ? siblings.filter((s) => s.id !== target.id && getAxisValue(s.position, mainAxis) > targetMain)
      : siblings.filter((s) => s.id !== target.id && getAxisValue(s.position, mainAxis) < targetMain);

  const position = setAxisValue(target.position, mainAxis, targetMain + delta);

  // 押し出す兄弟＋その子孫を delta だけ主軸方向に平行移動
  const shiftIds = new Set<string>();
  for (const s of farSide) {
    shiftIds.add(s.id);
    for (const d of getDescendantIds(s.id, currentMap.edges)) shiftIds.add(d);
  }
  const shifts = Array.from(shiftIds).map((id) => {
    const nd = currentMap.nodes.find((n) => n.id === id)!;
    return { id, position: setAxisValue(nd.position, mainAxis, getAxisValue(nd.position, mainAxis) + delta) };
  });

  return { position, parentId, sourceHandle, targetHandle, shifts };
}

// ノード位置が既存のノードと重複しているかチェックし、重複している場合は位置をずらす
// offsetDirection: 'x' = X方向のみ, 'y' = Y方向のみ, 'both' = 両方向
function adjustPositionToAvoidOverlap(
  position: { x: number; y: number },
  existingNodes: MapNode[],
  offsetDirection: 'x' | 'y' | 'both' = 'both',
  offsetSign: 1 | -1 = 1
): { x: number; y: number } {
  let adjustedPosition = { ...position };
  let attempts = 0;
  const maxAttempts = 20;
  const offsetStep = 100; // ノードサイズを考慮したオフセット
  // ノードサイズに基づいた重複判定のしきい値
  const thresholdX = 150; // ノードの最小幅
  const thresholdY = 60;  // ノードの概算高さ

  while (attempts < maxAttempts) {
    const hasOverlap = existingNodes.some((node) => {
      const dx = Math.abs(node.position.x - adjustedPosition.x);
      const dy = Math.abs(node.position.y - adjustedPosition.y);

      // offsetDirectionに応じて重複判定の方向を決める
      if (offsetDirection === 'x') {
        // X方向にオフセットする場合、同じY座標帯にあるノードとのX方向の重複をチェック
        return dy < thresholdY && dx < thresholdX;
      } else if (offsetDirection === 'y') {
        // Y方向にオフセットする場合、同じX座標帯にあるノードとのY方向の重複をチェック
        return dx < thresholdX && dy < thresholdY;
      } else {
        // 両方向の場合
        return dx < thresholdX && dy < thresholdY;
      }
    });

    if (!hasOverlap) {
      break;
    }

    // 重複している場合は指定された方向に位置をずらす
    adjustedPosition = {
      x: adjustedPosition.x + (offsetDirection === 'y' ? 0 : offsetStep * offsetSign),
      y: adjustedPosition.y + (offsetDirection === 'x' ? 0 : offsetStep * offsetSign),
    };
    attempts++;
  }

  return adjustedPosition;
}

/**
 * 子ノード・兄弟ノード作成ロジック。
 * useKeyboardShortcuts（Tab/Enterキーバインド）とCustomNode（編集中Tab/Enterで確定して
 * ノードを作る操作）の両方から使われる共有ロジック。位置計算（レイアウト方向に応じた
 * ハンドル選択・重複回避）、作成、新ノードの選択、ビューポート外なら全体表示、までを担う
 */
export function useNodeCreation() {
  const { fitView, getViewport, getNodes } = useReactFlow();
  const { currentMap, addNode, insertParentNode, addNodeWithShifts } = useMapStore();
  const { setSelectedNodeId } = useUIStore();

  // ノードがビューポート内に表示されているかチェック
  const isNodeInViewport = useCallback(
    (nodePosition: { x: number; y: number }) => {
      const viewport = getViewport();
      // ビューポートの表示範囲を計算（おおよその値）
      const viewportWidth = window.innerWidth / viewport.zoom;
      const viewportHeight = window.innerHeight / viewport.zoom;
      const viewportX = -viewport.x / viewport.zoom;
      const viewportY = -viewport.y / viewport.zoom;

      const margin = 100; // マージンを設けて少し余裕を持たせる
      return (
        nodePosition.x >= viewportX - margin &&
        nodePosition.x <= viewportX + viewportWidth + margin &&
        nodePosition.y >= viewportY - margin &&
        nodePosition.y <= viewportY + viewportHeight + margin
      );
    },
    [getViewport]
  );

  // 子ノードを作成し、選択状態にする。新ノードのIDを返す（作成できなかった場合はundefined）
  const createChildNode = useCallback(
    (nodeId: string): string | undefined => {
      if (!currentMap) return undefined;
      const activeNode = currentMap.nodes.find((n) => n.id === nodeId);
      if (!activeNode) return undefined;

      // 子ノードの位置はレイアウト方向に応じて設定。親の実測primaryサイズ＋PRIMARY_GAPで配置する
      // ことで、親右端(下端)と子左端(上端)の間隔が親の幅（高さ）によらず常にPRIMARY_GAPで
      // 一定になる（固定オフセットだと親が広い場合に子と重なっていた不具合の修正。
      // auto-layout(sugiyama-ext / 既定のsugiyama-port)のforward配置とも一致する。docs/decisions.md参照）
      const direction = currentMap.layoutDirection;
      const rfParentNode = getNodes().find((n) => n.id === nodeId);
      const parentPrimary = measuredPrimarySize(rfParentNode, direction);
      let childPosition = { x: activeNode.position.x, y: activeNode.position.y };
      let sourceHandle: string;
      let targetHandle: string;

      switch (direction) {
        case 'DOWN':
          childPosition = { x: activeNode.position.x, y: activeNode.position.y + parentPrimary + PRIMARY_GAP };
          sourceHandle = 'bottom';
          targetHandle = 'top';
          break;
        case 'RIGHT':
          childPosition = { x: activeNode.position.x + parentPrimary + PRIMARY_GAP, y: activeNode.position.y };
          sourceHandle = 'right';
          targetHandle = 'left';
          break;
      }

      // 既存ノードとの重複を避ける
      const adjustedPosition = adjustPositionToAvoidOverlap(childPosition, currentMap.nodes);

      const newNodeId = addNode(
        {
          content: EMPTY_NODE_CONTENT,
          position: adjustedPosition,
        },
        nodeId,
        sourceHandle,
        targetHandle
      );

      if (newNodeId) {
        setSelectedNodeId(newNodeId);
        // ノードがビューポート外の場合は全体表示
        if (!isNodeInViewport(adjustedPosition)) {
          setTimeout(() => fitView({ padding: 0.2 }), 50);
        }
      }

      return newNodeId || undefined;
    },
    [currentMap, getNodes, addNode, setSelectedNodeId, isNodeInViewport, fitView]
  );

  // 弟ノードを作成し、選択状態にする。対象のすぐ隣（1スロット先）に挿入し、押し出す兄弟は
  // サブツリーごと平行移動する。新ノードのIDを返す（作成できなかった場合はundefined）
  const createSiblingNode = useCallback(
    (nodeId: string): string | undefined => {
      if (!currentMap) return undefined;
      const direction = currentMap.layoutDirection;
      const targetCrossSize = measuredCrossSize(getNodes().find((n) => n.id === nodeId), direction);
      const plan = computeSiblingInsertion('younger', nodeId, currentMap, targetCrossSize);
      if (!plan) return undefined;

      const newNodeId = addNodeWithShifts(
        { content: EMPTY_NODE_CONTENT, position: plan.position },
        plan.parentId,
        plan.sourceHandle,
        plan.targetHandle,
        plan.shifts
      );

      if (newNodeId) {
        setSelectedNodeId(newNodeId);
        if (!isNodeInViewport(plan.position)) {
          setTimeout(() => fitView({ padding: 0.2 }), 50);
        }
      }

      return newNodeId || undefined;
    },
    [currentMap, getNodes, addNodeWithShifts, setSelectedNodeId, isNodeInViewport, fitView]
  );

  // 兄ノード（弟の逆方向）を作成し選択する。対象のすぐ隣（1スロット手前）に挿入し、押し出す
  // 兄弟はサブツリーごと平行移動する。親は対象と同じ（createSiblingNodeと同様 parents[0]）。
  const createOlderSiblingNode = useCallback(
    (nodeId: string): string | undefined => {
      if (!currentMap) return undefined;
      const direction = currentMap.layoutDirection;
      const targetCrossSize = measuredCrossSize(getNodes().find((n) => n.id === nodeId), direction);
      const plan = computeSiblingInsertion('older', nodeId, currentMap, targetCrossSize);
      if (!plan) return undefined;

      const newNodeId = addNodeWithShifts(
        { content: EMPTY_NODE_CONTENT, position: plan.position },
        plan.parentId,
        plan.sourceHandle,
        plan.targetHandle,
        plan.shifts
      );

      if (newNodeId) {
        setSelectedNodeId(newNodeId);
        if (!isNodeInViewport(plan.position)) {
          setTimeout(() => fitView({ padding: 0.2 }), 50);
        }
      }
      return newNodeId || undefined;
    },
    [currentMap, getNodes, addNodeWithShifts, setSelectedNodeId, isNodeInViewport, fitView]
  );

  // 親ノードを作成して対象の親として挿入する。対象の既存の親は新ノードの親になり、
  // 対象は新ノードの子になる（対象の子はそのまま）。多重親も維持される。
  // 新ノードNは対象Tの元スロットを継承し、T＋その子孫を1レイヤ分外側へ平行移動する。
  const createParentNode = useCallback(
    (nodeId: string): string | undefined => {
      if (!currentMap) return undefined;
      const activeNode = currentMap.nodes.find((n) => n.id === nodeId);
      if (!activeNode) return undefined;

      const direction = currentMap.layoutDirection;
      const layerAxis: Axis = direction === 'RIGHT' ? 'x' : 'y';
      const layerGap = direction === 'RIGHT' ? 200 : 120;
      const childSourceHandle = direction === 'RIGHT' ? 'right' : 'bottom'; // 新ノード→対象
      const childTargetHandle = direction === 'RIGHT' ? 'left' : 'top';     // 対象の受け口
      const parentTargetHandle = childTargetHandle;                        // 新ノードの受け口（既存親から）

      // N は T の元スロットを継承
      const newPosition = { ...activeNode.position };

      // T＋子孫を1レイヤ分外へずらす
      const shiftIds = new Set<string>([nodeId, ...getDescendantIds(nodeId, currentMap.edges)]);
      const shifts = Array.from(shiftIds).map((id) => {
        const nd = currentMap.nodes.find((n) => n.id === id)!;
        return {
          id,
          position: setAxisValue(nd.position, layerAxis, getAxisValue(nd.position, layerAxis) + layerGap),
        };
      });

      const newNodeId = insertParentNode(
        nodeId,
        { content: EMPTY_NODE_CONTENT, position: newPosition },
        childSourceHandle,
        childTargetHandle,
        parentTargetHandle,
        shifts
      );

      if (newNodeId) {
        setSelectedNodeId(newNodeId);
        if (!isNodeInViewport(newPosition)) {
          setTimeout(() => fitView({ padding: 0.2 }), 50);
        }
      }
      return newNodeId || undefined;
    },
    [currentMap, insertParentNode, setSelectedNodeId, isNodeInViewport, fitView]
  );

  return { createChildNode, createSiblingNode, createOlderSiblingNode, createParentNode };
}
