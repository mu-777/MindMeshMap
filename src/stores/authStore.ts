import { create } from 'zustand';
import { AuthState } from '../types';

interface AuthStoreState extends AuthState {
  setAuth: (auth: Partial<AuthState>) => void;
  signOut: () => void;
}

export const useAuthStore = create<AuthStoreState>((set) => ({
  isSignedIn: false,
  accessToken: null,
  userEmail: null,
  userName: null,

  setAuth: (auth) => set((state) => ({ ...state, ...auth })),

  signOut: () =>
    set({
      isSignedIn: false,
      accessToken: null,
      userEmail: null,
      userName: null,
    }),
}));
