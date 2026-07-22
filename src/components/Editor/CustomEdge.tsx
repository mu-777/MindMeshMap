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
// 編集中のエッジラベル（input+✕）のz-index。react-flow__edgelabel-rendererはz-index未指定のため、
// 選択中ノード（z-index≈1000）の下に隠れることがある。編集中だけ確実に上回る値を明示的に付与する
const EDITING_LABEL_Z_INDEX = 1500;

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
  const { openContextMenu, toggleEdgeSelection } = useUIStore();
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

  // エッジのクリック処理。パスの端・中央・ラベルチップのどこをクリックしても同じ挙動にする
  // （旧仕様は「端はラベル編集input、中央はselected+×付きチップ」で見え方が一貫していなかった。
  // docs/decisions.md参照）。Shiftなし＝ラベル編集モード（input+×）を開く、
  // Shiftあり＝複数選択（selectedEdgeIds）をトグルする
  const handleEdgeClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (e.shiftKey) {
        toggleEdgeSelection(id);
      } else {
        setIsEditing(true);
      }
    },
    [id, toggleEdgeSelection]
  );

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

  // ✕ボタンでのエッジ削除はonMouseDownで処理する。onClickだと、mousedownの既定動作で
  // input側にblur（→handleLabelBlurのラベル確定＋setIsEditing(false)）が先に走り、
  // 編集UI（input+✕）が再レンダーでアンマウントされてしまい、後続のclickイベントが
  // ✕ボタンに届かず削除できないことがある（旧仕様でDeleteキーが効かなかった問題と同根の
  // 「ラベル編集inputにフォーカスが奪われて操作を取りこぼす」系の不具合）。
  // preventDefaultでフォーカス移動（＝blur）自体を起こさせず、mousedown時点で確実に削除する
  const handleDeleteMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
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
      <BaseEdge
        id={id}
        path={edgePath}
        // BaseEdgeがデフォルトで自動生成する当たり判定用パス（interactionWidth=20、
        // react-flow__edge-interaction クラス）は、下の自前インタラクションパスと機能重複する上、
        // SVGの描画順（後勝ち）で自前パスより手前に来てクリックを奪ってしまう
        // （実際に検証して確認済み）。0を渡して自動生成自体を無効化する
        interactionWidth={0}
        style={{
          stroke: selected ? '#3b82f6' : '#6b7280',
          strokeWidth: selected ? 2 : 1.5,
        }}
        markerEnd="url(#arrow)"
      />

      {/* インタラクション用の透明なパス（クリック/タップ領域を広げる）。
          パスのどこをクリックしてもラベルチップと同じ挙動（編集モードを開く/Shiftで複数選択）にする。
          SVGは後に描画した要素が手前（クリックを受け取る側）になるため、BaseEdgeの可視パスより
          後ろに置くことで、このパスが確実にクリック/タップを受け取れるようにする。
          クラス名（edge-click-target）はE2Eテストがこのパスをピンポイントに指定するための目印
          （e2e/context-menu-delete.mjs参照。座標クリックだと隣接要素と重なって不安定になるため
          dispatchEventで直接この要素を狙う） */}
      <path
        className="edge-click-target"
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onClick={handleEdgeClick}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        style={{ cursor: 'pointer' }}
      />

      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
            // 編集中のみ最前面に引き上げる（ノードの選択時z-indexを確実に上回らせるため）。
            // 非編集時（通常のラベルチップ表示）はundefinedのまま既定のスタッキング順に委ねる
            zIndex: isEditing ? EDITING_LABEL_Z_INDEX : undefined,
          }}
          className="nodrag nopan"
        >
          {isEditing ? (
            // 編集モードは常にinput+✕を一体で表示する（✕なしのinputだけになるケースを作らない）
            <div className="flex items-center gap-1">
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
              <button
                onMouseDown={handleDeleteMouseDown}
                className="rounded bg-red-500/20 px-1 py-1 text-xs text-red-400 hover:bg-red-500/40"
                title={t('editor.deleteEdge')}
              >
                ×
              </button>
            </div>
          ) : data?.label ? (
            // ラベルがある場合のみチップを表示する。ラベルが無い場合は何も描画しない
            // （旧「+ラベル」ホバーヒントは、クリックで編集+削除UIが開くことが伝われば冗長なため廃止。
            // 透明なクリック用パス（edge-click-target）は残っているのでクリック自体は引き続き可能。
            // docs/decisions.md参照）
            <div
              onClick={handleEdgeClick}
              className={`
                group flex items-center gap-1 rounded px-2 py-1 text-xs
                bg-gray-700 text-gray-200
                ${selected ? 'opacity-100' : ''}
              `}
            >
              <span>{data.label}</span>
            </div>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const CustomEdge = memo(CustomEdgeComponent);
