import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenuPlugin } from '@tiptap/extension-bubble-menu';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { useMapStore } from '../../stores/mapStore';
import { useUIStore } from '../../stores/uiStore';
import { useEditorStore } from '../../stores/editorStore';

// BubbleMenu用ProseMirrorプラグインのpluginKey（ノードごとのエディタに閉じているので固定文字列でよい）
const BUBBLE_MENU_PLUGIN_KEY = 'bubbleMenu';

const LONG_PRESS_DURATION = 500; // 長押し判定時間（ミリ秒）

export type CustomNodeData = {
  content: string;
};

export type CustomNodeType = Node<CustomNodeData, 'custom'>;

function CustomNodeComponent({ id, data, selected }: NodeProps<CustomNodeType>) {
  const { t } = useTranslation();
  const { updateNodeContent } = useMapStore();
  const { editingNodeId, setEditingNodeId, setSelectedNodeId, toggleNodeSelection, openContextMenu, pendingEditClear, setPendingEditClear } = useUIStore();
  const setActiveEditor = useEditorStore((state) => state.setActiveEditor);
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
  // BubbleMenu（テキスト選択時の書式バー）の中身を入れる要素。@tiptap/reactの<BubbleMenu>を
  // isEditingで直接マウント/アンマウントすると、内部でtippyがこの要素を実DOM上で
  // ポップアップ側へ再親子付けするため、Reactが後からremoveChildしようとして
  // 「The node to be removed is not a child of this node」でクラッシュする。
  // そのため要素自体は常時マウントしたままにし、下のuseEffectでプラグインの登録/解除だけを
  // isEditingで切り替える（要素を動かすtippy側の処理と、Reactのマウント管理を分離する）
  const [bubbleMenuElement, setBubbleMenuElement] = useState<HTMLDivElement | null>(null);

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
      // マウント直後、実際のユーザー入力なしにTiptap/ProseMirror側の初期化（スキーマ正規化等）で
      // onUpdateが発火することがある。このとき再シリアライズしたjsonは既存のdata.contentと
      // 完全一致する（内容としては無変更）ため、履歴を汚さないようここで無視する。
      // これにより「ダブルクリックでのノード作成1回でsaveToHistoryが複数回積まれる」問題
      // （addNode自身のsaveToHistoryに加え、この無変更onUpdateがrecordHistory=trueで
      // もう1回積んでいた）も解消される
      if (json === data.content) return;
      const recordHistory = isFirstEditInSessionRef.current;
      isFirstEditInSessionRef.current = false;
      updateNodeContent(id, json, recordHistory);
    },
  });

  // 編集セッション開始時（isEditingがtrueになった瞬間）に「最初の変更」フラグをリセットする。
  // 下の「編集モードの切り替え」effectより先に実行される必要があるためuseLayoutEffectにしている
  // （両方useLayoutEffectであれば宣言順に同期実行されるため、この順序関係が保たれる）
  useLayoutEffect(() => {
    if (isEditing) {
      isFirstEditInSessionRef.current = true;
    }
  }, [isEditing]);

  // 編集モードの切り替え。
  // useLayoutEffect にしているのは、印字可能文字によるキーボード横取り編集開始
  // （useKeyboardShortcutsのflushSync）内で同期的に実行される必要があるため。
  // useEffectだと次のマクロタスクまで実行が遅延し、ブラウザのデフォルトの文字入力/IME変換開始処理が
  // 走る時点でまだフォーカスが移っておらず、1文字目の入力を取りこぼしてしまう
  useLayoutEffect(() => {
    if (editor) {
      editor.setEditable(isEditing);
      if (isEditing) {
        // pendingEditClearが立っている場合、既存内容をクリアしてから編集開始する
        // （文字の挿入自体はブラウザ/IMEのデフォルト処理に任せるため、ここではクリアのみ行う）
        if (pendingEditClear) {
          editor.commands.clearContent();
          setPendingEditClear(false);
        }
        // Tiptapのfocusコマンドは実際のDOMフォーカスをrequestAnimationFrame内で行うため
        // （「For React we have to focus asynchronously」）、キーボード横取り編集開始の
        // flushSync内では間に合わず、直後にブラウザが処理する1文字目の入力を取りこぼす。
        // そのためDOMフォーカス自体はここで同期的に行い、focus('end')ではカーソル位置のみ委ねる
        editor.view.dom.focus();
        editor.commands.focus('end');
      }
    }
  }, [editor, isEditing, pendingEditClear, setPendingEditClear]);

  // 外部（Undo/Redo等）からのcontent変更をエディタに反映する。
  // アプリ側のUndo/RedoはmapStoreのhistoryでdata.contentを戻すが、Tiptapエディタは
  // 初期化時にcontentを読むだけで以後のprops変更を自動反映しないため、ここで同期する。
  // 編集中は自分自身の入力でdata.contentが更新されるため何もしない
  useEffect(() => {
    if (!editor || isEditing) return;
    const currentJson = JSON.stringify(editor.getJSON());
    if (currentJson === data.content) return;

    try {
      const parsed = JSON.parse(data.content);
      editor.commands.setContent(parsed, false);
    } catch {
      editor.commands.setContent(
        { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: data.content || '' }] }] },
        false
      );
    }
  }, [data.content, editor, isEditing]);

  // 編集中のエディタをeditorStoreに公開し、FormatToolbar（キャンバス右上の常設書式パネル）が
  // 操作対象として参照できるようにする。編集終了・アンマウント時は自分がactiveEditorの場合のみクリアする
  useEffect(() => {
    if (isEditing && editor) {
      setActiveEditor(editor);
      return () => {
        if (useEditorStore.getState().activeEditor === editor) {
          setActiveEditor(null);
        }
      };
    }
  }, [isEditing, editor, setActiveEditor]);

  // BubbleMenu（テキスト選択時の書式バー）のProseMirrorプラグインをisEditingに応じて
  // 登録/解除する。編集中でないノードはプラグイン自体が存在しない状態になるため、
  // tippyインスタンスやeditor.on('focus'/'blur')等のリスナーはノード数分ではなく
  // 編集中の1ノード分（最大1インスタンス）しか生きない。
  // useLayoutEffectにしているのは、下のclassName切り替え（isEditing===falseで.hidden付与）と
  // 同じコミットで同期的に実行するため（ズレるとプラグインのdestroy前後で1フレーム分
  // 表示が不安定になりうる）
  useLayoutEffect(() => {
    if (!isEditing || !editor || !bubbleMenuElement || editor.isDestroyed) return;

    const plugin = BubbleMenuPlugin({
      pluginKey: BUBBLE_MENU_PLUGIN_KEY,
      editor,
      element: bubbleMenuElement,
      tippyOptions: { zIndex: 9999, placement: 'top' },
    });
    editor.registerPlugin(plugin);
    return () => {
      if (!editor.isDestroyed) {
        editor.unregisterPlugin(BUBBLE_MENU_PLUGIN_KEY);
      }
    };
  }, [isEditing, editor, bubbleMenuElement]);

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
        // IME変換中のEnter/Escapeは変換確定のためのキー入力なので、
        // 編集モードの終了として扱わない（何もせずTiptap/IMEにそのまま処理させる）
        if (e.nativeEvent.isComposing) {
          return;
        }
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
        {/* テキスト選択時に表示される書式バー。
            要素自体は常時マウントしておき（理由は上のuseEffectのコメント参照）、
            表示に使われるBubbleMenuPluginの登録/解除をisEditingで切り替えることで、
            実質的に編集中の1ノードだけがtippyインスタンスを持つようにしている */}
        {editor && (
          <div
            ref={setBubbleMenuElement}
            // isEditingがfalseの間はプラグイン未登録でtippyに引き取られないため、
            // 素のインライン要素としてレイアウトに残ってしまう。hiddenクラスで場所を取らせない
            // （visibility:hiddenだとボタン分の高さが常にノード内に残ってしまうため）
            className={
              isEditing
                ? 'nodrag flex items-center gap-0.5 rounded border border-gray-600 bg-gray-800 p-1 shadow-lg'
                : 'hidden'
            }
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
          </div>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export const CustomNode = memo(CustomNodeComponent);
