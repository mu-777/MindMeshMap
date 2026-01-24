import { create } from 'zustand';
import { UIState } from '../types';

interface UIStoreState extends UIState {
  lastSelectedNodeId: string | null;
  selectedNodeIds: string[];
  setSelectedNodeId: (nodeId: string | null) => void;
  toggleNodeSelection: (nodeId: string) => void;
  clearMultiSelection: () => void;
  setEditingNodeId: (nodeId: string | null) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setHelpModalOpen: (open: boolean) => void;
  toggleHelpModal: () => void;
}

export const useUIStore = create<UIStoreState>((set) => ({
  selectedNodeId: null,
  lastSelectedNodeId: null,
  selectedNodeIds: [],
  editingNodeId: null,
  isSidebarOpen: true,
  isHelpModalOpen: false,

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
      const index = state.selectedNodeIds.indexOf(nodeId);
      let newSelectedNodeIds: string[];
      if (index >= 0) {
        // 既に選択されていたら解除
        newSelectedNodeIds = state.selectedNodeIds.filter((id) => id !== nodeId);
      } else {
        // 選択されていなければ追加
        newSelectedNodeIds = [...state.selectedNodeIds, nodeId];
      }
      return {
        selectedNodeIds: newSelectedNodeIds,
        // 複数選択モードでは単一選択をクリアしない（最初のノードをactiveNodeIdとして使えるように）
        selectedNodeId: state.selectedNodeId,
        lastSelectedNodeId: nodeId,
      };
    }),

  clearMultiSelection: () =>
    set({ selectedNodeIds: [] }),

  setEditingNodeId: (nodeId) => set({ editingNodeId: nodeId }),

  setSidebarOpen: (open) => set({ isSidebarOpen: open }),

  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

  setHelpModalOpen: (open) => set({ isHelpModalOpen: open }),

  toggleHelpModal: () => set((state) => ({ isHelpModalOpen: !state.isHelpModalOpen })),
}));
