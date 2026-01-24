import { useCallback, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { MindMap, MapMeta } from '../types';

const FOLDER_NAME = 'MindMapDAG';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API_BASE = 'https://www.googleapis.com/upload/drive/v3';

export function useGoogleDrive() {
  const { accessToken } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getHeaders = useCallback(() => {
    if (!accessToken) {
      throw new Error('Not authenticated');
    }
    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };
  }, [accessToken]);

  // アプリ専用フォルダを取得または作成
  const getOrCreateAppFolder = useCallback(async (): Promise<string> => {
    const headers = getHeaders();

    // フォルダを検索
    const searchResponse = await fetch(
      `${DRIVE_API_BASE}/files?q=name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)`,
      { headers }
    );

    if (!searchResponse.ok) {
      throw new Error('Failed to search for folder');
    }

    const searchData = await searchResponse.json();

    if (searchData.files && searchData.files.length > 0) {
      return searchData.files[0].id;
    }

    // フォルダを作成
    const createResponse = await fetch(`${DRIVE_API_BASE}/files`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });

    if (!createResponse.ok) {
      throw new Error('Failed to create folder');
    }

    const createData = await createResponse.json();
    return createData.id;
  }, [getHeaders]);

  // マップ一覧を取得
  const listMaps = useCallback(async (): Promise<MapMeta[]> => {
    setIsLoading(true);
    setError(null);

    try {
      const folderId = await getOrCreateAppFolder();
      const headers = getHeaders();

      const response = await fetch(
        `${DRIVE_API_BASE}/files?q='${folderId}' in parents and mimeType='application/json' and trashed=false&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`,
        { headers }
      );

      if (!response.ok) {
        throw new Error('Failed to list maps');
      }

      const data = await response.json();

      return (data.files || []).map((file: { id: string; name: string; modifiedTime: string }) => ({
        fileId: file.id,
        name: file.name.replace('.json', ''),
        updatedAt: file.modifiedTime,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [getHeaders, getOrCreateAppFolder]);

  // マップを読み込み
  const loadMap = useCallback(
    async (fileId: string): Promise<MindMap> => {
      setIsLoading(true);
      setError(null);

      try {
        const headers = getHeaders();

        const response = await fetch(
          `${DRIVE_API_BASE}/files/${fileId}?alt=media`,
          { headers }
        );

        if (!response.ok) {
          throw new Error('Failed to load map');
        }

        const data = await response.json();
        return data as MindMap;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [getHeaders]
  );

  // マップを保存
  const saveMap = useCallback(
    async (map: MindMap, fileId?: string | null): Promise<string> => {
      setIsLoading(true);
      setError(null);

      try {
        const headers = getHeaders();

        if (fileId) {
          // 既存ファイルを更新
          const response = await fetch(
            `${UPLOAD_API_BASE}/files/${fileId}?uploadType=media`,
            {
              method: 'PATCH',
              headers: {
                ...headers,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(map),
            }
          );

          if (!response.ok) {
            throw new Error('Failed to update map');
          }

          return fileId;
        } else {
          // 新規ファイルを作成
          const folderId = await getOrCreateAppFolder();

          // メタデータを作成
          const metadata = {
            name: `${map.name}.json`,
            mimeType: 'application/json',
            parents: [folderId],
          };

          const form = new FormData();
          form.append(
            'metadata',
            new Blob([JSON.stringify(metadata)], { type: 'application/json' })
          );
          form.append(
            'file',
            new Blob([JSON.stringify(map)], { type: 'application/json' })
          );

          const response = await fetch(
            `${UPLOAD_API_BASE}/files?uploadType=multipart`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
              body: form,
            }
          );

          if (!response.ok) {
            throw new Error('Failed to create map');
          }

          const data = await response.json();
          return data.id;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [accessToken, getHeaders, getOrCreateAppFolder]
  );

  // マップを削除
  const deleteMap = useCallback(
    async (fileId: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const headers = getHeaders();

        const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}`, {
          method: 'DELETE',
          headers,
        });

        if (!response.ok) {
          throw new Error('Failed to delete map');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [getHeaders]
  );

  // マップをリネーム
  const renameMap = useCallback(
    async (fileId: string, newName: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const headers = getHeaders();

        const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            name: `${newName}.json`,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to rename map');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [getHeaders]
  );

  return {
    isLoading,
    error,
    listMaps,
    loadMap,
    saveMap,
    deleteMap,
    renameMap,
  };
}
