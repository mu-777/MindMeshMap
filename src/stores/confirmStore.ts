import { create } from 'zustand';

interface ConfirmStoreState {
  isOpen: boolean;
  message: string;
  resolve: ((result: boolean) => void) | null;
  // window.confirm() の代替。Promise<boolean> でユーザーの選択を返す
  requestConfirm: (message: string) => Promise<boolean>;
  handleConfirm: () => void;
  handleCancel: () => void;
}

export const useConfirmStore = create<ConfirmStoreState>((set, get) => ({
  isOpen: false,
  message: '',
  resolve: null,

  requestConfirm: (message) =>
    new Promise<boolean>((resolve) => {
      set({ isOpen: true, message, resolve });
    }),

  handleConfirm: () => {
    get().resolve?.(true);
    set({ isOpen: false, message: '', resolve: null });
  },

  handleCancel: () => {
    get().resolve?.(false);
    set({ isOpen: false, message: '', resolve: null });
  },
}));
