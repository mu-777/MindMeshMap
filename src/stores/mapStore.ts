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
  setCurrentFileId: (fileId: string | null) => void;

  // ノード操作
  addNode: (node: Omit<MapNode, 'id'>, parentId?: string, sourceHandle?: string, targetHandle?: string) => string;
  // ノード追加(+任意の親エッジ) と 既存ノードの位置移動 を1履歴でまとめて適用する。
  // 兄弟ノードを対象の隣に挿入し、押し出す兄弟（＋そのサブツリー）を平行移動するのに使う。
  addNodeWithShifts: (
    node: Omit<MapNode, 'id'>,
    parentId: string | undefined,
    sourceHandle: string | undefined,
    targetHandle: string | undefined,
    shifts: { id: string; position: { x: number; y: number } }[]
  ) => string;
  // 対象ノードの「親」として新ノードを挿入する。対象の既存の親（複数可）は新ノードの親になり、
  // 対象は新ノードの子になる（対象の子はそのまま）。ノード追加・エッジ張り替えを1履歴でまとめる。
  insertParentNode: (
    targetId: string,
    node: Omit<MapNode, 'id'>,
    childSourceHandle?: string,   // 新ノード→対象 のsourceHandle（RIGHT:'right' / DOWN:'bottom'）
    childTargetHandle?: string,   // 対象側のtargetHandle（RIGHT:'left' / DOWN:'top'）
    parentTargetHandle?: string,  // 既存親→新ノード のtargetHandle（RIGHT:'left' / DOWN:'top'）
    shifts?: { id: string; position: { x: number; y: number } }[]  // 対象＋子孫を外側レイヤへ移動する
  ) => string;
  updateNode: (nodeId: string, updates: Partial<MapNode>) => void;
  updateNodeContent: (nodeId: string, content: string, recordHistory: boolean) => void;
  deleteNode: (nodeId: string) => void;
  deleteNodes: (nodeIds: string[]) => void;
  // ノードと明示指定エッジを1回の履歴エントリでまとめて削除する（複数選択のDelete一括削除用）。
  // ノードに接続するエッジは自動的に連鎖削除される（deleteNode/deleteNodesと同様）
  deleteNodesAndEdges: (nodeIds: string[], edgeIds: string[]) => void;
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

const createEmptyMap = (name: string = 'New Map'): MindMap => {
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
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Root Node' }] }],
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

  setCurrentFileId: (fileId) => set({ currentFileId: fileId }),

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

  addNodeWithShifts: (nodeData, parentId, sourceHandle, targetHandle, shifts) => {
    const { currentMap, saveToHistory } = get();
    if (!currentMap) return '';

    saveToHistory();

    const newNode: MapNode = { ...nodeData, id: generateId() };
    const shiftMap = new Map(shifts.map((s) => [s.id, s.position]));

    const nodes = currentMap.nodes.map((n) =>
      shiftMap.has(n.id) ? { ...n, position: shiftMap.get(n.id)! } : n
    );
    nodes.push(newNode);

    const edges = parentId
      ? [
          ...currentMap.edges,
          { id: generateId(), source: parentId, target: newNode.id, sourceHandle, targetHandle },
        ]
      : currentMap.edges;

    set({
      currentMap: { ...currentMap, nodes, edges, updatedAt: new Date().toISOString() },
      isDirty: true,
    });

    return newNode.id;
  },

  insertParentNode: (targetId, nodeData, childSourceHandle, childTargetHandle, parentTargetHandle, shifts = []) => {
    const { currentMap, saveToHistory } = get();
    if (!currentMap) return '';
    const target = currentMap.nodes.find((n) => n.id === targetId);
    if (!target) return '';

    saveToHistory();

    const newNode: MapNode = { ...nodeData, id: generateId() };
    const shiftMap = new Map(shifts.map((s) => [s.id, s.position]));

    // 対象を指している既存エッジ（＝対象の親→対象）を、親→新ノード に張り替える。
    // 親側のsourceHandleは維持し、targetHandleは新ノードの受け口に更新する。
    // 対象から出るエッジ（対象の子）は一切触らない。
    const rewiredEdges = currentMap.edges.map((edge) =>
      edge.target === targetId
        ? { ...edge, target: newNode.id, targetHandle: parentTargetHandle }
        : edge
    );

    // 対象＋その子孫を外側レイヤへ平行移動する
    const nodes = currentMap.nodes.map((n) =>
      shiftMap.has(n.id) ? { ...n, position: shiftMap.get(n.id)! } : n
    );
    nodes.push(newNode);

    const newEdge: MapEdge = {
      id: generateId(),
      source: newNode.id,
      target: targetId,
      sourceHandle: childSourceHandle,
      targetHandle: childTargetHandle,
    };

    set({
      currentMap: { ...currentMap, nodes, edges: [...rewiredEdges, newEdge], updatedAt: new Date().toISOString() },
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

  // テキスト編集用。recordHistory が true のときのみ履歴を積む
  // （編集セッション中の最初の1回だけ true にすることで「1編集セッション=1 Undo」を実現する）
  updateNodeContent: (nodeId, content, recordHistory) => {
    const { currentMap, saveToHistory } = get();
    if (!currentMap) return;

    if (recordHistory) {
      saveToHistory();
    }

    set({
      currentMap: {
        ...currentMap,
        nodes: currentMap.nodes.map((node) =>
          node.id === nodeId ? { ...node, content } : node
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

  deleteNodes: (nodeIds) => {
    const { currentMap, saveToHistory } = get();
    if (!currentMap || nodeIds.length === 0) return;

    // ルートノードは削除しない（エッジで参照されていないノード）
    const nodesToDelete = nodeIds.filter((nodeId) => {
      const incomingEdges = currentMap.edges.filter((e) => e.target === nodeId);
      const isRoot = incomingEdges.length === 0;
      // ルートノードで、かつ削除後にノードが残らない場合は削除しない
      if (isRoot && currentMap.nodes.length - nodeIds.length < 1) {
        return false;
      }
      return true;
    });

    if (nodesToDelete.length === 0) return;

    const deleteSet = new Set(nodesToDelete);

    saveToHistory();

    // ノードと関連するエッジを削除
    set({
      currentMap: {
        ...currentMap,
        nodes: currentMap.nodes.filter((node) => !deleteSet.has(node.id)),
        edges: currentMap.edges.filter(
          (edge) => !deleteSet.has(edge.source) && !deleteSet.has(edge.target)
        ),
        updatedAt: new Date().toISOString(),
      },
      isDirty: true,
    });
  },

  // ノード・エッジの複数選択混在Deleteの一括削除用。saveToHistory()を1回だけ呼ぶことで、
  // 「Ctrl+Z 1回で選択していたノード・エッジが全部戻る」を実現する
  // （ノードごとdeleteNodesを、エッジごとdeleteEdgeを個別に呼ぶと履歴が複数積まれてしまうため）
  deleteNodesAndEdges: (nodeIds, edgeIds) => {
    const { currentMap, saveToHistory } = get();
    if (!currentMap || (nodeIds.length === 0 && edgeIds.length === 0)) return;

    // ルートノードは削除しない（deleteNodesと同じ保護ロジック）
    const nodesToDelete = nodeIds.filter((nodeId) => {
      const incomingEdges = currentMap.edges.filter((e) => e.target === nodeId);
      const isRoot = incomingEdges.length === 0;
      // ルートノードで、かつ削除後にノードが残らない場合は削除しない
      if (isRoot && currentMap.nodes.length - nodeIds.length < 1) {
        return false;
      }
      return true;
    });

    const nodeDeleteSet = new Set(nodesToDelete);
    const edgeDeleteSet = new Set(edgeIds);

    if (nodeDeleteSet.size === 0 && edgeDeleteSet.size === 0) return;

    saveToHistory();

    // ノード・そのノードに接続するエッジ・明示指定されたエッジを1回のsetで削除する
    set({
      currentMap: {
        ...currentMap,
        nodes: currentMap.nodes.filter((node) => !nodeDeleteSet.has(node.id)),
        edges: currentMap.edges.filter(
          (edge) =>
            !nodeDeleteSet.has(edge.source) &&
            !nodeDeleteSet.has(edge.target) &&
            !edgeDeleteSet.has(edge.id)
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
    const { currentMap, history, historyIndex } = get();
    if (historyIndex <= 0) return;

    // saveToHistory()は「これから行うアクションの実行前」の状態を積む設計のため、
    // 直近のアクション後の最新状態（currentMap）自体はまだhistory配列に反映されていない
    // （次のアクションのsaveToHistory()が呼ばれて初めて配列に載る）。
    // そのままhistoryIndexを1つ戻すと、この未反映の最新状態がRedoで復元できなくなってしまうため、
    // 移動前に現在の状態をhistory[historyIndex]に書き戻しておく
    const newHistory = [...history];
    if (currentMap) {
      newHistory[historyIndex] = currentMap;
    }

    const newIndex = historyIndex - 1;
    set({
      currentMap: newHistory[newIndex],
      history: newHistory,
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

// --- localStorageへの常時自動保存（ドラフト）とその復元 ---

const DRAFT_STORAGE_KEY = 'mindmeshmap-draft';
const DRAFT_SAVE_DEBOUNCE_MS = 500;

interface DraftData {
  map: MindMap;
  fileId: string | null;
  isDirty: boolean;
}

let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;

// currentMap / currentFileId / isDirty の変化を監視し、デバウンスしてlocalStorageに保存する
useMapStore.subscribe((state, prevState) => {
  if (
    state.currentMap === prevState.currentMap &&
    state.currentFileId === prevState.currentFileId &&
    state.isDirty === prevState.isDirty
  ) {
    return;
  }

  if (draftSaveTimer) {
    clearTimeout(draftSaveTimer);
  }

  draftSaveTimer = setTimeout(() => {
    const { currentMap, currentFileId, isDirty } = useMapStore.getState();
    // マップが存在しない場合は書かない
    if (!currentMap) return;

    const draft: DraftData = { map: currentMap, fileId: currentFileId, isDirty };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }, DRAFT_SAVE_DEBOUNCE_MS);
});

// 保存されたドラフトを復元する。パース失敗・不正な形式の場合はnullを返し、壊れたデータは削除する
export function loadDraft(): DraftData | null {
  const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.map) {
      throw new Error('Invalid draft data');
    }
    return parsed as DraftData;
  } catch {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    return null;
  }
}
