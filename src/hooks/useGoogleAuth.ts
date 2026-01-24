import { useCallback, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';

// Google API クライアントID（実際の値は環境変数または設定ファイルから取得）
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string }) => void;
          }) => {
            requestAccessToken: () => void;
          };
          revoke: (token: string, callback: () => void) => void;
        };
      };
    };
  }
}

export function useGoogleAuth() {
  const { isSignedIn, accessToken, setAuth, signOut: storeSignOut } = useAuthStore();

  // GIS スクリプトをロード
  useEffect(() => {
    if (!CLIENT_ID) {
      console.warn('Google Client ID is not configured');
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  const fetchUserInfo = useCallback(
    async (token: string) => {
      try {
        const response = await fetch(
          'https://www.googleapis.com/oauth2/v2/userinfo',
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          setAuth({
            userEmail: data.email,
            userName: data.name,
          });
        }
      } catch (error) {
        console.error('Failed to fetch user info:', error);
      }
    },
    [setAuth]
  );

  const signIn = useCallback(() => {
    if (!window.google || !CLIENT_ID) {
      console.error('Google Identity Services not loaded or Client ID not configured');
      return;
    }

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (response) => {
        if (response.error) {
          console.error('Authentication error:', response.error);
          return;
        }

        if (response.access_token) {
          setAuth({
            isSignedIn: true,
            accessToken: response.access_token,
          });

          // ユーザー情報を取得
          fetchUserInfo(response.access_token);
        }
      },
    });

    tokenClient.requestAccessToken();
  }, [setAuth, fetchUserInfo]);

  const signOut = useCallback(() => {
    if (accessToken && window.google) {
      window.google.accounts.oauth2.revoke(accessToken, () => {
        storeSignOut();
      });
    } else {
      storeSignOut();
    }
  }, [accessToken, storeSignOut]);

  return {
    isSignedIn,
    signIn,
    signOut,
  };
}
