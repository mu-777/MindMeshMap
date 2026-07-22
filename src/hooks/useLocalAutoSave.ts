import { useEffect } from 'react';
import { useMapStore } from '../stores/mapStore';
import { useAuthStore } from '../stores/authStore';
import { useLocalMapStore } from '../stores/localMapStore';

// Driveオートセーブ（useAutoSave.tsのAUTO_SAVE_DELAY_MS）と同じ値・同じ思想のデバウンス時間
const LOCAL_AUTO_SAVE_DELAY_MS = 3000;

/**
 * この端末（localStorage）への自動保存。useAutoSave（Google Drive向け）と対称の実装。
 * 既に名前付きでローカル保存済みのマップ（localMapStore.maps[currentMap.id]が存在する）のみを
 * 対象とする。未保存（一度もSaveされていない）マップは自動保存しない。Driveオートセーブが
 * currentFileIdの無い新規マップを対象外にしているのと同じ「勝手にエントリを作らない」思想
 * （docs/decisions.md参照）。保存されていないマップの作業内容自体は既存のworking-copy下書き
 * （mindmeshmap-draft）が別途常時保存しているため、この対象外扱いでデータが失われることはない。
 */
export function useLocalAutoSave(): void {
  const currentMap = useMapStore((state) => state.currentMap);
  const isDirty = useMapStore((state) => state.isDirty);
  const setDirty = useMapStore((state) => state.setDirty);
  const isSignedIn = useAuthStore((state) => state.isSignedIn);
  const saveLocalMap = useLocalMapStore((state) => state.saveLocalMap);

  useEffect(() => {
    if (isSignedIn || !isDirty || !currentMap) return;
    // 既に名前付きでローカル保存済みのマップのみ対象（最新値をgetState()で読む）
    if (useLocalMapStore.getState().maps[currentMap.id] == null) return;

    const timer = setTimeout(() => {
      saveLocalMap(currentMap);
      setDirty(false);
    }, LOCAL_AUTO_SAVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [currentMap, isDirty, isSignedIn, saveLocalMap, setDirty]);
}
