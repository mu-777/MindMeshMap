# Mind Mesh Map

循環を許容するグラフ構造のマインドマップをブラウザ上で編集できるWYSIWYGエディタです。

Try this: https://mu-777.github.io/MindMeshMap/

## 概要

従来のマインドマップはツリー構造に限定されていますが、本エディタは**循環を含むグラフ構造**をサポートします。これにより、概念間の相互関係や循環的な依存関係を自然に表現できます。

### 特徴

- **循環グラフ対応**: A→B→C→A のような循環構造も表現可能
- **リッチテキスト編集**: ノード内で太字・斜体・リストなどの書式設定
- **自動レイアウト**: ELK.jsによる階層的な自動配置（循環があっても破綻しない）。整列は現在の配置をなるべく保つ差分的な動作
- **キーボード操作**: マウスを使わず素早く編集可能。キーバインドはヘルプモーダルからカスタマイズ可能
- **ローカル自動保存**: 編集内容はブラウザに常時自動保存され、ログインなしでもリロード後に復元される
- **Google Drive連携**: ログインすると、変更が自動保存（オートセーブ）されクラウドに同期
- **エクスポート / インポート**: マップをJSON/PNGとしてエクスポート、JSONからインポート

### スクリーンショット

```
┌─────────────────────────────────────────────────────────────────┐
│ [≡] 新規 ファイル 保存  Undo Redo │ マップ名 │ ↓下向き▼ 整列 ? EN │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│     ┌──────────┐                                                │
│     │ルートノード│                                                │
│     └────┬─────┘                                                │
│          │                                                      │
│    ┌─────┴─────┐                                                │
│    ▼           ▼                                                │
│ ┌──────┐   ┌──────┐                                             │
│ │子ノード│   │子ノード│                                             │
│ └──────┘   └──────┘                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## ユーザーガイド

### 起動方法

1. ブラウザでアプリのURLにアクセス
2. 初回訪問時はサンプルマップ（ツールの使い方が体感できるデフォルトマップ）が表示されます
3. 2回目以降は、ブラウザに自動保存された前回の編集内容（下書き）が復元されます

### 基本操作（マウス / タッチ）

| 操作 | 方法 |
|------|------|
| ノード作成 | 空白をダブルクリック / 長押し |
| ノード編集 | ダブルクリック / 選択済みノードを再タップ |
| ノード選択 | クリック / タップ |
| 複数選択 | Shift+クリック（ノード・エッジを問わず、混在選択も可能） |
| ノード移動 | ドラッグ |
| エッジ作成 | ノードのハンドル（青い丸）を別のノードへドラッグ |
| 接続済み新ノード作成 | ハンドルをドラッグして空白にドロップ |
| エッジ編集 | エッジをクリック（パスのどこでもよい）するとラベル編集inputと`×`削除ボタンが一体で開く |
| 削除メニュー | 右クリック / 長押し（ノード・エッジどちらも対象） |

モバイルでは「1回目のタップは選択のみ、選択済みノードへの2回目のタップで編集モードに入る」2段階方式です。これは、選択したいだけの操作でソフトウェアキーボードが誤って開くのを防ぐためです。

エッジの削除方法は3通りあります: (1) エッジをクリックすると開く編集UIの `×` ボタンをクリックする、(2) エッジを右クリック（モバイルは長押し）してメニューから削除する、(3) Shift+クリックでノード・エッジを混在選択し `Delete` キーでまとめて削除する。

複数のノード（2個以上）を選択した状態で整列（`Ctrl+Shift+L`）を行うと、選択したノードだけがその場で整列されます（非選択のノードは動かず、画面表示も飛びません）。選択が1個以下の場合はマップ全体を整列します。整列はゼロから配置し直すのではなく、現在の配置（階層・兄弟ノードの並び順・循環エッジの向き）をなるべく保ったまま間隔と階層を整えます。そのため、エッジを少し足して再整列しても全体が組み変わることはありません。

### キーボード操作

| 操作 | キー |
|------|------|
| 子ノード作成 | `Tab` |
| 親ノード作成 | `Shift+Tab` |
| 兄弟ノード作成 | `Enter` |
| 兄ノード作成 | `Shift+Enter` |
| ノード編集 | `F2` |
| 編集終了 | `Escape` |
| ノード削除 | `Delete` |
| 親ノードへ移動 | `↑`（その方向にある最寄りのノードへ移動） |
| 子ノードへ移動 | `↓`（その方向にある最寄りのノードへ移動） |
| 前の兄弟へ移動 | `←`（その方向にある最寄りのノードへ移動） |
| 次の兄弟へ移動 | `→`（その方向にある最寄りのノードへ移動） |
| 元に戻す | `Ctrl` + `Z` |
| やり直し | `Ctrl` + `Shift` + `Z` |
| 保存（Google Driveへ） | `Ctrl` + `S` |
| 拡大 | `Ctrl` + `=` |
| 縮小 | `Ctrl` + `-` |
| 全体表示 | `Ctrl` + `0` |
| レイアウト方向切替（↓⇄→の2方向トグル） | `Ctrl` + `D` |
| 整列（複数選択中は選択ノードのみ整列） | `Ctrl` + `Shift` + `L` |
| ヘルプ表示 | `?` |

`↑`/`↓`/`←`/`→` によるナビゲーションは厳密なツリーの親子関係ではなく、「現在選択中のノードから見て、その方向にある最寄りのノード」へ移動します（循環グラフ・DAG構造でも自然に機能させるための挙動です）。

親ノード作成（`Shift+Tab`）で対象ノードに複数の親がいる場合、既存の親はすべて新しいノードの親になり、対象ノードは新しいノードの子になります（対象ノードの子はそのまま維持されます）。

`Enter`/`Shift+Enter` は対象ノードのすぐ隣（弟/兄の位置）に新しいノードを挿入し、重なる兄弟がいる場合はその兄弟をサブツリーごと押し出してスペースを空けます。`Shift+Tab` の親ノード作成では、対象ノードを1レイヤ分外側へ寄せ、新しい親ノードは対象ノードの元の位置に配置されます。

`Ctrl+S` は実際にGoogle Driveへの保存を実行します。未ログインの場合は「ローカルには自動保存済み。Drive保存にはログインが必要」というトーストが表示されます。

キーバインドは上記の初期値から変更できます。ヘルプモーダル（`?` キーまたはツールバーの `?` ボタン）の「キーボード」タブで、変更したいキーのkbd表示をクリックし、割り当てたいキーを押すと変更されます。他の操作に割り当て済みのキーは競合として警告され、割り当てられません。「デフォルトに戻す」ボタンで初期状態にリセットできます。

#### 編集中のEnter/Tab

ノードのテキストを編集している最中は、`Tab`/`Enter`/`Shift+Enter` が上記の表とは異なる意味になります（この挙動はキーバインドのカスタマイズ対象外です）。

| キー | 環境 | 動作 |
|------|------|------|
| `Tab` | 共通 | 編集を確定し、子ノードを作成（新しいノードが選択された状態になり、続けてタイプできます） |
| `Shift+Tab` | 共通 | 編集を確定し、親ノードを作成（対象の既存の親は新ノードの親になり、対象はその子になる。対象の子はそのまま） |
| `Enter` | デスクトップ | 編集を確定し、兄弟ノードを作成 |
| `Enter` | スマホ・タブレット（タッチ操作） | 改行（ソフトウェアキーボードで改行する手段を失わないよう、あえてノードを作成しません） |
| `Shift+Enter` | 共通 | 常に改行 |

日本語入力などIME変換中に確定のためだけに押したEnterは、上記のいずれの動作にもなりません（変換確定のみ行われ、編集は継続します）。

### レイアウト方向

ツールバーのドロップダウンから選択できます：

- **↓ 下向き**: ルートが上、子が下
- **→ 右向き**: ルートが左、子が右（デフォルト）

### リッチテキスト

ノードを編集中は、キャンバス右上に書式パネル（太字・斜体・打ち消し線・箇条書き・番号付きリスト）が常時表示されます。加えて、ノード内でテキストを選択すると、選択範囲のそばにも同じ操作ができる書式バー（BubbleMenu）が表示されます。どちらも操作内容は同じで、表示位置が異なるだけです。

| 書式 | ショートカット |
|------|----------------|
| 太字 | `Ctrl` + `B` |
| 斜体 | `Ctrl` + `I` |
| 打ち消し線 | `Ctrl` + `Shift` + `S` |
| 箇条書き | `Ctrl` + `Shift` + `8` |
| 番号付きリスト | `Ctrl` + `Shift` + `7` |
| 改行 | `Shift` + `Enter` |

### 保存

#### ローカル自動保存

編集内容は500ms間隔でブラウザの`localStorage`に自動保存されます。ログインしていなくても、リロードやブラウザの再起動後に前回の続きから編集できます。この自動保存はタブ単位ではなくブラウザに保存されるため、同じブラウザであれば次回訪問時にも復元されます（複数タブで同時編集した場合は最後に保存したタブの内容が残ります）。

#### Google Driveへの保存

1. サイドバーの「Googleでログイン」をクリックして認証
2. ツールバーの「保存」ボタンまたは `Ctrl+S` で初回保存（手動）
3. 一度保存したマップは、以降の変更から3秒後に自動保存（サイレント、オートセーブ）されます
4. 新規マップは自動保存の対象外です。Drive上にファイルを乱造しないよう、初回保存は必ず手動操作が必要です
5. サイドバーの一覧から過去のマップを開けます（一覧は保存のたびに自動更新されます）
6. 一覧上部のプルダウンで並び順（更新日時 / 作成日時 × 新しい順 / 古い順）を切り替えられます。選択した並び順はブラウザに保存され、次回訪問時も復元されます

保存されたマップはGoogle Drive内の `MindMeshMap` フォルダに格納されます。マップのタイトルを変更して保存すると、Drive上のファイル名にも反映されます。

ログインセッション（アクセストークン）は約1時間で失効します。失効を検知すると「再ログイン」ボタン付きのトーストが表示され、再ログインすると自動保存が自動的に再開します。

### エクスポート / インポート

ツールバーの「ファイル」メニュー（モバイルでは `⋮` メニュー内）は「エクスポート」「インポート」の2セクションに分かれており、以下の操作ができます。

| セクション | 操作 | 内容 |
|-----------|------|------|
| エクスポート | JSON | 現在のマップをJSONファイルとしてダウンロード |
| エクスポート | PNG画像 | 現在のマップをPNG画像としてダウンロード（余白付きで全ノードが必ず収まります） |
| インポート | JSON | JSONファイルを選択してマップを読み込み（インポート後はDrive未保存の新規マップとして扱われます） |

---

## 開発者向け情報

### ドキュメント

- [docs/decisions.md](docs/decisions.md) — 設計決定の記録（採用理由・不採用案・再検討の条件）
- [docs/tuning.md](docs/tuning.md) — 調整パラメータ一覧（定数の場所・意味・現在値）とストレージキー、既知の未対応事項
- [docs/testing.md](docs/testing.md) — E2Eテストの実行方法・テストケース一覧・手動確認チェックリスト

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
| PNGエクスポート | html-to-image | 1.x |
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

### テスト

E2Eテスト（[Playwright](https://playwright.dev/)）を用意しています。詳細な手順・テストケース一覧・手動確認が必要な項目は [docs/testing.md](docs/testing.md) を参照してください。

```bash
# 初回のみ: Chromiumバイナリのインストール
npx playwright install chromium

# 別ターミナルでdevサーバーを起動しておく
npm run dev

# 全E2Eテストを実行
npm run test:e2e
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
├── main.tsx                     # エントリーポイント
├── App.tsx                      # ルートコンポーネント
├── i18n.ts                      # i18next初期化
├── components/
│   ├── Editor/
│   │   ├── MindMapCanvas.tsx      # React Flowキャンバス
│   │   ├── CustomNode.tsx         # カスタムノード（Tiptap内蔵）
│   │   ├── CustomEdge.tsx         # カスタムエッジ（ラベル対応）
│   │   ├── ContextMenu.tsx        # 右クリック/長押しの削除メニュー
│   │   ├── FormatToolbar.tsx      # 編集中に常設表示する書式パネル（キャンバス右上）
│   │   └── Toolbar.tsx            # ツールバー
│   ├── Sidebar/
│   │   ├── MapList.tsx            # マップ一覧
│   │   └── MapListItem.tsx        # 一覧アイテム
│   ├── Auth/
│   │   └── GoogleAuthButton.tsx
│   └── Common/
│       ├── Modal.tsx
│       ├── KeyboardShortcutHelp.tsx  # ヘルプモーダル（基本操作/書式/キーボード）
│       ├── ToastContainer.tsx        # トースト通知
│       ├── ConfirmDialog.tsx         # 独自確認ダイアログ（window.confirm代替）
│       └── LanguageSwitcher.tsx      # 言語切替
├── hooks/
│   ├── useKeyboardShortcuts.ts    # キーバインドシステム
│   ├── useAutoLayout.ts           # ELKレイアウト
│   ├── useGoogleAuth.ts           # Google認証
│   ├── useGoogleDrive.ts          # Drive API操作
│   ├── useSaveMap.ts              # 保存処理（ボタン/Ctrl+S共通）
│   ├── useAutoSave.ts             # Driveオートセーブ（3秒デバウンス）
│   ├── useUnloadGuard.ts          # 離脱時の未保存確認（beforeunload）
│   └── useExportPng.ts            # PNGエクスポート
├── stores/
│   ├── mapStore.ts                # マップデータ + Undo/Redo + ローカル下書き自動保存
│   ├── uiStore.ts                 # UI状態
│   ├── editorStore.ts             # 編集中のTiptapエディタ参照（FormatToolbarが参照）
│   ├── keybindStore.ts            # キーバインド設定
│   ├── authStore.ts               # 認証状態
│   ├── toastStore.ts              # トースト通知
│   └── confirmStore.ts            # 確認ダイアログ
├── utils/
│   ├── layout.ts                  # ELKレイアウト計算
│   ├── graphTraversal.ts          # グラフ探索（循環対応）
│   ├── idGenerator.ts             # ID生成
│   ├── exportImport.ts            # JSONエクスポート/インポート
│   └── errors.ts                  # AuthExpiredError等
├── data/
│   └── defaultMap.ts              # 初回訪問用サンプルマップ
├── config/
│   └── defaultKeybinds.ts         # デフォルトキーバインド
├── locales/
│   ├── en.json / ja.json / zh.json  # i18nリソース
└── types/
    └── index.ts                   # 型定義
```

### データモデル

```typescript
// マップ全体
interface MindMap {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  layoutDirection: 'DOWN' | 'RIGHT';
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

ELK.jsの `layered` アルゴリズムは本来DAG（非循環有向グラフ）向けですが、`cycleBreaking.strategy` オプションにより循環エッジを一時的に逆向きにしてレイアウト計算を行います。

整列は各ノードの現在座標をヒントとしてELKに渡し、3フェーズ（cycleBreaking / layering / crossingMinimization）を `INTERACTIVE` 戦略で実行します。これにより「現在の配置をなるべく保ったまま整える」差分的なレイアウトになります（決定の経緯と実験データは [docs/decisions.md §26](docs/decisions.md) を参照）。

```typescript
// utils/layout.ts
const graph = {
  layoutOptions: {
    'elk.algorithm': 'layered',
    'elk.layered.cycleBreaking.strategy': 'INTERACTIVE',
    'elk.layered.layering.strategy': 'INTERACTIVE',
    'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',
    // ...
  },
  children: nodes.map((n) => ({
    // 現在位置をヒントとして渡す
    x: n.position.x,
    y: n.position.y,
    // ...
  })),
  // ...
};
```

### 状態管理

Zustandを使用し、以下のストアで状態を管理：

- **mapStore**: マップデータ、ノード/エッジ操作、履歴（Undo/Redo）、localStorageへのローカル下書き自動保存
- **uiStore**: 選択状態、編集モード、サイドバー開閉、ヘルプモーダル開閉、コンテキストメニュー
- **keybindStore**: キーバインド設定（LocalStorage永続化）
- **authStore**: Google認証状態（sessionStorage永続化）
- **toastStore**: トースト通知のキュー
- **confirmStore**: 確認ダイアログ（`window.confirm`のPromise版代替）

### キーバインドのカスタマイズ

`src/config/defaultKeybinds.ts` でデフォルト値を定義。ユーザーがカスタマイズした設定はLocalStorageに保存されます。アプリ内ではヘルプモーダル（`?`キー）の「キーボード」タブから、コードを触らずにGUIで変更できます。

```typescript
export const defaultKeybinds: KeybindMap = {
  createChildNode: 'Tab',
  createParentNode: 'Shift+Tab',
  createSiblingNode: 'Enter',
  createOlderSiblingNode: 'Shift+Enter',
  deleteNode: 'Delete',
  // ...
};
```

### ライセンス

MIT
