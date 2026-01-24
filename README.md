# Mind Mesh Map

循環を許容するグラフ構造のマインドマップをブラウザ上で編集できるWYSIWYGエディタです。

Try this: https://mu-777.github.io/MindMeshMap/

## 概要

従来のマインドマップはツリー構造に限定されていますが、本エディタは**循環を含むグラフ構造**をサポートします。これにより、概念間の相互関係や循環的な依存関係を自然に表現できます。

### 特徴

- **循環グラフ対応**: A→B→C→A のような循環構造も表現可能
- **リッチテキスト編集**: ノード内で太字・斜体・リストなどの書式設定
- **自動レイアウト**: ELK.jsによる階層的な自動配置（循環があっても破綻しない）
- **キーボード操作**: マウスを使わず素早く編集可能
- **Google Drive連携**: クラウドに保存・同期

### スクリーンショット

```
┌─────────────────────────────────────────────────────┐
│ [≡] 新規 保存  │  マップ名  │ ↓下向き ▼ │ ? │ ログイン │
├─────────────────────────────────────────────────────┤
│                                                     │
│     ┌──────────┐                                    │
│     │ルートノード│                                    │
│     └────┬─────┘                                    │
│          │                                          │
│    ┌─────┴─────┐                                    │
│    ▼           ▼                                    │
│ ┌──────┐   ┌──────┐                                 │
│ │子ノード│   │子ノード│                                 │
│ └──────┘   └──────┘                                 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## ユーザーガイド

### 起動方法

1. ブラウザでアプリのURLにアクセス
2. 自動的に新しいマップが作成されます

### 基本操作

#### ノードの操作

| 操作 | 方法 |
|------|------|
| 子ノード作成 | ノードを選択して `Tab` |
| 兄弟ノード作成 | ノードを選択して `Enter` |
| ノード編集 | ダブルクリック または `F2` |
| 編集終了 | `Escape` |
| ノード削除 | `Delete` または `Backspace` |
| ノード移動 | ドラッグ＆ドロップ |

#### ナビゲーション

| 操作 | キー |
|------|------|
| 親ノードへ移動 | `↑` |
| 子ノードへ移動 | `↓` |
| 前の兄弟へ移動 | `←` |
| 次の兄弟へ移動 | `→` |

#### エッジ（矢印）の操作

| 操作 | 方法 |
|------|------|
| エッジ作成 | ノードのハンドル（青い丸）からドラッグして別のノードへ接続 |
| ラベル追加 | エッジの中央をクリックしてテキスト入力 |
| エッジ削除 | エッジを選択して表示される×ボタンをクリック |

#### 表示操作

| 操作 | キー |
|------|------|
| 拡大 | `Ctrl` + `+` |
| 縮小 | `Ctrl` + `-` |
| 全体表示 | `Ctrl` + `0` |
| レイアウト方向切替 | `Ctrl` + `D` |

#### 編集操作

| 操作 | キー |
|------|------|
| 元に戻す | `Ctrl` + `Z` |
| やり直し | `Ctrl` + `Shift` + `Z` |
| 保存 | `Ctrl` + `S` |
| ヘルプ表示 | `?` |

### レイアウト方向

ツールバーのドロップダウンから選択できます：

- **↓ 下向き**: ルートが上、子が下（デフォルト）
- **↑ 上向き**: ルートが下、子が上
- **→ 右向き**: ルートが左、子が右
- **← 左向き**: ルートが右、子が左

### Google Driveへの保存

1. 右上の「Googleでログイン」をクリック
2. Googleアカウントで認証
3. 「保存」ボタンでGoogle Driveに保存
4. サイドバーから過去のマップを開く

保存されたマップはGoogle Drive内の `MindMeshMap` フォルダに格納されます。

---

## 開発者向け情報

### 技術スタック

| カテゴリ | 技術 | バージョン |
|---------|------|-----------|
| フレームワーク | React + TypeScript | 18.x |
| ビルドツール | Vite | 6.x |
| グラフ描画 | React Flow (@xyflow/react) | 12.x |
| 自動レイアウト | ELK.js | 0.9.x |
| リッチテキスト | Tiptap | 2.x |
| 状態管理 | Zustand | 5.x |
| スタイリング | Tailwind CSS | 3.x |
| 認証 | Google Identity Services | - |
| ストレージ | Google Drive API v3 | - |

### セットアップ

```bash
# 依存パッケージのインストール
npm install

# 開発サーバー起動
npm run dev

# 本番ビルド
npm run build

# リント
npm run lint
```

### Google OAuth設定

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクト作成
2. 「APIとサービス」→「認証情報」→「OAuth 2.0 クライアントID」を作成
3. 「APIとサービス」→「ライブラリ」→「Google Drive API」を有効化
4. 許可されたJavaScriptオリジンにデプロイ先URLを追加
5. `.env` ファイルを作成：

```env
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

### ディレクトリ構成

```
src/
├── main.tsx                 # エントリーポイント
├── App.tsx                  # ルートコンポーネント
├── components/
│   ├── Editor/
│   │   ├── MindMapCanvas.tsx   # React Flowキャンバス
│   │   ├── CustomNode.tsx      # カスタムノード（Tiptap内蔵）
│   │   ├── CustomEdge.tsx      # カスタムエッジ（ラベル対応）
│   │   └── Toolbar.tsx         # ツールバー
│   ├── Sidebar/
│   │   ├── MapList.tsx         # マップ一覧
│   │   └── MapListItem.tsx     # 一覧アイテム
│   ├── Auth/
│   │   └── GoogleAuthButton.tsx
│   └── Common/
│       ├── Modal.tsx
│       └── KeyboardShortcutHelp.tsx
├── hooks/
│   ├── useKeyboardShortcuts.ts  # キーバインドシステム
│   ├── useAutoLayout.ts         # ELKレイアウト
│   ├── useGoogleAuth.ts         # Google認証
│   └── useGoogleDrive.ts        # Drive API操作
├── stores/
│   ├── mapStore.ts              # マップデータ + Undo/Redo
│   ├── uiStore.ts               # UI状態
│   ├── keybindStore.ts          # キーバインド設定
│   └── authStore.ts             # 認証状態
├── utils/
│   ├── layout.ts                # ELKレイアウト計算
│   ├── graphTraversal.ts        # グラフ探索（循環対応）
│   └── idGenerator.ts           # ID生成
├── config/
│   └── defaultKeybinds.ts       # デフォルトキーバインド
└── types/
    └── index.ts                 # 型定義
```

### データモデル

```typescript
// マップ全体
interface MindMap {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  layoutDirection: 'DOWN' | 'UP' | 'RIGHT' | 'LEFT';
  nodes: MapNode[];
  edges: MapEdge[];
}

// ノード
interface MapNode {
  id: string;
  content: string;  // Tiptap JSON文字列
  position: { x: number; y: number };
}

// エッジ
interface MapEdge {
  id: string;
  source: string;   // 始点ノードID
  target: string;   // 終点ノードID
  label?: string;   // オプションのラベル
}
```

### 循環グラフのレイアウト

ELK.jsの `layered` アルゴリズムは本来DAG（非循環有向グラフ）向けですが、`cycleBreaking.strategy: 'GREEDY'` オプションにより循環エッジを一時的に逆向きにしてレイアウト計算を行います。

```typescript
// utils/layout.ts
const graph = {
  layoutOptions: {
    'elk.algorithm': 'layered',
    'elk.layered.cycleBreaking.strategy': 'GREEDY',
    // ...
  },
  // ...
};
```

### 状態管理

Zustandを使用し、以下の4つのストアで状態を管理：

- **mapStore**: マップデータ、ノード/エッジ操作、履歴（Undo/Redo）
- **uiStore**: 選択状態、編集モード、サイドバー開閉
- **keybindStore**: キーバインド設定（LocalStorage永続化）
- **authStore**: Google認証状態

### キーバインドのカスタマイズ

`src/config/defaultKeybinds.ts` でデフォルト値を定義。ユーザーがカスタマイズした設定はLocalStorageに保存されます。

```typescript
export const defaultKeybinds: KeybindMap = {
  createChildNode: 'Tab',
  createSiblingNode: 'Enter',
  deleteNode: 'Delete',
  // ...
};
```

### ライセンス

MIT
