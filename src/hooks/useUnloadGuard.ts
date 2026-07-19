import { useEffect } from 'react';
import { useMapStore } from '../stores/mapStore';

/**
 * ページ離脱ガード。
 * Google Drive上のファイルに未同期の変更がある場合（isDirty && currentFileId !== null）のみ
 * beforeunloadで確認ダイアログを出す。
 * ローカルのみのマップ（currentFileId === null）はlocalStorageへの自動保存で守られているため対象外。
 */
export function useUnloadGuard(): void {
  const isDirty = useMapStore((state) => state.isDirty);
  const currentFileId = useMapStore((state) => state.currentFileId);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isDirty && currentFileId !== null) {
        event.preventDefault();
        event.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isDirty, currentFileId]);
}
