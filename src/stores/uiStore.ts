import { create } from 'zustand';
import { UIState } from '../types';

interface UIStoreState extends UIState {
  lastSelectedNodeId: string | null;
  setSelectedNodeId: (nodeId: string | null) => void;
  setEditingNodeId: (nodeId: string | null) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setHelpModalOpen: (open: boolean) => void;
  toggleHelpModal: () => void;
}

export const useUIStore = create<UIStoreState>((set) => ({
  selectedNodeId: null,
  lastSelectedNodeId: null,
  editingNodeId: null,
  isSidebarOpen: true,
  isHelpModalOpen: false,

  setSelectedNodeId: (nodeId) =>
    set((state) => ({
      selectedNodeId: nodeId,
      // 選択解除時は lastSelectedNodeId を更新しない
      lastSelectedNodeId: nodeId !== null ? nodeId : state.lastSelectedNodeId,
    })),

  setEditingNodeId: (nodeId) => set({ editingNodeId: nodeId }),

  setSidebarOpen: (open) => set({ isSidebarOpen: open }),

  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

  setHelpModalOpen: (open) => set({ isHelpModalOpen: open }),

  toggleHelpModal: () => set((state) => ({ isHelpModalOpen: !state.isHelpModalOpen })),
}));
