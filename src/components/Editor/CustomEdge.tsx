import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { useMapStore } from '../../stores/mapStore';
import { useUIStore } from '../../stores/uiStore';

const LONG_PRESS_DURATION = 500; // 長押し判定時間（ミリ秒）

export type CustomEdgeData = {
  label?: string;
};

export type CustomEdgeType = Edge<CustomEdgeData, 'custom'>;

function CustomEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<CustomEdgeType>) {
  const { t } = useTranslation();
  const { updateEdge, deleteEdge } = useMapStore();
  const { openContextMenu } = useUIStore();
  const [isEditing, setIsEditing] = useState(false);
  const [labelValue, setLabelValue] = useState(data?.label || '');
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const handleLabelClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  }, []);

  const handleLabelChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setLabelValue(e.target.value);
    },
    []
  );

  const handleLabelBlur = useCallback(() => {
    setIsEditing(false);
    updateEdge(id, { label: labelValue || undefined });
  }, [id, labelValue, updateEdge]);

  const handleLabelKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleLabelBlur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setLabelValue(data?.label || '');
        setIsEditing(false);
      }
      e.stopPropagation();
    },
    [data?.label, handleLabelBlur]
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      deleteEdge(id);
    },
    [id, deleteEdge]
  );

  // 右クリックでコンテキストメニュー表示
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      openContextMenu('edge', id, e.clientX, e.clientY);
    },
    [id, openContextMenu]
  );

  // 長押しタイマーをクリア
  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartPosRef.current = null;
  }, []);

  // タッチ開始（長押し検出開始）
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (isEditing) return;

      // 親要素への伝播を止めて、背景の長押しノード作成を防ぐ
      e.stopPropagation();

      const touch = e.touches[0];
      touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };

      longPressTimerRef.current = setTimeout(() => {
        if (touchStartPosRef.current) {
          openContextMenu('edge', id, touchStartPosRef.current.x, touchStartPosRef.current.y);
        }
      }, LONG_PRESS_DURATION);
    },
    [id, isEditing, openContextMenu]
  );

  // タッチ移動（指が動いたら長押しキャンセル）
  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartPosRef.current) return;

      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
      const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);

      // 10px以上動いたらキャンセル
      if (dx > 10 || dy > 10) {
        clearLongPressTimer();
      }
    },
    [clearLongPressTimer]
  );

  // タッチ終了
  const handleTouchEnd = useCallback(() => {
    clearLongPressTimer();
  }, [clearLongPressTimer]);

  // コンポーネントアンマウント時にタイマーをクリア
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  return (
    <>
      {/* インタラクション用の透明なパス（クリック/タップ領域を広げる） */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        style={{ cursor: 'pointer' }}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? '#3b82f6' : '#6b7280',
          strokeWidth: selected ? 2 : 1.5,
        }}
        markerEnd="url(#arrow)"
      />

      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
        >
          {isEditing ? (
            <input
              type="text"
              value={labelValue}
              onChange={handleLabelChange}
              onBlur={handleLabelBlur}
              onKeyDown={handleLabelKeyDown}
              autoFocus
              className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
              style={{ minWidth: '60px' }}
            />
          ) : (
            <div
              onClick={handleLabelClick}
              className={`
                group flex items-center gap-1 rounded px-2 py-1 text-xs
                ${
                  data?.label
                    ? 'bg-gray-700 text-gray-200'
                    : 'cursor-pointer bg-gray-700/50 text-gray-400 opacity-0 hover:opacity-100'
                }
                ${selected ? 'opacity-100' : ''}
              `}
            >
              <span>{data?.label || t('editor.addLabel')}</span>
              {selected && (
                <button
                  onClick={handleDelete}
                  className="ml-1 rounded bg-red-500/20 px-1 text-red-400 hover:bg-red-500/40"
                  title={t('editor.deleteEdge')}
                >
                  ×
                </button>
              )}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const CustomEdge = memo(CustomEdgeComponent);
