import { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { useMapStore } from '../../stores/mapStore';
import { useUIStore } from '../../stores/uiStore';
import { useEditorStore } from '../../stores/editorStore';
import { useNodeCreation } from '../../hooks/useNodeCreation';
import { wasLastInteractionTouch } from '../../utils/pointerTracker';
import { getUndirectedShortestPath } from '../../utils/graphTraversal';

const LONG_PRESS_DURATION = 500; // 長押し判定時間（ミリ秒）

// 新規ノード作成直後、フォーカスを監視して奪われたら取り戻し続けるフレーム数。
// ハンドルからエッジを引き伸ばして新規ノードを作る経路（onConnectEnd）では、d3-dragの
// pointerup後の後始末が非同期でフォーカスをキャンバス側へ奪うことがあり、「一度focusして終わり」
// だと最初の打鍵時にフォーカスが抜けていて1文字目が英数字になる。約20フレーム(≒320ms)監視して
// 奪われた分を取り戻すことで、実際に打鍵が来る頃にはフォーカスが安定している。詳細はdocs/decisions.md §13
const FOCUS_GUARD_FRAMES = 20;

// DOMRectはgetBoundingClientRect()の戻り値そのものを保存するとゲッタープロパティのみで
// JSON化・比較がしづらいため、uiStore.ContextMenuState.anchorRectが期待するプレーンな
// {left,top,right,bottom}に変換する
function rectToAnchorRect(rect: DOMRect): { left: number; top: number; right: number; bottom: number } {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

export type CustomNodeData = {
  content: string;
};

export type CustomNodeType = Node<CustomNodeData, 'custom'>;

function CustomNodeComponent({ id, data, selected }: NodeProps<CustomNodeType>) {
  const { t } = useTranslation();
  const { updateNodeContent } = useMapStore();
  const { editingNodeId, setEditingNodeId, setSelectedNodeId, toggleNodeSelection, addNodesToSelection, openContextMenu } = useUIStore();
  const setActiveEditor = useEditorStore((state) => state.setActiveEditor);
  const { createChildNode, createParentNode } = useNodeCreation();
  const isEditing = editingNodeId === id;
  // armed状態（選択中かつ編集中でない）。この状態ではTiptapエディタをeditable+フォーカス済みに
  // しておく（armed-focus方式）。IMEは打鍵時点でフォーカスされている要素を見てcomposition開始を
  // 判断するため、打鍵の「前」からフォーカスがcontenteditableに無いと1文字目の変換が正しく
  // 働かない（keydownハンドラ内でフォーカスを移す方式では、その打鍵自体には間に合わない）。
  // タッチ操作直後はarmedにしない（1タップ目からソフトキーボードが開いてしまうのを防ぐ。
  // モバイルの2タップ編集フローはこのarmed機構と独立して従来通り動作する）
  const armed = selected && !isEditing && !wasLastInteractionTouch();
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
      // URLの自動リンク化（入力/貼り付け時）。クリックでの別タブオープンは自前のhandleClickで
      // 処理する（openOnClick:false。armed/読み取り専用状態でも確実に別タブで開けるようにするため。
      // 詳細はdocs/decisions.md参照）
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' },
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
    // armed-focus方式の要。ノードのTiptapエディタに常時フォーカスを当てておくことで
    // IMEが1文字目から正しくcomposition開始できるようにする一方、印字可能文字以外
    // （Tab/Enter/Delete/矢印/Ctrl系等）はProseMirrorに処理させず、windowのuseKeyboardShortcuts
    // にノード操作として処理させる（returnをtrueにするとProseMirrorはpreventDefaultした上で
    // 自身のキー処理を行わない。ただしDOMイベントの伝播は止まらないためwindowまでバブルする）。
    // このオブジェクトは毎レンダーで新しく作られるが、@tiptap/reactのuseEditorは
    // レンダーごとにeditorProps差分を検知してeditor.setOptions()経由でライブのEditorViewへ
    // 反映するため、id・armed・createChildNode等の最新のクロージャが常に使われる
    // （stale closureの心配はない）。ただし「今この瞬間の」selectedNodeId/editingNodeIdは
    // レンダー時点の値では不十分な場合があるため、useUIStore.getState()で都度取得する
    editorProps: {
      handleKeyDown: (_view, event) => {
        const uiState = useUIStore.getState();
        const isEditingNow = uiState.editingNodeId === id;
        const isArmedNow =
          !isEditingNow &&
          (uiState.selectedNodeId === id || uiState.selectedNodeIds.includes(id));

        // IME変換中、または変換確定のキー入力（keyCode 229はSafari等でisComposingが
        // 正しく立たない場合のフォールバック）。armedであれば編集モードへ遷移させた上で
        // このキー入力自体はTiptap/ブラウザのIME処理にそのまま委ねる（return false）。
        // 編集中は何もしない（IME変換確定のEnter等を編集終了として扱わないため）
        if (event.isComposing || event.keyCode === 229) {
          if (isArmedNow) {
            // 既にこのエディタにフォーカスがある（armed-focus）ので、compositionはこの
            // エディタ上で始まっている。編集モードへ遷移させるだけでよい（内容クリアはしない。
            // 新規ノードは空なので不要。既存ノードは末尾に追記される）
            flushSync(() => {
              setEditingNodeId(id);
            });
          }
          return false;
        }

        if (isEditingNow) {
          // Escapeで編集終了（armedへ復帰。selectedNodeIdは変えないので選択状態は保たれる）
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            flushSync(() => {
              setEditingNodeId(null);
            });
            return true;
          }
          // Tabで編集確定＋子ノード作成（新ノードを選択=armed。マインドマップ標準の階層操作）
          if (event.key === 'Tab' && !event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            flushSync(() => {
              setEditingNodeId(null);
              createChildNode(id);
            });
            return true;
          }
          // Shift+Tabで編集確定＋親ノード作成（対象の既存の親は新ノードの親になり、対象はその子になる）
          if (event.key === 'Tab' && event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            flushSync(() => {
              setEditingNodeId(null);
              createParentNode(id);
            });
            return true;
          }
          // 編集中のEnter（Shift無し）は改行にする（Tiptapのデフォルト処理に委ねる）。
          // 挙動は「確定＋弟ノード作成」→「確定のみ」→「改行」と変遷したが、テキスト内で
          // 改行できることを優先する方針に落ち着いた（docs/decisions.md参照）。弟ノード作成は、
          // Escape/Tab等で編集を終えたarmed状態でEnterを押すと発火する（useKeyboardShortcuts側の
          // createSiblingNode）。Shift+Enterも従来通りTiptapに任せて改行にする。
          // Enterは特別扱いせず、下の return false で他キーと同様にTiptap/ブラウザへ委ねる
          // 他のキーはTiptapに任せる（通常のテキスト入力、Ctrl+Zでのテキスト内Undo等）
          return false;
        }

        if (isArmedNow) {
          // 印字可能文字（Ctrl/Meta/Altなしの単一文字）は編集モードへ遷移し、この打鍵自体は
          // ブラウザ/ProseMirrorのデフォルト処理に委ねる（フォーカスは既にあるのでIMEも正しく動く）
          const isPrintableChar =
            event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
          if (isPrintableChar) {
            // フォーカスは既にこのエディタにある（armed-focus）ので、編集モードへ遷移させるだけ。
            // この打鍵自体はProseMirror/ブラウザのデフォルト処理でエディタに入力される
            flushSync(() => {
              setEditingNodeId(id);
            });
            return false;
          }
          // それ以外のキー（Tab/Enter/Backspace/Delete/矢印/Ctrl・Meta修飾付き全般/F2等）は
          // ProseMirrorに処理させない。preventDefaultはProseMirror側で行われ、イベント自体は
          // windowまでバブルするので、既存のuseKeyboardShortcutsがノード操作として処理する
          return true;
        }

        return false;
      },
    },
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

  // 編集モード・armed状態の切り替えに応じて、editable/フォーカスを同期する。
  // useLayoutEffect にしているのは、印字可能文字によるキーボード横取り編集開始
  // （useKeyboardShortcutsのflushSync、またはCustomNode自身のeditorProps.handleKeyDownの
  // flushSync）内で同期的に実行される必要があるため。useEffectだと次のマクロタスクまで
  // 実行が遅延し、ブラウザのデフォルトの文字入力/IME変換開始処理が走る時点でまだフォーカスが
  // 移っておらず、1文字目の入力を取りこぼしてしまう
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const dom = editor.view.dom as HTMLElement;

    // DOMフォーカスを当て、作成直後の一定フレームだけ「奪われたら取り戻す」監視を続ける。
    // 2種類の要因でノード新規作成直後にフォーカスが確立できない/奪われるため、両方に対応する:
    //  (1) React Flowは新規追加ノードを寸法計測完了まで visibility:hidden で描画する。非表示要素は
    //      フォーカスできないため、初回の同期focus()が失敗することがある（可視化後に取り戻す）。
    //  (2) ハンドルからエッジを引き伸ばして作る経路（onConnectEnd）では、d3-dragのpointerup後の
    //      後始末が非同期でフォーカスをキャンバス側へ奪う。一度focus()が成功しても直後に奪われるため、
    //      「成功したら監視停止」だと最初の打鍵時にフォーカスが抜けている。
    // どちらも症状は同じ「作成ノードにそのままIME入力すると1文字目が英数字になる」。
    // 既にdomにフォーカスがある間はfocus()を呼ばない（no-op）ので、ユーザーの正常な操作は妨げない。
    // 別ノード選択等でこのeffectが再実行されればcleanupで監視は止まる。詳細はdocs/decisions.md §13
    const focusWithRetry = (): (() => void) => {
      let frames = 0;
      let rafId: number | null = null;
      const ensureFocused = () => {
        rafId = null;
        if (editor.isDestroyed) return;
        if (document.activeElement !== dom) {
          dom.focus();
        }
        frames += 1;
        if (frames < FOCUS_GUARD_FRAMES) {
          rafId = requestAnimationFrame(ensureFocused);
        }
      };
      dom.focus(); // まず同期的に一度当てる（可視かつ奪取が無ければこれで確定）
      rafId = requestAnimationFrame(ensureFocused); // 以降、奪われた分を取り戻す
      return () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
      };
    };

    if (isEditing) {
      editor.setEditable(true);
      // Tiptapのfocusコマンド（focus('end')）は実際のDOMフォーカスをrequestAnimationFrame内で
      // 行うため（「For React we have to focus asynchronously」）、直後の1文字目入力に間に合わない。
      // DOMフォーカス自体はfocusWithRetryで同期的に確立し、focus('end')はカーソル位置のみ委ねる
      editor.commands.focus('end');
      return focusWithRetry();
    } else if (armed) {
      // armed-focus方式: 選択中・非編集のノードのエディタに常時フォーカスを当てておく。
      // これにより次の打鍵が発生する「前」からフォーカスがcontenteditableにある状態になり、
      // IMEが1文字目から正しくcomposition開始できる
      editor.setEditable(true);
      return focusWithRetry();
    } else {
      // armedでも編集中でもない（未選択・他ノード選択・タッチ選択直後 等）。
      // editor.commands.blur()はTiptap内部でrequestAnimationFrame経由の非同期実行になる
      // （focusコマンドと同様の理由）ため、ここではview.dom.blur()を直接同期的に呼ぶ。
      // 非同期のままだと、このコミット内で別ノード（子ノード作成等）が同期的にfocus()を
      // 呼んだ後になって、遅延実行されたblur()が発火してしまい、意図せずフォーカスが
      // documentへ抜けてしまう
      editor.setEditable(false);
      if (document.activeElement === dom) {
        dom.blur();
      }
    }
  }, [editor, isEditing, armed]);

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

  // ダブルクリックで編集モードに
  const handleDoubleClick = useCallback(() => {
    setEditingNodeId(id);
  }, [id, setEditingNodeId]);

  // クリックで選択。修飾キーで挙動を変える（エクスプローラ風の複数選択。docs/decisions.md参照）:
  // Ctrl/Meta+クリック＝そのノード単体を選択にトグル追加、Shift+クリック＝アンカー（直近選択
  // ノード）からクリックしたノードまでの無向最短経路上のノードをまとめて選択にunion追加、
  // 修飾なし＝単一選択
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // 非編集時にリンク（自動リンク化されたURL）をクリックしたら別タブで開く
      // （Link拡張はopenOnClick:falseにしているため自前で処理する）。選択/編集には進めない。
      // 編集中はリンク上クリックでもカーソル移動＝通常のテキスト編集をさせたいのでopenしない
      const anchor = (e.target as HTMLElement).closest('a');
      if (!isEditing && anchor?.href) {
        e.stopPropagation();
        window.open(anchor.href, '_blank', 'noopener,noreferrer');
        return;
      }

      e.stopPropagation();

      // タッチ由来のタップはhandleTouchEndで処理済みのため、
      // 直後に発火する合成clickイベントはここで消費して無視する（二重処理防止）
      if (tapHandledRef.current) {
        tapHandledRef.current = false;
        return;
      }

      if (isEditing) return;

      if (e.shiftKey) {
        // 常に最新の選択状態・マップを読む（レンダー時点の古いクロージャを避けるためgetState()経由）
        const uiState = useUIStore.getState();
        const anchor = uiState.selectedNodeId ?? uiState.lastSelectedNodeId;
        const currentMap = useMapStore.getState().currentMap;
        const path =
          anchor && currentMap ? getUndirectedShortestPath(anchor, id, currentMap.edges) : [];
        if (path.length > 0) {
          addNodesToSelection(path);
        } else {
          // アンカーが無い、またはアンカーからクリックノードへ到達できない（別の連結成分）場合は
          // そのノード単体をトグル追加するフォールバック
          toggleNodeSelection(id);
        }
      } else if (e.ctrlKey || e.metaKey) {
        // そのノード単体を選択にトグル追加
        toggleNodeSelection(id);
      } else {
        // 通常クリックで単一選択
        setSelectedNodeId(id);
      }
    },
    [id, isEditing, setSelectedNodeId, toggleNodeSelection, addNodesToSelection]
  );

  // 編集中のキーイベント処理。
  // Escape/Tab/Enterの特別処理はeditorProps.handleKeyDown（Tiptap側）に一本化したため、
  // ここでは編集中の他のキー（通常のテキスト入力等）がwindowのuseKeyboardShortcutsまで
  // バブリングしないようにするだけ
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isEditing) {
        // IME変換中のキー入力は変換確定のためのものなので、そのままTiptap/IMEに処理させる
        if (e.nativeEvent.isComposing) {
          return;
        }
        e.stopPropagation();
      }
    },
    [isEditing]
  );

  // 右クリックでコンテキストメニュー表示。ノードのDOM矩形をanchorRectとして渡し、
  // ContextMenu側でノードに重ならない位置（左側優先）に配置させる
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = containerRef.current?.getBoundingClientRect();
      openContextMenu('node', id, e.clientX, e.clientY, rect ? rectToAnchorRect(rect) : undefined);
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
          // タップ座標(x,y)はフォールバック用に渡しつつ、anchorRectでノードに重ならない
          // 位置（左上あたり）へ配置させる（指で隠れる・ノードに重なる問題への対策）
          const rect = containerRef.current?.getBoundingClientRect();
          openContextMenu(
            'node',
            id,
            touchStartPosRef.current.x,
            touchStartPosRef.current.y,
            rect ? rectToAnchorRect(rect) : undefined
          );
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
          ${!isEditing ? 'caret-transparent [&_*]:caret-transparent' : ''}
        `}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export const CustomNode = memo(CustomNodeComponent);
