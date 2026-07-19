import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useMapStore } from '../stores/mapStore';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { useUIStore } from '../stores/uiStore';
import { useGoogleDrive } from './useGoogleDrive';
import { useGoogleAuth } from './useGoogleAuth';
import { AuthExpiredError } from '../utils/errors';

const AUTO_SAVE_DELAY_MS = 3000;

/**
 * Google Driveへの自動保存。
 * 既にDriveに保存済みのマップ（currentFileIdがある）のみが対象。
 * 新規マップの初回保存は明示操作（保存ボタン/Ctrl+S）に限定し、Driveに勝手にファイルを作らない。
 */
export function useAutoSave(): void {
  const { t } = useTranslation();
  const currentMap = useMapStore((state) => state.currentMap);
  const currentFileId = useMapStore((state) => state.currentFileId);
  const isDirty = useMapStore((state) => state.isDirty);
  const setDirty = useMapStore((state) => state.setDirty);
  const isSignedIn = useAuthStore((state) => state.isSignedIn);
  const { saveMap } = useGoogleDrive();
  const { signIn } = useGoogleAuth();
  const addToast = useToastStore((state) => state.addToast);
  const bumpMapListVersion = useUIStore((state) => state.bumpMapListVersion);

  // 保存の多重実行防止
  const isSavingRef = useRef(false);
  // 直前の保存が失敗したかどうか。次にcurrentMapが変わるまで再試行しない
  const hasFailedRef = useRef(false);

  // マップが変更されたら失敗フラグをリセット（次の変更で再試行できるようにする）
  useEffect(() => {
    hasFailedRef.current = false;
  }, [currentMap]);

  useEffect(() => {
    if (!isSignedIn || !isDirty || currentFileId === null || !currentMap) return;
    if (hasFailedRef.current) return;

    const timer = setTimeout(async () => {
      if (isSavingRef.current) return;
      isSavingRef.current = true;

      try {
        await saveMap(currentMap, currentFileId);
        setDirty(false);
        bumpMapListVersion();
      } catch (error) {
        console.error('Auto-save failed:', error);
        if (error instanceof AuthExpiredError) {
          // signOut()によりisSignedInが直ちにfalseになるため、これ自体が次の自動保存の抑止になる。
          // hasFailedRefは立てない。isDirtyがtrueのまま維持されるため、再ログインでisSignedInが
          // trueに戻ると、この副作用が再発火して自動保存が自然に再開する
          addToast({
            type: 'error',
            message: t('toast.sessionExpired'),
            actionLabel: t('auth.signInWithGoogle'),
            onAction: signIn,
          });
        } else {
          hasFailedRef.current = true;
          addToast({ type: 'error', message: t('dialogs.saveFailed') });
        }
      } finally {
        isSavingRef.current = false;
      }
    }, AUTO_SAVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [
    currentMap,
    currentFileId,
    isDirty,
    isSignedIn,
    saveMap,
    setDirty,
    bumpMapListVersion,
    signIn,
    addToast,
    t,
  ]);
}
