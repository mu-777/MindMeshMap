import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ReactFlow,
  Background,
  Controls,
  Connection,
  ConnectionMode,
  applyNodeChanges,
  applyEdgeChanges,
  MarkerType,
  useReactFlow,
  useStore,
  type NodeChange,
  type EdgeChange,
  type Node,
  type OnConnectEnd,
  type OnSelectionChangeFunc,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { CustomNode, type CustomNodeType } from './CustomNode';
import { CustomEdge, type CustomEdgeType } from './CustomEdge';
import { ContextMenu } from './ContextMenu';
import { FormatToolbar } from './FormatToolbar';
import { useMapStore, loadDraft } from '../../stores/mapStore';
import { useUIStore } from '../../stores/uiStore';
import { isFirstVisit, markAsVisited, createDefaultMap } from '../../data/defaultMap';
import { EMPTY_NODE_CONTENT } from '../../utils/nodeContent';
import { getUndirectedShortestPath } from '../../utils/graphTraversal';

const nodeTypes = {
  custom: CustomNode,
};

const edgeTypes = {
  custom: CustomEdge,
};

const defaultEdgeOptions = {
  type: 'custom',
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 20,
    height: 20,
    color: '#6b7280',
  },
};

// 長押し検出用の定数
const LONG_PRESS_DELAY = 500; // ミリ秒

export function MindMapCanvas() {
  const { t } = useTranslation();
  const {
    currentMap,
    createNewMap,
    setCurrentMap,
    setDirty,
    updateNodePositions,
    addNode,
    addEdge: storeAddEdge,
    saveToHistory,
  } = useMapStore();
  const { selectedNodeId, selectedNodeIds, selectedEdgeIds, setSelectedNodeId, toggleNodeSelection, addNodesToSelection, setMultiSelection, clearMultiSelection, clearEdgeSelection, setEditingNodeId, closeContextMenu } = useUIStore();
  const { screenToFlowPosition, fitView, getViewport } = useReactFlow();
  // Controls左下の「Toggle interactivity」ロック状態。ロック中はnodesDraggable/elementsSelectableと
  // 一緒にnodesConnectableもfalseになる。ロック中はエッジ接続だけでなく新規ノード作成の
  // 全ルート（ダブルクリック/長押し/ハンドルドラッグ/キーボード）も禁止する判定に使う
  // （docs/decisions.md参照）
  const nodesConnectable = useStore((s) => s.nodesConnectable);
  const connectingInfo = useRef<{ nodeId: string | null; handleId: string | null }>({
    nodeId: null,
    handleId: null,
  });
  // ハンドルからエッジを引き伸ばして空白にドロップし新規ノードを作った直後は、その pointerup が
  // paneのclickとして扱われ onPaneClick が発火して選択・編集を解除してしまうことがある
  // （新ノードが「どこにも選択されていない」状態になり、IME入力どころかフォーカスも当たらない）。
  // onConnectEndで新ノードを作ったら短時間このフラグを立て、直後の onPaneClick を1回無視する
  const justConnectedRef = useRef<boolean>(false);

  // 複数ノードドラッグ用
  const dragStartPositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  const isDraggingMultiple = useRef<boolean>(false);

  // 長押し検出用
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressPositionRef = useRef<{ x: number; y: number } | null>(null);

  // 初回マップ初期化が完了済みかどうか。dev の StrictMode は初回マウント時にeffectを
  // 「実行→クリーンアップ→再実行」と2回連続で呼び出すため、このrefが無いとisFirstVisit()を
  // 元に分岐する初期化ロジックが2回走ってしまい、1回目のsetCurrentMap（デフォルトマップ）が
  // 2回目のcreateNewMap（Root Node 1個のマップ）で上書きされてしまう
  // （1回目のmarkAsVisited()がstateの反映前に同期実行されるため、2回目はisFirstVisit()がfalseになる）
  const hasInitializedMapRef = useRef(false);

  // ノードがビューポート内に表示されているかチェック
  const isNodeInViewport = useCallback(
    (nodePosition: { x: number; y: number }) => {
      const viewport = getViewport();
      const viewportWidth = window.innerWidth / viewport.zoom;
      const viewportHeight = window.innerHeight / viewport.zoom;
      const viewportX = -viewport.x / viewport.zoom;
      const viewportY = -viewport.y / viewport.zoom;

      const margin = 100;
      return (
        nodePosition.x >= viewportX - margin &&
        nodePosition.x <= viewportX + viewportWidth + margin &&
        nodePosition.y >= viewportY - margin &&
        nodePosition.y <= viewportY + viewportHeight + margin
      );
    },
    [getViewport]
  );

  // 初回マウント時にマップを復元・作成する。
  // 優先順位: (1) localStorageに保存されたドラフトがあれば復元 → (2) 初回訪問時はデフォルトマップ → (3) 新規マップ
  useEffect(() => {
    if (hasInitializedMapRef.current || currentMap) return;
    hasInitializedMapRef.current = true;

    const draft = loadDraft();
    if (draft) {
      setCurrentMap(draft.map, draft.fileId);
      setDirty(draft.isDirty);
    } else if (isFirstVisit()) {
      setCurrentMap(createDefaultMap(t));
      markAsVisited();
    } else {
      createNewMap();
    }
  }, [currentMap, createNewMap, setCurrentMap, setDirty, t]);

  // 前回生成したReact Flowノード/エッジオブジェクトをidキーで保持するキャッシュ。
  // React Flowはオブジェクト参照の同一性でmemo化されたノード/エッジコンポーネントの再レンダーを
  // 抑制するため、内容（content/position/selected、エッジはlabel/source/target/handles）が
  // 変わっていない要素は同一参照を返すことで、キー入力やドラッグの毎フレームで全ノードが
  // 再レンダーされるのを防ぐ
  const nodesCacheRef = useRef<Map<string, CustomNodeType>>(new Map());
  const edgesCacheRef = useRef<Map<string, CustomEdgeType>>(new Map());

  // ノードをReact Flow形式に変換（内容が変わっていないノードは前回と同じオブジェクト参照を返す）
  const nodes: CustomNodeType[] = useMemo(() => {
    if (!currentMap) return [];
    const prevCache = nodesCacheRef.current;
    const nextCache = new Map<string, CustomNodeType>();

    const result = currentMap.nodes.map((node) => {
      const selected = node.id === selectedNodeId || selectedNodeIds.includes(node.id);
      const prev = prevCache.get(node.id);
      const unchanged =
        prev !== undefined &&
        prev.data.content === node.content &&
        prev.position.x === node.position.x &&
        prev.position.y === node.position.y &&
        prev.selected === selected;

      const nodeObj: CustomNodeType = unchanged
        ? prev
        : {
            id: node.id,
            type: 'custom' as const,
            position: node.position,
            data: { content: node.content },
            selected,
          };
      nextCache.set(node.id, nodeObj);
      return nodeObj;
    });

    // 削除されたノードのエントリを引き継がないよう、キャッシュはMapごと差し替える
    nodesCacheRef.current = nextCache;
    return result;
  }, [currentMap, selectedNodeId, selectedNodeIds]);

  // エッジをReact Flow形式に変換（内容が変わっていないエッジは前回と同じオブジェクト参照を返す）
  const edges: CustomEdgeType[] = useMemo(() => {
    if (!currentMap) return [];
    const prevCache = edgesCacheRef.current;
    const nextCache = new Map<string, CustomEdgeType>();

    const result = currentMap.edges.map((edge) => {
      const selected = selectedEdgeIds.includes(edge.id);
      const prev = prevCache.get(edge.id);
      const unchanged =
        prev !== undefined &&
        prev.source === edge.source &&
        prev.target === edge.target &&
        prev.sourceHandle === edge.sourceHandle &&
        prev.targetHandle === edge.targetHandle &&
        prev.data?.label === edge.label &&
        prev.selected === selected;

      const edgeObj: CustomEdgeType = unchanged
        ? prev
        : {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle,
            targetHandle: edge.targetHandle,
            type: 'custom' as const,
            data: { label: edge.label },
            selected,
          };
      nextCache.set(edge.id, edgeObj);
      return edgeObj;
    });

    edgesCacheRef.current = nextCache;
    return result;
  }, [currentMap, selectedEdgeIds]);

  // ノード変更ハンドラ
  const onNodesChange = useCallback(
    (changes: NodeChange<CustomNodeType>[]) => {
      // 選択変更はCustomNodeのhandleClickで処理するため、ここでは無視
      // （React Flowの内部選択管理がselectedNodeIdsを上書きしないようにする）

      // 位置変更を処理
      const positionChanges = changes.filter(
        (c): c is NodeChange<CustomNodeType> & { type: 'position'; position: { x: number; y: number } } =>
          c.type === 'position' && 'position' in c && c.position !== undefined
      );
      if (positionChanges.length > 0) {
        const positions = positionChanges.map((c) => ({
          id: c.id,
          position: c.position,
        }));
        updateNodePositions(positions);
      }

      // React Flowの内部状態を更新
      const newNodes = applyNodeChanges(changes, nodes);

      // 削除されたノードを処理
      const removedNodes = changes.filter((c) => c.type === 'remove');
      for (const removed of removedNodes) {
        if (removed.id === selectedNodeId) {
          setSelectedNodeId(null);
        }
      }

      return newNodes;
    },
    [nodes, selectedNodeId, setSelectedNodeId, updateNodePositions]
  );

  // エッジ変更ハンドラ
  const onEdgesChange = useCallback(
    (changes: EdgeChange<CustomEdgeType>[]) => {
      return applyEdgeChanges(changes, edges);
    },
    [edges]
  );

  // エッジ接続開始時に接続元ノードとハンドルを記録
  const onConnectStart = useCallback(
    (_event: MouseEvent | TouchEvent, params: { nodeId: string | null; handleId: string | null }) => {
      connectingInfo.current = {
        nodeId: params.nodeId,
        handleId: params.handleId,
      };
    },
    []
  );

  // 新しいエッジ接続ハンドラ
  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) {
        storeAddEdge(
          connection.source,
          connection.target,
          connection.sourceHandle || undefined,
          connection.targetHandle || undefined
        );
      }
    },
    [storeAddEdge]
  );

  // エッジ接続終了時（空白にドロップした場合、新しいノードを作成）
  const onConnectEnd: OnConnectEnd = useCallback(
    (event) => {
      const { nodeId, handleId } = connectingInfo.current;
      if (!nodeId) return;

      // Toggle interactivityでロック中は、ハンドルドラッグ経由の新規ノード作成も禁止する
      // （nodesDraggable=falseだけでは自前実装のこの作成ルートは止まらないための保険）
      if (!nodesConnectable) {
        connectingInfo.current = { nodeId: null, handleId: null };
        return;
      }

      // MouseEventまたはTouchEventから座標を取得
      let clientX: number | undefined;
      let clientY: number | undefined;

      if (event instanceof MouseEvent) {
        clientX = event.clientX;
        clientY = event.clientY;
      } else if (event instanceof TouchEvent && event.changedTouches.length > 0) {
        clientX = event.changedTouches[0].clientX;
        clientY = event.changedTouches[0].clientY;
      }

      if (clientX === undefined || clientY === undefined || !currentMap) {
        connectingInfo.current = { nodeId: null, handleId: null };
        return;
      }

      // ドロップ位置の要素を取得（タッチイベントではevent.targetがドラッグ開始位置を指すため）
      const elementAtPoint = document.elementFromPoint(clientX, clientY);
      const targetIsPane = elementAtPoint?.classList.contains('react-flow__pane') ?? false;
      // ノード上にドロップした場合は新規作成しない
      const isOverNode = elementAtPoint?.closest('.react-flow__node') !== null;

      if (targetIsPane || (!isOverNode && elementAtPoint?.closest('.react-flow'))) {
        // スクリーン座標をFlow座標に変換
        const position = screenToFlowPosition({
          x: clientX,
          y: clientY,
        });

        // レイアウト方向に応じてハンドルを決定
        const direction = currentMap.layoutDirection;
        const sourceHandle = handleId || (direction === 'RIGHT' ? 'right' : 'bottom');
        const targetHandle = direction === 'RIGHT' ? 'left' : 'top';

        // 新しいノードを作成（空ノード。理由は utils/nodeContent.ts 参照）
        const newNodeId = addNode(
          {
            content: EMPTY_NODE_CONTENT,
            position,
          },
          nodeId,
          sourceHandle,
          targetHandle
        );

        if (newNodeId) {
          // 直後に発火しうる onPaneClick による選択解除を防ぐ（300ms内の最初の1回を無視）
          justConnectedRef.current = true;
          setTimeout(() => {
            justConnectedRef.current = false;
          }, 300);
          setSelectedNodeId(newNodeId);
          setEditingNodeId(newNodeId);
          // ノードがビューポート外の場合は全体表示
          if (!isNodeInViewport(position)) {
            setTimeout(() => fitView({ padding: 0.2 }), 50);
          }
        }
      }

      connectingInfo.current = { nodeId: null, handleId: null };
    },
    [
      nodesConnectable,
      screenToFlowPosition,
      addNode,
      setSelectedNodeId,
      setEditingNodeId,
      currentMap,
      isNodeInViewport,
      fitView,
    ]
  );

  // ノードクリック。修飾キーで挙動を変える（CustomNode.handleClickと同一セマンティクス。
  // docs/decisions.md参照）: Ctrl/Meta+クリック＝そのノード単体を選択にトグル追加、
  // Shift+クリック＝アンカー（直近選択ノード）からクリックしたノードまでの無向最短経路上の
  // ノードをまとめて選択にunion追加、修飾なし＝単一選択
  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (event.shiftKey) {
        // 常に最新の選択状態を読む（getState()経由。CustomNode.handleClickと同じ理由）
        const uiState = useUIStore.getState();
        const anchor = uiState.selectedNodeId ?? uiState.lastSelectedNodeId;
        const path =
          anchor && currentMap ? getUndirectedShortestPath(anchor, node.id, currentMap.edges) : [];
        if (path.length > 0) {
          addNodesToSelection(path);
        } else {
          // アンカーが無い、または到達不能（別の連結成分）な場合は単体トグル追加にフォールバック
          toggleNodeSelection(node.id);
        }
      } else if (event.ctrlKey || event.metaKey) {
        // そのノード単体を選択にトグル追加
        toggleNodeSelection(node.id);
      } else {
        // 通常クリックは単一選択
        setSelectedNodeId(node.id);
      }
    },
    [toggleNodeSelection, addNodesToSelection, setSelectedNodeId, currentMap]
  );

  // Shift+ドラッグの矩形選択（React Flow標準機能）をuiStoreの複数選択へ橋渡しする。
  // アプリの選択状態は独自管理（uiStore.selectedNodeIds）で、単一クリック/Ctrl+クリック/
  // Shift+クリックはonNodeClick/CustomNode.handleClickが個別に反映しているが、矩形選択には
  // 対応するハンドラが無くuiStoreへ反映されていなかった（Deleteキーがselected NodeIdsを
  // 見るため、矩形選択したノードをDeleteで削除できない不具合になっていた）。
  // 2件以上のときだけ反映する（1件以下は単一選択系のクリックハンドラが管理するため、ここで
  // 触ると単一クリックの選択解除等と競合しうる）。既に同一集合ならno-op（無限ループ防止）
  const handleSelectionChange = useCallback<OnSelectionChangeFunc>(
    ({ nodes: selNodes }) => {
      const ids = selNodes.map((n) => n.id);
      if (ids.length < 2) return;
      const cur = useUIStore.getState().selectedNodeIds;
      const same = ids.length === cur.length && ids.every((id) => cur.includes(id));
      if (!same) setMultiSelection(ids);
    },
    [setMultiSelection]
  );

  // キャンバスクリックで選択解除
  const onPaneClick = useCallback(() => {
    // ハンドルドラッグでの新規ノード作成直後のonPaneClickは、作ったばかりのノードの
    // 選択・編集を解除してしまうので1回だけ無視する（詳細はjustConnectedRefのコメント参照）
    if (justConnectedRef.current) {
      justConnectedRef.current = false;
      return;
    }
    setSelectedNodeId(null);
    clearMultiSelection();
    clearEdgeSelection();
    setEditingNodeId(null);
    closeContextMenu();
  }, [setSelectedNodeId, clearMultiSelection, clearEdgeSelection, setEditingNodeId, closeContextMenu]);

  // ダブルクリック/ダブルタップで新しいノードを作成
  const createNodeAtPosition = useCallback(
    (clientX: number, clientY: number) => {
      if (!currentMap) return;
      // Toggle interactivityでロック中は新規ノード作成を禁止する（ダブルクリック・長押し両方をカバー）
      if (!nodesConnectable) return;

      // ノード上にドロップした場合は新規作成しない
      const elementAtPoint = document.elementFromPoint(clientX, clientY);
      const isOverNode = elementAtPoint?.closest('.react-flow__node') !== null;
      if (isOverNode) return;

      // スクリーン座標をFlow座標に変換
      const position = screenToFlowPosition({
        x: clientX,
        y: clientY,
      });

      // エッジに接続されていない独立したノードを作成（空ノード。理由は utils/nodeContent.ts 参照）
      const newNodeId = addNode(
        {
          content: EMPTY_NODE_CONTENT,
          position,
        },
        undefined, // 親ノードなし
        undefined,
        undefined
      );

      if (newNodeId) {
        setSelectedNodeId(newNodeId);
        setEditingNodeId(newNodeId);
      }
    },
    [currentMap, nodesConnectable, screenToFlowPosition, addNode, setSelectedNodeId, setEditingNodeId]
  );

  // ペインのダブルクリックハンドラ（デスクトップ用）
  const onDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      // ノード上でのダブルクリックは編集モードになるので無視
      const target = event.target as HTMLElement;
      if (target.closest('.react-flow__node')) return;

      createNodeAtPosition(event.clientX, event.clientY);
    },
    [createNodeAtPosition]
  );

  // タッチスタートで長押しタイマーを開始（モバイル用）
  const onTouchStart = useCallback(
    (event: React.TouchEvent) => {
      // ノードまたはエッジ上でのタッチは無視（それぞれ独自の長押しハンドリングを持つ）
      const target = event.target as HTMLElement;
      if (target.closest('.react-flow__node')) return;
      if (target.closest('.react-flow__edge')) return;

      const touch = event.touches[0];
      const clientX = touch.clientX;
      const clientY = touch.clientY;

      // 前のタイマーをクリア
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }

      // 位置を記録
      longPressPositionRef.current = { x: clientX, y: clientY };

      // 長押しタイマーを開始
      longPressTimerRef.current = setTimeout(() => {
        createNodeAtPosition(clientX, clientY);
        longPressTimerRef.current = null;
        longPressPositionRef.current = null;
      }, LONG_PRESS_DELAY);
    },
    [createNodeAtPosition]
  );

  // タッチ移動で長押しをキャンセル（モバイル用）
  const onTouchMove = useCallback(
    (event: React.TouchEvent) => {
      if (!longPressTimerRef.current || !longPressPositionRef.current) return;

      const touch = event.touches[0];
      const startPos = longPressPositionRef.current;

      // 位置の許容範囲（ピクセル）
      const MOVE_THRESHOLD = 10;

      // 指が動いたらキャンセル
      if (
        Math.abs(touch.clientX - startPos.x) > MOVE_THRESHOLD ||
        Math.abs(touch.clientY - startPos.y) > MOVE_THRESHOLD
      ) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
        longPressPositionRef.current = null;
      }
    },
    []
  );

  // タッチ終了で長押しをキャンセル（モバイル用）
  const onTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressPositionRef.current = null;
  }, []);

  // ノードドラッグ開始
  const onNodeDragStart = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      // ドラッグ前のスナップショットを履歴に積む（ドラッグ全体で1 Undoステップにするため）
      saveToHistory();

      // 選択されたノードを取得（単一選択 + 複数選択）
      const allSelectedIds = new Set<string>();
      if (selectedNodeId) allSelectedIds.add(selectedNodeId);
      selectedNodeIds.forEach((id) => allSelectedIds.add(id));

      // ドラッグ対象のノードが選択されていない場合は、単一ノードのドラッグ
      if (!allSelectedIds.has(node.id)) {
        isDraggingMultiple.current = false;
        dragStartPositions.current.clear();
        return;
      }

      // 複数ノードが選択されている場合
      if (allSelectedIds.size > 1 && currentMap) {
        isDraggingMultiple.current = true;
        dragStartPositions.current.clear();

        // 選択されているノードの初期位置を記録
        allSelectedIds.forEach((nodeId) => {
          const mapNode = currentMap.nodes.find((n) => n.id === nodeId);
          if (mapNode) {
            dragStartPositions.current.set(nodeId, { ...mapNode.position });
          }
        });
      } else {
        isDraggingMultiple.current = false;
        dragStartPositions.current.clear();
      }
    },
    [selectedNodeId, selectedNodeIds, currentMap, saveToHistory]
  );

  // 複数ノードドラッグ中
  const onNodeDrag = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (!isDraggingMultiple.current || !currentMap) return;

      // ドラッグされているノードの初期位置を取得
      const startPos = dragStartPositions.current.get(node.id);
      if (!startPos) return;

      // 移動量を計算
      const deltaX = node.position.x - startPos.x;
      const deltaY = node.position.y - startPos.y;

      // 他の選択されたノードも同じ量だけ移動
      const positions: { id: string; position: { x: number; y: number } }[] = [];
      dragStartPositions.current.forEach((originalPos, nodeId) => {
        if (nodeId !== node.id) {
          positions.push({
            id: nodeId,
            position: {
              x: originalPos.x + deltaX,
              y: originalPos.y + deltaY,
            },
          });
        }
      });

      if (positions.length > 0) {
        updateNodePositions(positions);
      }
    },
    [currentMap, updateNodePositions]
  );

  // ノードドラッグ終了
  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (isDraggingMultiple.current) {
        // 複数ドラッグ終了時：最終位置を保存
        isDraggingMultiple.current = false;
        dragStartPositions.current.clear();
      }
      // updateNodeは履歴を積んでしまうため、位置のみ更新するupdateNodePositionsを使う
      // （履歴はonNodeDragStartで既に積んでいる）
      updateNodePositions([{ id: node.id, position: node.position }]);
    },
    [updateNodePositions]
  );

  if (!currentMap) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <>
    <ContextMenu />
    <div
      className="h-full w-full"
      onDoubleClick={onDoubleClick}
      onTouchStartCapture={onTouchStart}
      onTouchMoveCapture={onTouchMove}
      onTouchEndCapture={onTouchEnd}
    >
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnectStart={onConnectStart}
      onConnect={onConnect}
      onConnectEnd={onConnectEnd}
      onNodeClick={onNodeClick}
      onSelectionChange={handleSelectionChange}
      onPaneClick={onPaneClick}
      onNodeDragStart={onNodeDragStart}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={onNodeDragStop}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      connectionMode={ConnectionMode.Loose}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.1}
      maxZoom={2}
      // ダブルクリックはノード作成に割り当てているため、React Flow標準のズーム動作は無効化する
      // （有効のままだとd3-zoomのdblclickハンドラがイベント伝播を止め、ラッパーdivのonDoubleClickまで届かない）
      zoomOnDoubleClick={false}
      // React Flow標準のキーボードアクセシビリティ（ノードDOMがフォーカスを持っている状態で
      // 矢印キーを押すと選択中ノードがその方向へ移動する等）を無効化する。アプリ独自のキーボード
      // ナビゲーション（useKeyboardShortcuts）と二重に働き、矢印キーでノードが動いてしまう
      // 不具合の原因になっていたため
      disableKeyboardA11y={true}
      className="bg-gray-900"
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#374151" gap={20} />
      <Controls className="!bg-gray-800 !border-gray-700 [&>button]:!bg-gray-700 [&>button]:!border-gray-600 [&>button]:!text-gray-300 [&>button:hover]:!bg-gray-600" />
      <FormatToolbar />

      {/* 矢印マーカー定義 */}
      <svg>
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#6b7280" />
          </marker>
        </defs>
      </svg>
    </ReactFlow>
    </div>
    </>
  );
}
