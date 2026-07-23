import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGoogleAuth } from '../../hooks/useGoogleAuth';
import { useAuthStore } from '../../stores/authStore';

// メニュー外クリックで閉じるためのカスタムフック（Toolbar.tsxのファイルメニューと同じ実装）
function useClickOutside(
  ref: React.RefObject<HTMLElement>,
  handler: () => void
) {
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) {
        return;
      }
      handler();
    };
    // キャプチャフェーズで登録する。React Flowのパン/ズーム（d3-drag/d3-zoom）は
    // キャンバス上のmousedownでstopImmediatePropagationを呼ぶため、バブルフェーズの
    // リスナーだとキャンバスクリックがdocumentまで届かずメニューが閉じない問題への対策。
    document.addEventListener('mousedown', listener, { capture: true });
    document.addEventListener('touchstart', listener, { capture: true });
    return () => {
      document.removeEventListener('mousedown', listener, { capture: true });
      document.removeEventListener('touchstart', listener, { capture: true });
    };
  }, [ref, handler]);
}

export function GoogleAuthButton() {
  const { t } = useTranslation();
  const { isSignedIn, signIn, signOut } = useGoogleAuth();
  const { userName, userEmail, userPicture } = useAuthStore();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef as React.RefObject<HTMLElement>, () =>
    setIsMenuOpen(false)
  );

  if (isSignedIn) {
    return (
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setIsMenuOpen((open) => !open)}
          title={userEmail || undefined}
          className="flex w-full items-center gap-3 rounded p-1 text-left hover:bg-gray-700"
        >
          {userPicture ? (
            // GoogleのアバターURLはreferrerを送るとサーバー側で拒否される（403）ことがあるためno-referrer必須
            <img
              src={userPicture}
              alt=""
              referrerPolicy="no-referrer"
              className="h-8 w-8 flex-shrink-0 rounded-full"
            />
          ) : (
            // pictureが取得できない場合のフォールバック（既存の名前頭文字が無いグレー丸アイコン）
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-600 text-xs text-gray-300">
              {userName ? userName.charAt(0).toUpperCase() : '?'}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-gray-300">{userName}</div>
            <div className="truncate text-xs text-gray-500">{userEmail}</div>
          </div>
          {/* 上方向に開くメニューであることを示すシェブロン */}
          <svg
            className="h-4 w-4 flex-shrink-0 text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>

        {isMenuOpen && (
          <div className="absolute bottom-full left-0 right-0 z-50 mb-1 rounded-md border border-gray-600 bg-gray-800 py-1 shadow-lg">
            <button
              onClick={() => {
                setIsMenuOpen(false);
                signOut();
              }}
              className="flex w-full items-center px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700"
            >
              {t('auth.signOut')}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={signIn}
      className="flex items-center gap-2 rounded bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow hover:bg-gray-100"
    >
      <svg className="h-5 w-5" viewBox="0 0 24 24">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        />
      </svg>
      {t('auth.signInWithGoogle')}
    </button>
  );
}
