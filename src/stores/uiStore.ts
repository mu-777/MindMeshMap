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
  contextMenu: ContextMenuState | null;
  pendingEditChar: string | null;
  setSelectedNodeId: (nodeId: string | null) => void;
  toggleNodeSelection: (nodeId: string) => void;
  clearMultiSelection: () => void;
  setEditingNodeId: (nodeId: string | null) => void;
  setPendingEditChar: (char: string | null) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setHelpModalOpen: (open: boolean) => void;
  toggleHelpModal: () => void;
  openContextMenu: (type: 'node' | 'edge', id: string, x: number, y: number) => void;
  closeContextMenu: () => void;
}

export const useUIStore = create<UIStoreState>((set) => ({
  selectedNodeId: null,
  lastSelectedNodeId: null,
  selectedNodeIds: [],
  editingNodeId: null,
  isSidebarOpen: true,
  isHelpModalOpen: false,
  contextMenu: null,
  pendingEditChar: null,

  setSelectedNodeId: (nodeId) =>
    set((state) => ({
      selectedNodeId: nodeId,
      // 選択解除時は lastSelectedNodeId を更新しない
      lastSelectedNodeId: nodeId !== null ? nodeId : state.lastSelectedNodeId,
      // 単一選択時は複数選択をクリア
      selectedNodeIds: [],
    })),

  toggleNodeSelection: (nodeId) =>
    set((state) => {
      // 現在のselectedNodeIdも含めた選択リストを作成
      let currentSelectedIds = [...state.selectedNodeIds];
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
      };
    }),

  clearMultiSelection: () =>
    set({ selectedNodeIds: [] }),

  setEditingNodeId: (nodeId) => set({ editingNodeId: nodeId }),

  setPendingEditChar: (char) => set({ pendingEditChar: char }),

  setSidebarOpen: (open) => set({ isSidebarOpen: open }),

  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

  setHelpModalOpen: (open) => set({ isHelpModalOpen: open }),

  toggleHelpModal: () => set((state) => ({ isHelpModalOpen: !state.isHelpModalOpen })),

  openContextMenu: (type, id, x, y) => set({ contextMenu: { type, id, x, y } }),

  closeContextMenu: () => set({ contextMenu: null }),
}));
