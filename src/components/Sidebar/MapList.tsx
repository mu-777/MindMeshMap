import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import { useMapStore } from '../../stores/mapStore';
import { useLocalMapStore } from '../../stores/localMapStore';
import { useConfirmStore } from '../../stores/confirmStore';
import { useToastStore } from '../../stores/toastStore';
import { useUIStore } from '../../stores/uiStore';
import { useGoogleDrive } from '../../hooks/useGoogleDrive';
import { useGoogleAuth } from '../../hooks/useGoogleAuth';
import { AuthExpiredError } from '../../utils/errors';
import { MapMeta } from '../../types';
import { MapListItem } from './MapListItem';
import { GoogleAuthButton } from '../Auth/GoogleAuthButton';

// マップ一覧の並び順。選択値はlocalStorageに保存し、次回表示時も復元する
type SortOrder = 'updatedDesc' | 'updatedAsc' | 'createdDesc' | 'createdAsc';
const SORT_ORDERS: SortOrder[] = ['updatedDesc', 'updatedAsc', 'createdDesc', 'createdAsc'];
const DEFAULT_SORT_ORDER: SortOrder = 'updatedDesc';
const SORT_ORDER_STORAGE_KEY = 'mindmeshmap-maplist-sort';

// 保存されている並び順を復元。不正な値（未知の文字列・未保存など）はデフォルトにフォールバックする
function loadSortOrder(): SortOrder {
  const stored = localStorage.getItem(SORT_ORDER_STORAGE_KEY);
  return SORT_ORDERS.includes(stored as SortOrder) ? (stored as SortOrder) : DEFAULT_SORT_ORDER;
}

// 並び順に応じてマップ一覧をソート（一覧は小規模なので毎回ソートし直す）
function sortMaps(maps: MapMeta[], order: SortOrder): MapMeta[] {
  const key = order.startsWith('updated') ? 'updatedAt' : 'createdAt';
  const direction = order.endsWith('Desc') ? -1 : 1;
  return [...maps].sort(
    (a, b) => direction * (new Date(a[key]).getTime() - new Date(b[key]).getTime())
  );
}

// マップ一覧セクションの見出し（既存のToolbarファイルメニューのセクション見出しと同じスタイル）
function SectionHeading({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-1 text-xs text-gray-500">{children}</div>;
}

export function MapList() {
  const { t } = useTranslation();
  const { isSignedIn } = useAuthStore();
  const { currentMap, currentFileId, isDirty, setDirty, setCurrentMap, setCurrentFileId } = useMapStore();
  const { listMaps, loadMap, deleteMap, saveMap, isLoading, error } = useGoogleDrive();
  const { signIn } = useGoogleAuth();
  const { requestConfirm } = useConfirmStore();
  const { addToast } = useToastStore();
  const mapListVersion = useUIStore((state) => state.mapListVersion);
  const bumpMapListVersion = useUIStore((state) => state.bumpMapListVersion);
  const { maps: localMapsById, deleteLocalMap, getLocalMap } = useLocalMapStore();

  const [driveMaps, setDriveMaps] = useState<MapMeta[]>([]);
  const [sortOrder, setSortOrder] = useState<SortOrder>(loadSortOrder);
  const sortedDriveMaps = useMemo(() => sortMaps(driveMaps, sortOrder), [driveMaps, sortOrder]);

  // ローカル保存マップ一覧をDrive一覧と同じMapMeta[]形式へ導出する（fileId=マップID）。
  // こうすることで既存のsortMaps/MapListItemをローカル・Drive両方でそのまま使い回せる
  const localMaps: MapMeta[] = useMemo(
    () =>
      Object.values(localMapsById).map((map) => ({
        fileId: map.id,
        name: map.name,
        updatedAt: map.updatedAt,
        createdAt: map.createdAt,
      })),
    [localMapsById]
  );
  const sortedLocalMaps = useMemo(() => sortMaps(localMaps, sortOrder), [localMaps, sortOrder]);

  // 並び順の選択を保存し、次回表示時にも復元する
  const handleSortOrderChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const order = e.target.value as SortOrder;
    setSortOrder(order);
    localStorage.setItem(SORT_ORDER_STORAGE_KEY, order);
  }, []);

  // セッション失効時の共通トースト（再ログインボタン付き）
  const showSessionExpiredToast = useCallback(() => {
    addToast({
      type: 'error',
      message: t('toast.sessionExpired'),
      actionLabel: t('auth.signInWithGoogle'),
      onAction: signIn,
    });
  }, [addToast, signIn, t]);

  // Driveマップ一覧を取得
  const fetchMaps = useCallback(async () => {
    if (!isSignedIn) return;

    try {
      const mapList = await listMaps();
      setDriveMaps(mapList);
    } catch (err) {
      console.error('Failed to fetch maps:', err);
      if (err instanceof AuthExpiredError) {
        showSessionExpiredToast();
      }
    }
  }, [isSignedIn, listMaps, showSessionExpiredToast]);

  // mapListVersionは保存成功のたびにインクリメントされる。
  // 依存に加えることで、保存のたびに一覧（名前・更新日時）が最新化される
  useEffect(() => {
    fetchMaps();
  }, [fetchMaps, mapListVersion]);

  // Driveのマップを開く
  const handleOpenMap = useCallback(
    async (fileId: string) => {
      if (isDirty) {
        const confirmed = await requestConfirm(t('dialogs.unsavedChangesContinue'));
        if (!confirmed) return;
      }

      try {
        const map = await loadMap(fileId);
        setCurrentMap(map, fileId);
        setDirty(false);
      } catch (err) {
        console.error('Failed to load map:', err);
        if (err instanceof AuthExpiredError) {
          showSessionExpiredToast();
        } else {
          addToast({ type: 'error', message: t('dialogs.loadFailed') });
        }
      }
    },
    [isDirty, loadMap, setCurrentMap, setDirty, requestConfirm, addToast, showSessionExpiredToast, t]
  );

  // Driveのマップを削除
  const handleDeleteMap = useCallback(
    async (fileId: string, name: string) => {
      const confirmed = await requestConfirm(t('dialogs.deleteConfirm', { name }));
      if (!confirmed) return;

      try {
        await deleteMap(fileId);
        await fetchMaps();
      } catch (err) {
        console.error('Failed to delete map:', err);
        if (err instanceof AuthExpiredError) {
          showSessionExpiredToast();
        } else {
          addToast({ type: 'error', message: t('dialogs.deleteFailed') });
        }
      }
    },
    [deleteMap, fetchMaps, requestConfirm, addToast, showSessionExpiredToast, t]
  );

  // ローカル保存マップを開く（fileId=nullでlocal-backedとして開く）
  const handleOpenLocalMap = useCallback(
    async (id: string) => {
      if (isDirty) {
        const confirmed = await requestConfirm(t('dialogs.unsavedChangesContinue'));
        if (!confirmed) return;
      }

      const map = getLocalMap(id);
      if (!map) return;
      setCurrentMap(map, null);
    },
    [isDirty, getLocalMap, setCurrentMap, requestConfirm, t]
  );

  // ローカル保存マップを削除
  const handleDeleteLocalMap = useCallback(
    async (id: string, name: string) => {
      const confirmed = await requestConfirm(t('dialogs.deleteConfirm', { name }));
      if (!confirmed) return;
      deleteLocalMap(id);
    },
    [deleteLocalMap, requestConfirm, t]
  );

  // ローカル保存マップをGoogle Driveへ移行する（新規Driveファイルとして保存 → 成功したらローカルから削除）。
  // 移行中のマップが現在開いているマップと同じ場合は、drive-backed（currentFileIdあり）へ昇格させる
  const handleMigrateToDrive = useCallback(
    async (id: string) => {
      const map = getLocalMap(id);
      if (!map) return;

      try {
        const newFileId = await saveMap(map, null);
        deleteLocalMap(id);
        if (currentMap?.id === id) {
          setCurrentFileId(newFileId);
        }
        await fetchMaps();
        bumpMapListVersion();
        addToast({ type: 'success', message: t('toast.migratedToDrive') });
      } catch (err) {
        console.error('Failed to migrate map to Drive:', err);
        if (err instanceof AuthExpiredError) {
          showSessionExpiredToast();
        } else {
          addToast({ type: 'error', message: t('dialogs.saveFailed') });
        }
      }
    },
    [
      getLocalMap,
      saveMap,
      deleteLocalMap,
      currentMap,
      setCurrentFileId,
      fetchMaps,
      bumpMapListVersion,
      addToast,
      showSessionExpiredToast,
      t,
    ]
  );

  // ログイン中は「ローカルマップが1件以上あるときだけ」ローカルセクションを出す
  // （未ログイン時は常にローカルセクションのみを出す。docs/decisions.md参照）
  const showLocalSection = !isSignedIn || sortedLocalMaps.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* ヘッダー */}
      <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
        <h2 className="text-sm font-medium text-gray-300">{t('mapList.title')}</h2>
        <button
          onClick={fetchMaps}
          disabled={isLoading || !isSignedIn}
          className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white disabled:opacity-50"
          title={t('common.refresh')}
        >
          <svg
            className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>

      {/* 並び順選択 */}
      <div className="border-b border-gray-700 px-4 py-2">
        <select
          value={sortOrder}
          onChange={handleSortOrderChange}
          className="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs text-gray-300 focus:border-blue-500 focus:outline-none"
        >
          <option value="updatedDesc">{t('mapList.sortUpdatedDesc')}</option>
          <option value="updatedAsc">{t('mapList.sortUpdatedAsc')}</option>
          <option value="createdDesc">{t('mapList.sortCreatedDesc')}</option>
          <option value="createdAsc">{t('mapList.sortCreatedAsc')}</option>
        </select>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="m-2 rounded bg-red-900/50 p-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* マップリスト（ログイン中はGoogle Drive＋ローカルの2セクション、未ログインはローカルのみ） */}
      <div className="flex-1 overflow-y-auto">
        {isSignedIn && (
          <div>
            <SectionHeading>{t('mapList.sectionDrive')}</SectionHeading>
            {isLoading && sortedDriveMaps.length === 0 ? (
              <div className="flex items-center justify-center p-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
              </div>
            ) : sortedDriveMaps.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500">
                {t('mapList.noMaps')}
              </div>
            ) : (
              <ul className="divide-y divide-gray-700">
                {sortedDriveMaps.map((map) => (
                  <MapListItem
                    key={map.fileId}
                    map={map}
                    isActive={map.fileId === currentFileId}
                    onOpen={() => handleOpenMap(map.fileId)}
                    onDelete={() => handleDeleteMap(map.fileId, map.name)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}

        {showLocalSection && (
          <div>
            <SectionHeading>{t('mapList.sectionLocal')}</SectionHeading>
            {sortedLocalMaps.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500">
                {t('mapList.noMaps')}
              </div>
            ) : (
              <ul className="divide-y divide-gray-700">
                {sortedLocalMaps.map((map) => (
                  <MapListItem
                    key={map.fileId}
                    map={map}
                    isActive={currentFileId === null && currentMap?.id === map.fileId}
                    onOpen={() => handleOpenLocalMap(map.fileId)}
                    onDelete={() => handleDeleteLocalMap(map.fileId, map.name)}
                    // Driveへの移行はログイン中のみ意味を持つ操作なので、未ログイン時は渡さない
                    onMigrate={isSignedIn ? () => handleMigrateToDrive(map.fileId) : undefined}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ユーザー情報 / サインイン導線 */}
      <div className="border-t border-gray-700 p-3">
        {!isSignedIn && (
          <p className="mb-2 text-xs text-gray-500">{t('mapList.signInPrompt')}</p>
        )}
        <GoogleAuthButton />
      </div>
    </div>
  );
}
