// マップ全体
export interface MindMap {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  layoutDirection: LayoutDirection;
  nodes: MapNode[];
  edges: MapEdge[];
}

// レイアウト方向
export type LayoutDirection = 'DOWN' | 'RIGHT' | 'UP' | 'LEFT';

// ノード
export interface MapNode {
  id: string;
  content: string; // Tiptap JSON文字列
  position: { x: number; y: number };
  width?: number;
  height?: number;
}

// エッジ
export interface MapEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
}

// Google Drive上のファイルリスト用
export interface MapMeta {
  fileId: string;
  name: string;
  updatedAt: string;
}

// キーバインド設定
export type KeybindAction =
  | 'createChildNode'
  | 'createSiblingNode'
  | 'deleteNode'
  | 'editNode'
  | 'finishEdit'
  | 'selectParent'
  | 'selectChild'
  | 'selectPrevSibling'
  | 'selectNextSibling'
  | 'undo'
  | 'redo'
  | 'save'
  | 'zoomIn'
  | 'zoomOut'
  | 'fitView'
  | 'toggleLayoutDirection';

export type KeybindMap = Record<KeybindAction, string>;

// UI状態
export interface UIState {
  selectedNodeId: string | null;
  editingNodeId: string | null;
  isSidebarOpen: boolean;
  isHelpModalOpen: boolean;
}

// 認証状態
export interface AuthState {
  isSignedIn: boolean;
  accessToken: string | null;
  userEmail: string | null;
  userName: string | null;
}
