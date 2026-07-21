import { create } from 'zustand';
import { UIState } from '../types';

export interface ContextMenuState {
  type: 'node' | 'edge';
  id: string;
  x: number;
  y: number;
}

interface UIStoreState extends UIState {
  lastSelectedNodeId: string | null;
  selectedNodeIds: string[];
  // エッジの複数選択（Shift+クリックでトグル）。単独クリックでの選択状態は持たない
  // （単独クリックは常にラベル編集モードを開く。docs/decisions.md参照）
  selectedEdgeIds: string[];
  contextMenu: ContextMenuState | null;
  // Drive保存が成功するたびにインクリメントするカウンタ。
  // MapListの一覧取得useEffectの依存に加えることで、保存後に一覧（名前・更新日時）を再取得させる
  mapListVersion: number;
  setSelectedNodeId: (nodeId: string | null) => void;
  toggleNodeSelection: (nodeId: string) => void;
  toggleEdgeSelection: (edgeId: string) => void;
  clearMultiSelection: () => void;
  clearEdgeSelection: () => void;
  setEditingNodeId: (nodeId: string | null) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setHelpModalOpen: (open: boolean) => void;
  toggleHelpModal: () => void;
  openContextMenu: (type: 'node' | 'edge', id: string, x: number, y: number) => void;
  closeContextMenu: () => void;
  bumpMapListVersion: () => void;
}

export const useUIStore = create<UIStoreState>((set) => ({
  selectedNodeId: null,
  lastSelectedNodeId: null,
  selectedNodeIds: [],
  selectedEdgeIds: [],
  editingNodeId: null,
  isSidebarOpen: true,
  isHelpModalOpen: false,
  contextMenu: null,
  mapListVersion: 0,

  setSelectedNodeId: (nodeId) =>
    set((state) => ({
      selectedNodeId: nodeId,
      // 選択解除時は lastSelectedNodeId を更新しない
      lastSelectedNodeId: nodeId !== null ? nodeId : state.lastSelectedNodeId,
      // 単独クリックでの選択時（nodeIdがnull以外）は複数選択（ノード・エッジとも）をクリアする。
      // nodeId===null（選択解除）の呼び出しでは他の選択状態には触れない
      selectedNodeIds: nodeId !== null ? [] : state.selectedNodeIds,
      selectedEdgeIds: nodeId !== null ? [] : state.selectedEdgeIds,
      // 不変条件「編集中ノードは常に選択中」を保つ。この呼び出し後の選択は nodeId 単体
      // （複数選択はクリアされる）なので、編集中ノードが nodeId 自身でなければ編集を終了する。
      // これにより「ノードAを編集中に別ノードBをクリック→Aは選択解除されるのに editingNodeId が
      // A のまま残り、枠グレー＋緑リングの操作不能状態になる」不具合を防ぐ（docs/decisions.md §27）
      editingNodeId: state.editingNodeId === nodeId ? state.editingNodeId : null,
    })),

  toggleNodeSelection: (nodeId) =>
    set((state) => {
      // 現在のselectedNodeIdも含めた選択リストを作成
      const currentSelectedIds = [...state.selectedNodeIds];
      if (state.selectedNodeId && !currentSelectedIds.includes(state.selectedNodeId)) {
        currentSelectedIds.push(state.selectedNodeId);
      }

      const index = currentSelectedIds.indexOf(nodeId);
      let newSelectedNodeIds: string[];
      if (index >= 0) {
        // 既に選択されていたら解除
        newSelectedNodeIds = currentSelectedIds.filter((id) => id !== nodeId);
      } else {
        // 選択されていなければ追加
        newSelectedNodeIds = [...currentSelectedIds, nodeId];
      }
      return {
        selectedNodeIds: newSelectedNodeIds,
        // 複数選択モードではselectedNodeIdをクリア（selectedNodeIdsで管理）
        selectedNodeId: null,
        lastSelectedNodeId: nodeId,
        // エッジの選択状態は維持する（ノード・エッジ混在選択を許すため）
        // 不変条件「編集中ノードは常に選択中」を保つ。トグル後の選択集合（newSelectedNodeIds）に
        // 編集中ノードが含まれなくなった場合（編集中ノード自身をShift+クリックで選択解除した等）は
        // 編集を終了する。枠グレー＋緑リングの操作不能状態を防ぐ（docs/decisions.md §27）
        editingNodeId:
          state.editingNodeId && newSelectedNodeIds.includes(state.editingNodeId)
            ? state.editingNodeId
            : null,
      };
    }),

  toggleEdgeSelection: (edgeId) =>
    set((state) => {
      const index = state.selectedEdgeIds.indexOf(edgeId);
      const newSelectedEdgeIds =
        index >= 0
          ? state.selectedEdgeIds.filter((id) => id !== edgeId)
          : [...state.selectedEdgeIds, edgeId];
      // ノードの選択状態は維持する（ノード・エッジ混在選択を許すため）
      return { selectedEdgeIds: newSelectedEdgeIds };
    }),

  clearMultiSelection: () =>
    set({ selectedNodeIds: [] }),

  clearEdgeSelection: () =>
    set({ selectedEdgeIds: [] }),

  setEditingNodeId: (nodeId) => set({ editingNodeId: nodeId }),

  setSidebarOpen: (open) => set({ isSidebarOpen: open }),

  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

  setHelpModalOpen: (open) => set({ isHelpModalOpen: open }),

  toggleHelpModal: () => set((state) => ({ isHelpModalOpen: !state.isHelpModalOpen })),

  openContextMenu: (type, id, x, y) => set({ contextMenu: { type, id, x, y } }),

  closeContextMenu: () => set({ contextMenu: null }),

  bumpMapListVersion: () => set((state) => ({ mapListVersion: state.mapListVersion + 1 })),
}));
