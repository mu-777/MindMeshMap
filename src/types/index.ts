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
export type LayoutDirection = 'DOWN' | 'RIGHT';

// 整列アルゴリズム（dev限定の切り替え。docs/align-branch-layout.md参照）
export type AlignAlgorithm =
  | 'uniform'
  | 'branch'
  | 'flat-axis'
  | 'sugiyama-ext'
  | 'sugiyama-port'
  | 'elk-port'
  | 'elk-port-ext'
  | 'elk-port-pava'
  | 'hola-lite';

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
  createdAt: string;
}

// キーバインド設定
export type KeybindAction =
  | 'createChildNode'
  | 'createParentNode'
  | 'createSiblingNode'
  | 'createOlderSiblingNode'
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
  | 'toggleLayoutDirection'
  | 'autoLayout';

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
  userPicture: string | null;
  // アクセストークンの有効期限（epoch ms）。GISのimplicitトークンは約1時間で失効する
  expiresAt: number | null;
}
