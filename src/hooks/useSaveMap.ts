import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMapStore } from '../stores/mapStore';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { useUIStore } from '../stores/uiStore';
import { useGoogleDrive } from './useGoogleDrive';
import { useGoogleAuth } from './useGoogleAuth';
import { AuthExpiredError } from '../utils/errors';

/**
 * Google Driveへの保存処理を共通化したフック。
 * Toolbarの保存ボタン・Ctrl+Sショートカットの両方から利用する。
 */
export function useSaveMap() {
  const { t } = useTranslation();
  const { currentMap, currentFileId, isDirty, setDirty, setCurrentFileId } = useMapStore();
  const { isSignedIn } = useAuthStore();
  const { saveMap: saveMapToDrive, isLoading } = useGoogleDrive();
  const { signIn } = useGoogleAuth();
  const { addToast } = useToastStore();
  const bumpMapListVersion = useUIStore((state) => state.bumpMapListVersion);

  const save = useCallback(async () => {
    if (!currentMap) return;

    if (!isSignedIn) {
      addToast({ type: 'info', message: t('toast.localAutoSaved') });
      return;
    }

    if (!isDirty) {
      addToast({ type: 'info', message: t('toast.alreadySaved') });
      return;
    }

    try {
      const fileId = await saveMapToDrive(currentMap, currentFileId);
      // 新規ファイル作成時に限らず、戻り値のfileIdを必ずストアに反映する
      // （反映を怠ると新規マップの保存のたびにDrive上でファイルが増殖するバグになる）
      setCurrentFileId(fileId);
      setDirty(false);
      bumpMapListVersion();
      addToast({ type: 'success', message: t('dialogs.savedSuccess') });
    } catch (error) {
      console.error('Save failed:', error);
      if (error instanceof AuthExpiredError) {
        // isDirtyはtrueのまま維持されるため、再ログイン後はオートセーブが自然に再開する
        addToast({
          type: 'error',
          message: t('toast.sessionExpired'),
          actionLabel: t('auth.signInWithGoogle'),
          onAction: signIn,
        });
        return;
      }
      addToast({ type: 'error', message: t('dialogs.saveFailed') });
    }
  }, [
    currentMap,
    currentFileId,
    isDirty,
    isSignedIn,
    saveMapToDrive,
    setDirty,
    setCurrentFileId,
    bumpMapListVersion,
    signIn,
    addToast,
    t,
  ]);

  return { save, isLoading };
}
