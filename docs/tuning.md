# 調整パラメータ一覧

挙動チューニングの際に変更しうる定数と、その場所・意味の一覧。コードを探さずに調整箇所へ辿り着くためのインデックス。値を変更したらこのドキュメントも更新すること。

設計上の決定事項（なぜこの方式か・不採用案）は [decisions.md](./decisions.md) を参照。

## 保存・同期

| 定数 | 場所 | 現在値 | 意味 |
|---|---|---|---|
| `DRAFT_SAVE_DEBOUNCE_MS` | `src/stores/mapStore.ts` | 500 | ローカル下書き（localStorage）保存のデバウンス時間（ms） |
| `AUTO_SAVE_DELAY_MS` | `src/hooks/useAutoSave.ts` | 3000 | Google Drive オートセーブのデバウンス時間（ms）。変更が止まってからこの時間後に保存 |
| 履歴上限 | `src/stores/mapStore.ts` の `saveToHistory` | 50 | Undo/Redo の履歴保持件数 |

## 認証（Google）

| 定数 | 場所 | 現在値 | 意味 |
|---|---|---|---|
| `EXPIRY_BUFFER_MS` | `src/stores/authStore.ts` | 60000 | トークン失効をどれだけ手前から「失効扱い」にするか（ms）。API 実行直前の失効を避けるバッファ |
| `DEFAULT_EXPIRES_IN_SEC` | `src/hooks/useGoogleAuth.ts` | 3600 | GIS レスポンスに `expires_in` が無い場合に仮定するトークン寿命（秒） |

## PNG エクスポート

すべて `src/hooks/useExportPng.ts` 冒頭。

| 定数 | 現在値 | 意味 |
|---|---|---|
| `MAX_IMAGE_SIZE` | 4096 | 出力画像の長辺上限（px）。巨大マップでブラウザが固まるのを防ぐクランプ |
| `EXPORT_PADDING_PX` | 40 | マップ周囲の余白（px、スケール適用後の実ピクセル数）。以前は `getViewportForBounds` に比率（`EXPORT_PADDING = 0.1`）を渡す実装だったが、内部でzoomをクランプする挙動により右端・下端のノードが見切れる問題があったため、bounds・transformを自前で計算するpx指定に変更した |
| `FALLBACK_NODE_WIDTH` / `FALLBACK_NODE_HEIGHT` | 150 / 60 | ノードのDOM要素（`data-id`）が見つからない場合にbounds計算で使うフォールバック概算サイズ（px） |
| `EXPORT_BACKGROUND_COLOR` | `#111827` | 背景色（bg-gray-900 相当）。透過にするなら `undefined` ではなく toPng オプションごと調整 |

`EXPORT_MIN_ZOOM` / `EXPORT_MAX_ZOOM` は上記のbounds/transform自前計算への変更に伴い削除済み（`getViewportForBounds` を使わなくなったため不要になった）。

## 通知（トースト）

| 定数 | 場所 | 現在値 | 意味 |
|---|---|---|---|
| `AUTO_DISMISS_DELAY_MS` | `src/stores/toastStore.ts` | success/info: 4000、error: 8000 | 自動消滅までの時間（ms）。`actionLabel` 付きトーストは自動消滅しない |

## タッチ・マウス操作

| 定数 | 場所 | 現在値 | 意味 |
|---|---|---|---|
| `LONG_PRESS_DURATION` | `src/components/Editor/CustomNode.tsx` / `CustomEdge.tsx` | 500 | ノード/エッジ長押し（コンテキストメニュー表示）の判定時間（ms） |
| `LONG_PRESS_DELAY` | `src/components/Editor/MindMapCanvas.tsx` | 500 | キャンバス空白の長押し（ノード作成）の判定時間（ms） |
| `MOVE_THRESHOLD` | `MindMapCanvas.tsx` / `CustomNode.tsx` のタッチ処理 | 10 | 長押し判定をキャンセルする指の移動量（px） |
| `thresholdX` / `thresholdY` / `offsetStep` | `src/hooks/useKeyboardShortcuts.ts` の `adjustPositionToAvoidOverlap` | 150 / 60 / 100 | キーボードでのノード作成時の重複判定しきい値とずらし量（px） |

## ストレージキー

**変更すると既存ユーザーのデータ・設定が引き継がれなくなる**ため、原則変更しない。変更する場合は旧キーからのマイグレーションを実装すること。

| キー | ストレージ | 場所 | 内容 |
|---|---|---|---|
| `mindmeshmap-draft` | localStorage | `src/stores/mapStore.ts` | 編集中マップの下書き（map / fileId / isDirty） |
| `mindmeshmap-auth` | sessionStorage | `src/stores/authStore.ts` | 認証状態（トークン・有効期限・ユーザー情報）。タブ単位 |
| `mindmap-keybinds` | localStorage | `src/stores/keybindStore.ts` | キーバインド設定 |
| `mindmap-has-visited` | localStorage | `src/data/defaultMap.ts` | 初回訪問フラグ（デフォルトマップ表示判定） |
| `mindmeshmap-maplist-sort` | localStorage | `src/components/Sidebar/MapList.tsx` | マップ一覧の並び順（`updatedDesc` / `updatedAsc` / `createdDesc` / `createdAsc`） |
| `MindMeshMap`（フォルダ名） | Google Drive | `src/hooks/useGoogleDrive.ts` の `FOLDER_NAME` | マップ保存先フォルダ。変更すると既存マップが一覧から見えなくなる |

## 既知の未対応事項（将来対応の候補）

2026-07 の UX 改善（decisions.md 記載の一連の対応）時点で、認識した上で対応を見送った項目。対応する際はここから消すこと。

- **og:image 未設定**: 詳細は [decisions.md §10](./decisions.md)。1200×630 の PNG 素材を作成したら `index.html` に追加。
- **新規マップの初期文言が英語ハードコード**: `src/stores/mapStore.ts` の `Root Node` / `New Map`、`src/hooks/useKeyboardShortcuts.ts` の `New Node` は i18n されていない（キャンバス側のノード作成は `t('editor.newNode')` 使用済みで不統一）。日本語/中国語 UI に英語ノードが混ざる。
- **ノードの色分け・見た目カスタマイズ**: 分類・強調のための色付け機能はない。
- **ノード検索**: ノード数が増えたときにテキストで検索する手段がない。
- **ローカル下書きの複数タブ動作**: 後勝ち（last-write-wins）。詳細は [decisions.md §1](./decisions.md)。
- **Google Identity Servicesのスクリプトタグが最大4重に読み込まれる**: `useGoogleAuth`（`src/hooks/useGoogleAuth.ts`）は呼び出しごとに独立して `https://accounts.google.com/gsi/client` の `<script>` タグを `document.body` に追加・アンマウント時に除去する。この hook は `GoogleAuthButton` / `useAutoSave`（`App.tsx`） / `useSaveMap`（`Toolbar.tsx`） / `MapList.tsx` の計4箇所から呼ばれており、アプリ起動時に同一スクリプトが最大4回重複してリクエスト・実行されうる。各呼び出しは自分が追加したタグだけを正しくクリーンアップするためリーク（アンマウント後も残り続ける）ではなく、マウント時に一度だけ発生する無駄なネットワーク往復・スクリプト実行コストに留まる。対応するなら「GISスクリプト読み込み」を`useAutoLayout`等と同様の1箇所の共有フック/コンポーネントに集約するのが妥当だが、今回のバッチのスコープ外のため見送った。
