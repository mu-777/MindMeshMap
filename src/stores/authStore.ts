import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { AuthState } from '../types';

interface AuthStoreState extends AuthState {
  setAuth: (auth: Partial<AuthState>) => void;
  signOut: () => void;
}

// トークン失効判定のバッファ（ミリ秒）。期限ぎりぎりでのAPI呼び出し失敗を避けるため、
// 実際の期限より少し早めに「失効した」とみなす
export const EXPIRY_BUFFER_MS = 60 * 1000;

// useGoogleDriveのauthFetch等、ストア外からも同じ判定基準を使えるようexportする
export const isExpired = (expiresAt: number | null): boolean => {
  if (expiresAt === null) return false;
  return Date.now() >= expiresAt - EXPIRY_BUFFER_MS;
};

const signedOutState: AuthState = {
  isSignedIn: false,
  accessToken: null,
  userEmail: null,
  userName: null,
  userPicture: null,
  expiresAt: null,
};

export const useAuthStore = create<AuthStoreState>()(
  persist(
    (set) => ({
      ...signedOutState,

      setAuth: (auth) => set((state) => ({ ...state, ...auth })),

      signOut: () => set({ ...signedOutState }),
    }),
    {
      name: 'mindmeshmap-auth',
      // localStorageはトークンの露出面が広がるため不採用。sessionStorageならタブを閉じる/
      // ブラウザ終了で自動的に消え、タブ単位でのみ保持される
      storage: createJSONStorage(() => sessionStorage),
      onRehydrateStorage: () => (state) => {
        // 復元したトークンが既に（バッファを含めて）失効していたらsigned-out状態にする
        if (state && isExpired(state.expiresAt)) {
          state.isSignedIn = false;
          state.accessToken = null;
          state.userEmail = null;
          state.userName = null;
          state.userPicture = null;
          state.expiresAt = null;
        }
      },
    }
  )
);
