import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useMapStore } from '../../stores/mapStore';
import { useGoogleDrive } from '../../hooks/useGoogleDrive';
import { MapMeta } from '../../types';
import { MapListItem } from './MapListItem';
import { GoogleAuthButton } from '../Auth/GoogleAuthButton';

export function MapList() {
  const { isSignedIn } = useAuthStore();
  const { currentFileId, isDirty, setDirty } = useMapStore();
  const { listMaps, loadMap, deleteMap, isLoading, error } = useGoogleDrive();
  const { setCurrentMap } = useMapStore();

  const [maps, setMaps] = useState<MapMeta[]>([]);

  // マップ一覧を取得
  const fetchMaps = useCallback(async () => {
    if (!isSignedIn) return;

    try {
      const mapList = await listMaps();
      setMaps(mapList);
    } catch (err) {
      console.error('Failed to fetch maps:', err);
    }
  }, [isSignedIn, listMaps]);

  useEffect(() => {
    fetchMaps();
  }, [fetchMaps]);

  // マップを開く
  const handleOpenMap = useCallback(
    async (fileId: string) => {
      if (isDirty) {
        const confirm = window.confirm(
          '保存されていない変更があります。続行しますか？'
        );
        if (!confirm) return;
      }

      try {
        const map = await loadMap(fileId);
        setCurrentMap(map, fileId);
        setDirty(false);
      } catch (err) {
        console.error('Failed to load map:', err);
        alert('マップの読み込みに失敗しました');
      }
    },
    [isDirty, loadMap, setCurrentMap, setDirty]
  );

  // マップを削除
  const handleDeleteMap = useCallback(
    async (fileId: string, name: string) => {
      const confirm = window.confirm(`"${name}" を削除しますか？`);
      if (!confirm) return;

      try {
        await deleteMap(fileId);
        await fetchMaps();
      } catch (err) {
        console.error('Failed to delete map:', err);
        alert('削除に失敗しました');
      }
    },
    [deleteMap, fetchMaps]
  );

  if (!isSignedIn) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center">
        <svg
          className="mb-4 h-12 w-12 text-gray-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p className="mb-4 text-sm text-gray-400">
          Googleでログインすると
          <br />
          マップを保存・同期できます
        </p>
        <GoogleAuthButton />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* ヘッダー */}
      <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
        <h2 className="text-sm font-medium text-gray-300">マップ一覧</h2>
        <button
          onClick={fetchMaps}
          disabled={isLoading}
          className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white disabled:opacity-50"
          title="更新"
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

      {/* エラー表示 */}
      {error && (
        <div className="m-2 rounded bg-red-900/50 p-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* マップリスト */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && maps.length === 0 ? (
          <div className="flex items-center justify-center p-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
          </div>
        ) : maps.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-500">
            マップがありません
          </div>
        ) : (
          <ul className="divide-y divide-gray-700">
            {maps.map((map) => (
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

      {/* ユーザー情報 */}
      <div className="border-t border-gray-700 p-3">
        <GoogleAuthButton />
      </div>
    </div>
  );
}
