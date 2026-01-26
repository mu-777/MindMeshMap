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
  type NodeChange,
  type EdgeChange,
  type Node,
  type OnConnectEnd,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { CustomNode, type CustomNodeType } from './CustomNode';
import { CustomEdge, type CustomEdgeType } from './CustomEdge';
import { ContextMenu } from './ContextMenu';
import { useMapStore } from '../../stores/mapStore';
import { useUIStore } from '../../stores/uiStore';

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
    updateNode,
    updateNodePositions,
    addNode,
    addEdge: storeAddEdge,
  } = useMapStore();
  const { selectedNodeId, selectedNodeIds, setSelectedNodeId, toggleNodeSelection, clearMultiSelection, setEditingNodeId, closeContextMenu } = useUIStore();
  const { screenToFlowPosition, fitView, getViewport } = useReactFlow();
  const connectingInfo = useRef<{ nodeId: string | null; handleId: string | null }>({
    nodeId: null,
    handleId: null,
  });

  // 長押し検出用
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressPositionRef = useRef<{ x: number; y: number } | null>(null);

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

  // 初回マウント時に新規マップを作成
  useEffect(() => {
    if (!currentMap) {
      createNewMap();
    }
  }, [currentMap, createNewMap]);

  // ノードをReact Flow形式に変換
  const nodes: CustomNodeType[] = useMemo(() => {
    if (!currentMap) return [];
    return currentMap.nodes.map((node) => ({
      id: node.id,
      type: 'custom' as const,
      position: node.position,
      data: { content: node.content },
      selected: node.id === selectedNodeId || selectedNodeIds.includes(node.id),
    }));
  }, [currentMap, selectedNodeId, selectedNodeIds]);

  // エッジをReact Flow形式に変換
  const edges: CustomEdgeType[] = useMemo(() => {
    if (!currentMap) return [];
    return currentMap.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      type: 'custom' as const,
      data: { label: edge.label },
    }));
  }, [currentMap]);

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

        // 新しいノードを作成
        const newNodeId = addNode(
          {
            content: JSON.stringify({
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: t('editor.newNode') }] }],
            }),
            position,
          },
          nodeId,
          sourceHandle,
          targetHandle
        );

        if (newNodeId) {
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
    [screenToFlowPosition, addNode, setSelectedNodeId, setEditingNodeId, currentMap, isNodeInViewport, fitView, t]
  );

  // ノードクリック（Shift+クリックで複数選択）
  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (event.shiftKey) {
        // Shift+クリックで複数選択をトグル
        toggleNodeSelection(node.id);
      } else {
        // 通常クリックは単一選択
        setSelectedNodeId(node.id);
      }
    },
    [toggleNodeSelection, setSelectedNodeId]
  );

  // キャンバスクリックで選択解除
  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    clearMultiSelection();
    setEditingNodeId(null);
    closeContextMenu();
  }, [setSelectedNodeId, clearMultiSelection, setEditingNodeId, closeContextMenu]);

  // ダブルクリック/ダブルタップで新しいノードを作成
  const createNodeAtPosition = useCallback(
    (clientX: number, clientY: number) => {
      if (!currentMap) return;

      // ノード上にドロップした場合は新規作成しない
      const elementAtPoint = document.elementFromPoint(clientX, clientY);
      const isOverNode = elementAtPoint?.closest('.react-flow__node') !== null;
      if (isOverNode) return;

      // スクリーン座標をFlow座標に変換
      const position = screenToFlowPosition({
        x: clientX,
        y: clientY,
      });

      // エッジに接続されていない独立したノードを作成
      const newNodeId = addNode(
        {
          content: JSON.stringify({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: t('editor.newNode') }] }],
          }),
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
    [currentMap, screenToFlowPosition, addNode, setSelectedNodeId, setEditingNodeId, t]
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
      // ノード上でのタッチは無視
      const target = event.target as HTMLElement;
      if (target.closest('.react-flow__node')) return;

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

  // ノードサイズ変更時のハンドラ
  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      updateNode(node.id, { position: node.position });
    },
    [updateNode]
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
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
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
      onPaneClick={onPaneClick}
      onDoubleClick={onDoubleClick}
      onNodeDragStop={onNodeDragStop}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      connectionMode={ConnectionMode.Loose}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.1}
      maxZoom={2}
      className="bg-gray-900"
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#374151" gap={20} />
      <Controls className="!bg-gray-800 !border-gray-700 [&>button]:!bg-gray-700 [&>button]:!border-gray-600 [&>button]:!text-gray-300 [&>button:hover]:!bg-gray-600" />

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
