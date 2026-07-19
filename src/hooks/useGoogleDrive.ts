import { useCallback, useState } from 'react';
import { isExpired, useAuthStore } from '../stores/authStore';
import { MindMap, MapMeta } from '../types';
import { AuthExpiredError } from '../utils/errors';

const FOLDER_NAME = 'MindMeshMap';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API_BASE = 'https://www.googleapis.com/upload/drive/v3';

// multipart/relatedアップロード用のFormDataを構築（新規作成・既存ファイル更新のPATCHで共通利用）
const buildMultipartForm = (metadata: Record<string, unknown>, map: MindMap): FormData => {
  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append(
    'file',
    new Blob([JSON.stringify(map)], { type: 'application/json' })
  );
  return form;
};

export function useGoogleDrive() {
  const { accessToken, expiresAt, signOut } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 認証ヘッダーのみ。FormDataを送る場合はboundary付きContent-Typeをブラウザに
  // 任せる必要があるため、Content-Typeはここでは付与しない
  const getAuthHeader = useCallback(
    (): HeadersInit => ({ Authorization: `Bearer ${accessToken}` }),
    [accessToken]
  );

  // JSONボディを送る通常のAPI呼び出し用ヘッダー
  const getJsonHeaders = useCallback(
    (): HeadersInit => ({ ...getAuthHeader(), 'Content-Type': 'application/json' }),
    [getAuthHeader]
  );

  // 全Drive API呼び出しをこの関数経由にする。
  // 呼び出し前にトークンの有無・有効期限（60秒バッファ）をチェックし、
  // fetch実行後は401レスポンスも検知する。いずれの場合もsignOutしてAuthExpiredErrorをthrowし、
  // 呼び出し側（useSaveMap/useAutoSave/MapList）で再ログイン導線を出せるようにする
  const authFetch = useCallback(
    async (url: string, init?: RequestInit): Promise<Response> => {
      if (!accessToken || isExpired(expiresAt)) {
        signOut();
        throw new AuthExpiredError();
      }

      const response = await fetch(url, init);

      if (response.status === 401) {
        signOut();
        throw new AuthExpiredError();
      }

      return response;
    },
    [accessToken, expiresAt, signOut]
  );

  // アプリ専用フォルダを取得または作成
  const getOrCreateAppFolder = useCallback(async (): Promise<string> => {
    // フォルダを検索
    const searchResponse = await authFetch(
      `${DRIVE_API_BASE}/files?q=name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)`,
      { headers: getJsonHeaders() }
    );

    if (!searchResponse.ok) {
      throw new Error('Failed to search for folder');
    }

    const searchData = await searchResponse.json();

    if (searchData.files && searchData.files.length > 0) {
      return searchData.files[0].id;
    }

    // フォルダを作成
    const createResponse = await authFetch(`${DRIVE_API_BASE}/files`, {
      method: 'POST',
      headers: getJsonHeaders(),
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
  }, [authFetch, getJsonHeaders]);

  // マップ一覧を取得
  const listMaps = useCallback(async (): Promise<MapMeta[]> => {
    setIsLoading(true);
    setError(null);

    try {
      const folderId = await getOrCreateAppFolder();

      const response = await authFetch(
        `${DRIVE_API_BASE}/files?q='${folderId}' in parents and mimeType='application/json' and trashed=false&fields=files(id,name,modifiedTime,createdTime)&orderBy=modifiedTime desc`,
        { headers: getJsonHeaders() }
      );

      if (!response.ok) {
        throw new Error('Failed to list maps');
      }

      const data = await response.json();

      return (data.files || []).map(
        (file: { id: string; name: string; modifiedTime: string; createdTime: string }) => ({
          fileId: file.id,
          name: file.name.replace('.json', ''),
          updatedAt: file.modifiedTime,
          createdAt: file.createdTime,
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [authFetch, getJsonHeaders, getOrCreateAppFolder]);

  // マップを読み込み
  const loadMap = useCallback(
    async (fileId: string): Promise<MindMap> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await authFetch(
          `${DRIVE_API_BASE}/files/${fileId}?alt=media`,
          { headers: getJsonHeaders() }
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
    [authFetch, getJsonHeaders]
  );

  // マップを保存
  const saveMap = useCallback(
    async (map: MindMap, fileId?: string | null): Promise<string> => {
      setIsLoading(true);
      setError(null);

      try {
        if (fileId) {
          // 既存ファイルを更新。uploadType=multipartでメタデータ（ファイル名）とコンテンツを
          // 1リクエストで同時更新する。uploadType=mediaだと中身しか更新されず、
          // タイトルをリネームしてもDrive上のファイル名が古いままになってしまうため
          const form = buildMultipartForm({ name: `${map.name}.json` }, map);

          const response = await authFetch(
            `${UPLOAD_API_BASE}/files/${fileId}?uploadType=multipart`,
            {
              method: 'PATCH',
              headers: getAuthHeader(),
              body: form,
            }
          );

          if (!response.ok) {
            throw new Error('Failed to update map');
          }

          return fileId;
        } else {
          // 新規ファイルを作成
          const folderId = await getOrCreateAppFolder();
          const form = buildMultipartForm(
            {
              name: `${map.name}.json`,
              mimeType: 'application/json',
              parents: [folderId],
            },
            map
          );

          const response = await authFetch(`${UPLOAD_API_BASE}/files?uploadType=multipart`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: form,
          });

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
    [authFetch, getAuthHeader, getOrCreateAppFolder]
  );

  // マップを削除
  const deleteMap = useCallback(
    async (fileId: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await authFetch(`${DRIVE_API_BASE}/files/${fileId}`, {
          method: 'DELETE',
          headers: getJsonHeaders(),
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
    [authFetch, getJsonHeaders]
  );

  return {
    isLoading,
    error,
    listMaps,
    loadMap,
    saveMap,
    deleteMap,
  };
}
