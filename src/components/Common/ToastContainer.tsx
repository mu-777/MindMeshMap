import { useToastStore, type ToastType } from '../../stores/toastStore';

// トーストタイプ別のアクセントカラー
const ACCENT_BORDER: Record<ToastType, string> = {
  success: 'border-green-500',
  error: 'border-red-500',
  info: 'border-blue-500',
};

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-start gap-3 rounded-lg border bg-gray-800 px-4 py-3 shadow-lg ${ACCENT_BORDER[toast.type]}`}
        >
          <p className="flex-1 whitespace-pre-line text-sm text-gray-100">{toast.message}</p>

          {toast.actionLabel && toast.onAction && (
            <button
              onClick={() => {
                toast.onAction?.();
                removeToast(toast.id);
              }}
              className="flex-shrink-0 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
            >
              {toast.actionLabel}
            </button>
          )}

          <button
            onClick={() => removeToast(toast.id)}
            className="flex-shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-700 hover:text-white"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
