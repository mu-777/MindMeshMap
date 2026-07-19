import { create } from 'zustand';
import { generateId } from '../utils/idGenerator';

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

// success/info は4秒、error は8秒で自動消滅（actionLabel付きは自動消滅しない）
const AUTO_DISMISS_DELAY_MS: Record<ToastType, number> = {
  success: 4000,
  info: 4000,
  error: 8000,
};

interface ToastStoreState {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastStoreState>((set, get) => ({
  toasts: [],

  addToast: (toast) => {
    const id = generateId();
    const newToast: Toast = { ...toast, id };

    set((state) => ({ toasts: [...state.toasts, newToast] }));

    // アクション付きトーストはユーザー操作待ちのため自動消滅させない
    if (!toast.actionLabel) {
      setTimeout(() => {
        get().removeToast(id);
      }, AUTO_DISMISS_DELAY_MS[toast.type]);
    }
  },

  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));
