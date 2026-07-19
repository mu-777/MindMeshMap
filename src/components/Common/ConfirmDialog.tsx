import { useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirmStore } from '../../stores/confirmStore';

// window.confirm() の代替。タイトルが不要なため既存のModalは使わず独自の小さなモーダルにする
export function ConfirmDialog() {
  const { t } = useTranslation();
  const { isOpen, message, handleConfirm, handleCancel } = useConfirmStore();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    },
    [handleCancel]
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
      onClick={handleCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-gray-800 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5">
          <p className="text-sm text-gray-200">{message}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-700 px-6 py-3">
          <button
            onClick={handleCancel}
            className="rounded px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            {t('common.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
