import { memo, useCallback, useEffect, useRef } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { useMapStore } from '../../stores/mapStore';
import { useUIStore } from '../../stores/uiStore';

export type CustomNodeData = {
  content: string;
};

export type CustomNodeType = Node<CustomNodeData, 'custom'>;

function CustomNodeComponent({ id, data, selected }: NodeProps<CustomNodeType>) {
  const { updateNode } = useMapStore();
  const { editingNodeId, setEditingNodeId, setSelectedNodeId } = useUIStore();
  const isEditing = editingNodeId === id;
  const containerRef = useRef<HTMLDivElement>(null);

  // Tiptapエディタの初期化
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'テキストを入力...',
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
      updateNode(id, { content: json });
    },
  });

  // 編集モードの切り替え
  useEffect(() => {
    if (editor) {
      editor.setEditable(isEditing);
      if (isEditing) {
        editor.commands.focus('end');
      }
    }
  }, [editor, isEditing]);

  // ダブルクリックで編集モードに
  const handleDoubleClick = useCallback(() => {
    setEditingNodeId(id);
  }, [id, setEditingNodeId]);

  // クリックで選択
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!isEditing) {
        setSelectedNodeId(id);
      }
    },
    [id, isEditing, setSelectedNodeId]
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
        // Ctrl+Enterで編集終了してノード選択状態に
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          e.stopPropagation();
          setEditingNodeId(null);
          setSelectedNodeId(id);
          return;
        }
        // 他のキーはTiptapに任せる（Enterは改行として動作）
        e.stopPropagation();
      }
    },
    [isEditing, setEditingNodeId, setSelectedNodeId, id]
  );

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
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export const CustomNode = memo(CustomNodeComponent);
