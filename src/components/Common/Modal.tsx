import { useEffect, useCallback, ReactNode } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  // 幅を広げたい場合のTailwindのmax-widthクラス（例: JSONテキストの入出力は 'max-w-2xl'）。
  // Tailwindはクラス名を静的に走査するため、呼び出し側にはリテラルのクラス名を書くこと
  maxWidthClass?: string;
  // 操作ボタン等、本文がスクロールしても常に見えていてほしい要素。
  // 本文（children）のスクロール領域の外側に固定表示する
  footer?: ReactNode;
  children: ReactNode;
}

export function Modal({
  isOpen,
  onClose,
  title,
  maxWidthClass = 'max-w-lg',
  footer,
  children,
}: ModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`max-h-[80vh] w-full ${maxWidthClass} overflow-hidden rounded-lg bg-gray-800 shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-700 px-6 py-4">
          <h2 className="text-lg font-medium text-white">{title}</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-6 py-4">{children}</div>
        {footer && <div className="border-t border-gray-700 px-6 py-3">{footer}</div>}
      </div>
    </div>
  );
}
