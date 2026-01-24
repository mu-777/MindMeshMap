import { create } from 'zustand';
import { UIState } from '../types';

interface UIStoreState extends UIState {
  lastSelectedNodeId: string | null;
  selectedNodeIds: Set<string>;
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
  selectedNodeIds: new Set<string>(),
  editingNodeId: null,
  isSidebarOpen: true,
  isHelpModalOpen: false,

  setSelectedNodeId: (nodeId) =>
    set((state) => ({
      selectedNodeId: nodeId,
      // 選択解除時は lastSelectedNodeId を更新しない
      lastSelectedNodeId: nodeId !== null ? nodeId : state.lastSelectedNodeId,
      // 単一選択時は複数選択をクリア
      selectedNodeIds: new Set<string>(),
    })),

  toggleNodeSelection: (nodeId) =>
    set((state) => {
      const newSelectedNodeIds = new Set(state.selectedNodeIds);
      if (newSelectedNodeIds.has(nodeId)) {
        newSelectedNodeIds.delete(nodeId);
      } else {
        newSelectedNodeIds.add(nodeId);
      }
      return {
        selectedNodeIds: newSelectedNodeIds,
        // 複数選択時は単一選択をクリア
        selectedNodeId: null,
        lastSelectedNodeId: nodeId,
      };
    }),

  clearMultiSelection: () =>
    set({ selectedNodeIds: new Set<string>() }),

  setEditingNodeId: (nodeId) => set({ editingNodeId: nodeId }),

  setSidebarOpen: (open) => set({ isSidebarOpen: open }),

  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

  setHelpModalOpen: (open) => set({ isHelpModalOpen: open }),

  toggleHelpModal: () => set((state) => ({ isHelpModalOpen: !state.isHelpModalOpen })),
}));
