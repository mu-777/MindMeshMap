import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { useMapStore } from '../../stores/mapStore';
import { useUIStore } from '../../stores/uiStore';

const LONG_PRESS_DURATION = 500; // 長押し判定時間（ミリ秒）

export type CustomNodeData = {
  content: string;
};

export type CustomNodeType = Node<CustomNodeData, 'custom'>;

function CustomNodeComponent({ id, data, selected }: NodeProps<CustomNodeType>) {
  const { t } = useTranslation();
  const { updateNodeContent } = useMapStore();
  const { editingNodeId, setEditingNodeId, setSelectedNodeId, toggleNodeSelection, openContextMenu, pendingEditChar, setPendingEditChar } = useUIStore();
  const isEditing = editingNodeId === id;
  const containerRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef<boolean>(false);
  const dragDetectedRef = useRef<boolean>(false);
  // タップをhandleTouchEndで処理済みかどうか。直後に発火する合成clickイベント
  // （handleClick）で同じタップを二重処理しないようにするためのフラグ
  const tapHandledRef = useRef<boolean>(false);
  // 編集セッション中の最初の変更かどうか（最初の変更のみ履歴を積み、1編集セッション=1 Undoにする）
  const isFirstEditInSessionRef = useRef<boolean>(true);

  // Tiptapエディタの初期化
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: t('editor.placeholder'),
      }),
    ],
    content: (() => {
      try {
        return JSON.parse(data.content);
      } catch {
        return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: data.content || '' }] }] };
      }
    })(),
    editable: isEditing,
    onUpdate: ({ editor }) => {
      const json = JSON.stringify(editor.getJSON());
      const recordHistory = isFirstEditInSessionRef.current;
      isFirstEditInSessionRef.current = false;
      updateNodeContent(id, json, recordHistory);
    },
  });

  // 編集セッション開始時（isEditingがtrueになった瞬間）に「最初の変更」フラグをリセットする。
  // 下の「編集モードの切り替え」effectより先に実行される必要がある
  // （pendingEditChar挿入時のonUpdateがこのフラグを見るため）
  useEffect(() => {
    if (isEditing) {
      isFirstEditInSessionRef.current = true;
    }
  }, [isEditing]);

  // 編集モードの切り替え
  useEffect(() => {
    if (editor) {
      editor.setEditable(isEditing);
      if (isEditing) {
        // pendingEditCharがある場合、内容をクリアしてその文字から編集開始
        if (pendingEditChar) {
          editor.commands.clearContent();
          editor.commands.insertContent(pendingEditChar);
          setPendingEditChar(null);
        }
        editor.commands.focus('end');
      }
    }
  }, [editor, isEditing, pendingEditChar, setPendingEditChar]);

  // ダブルクリックで編集モードに
  const handleDoubleClick = useCallback(() => {
    setEditingNodeId(id);
  }, [id, setEditingNodeId]);

  // クリックで選択（Shift+クリックで複数選択）
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();

      // タッチ由来のタップはhandleTouchEndで処理済みのため、
      // 直後に発火する合成clickイベントはここで消費して無視する（二重処理防止）
      if (tapHandledRef.current) {
        tapHandledRef.current = false;
        return;
      }

      if (!isEditing) {
        if (e.shiftKey) {
          // Shift+クリックで複数選択をトグル
          toggleNodeSelection(id);
        } else {
          // 通常クリックで単一選択
          setSelectedNodeId(id);
        }
      }
    },
    [id, isEditing, setSelectedNodeId, toggleNodeSelection]
  );

  // 編集中のキーイベント処理
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isEditing) {
        // Escapeで編集終了
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setEditingNodeId(null);
          return;
        }
        // Enterで編集終了してノード選択状態に
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          setEditingNodeId(null);
          setSelectedNodeId(id);
          return;
        }
        // 他のキーはTiptapに任せる（Shift+Enterは改行として動作）
        e.stopPropagation();
      }
    },
    [isEditing, setEditingNodeId, setSelectedNodeId, id]
  );

  // 右クリックでコンテキストメニュー表示
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      openContextMenu('node', id, e.clientX, e.clientY);
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

      const touch = e.touches[0];
      touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
      longPressTriggeredRef.current = false;
      dragDetectedRef.current = false;

      longPressTimerRef.current = setTimeout(() => {
        longPressTriggeredRef.current = true;
        if (touchStartPosRef.current) {
          openContextMenu('node', id, touchStartPosRef.current.x, touchStartPosRef.current.y);
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

      // 10px以上動いたらドラッグと判定して長押しキャンセル
      if (dx > 10 || dy > 10) {
        dragDetectedRef.current = true;
        clearLongPressTimer();
      }
    },
    [clearLongPressTimer]
  );

  // タッチ終了（モバイルは1タップ目=選択、2タップ目=編集の2段階で処理する）
  const handleTouchEnd = useCallback(() => {
    const wasLongPress = longPressTriggeredRef.current;
    const wasDrag = dragDetectedRef.current;
    clearLongPressTimer();

    // 長押しでもドラッグでもない通常のタップの場合のみ選択/編集を処理する
    if (!wasLongPress && !wasDrag && !isEditing) {
      // 直後に発火する合成clickイベント（handleClick）で二重処理されないようにフラグを立てる
      tapHandledRef.current = true;

      if (selected) {
        // 既に選択済みのノードへの2回目のタップで編集モードに入る
        setEditingNodeId(id);
      } else {
        // 未選択ノードへの1回目のタップは選択のみ
        // （即座に編集モードにするとキーボードが誤って開いてしまうため）
        setSelectedNodeId(id);
      }
    }
  }, [clearLongPressTimer, id, isEditing, selected, setEditingNodeId, setSelectedNodeId]);

  // コンポーネントアンマウント時にタイマーをクリア
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`
        min-w-[150px] max-w-[300px] rounded-lg border-2 bg-gray-800 px-3 py-2 shadow-lg
        transition-all duration-200
        ${selected ? 'border-blue-500 ring-2 ring-blue-500/50' : 'border-gray-600'}
        ${isEditing ? 'ring-2 ring-green-500/50' : ''}
      `}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* 上側ハンドル */}
      <Handle
        type="source"
        position={Position.Top}
        id="top"
        className="!h-3 !w-3 !border-2 !border-gray-600 !bg-blue-400"
      />

      {/* 下側ハンドル */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="!h-3 !w-3 !border-2 !border-gray-600 !bg-blue-400"
      />

      {/* 左側ハンドル */}
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        className="!h-3 !w-3 !border-2 !border-gray-600 !bg-blue-400"
      />

      {/* 右側ハンドル */}
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="!h-3 !w-3 !border-2 !border-gray-600 !bg-blue-400"
      />

      <div
        className={`
          prose prose-sm prose-invert max-w-none
          ${isEditing ? 'cursor-text' : 'cursor-pointer'}
        `}
      >
        {/* テキスト選択時に表示される書式バー。編集中でない（isEditable=false）間は
            BubbleMenuのデフォルトshouldShowにより自動的に非表示になる */}
        {editor && (
          <BubbleMenu
            editor={editor}
            tippyOptions={{ zIndex: 9999, placement: 'top' }}
            className="nodrag flex items-center gap-0.5 rounded border border-gray-600 bg-gray-800 p-1 shadow-lg"
          >
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
              title={t('editor.bold')}
              className={`rounded px-2 py-1 text-xs font-bold ${
                editor.isActive('bold') ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
              }`}
            >
              B
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              title={t('editor.italic')}
              className={`rounded px-2 py-1 text-xs italic ${
                editor.isActive('italic') ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
              }`}
            >
              I
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleStrike().run()}
              title={t('editor.strike')}
              className={`rounded px-2 py-1 text-xs line-through ${
                editor.isActive('strike') ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
              }`}
            >
              S
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              title={t('editor.bulletList')}
              className={`rounded px-2 py-1 text-xs ${
                editor.isActive('bulletList') ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
              }`}
            >
              •
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              title={t('editor.orderedList')}
              className={`rounded px-2 py-1 text-xs ${
                editor.isActive('orderedList') ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
              }`}
            >
              1.
            </button>
          </BubbleMenu>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export const CustomNode = memo(CustomNodeComponent);
