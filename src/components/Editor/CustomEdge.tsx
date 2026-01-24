import { memo, useState, useCallback } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { useMapStore } from '../../stores/mapStore';

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
  const { updateEdge, deleteEdge } = useMapStore();
  const [isEditing, setIsEditing] = useState(false);
  const [labelValue, setLabelValue] = useState(data?.label || '');

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

  return (
    <>
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
              <span>{data?.label || '+ ラベル'}</span>
              {selected && (
                <button
                  onClick={handleDelete}
                  className="ml-1 rounded bg-red-500/20 px-1 text-red-400 hover:bg-red-500/40"
                  title="エッジを削除"
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
