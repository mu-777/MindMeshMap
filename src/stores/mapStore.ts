import { create } from 'zustand';
import { MindMap, MapNode, MapEdge, LayoutDirection } from '../types';
import { generateId } from '../utils/idGenerator';

interface MapState {
  // 現在のマップ
  currentMap: MindMap | null;
  currentFileId: string | null;
  isDirty: boolean;

  // 履歴（Undo/Redo）
  history: MindMap[];
  historyIndex: number;

  // アクション
  setCurrentMap: (map: MindMap, fileId?: string | null) => void;
  createNewMap: (name?: string) => void;
  updateMap: (updates: Partial<MindMap>) => void;
  setDirty: (dirty: boolean) => void;

  // ノード操作
  addNode: (node: Omit<MapNode, 'id'>, parentId?: string, sourceHandle?: string, targetHandle?: string) => string;
  updateNode: (nodeId: string, updates: Partial<MapNode>) => void;
  deleteNode: (nodeId: string) => void;
  updateNodePositions: (positions: { id: string; position: { x: number; y: number } }[]) => void;

  // エッジ操作
  addEdge: (source: string, target: string, sourceHandle?: string, targetHandle?: string, label?: string) => string | null;
  updateEdge: (edgeId: string, updates: Partial<MapEdge>) => void;
  deleteEdge: (edgeId: string) => void;

  // レイアウト
  setLayoutDirection: (direction: LayoutDirection) => void;

  // 履歴操作
  undo: () => void;
  redo: () => void;
  saveToHistory: () => void;
}

const createEmptyMap = (name: string = '新しいマップ'): MindMap => {
  const rootNodeId = generateId();
  return {
    id: generateId(),
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    layoutDirection: 'RIGHT',
    nodes: [
      {
        id: rootNodeId,
        content: JSON.stringify({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ルートノード' }] }],
        }),
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
  };
};

export const useMapStore = create<MapState>((set, get) => ({
  currentMap: null,
  currentFileId: null,
  isDirty: false,
  history: [],
  historyIndex: -1,

  setCurrentMap: (map, fileId = null) => {
    set({
      currentMap: map,
      currentFileId: fileId,
      isDirty: false,
      history: [map],
      historyIndex: 0,
    });
  },

  createNewMap: (name) => {
    const newMap = createEmptyMap(name);
    set({
      currentMap: newMap,
      currentFileId: null,
      isDirty: false,
      history: [newMap],
      historyIndex: 0,
    });
  },

  updateMap: (updates) => {
    const { currentMap } = get();
    if (!currentMap) return;

    const updatedMap = {
      ...currentMap,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    set({ currentMap: updatedMap, isDirty: true });
  },

  setDirty: (dirty) => set({ isDirty: dirty }),

  addNode: (nodeData, parentId, sourceHandle, targetHandle) => {
    const { currentMap, saveToHistory } = get();
    if (!currentMap) return '';

    saveToHistory();

    const newNode: MapNode = {
      ...nodeData,
      id: generateId(),
    };

    const newEdges = parentId
      ? [
          ...currentMap.edges,
          {
            id: generateId(),
            source: parentId,
            target: newNode.id,
            sourceHandle,
            targetHandle,
          },
        ]
      : currentMap.edges;

    set({
      currentMap: {
        ...currentMap,
        nodes: [...currentMap.nodes, newNode],
        edges: newEdges,
        updatedAt: new Date().toISOString(),
      },
      isDirty: true,
    });

    return newNode.id;
  },

  updateNode: (nodeId, updates) => {
    const { currentMap, saveToHistory } = get();
    if (!currentMap) return;

    saveToHistory();

    set({
      currentMap: {
        ...currentMap,
        nodes: currentMap.nodes.map((node) =>
          node.id === nodeId ? { ...node, ...updates } : node
        ),
        updatedAt: new Date().toISOString(),
      },
      isDirty: true,
    });
  },

  deleteNode: (nodeId) => {
    const { currentMap, saveToHistory } = get();
    if (!currentMap) return;

    // ルートノード（エッジで参照されていない唯一のノード）は削除しない
    const incomingEdges = currentMap.edges.filter((e) => e.target === nodeId);
    const isRoot = incomingEdges.length === 0 && currentMap.nodes.length > 1;
    if (isRoot && currentMap.nodes.length === 1) return;

    saveToHistory();

    // ノードと関連するエッジを削除
    set({
      currentMap: {
        ...currentMap,
        nodes: currentMap.nodes.filter((node) => node.id !== nodeId),
        edges: currentMap.edges.filter(
          (edge) => edge.source !== nodeId && edge.target !== nodeId
        ),
        updatedAt: new Date().toISOString(),
      },
      isDirty: true,
    });
  },

  updateNodePositions: (positions) => {
    const { currentMap } = get();
    if (!currentMap) return;

    const positionMap = new Map(positions.map((p) => [p.id, p.position]));

    set({
      currentMap: {
        ...currentMap,
        nodes: currentMap.nodes.map((node) => {
          const newPosition = positionMap.get(node.id);
          return newPosition ? { ...node, position: newPosition } : node;
        }),
        updatedAt: new Date().toISOString(),
      },
      isDirty: true,
    });
  },

  addEdge: (source, target, sourceHandle, targetHandle, label) => {
    const { currentMap, saveToHistory } = get();
    if (!currentMap) return null;

    // 自己ループは禁止
    if (source === target) return null;

    // 既存のエッジがある場合は追加しない
    const existingEdge = currentMap.edges.find(
      (e) => e.source === source && e.target === target
    );
    if (existingEdge) return null;

    saveToHistory();

    const newEdge: MapEdge = {
      id: generateId(),
      source,
      target,
      sourceHandle,
      targetHandle,
      label,
    };

    set({
      currentMap: {
        ...currentMap,
        edges: [...currentMap.edges, newEdge],
        updatedAt: new Date().toISOString(),
      },
      isDirty: true,
    });

    return newEdge.id;
  },

  updateEdge: (edgeId, updates) => {
    const { currentMap, saveToHistory } = get();
    if (!currentMap) return;

    saveToHistory();

    set({
      currentMap: {
        ...currentMap,
        edges: currentMap.edges.map((edge) =>
          edge.id === edgeId ? { ...edge, ...updates } : edge
        ),
        updatedAt: new Date().toISOString(),
      },
      isDirty: true,
    });
  },

  deleteEdge: (edgeId) => {
    const { currentMap, saveToHistory } = get();
    if (!currentMap) return;

    saveToHistory();

    set({
      currentMap: {
        ...currentMap,
        edges: currentMap.edges.filter((edge) => edge.id !== edgeId),
        updatedAt: new Date().toISOString(),
      },
      isDirty: true,
    });
  },

  setLayoutDirection: (direction) => {
    const { currentMap, saveToHistory } = get();
    if (!currentMap) return;

    saveToHistory();

    set({
      currentMap: {
        ...currentMap,
        layoutDirection: direction,
        updatedAt: new Date().toISOString(),
      },
      isDirty: true,
    });
  },

  saveToHistory: () => {
    const { currentMap, history, historyIndex } = get();
    if (!currentMap) return;

    // 現在の位置以降の履歴を削除して新しい状態を追加
    const newHistory = [...history.slice(0, historyIndex + 1), currentMap];
    // 履歴は最大50件まで
    if (newHistory.length > 50) {
      newHistory.shift();
    }

    set({
      history: newHistory,
      historyIndex: newHistory.length - 1,
    });
  },

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex <= 0) return;

    const newIndex = historyIndex - 1;
    set({
      currentMap: history[newIndex],
      historyIndex: newIndex,
      isDirty: true,
    });
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex >= history.length - 1) return;

    const newIndex = historyIndex + 1;
    set({
      currentMap: history[newIndex],
      historyIndex: newIndex,
      isDirty: true,
    });
  },
}));
