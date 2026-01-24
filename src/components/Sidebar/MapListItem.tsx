import { memo } from 'react';
import { MapMeta } from '../../types';

interface MapListItemProps {
  map: MapMeta;
  isActive: boolean;
  onOpen: () => void;
  onDelete: () => void;
}

function MapListItemComponent({
  map,
  isActive,
  onOpen,
  onDelete,
}: MapListItemProps) {
  const formattedDate = new Date(map.updatedAt).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

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

      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="ml-2 rounded p-1 text-gray-500 opacity-0 transition-opacity hover:bg-gray-600 hover:text-red-400 group-hover:opacity-100"
        title="削除"
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
