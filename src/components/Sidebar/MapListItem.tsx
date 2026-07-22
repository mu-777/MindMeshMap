import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { MapMeta } from '../../types';

interface MapListItemProps {
  map: MapMeta;
  isActive: boolean;
  onOpen: () => void;
  onDelete: () => void;
  // 指定された場合のみ「Driveへ保存」ボタン（ローカル保存マップの移行導線）を表示する。
  // Drive一覧のアイテムには渡さない
  onMigrate?: () => void;
}

function MapListItemComponent({
  map,
  isActive,
  onOpen,
  onDelete,
  onMigrate,
}: MapListItemProps) {
  const { t, i18n } = useTranslation();

  const localeMap: Record<string, string> = {
    ja: 'ja-JP',
    zh: 'zh-CN',
    en: 'en-US',
  };
  const formattedDate = new Date(map.updatedAt).toLocaleDateString(
    localeMap[i18n.language] || 'en-US',
    {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }
  );

  return (
    <li
      className={`
        group flex cursor-pointer items-center justify-between px-4 py-3
        transition-colors hover:bg-gray-700
        ${isActive ? 'bg-gray-700/50' : ''}
      `}
      onClick={onOpen}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <svg
            className="h-4 w-4 flex-shrink-0 text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <span
            className={`truncate text-sm ${
              isActive ? 'font-medium text-white' : 'text-gray-300'
            }`}
          >
            {map.name}
          </span>
        </div>
        <div className="mt-1 text-xs text-gray-500">{formattedDate}</div>
      </div>

      {/* onMigrateが渡されたとき（ローカル保存マップ）のみ「Driveへ保存」ボタンを表示する */}
      {onMigrate && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMigrate();
          }}
          className="ml-2 rounded p-1 text-gray-500 opacity-0 transition-opacity hover:bg-gray-600 hover:text-blue-400 group-hover:opacity-100"
          title={t('mapList.migrateToDrive')}
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        </button>
      )}

      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="ml-2 rounded p-1 text-gray-500 opacity-0 transition-opacity hover:bg-gray-600 hover:text-red-400 group-hover:opacity-100"
        title={t('common.delete')}
      >
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
          />
        </svg>
      </button>
    </li>
  );
}

export const MapListItem = memo(MapListItemComponent);
