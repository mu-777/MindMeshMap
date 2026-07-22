import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { MindMap } from '../types';

interface LocalMapStoreState {
  // マップID(MindMap.id)をキーにしたローカル保存マップ一覧。
  // Google Driveとは別系統のストレージ（未ログイン時の保存先、ログイン中は「Driveへ保存」で移行できる）
  maps: Record<string, MindMap>;
  saveLocalMap: (map: MindMap) => void;
  deleteLocalMap: (id: string) => void;
  getLocalMap: (id: string) => MindMap | undefined;
}

export const useLocalMapStore = create<LocalMapStoreState>()(
  persist(
    (set, get) => ({
      maps: {},

      saveLocalMap: (map) =>
        set((state) => ({
          maps: {
            ...state.maps,
            [map.id]: { ...map, updatedAt: new Date().toISOString() },
          },
        })),

      deleteLocalMap: (id) =>
        set((state) => {
          const maps = { ...state.maps };
          delete maps[id];
          return { maps };
        }),

      getLocalMap: (id) => get().maps[id],
    }),
    {
      name: 'mindmeshmap-local-maps',
      // Drive保存済みマップの下書き（mindmeshmap-draft、既存）とは別キーの独立したlocalStorage領域。
      // 既存の追加依存なし・同期APIというdraft保存と同じ方針（docs/decisions.md参照）
      storage: createJSONStorage(() => localStorage),
    }
  )
);
