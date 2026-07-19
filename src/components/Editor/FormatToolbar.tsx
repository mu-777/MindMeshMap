import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Panel } from '@xyflow/react';
import { useEditorStore } from '../../stores/editorStore';

// キャンバス右上に常設する書式設定パネル。
// 編集中のノードのTiptapエディタ（editorStore.activeEditor）を操作対象とする。
// 既存のBubbleMenu（テキスト選択時のみ表示）とは別に、編集中は常に表示される
export function FormatToolbar() {
  const { t } = useTranslation();
  const activeEditor = useEditorStore((state) => state.activeEditor);
  // editor.isActive()の結果はエディタ内部状態に依存するため、Reactのstateではない。
  // transactionイベントを購読して強制的に再レンダーし、太字/斜体等のアクティブ表示を最新に保つ
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!activeEditor) return;
    const handleTransaction = () => forceRender((n) => n + 1);
    activeEditor.on('transaction', handleTransaction);
    return () => {
      activeEditor.off('transaction', handleTransaction);
    };
  }, [activeEditor]);

  if (!activeEditor) return null;

  const buttonClass = (active: boolean) =>
    `flex h-7 w-7 items-center justify-center rounded text-xs text-gray-300 hover:bg-gray-600 ${
      active ? 'bg-blue-600 text-white' : ''
    }`;

  return (
    <Panel position="top-right">
      <div className="nodrag flex items-center gap-0.5 rounded border border-gray-600 bg-gray-800 p-1 shadow-lg">
        <button
          type="button"
          // mousedownでフォーカスを奪うとエディタの選択状態が失われるため、ここでpreventDefaultする
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => activeEditor.chain().focus().toggleBold().run()}
          title={t('editor.bold')}
          className={`${buttonClass(activeEditor.isActive('bold'))} font-bold`}
        >
          B
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => activeEditor.chain().focus().toggleItalic().run()}
          title={t('editor.italic')}
          className={`${buttonClass(activeEditor.isActive('italic'))} italic`}
        >
          I
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => activeEditor.chain().focus().toggleStrike().run()}
          title={t('editor.strike')}
          className={`${buttonClass(activeEditor.isActive('strike'))} line-through`}
        >
          S
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => activeEditor.chain().focus().toggleBulletList().run()}
          title={t('editor.bulletList')}
          className={buttonClass(activeEditor.isActive('bulletList'))}
        >
          •
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => activeEditor.chain().focus().toggleOrderedList().run()}
          title={t('editor.orderedList')}
          className={buttonClass(activeEditor.isActive('orderedList'))}
        >
          1.
        </button>
      </div>
    </Panel>
  );
}
