import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMapStore } from '../stores/mapStore';
import { useAuthStore } from '../stores/authStore';
import { useLocalMapStore } from '../stores/localMapStore';
import { useToastStore } from '../stores/toastStore';
import { useUIStore } from '../stores/uiStore';
import { useGoogleDrive } from './useGoogleDrive';
import { useGoogleAuth } from './useGoogleAuth';
import { AuthExpiredError } from '../utils/errors';

/**
 * 保存処理を共通化したフック。未ログイン時はこの端末（localStorage）へ、ログイン時はGoogle
 * Driveへ保存する（Toolbarの保存ボタン・Ctrl+Sショートカットの両方から利用する）。
 */
export function useSaveMap() {
  const { t } = useTranslation();
  const { currentMap, currentFileId, isDirty, setDirty, setCurrentFileId } = useMapStore();
  const { isSignedIn } = useAuthStore();
  const { saveLocalMap } = useLocalMapStore();
  const { saveMap: saveMapToDrive, isLoading } = useGoogleDrive();
  const { signIn } = useGoogleAuth();
  const { addToast } = useToastStore();
  const bumpMapListVersion = useUIStore((state) => state.bumpMapListVersion);

  const save = useCallback(async () => {
    if (!currentMap) return;

    if (!isSignedIn) {
      // ログインしていない場合はこの端末（localStorage）に保存する
      saveLocalMap(currentMap);
      setDirty(false);
      addToast({ type: 'success', message: t('toast.localSaved') });
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
    saveLocalMap,
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
