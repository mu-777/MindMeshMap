# E2Eテスト手順書

MindMeshMapのE2Eテストは、素の[playwright](https://playwright.dev/)（`@playwright/test`ではない）と
自前の軽量ランナー（`e2e/run-all.mjs`）で構成されている。採用理由は[decisions.md](./decisions.md)を参照。

このドキュメントはAIエージェント（Sonnet 5等）や将来の自分が、コードを読み直さずにテストを
実行・拡張できるようにするための手順書。

## 前提

1. 依存関係のインストール（初回のみ、または`package.json`変更後）
   ```bash
   npm install
   ```
2. Playwrightのブラウザバイナリのインストール（初回のみ）
   ```bash
   npx playwright install chromium
   ```
3. devサーバの起動（テスト実行中はずっと起動したままにしておく）
   ```bash
   npm run dev
   ```
   `http://localhost:5173/MindMeshMap/` で応答することを確認する。

## 実行方法

- 全テスト一括実行:
  ```bash
  npm run test:e2e
  ```
  PASS/FAILのサマリが最後に表示され、1件でも失敗すると非0の終了コードで終わる。
  devサーバが起動していない場合は、その旨のエラーメッセージで終了する（サーバ起動を促す）。

- 個別テストの実行（デバッグ時など）:
  ```bash
  node e2e/<file>.mjs
  ```
  例: `node e2e/node-creation.mjs`

- 失敗時、原因調査用のスクリーンショットが `e2e/screenshots/` に保存される
  （`e2e/helpers.mjs`の`assertTrue`/`assertEqual`が失敗時点で自動保存する）。
  このディレクトリは実行時成果物のため`.gitignore`済み。

## テストケース一覧

| ファイル | 対象機能・過去に壊れた課題 | 検証内容 | 自動/手動 |
|---|---|---|---|
| `node-creation.mjs` | ノード作成の3経路（ダブルクリック/Tab/Enter） | キャンバス空白ダブルクリックで独立ノード作成＋即編集モード、armedノードでTab→子ノード作成、Enter→兄弟ノード作成。新ノードがarmed状態になること | 自動 |
| `armed-focus-typing.mjs` | armed-focus方式の中核（1文字目IME問題の対策） | クリックのみ（ダブルクリックなし）でTiptapエディタに事前フォーカスが移ること、armedにするだけでノード位置が動かないこと、armedから直接タイプすると既存内容の末尾に追記されること、1回のCtrl+Zで元に戻ること | 自動（実IMEでの変換確認は手動、下記参照） |
| `ime-input.mjs` | 日本語IME入力の1文字目が英数字にならないこと（過去に複数回再発した不具合の回帰） | 3経路を各独立ページで検証。経路B（ダブルクリック作成→即編集）／経路C（ハンドルからエッジを引き伸ばして作成→即編集）／経路A（クリック選択armed→入力）のいずれも、作成/選択直後に`document.activeElement`が`.ProseMirror`になり（bodyに抜けない）、CDP模擬のIME入力が1文字目から正しく入ること。※経路Cのd3-dragによるフォーカス奪取はCDPで再現できないため、実機確認が別途必要（下記） | 自動（実IMEの最終確認は手動、下記参照） |
| `editing-keys.mjs` | 編集中のTab/Enter/Shift+Enter・タッチ環境のEnter | Tab=確定+子ノード作成(armed)、Enter(非タッチ・1回目)=確定のみ(ノードは増えずarmedに戻る)、続けてEnter(2回目・armed)で兄弟ノードが1個作成されること（decisions.md §20「改訂」）、Shift+Enter=常に改行、Enter(タッチ)=改行のまま（ノードが増えない） | 自動 |
| `editing-selection-invariant.mjs` | 「編集中ノードは常に選択中」の不変条件（decisions.md §27）の回帰 | 編集中に確定キーを押さず別ノードをクリックすると元ノードの編集が終了し「枠グレー＋緑リング」の操作不能状態が残らないこと、編集中ノード自身をCtrl+クリックで選択解除しても編集が終了すること | 自動 |
| `arrow-navigation.mjs` | 矢印キーでのノード間移動、disableKeyboardA11y | armedノードから矢印キーで隣接ノードへフォーカス移動、移動前後で全ノード位置(transform)が不変（React Flow標準の矢印キー移動と二重に効かないこと） | 自動 |
| `text-undo-redo.mjs` | アプリレベルUndo/Redo、1編集セッション=1ステップ | armed中のDelete/Ctrl+Zがノード削除のアプリレベルUndoとして働く（ProseMirrorのテキスト内Undoに奪われない）、テキスト編集のUndo/Redo往復。複数アクション後のUndo/Redoは「繰り返せば収束する」ことのみ確認（既知の制限あり、下記tuning.md参照） | 自動 |
| `format-toolbar-bubblemenu.mjs` | 書式パネル(FormatToolbar、BubbleMenu廃止後は書式UIはこれのみ。decisions.md §40) | 編集中のみFormatToolbarが表示・終了で消える、テキストを選択した状態でFormatToolbarのボタンを押すと選択範囲に書式が適用される（選択範囲を保持したまま適用できることの確認）、複数ノードで編集セッションを繰り返してもクラッシュしない（BubbleMenu時代のremoveChild例外の回帰確認） | 自動 |
| `edge-label-delete.mjs` | エッジのクリック=ラベル編集+✕削除ボタンの一体化 | エッジのどこをクリックしても（パスの端・中央/ラベルチップ位置いずれも）ラベル編集inputと✕削除ボタンが一体で表示されること（✕なしのinputだけになるケースが無いこと）、✕クリックでエッジのみ削除されノードは残ること、ラベル入力→Enterで確定・表示されること | 自動 |
| `multi-select-delete.mjs` | Ctrl+クリック（ノード）とShift+クリック（エッジ）によるノード・エッジ混在の複数選択とDelete一括削除 | ノード2個をCtrl+クリック・エッジ1個をShift+クリックで混在選択できること（選択ハイライト、ノード選択とエッジ選択が互いを消さないこと）、Deleteで選択した要素だけがまとめて削除され非選択ノードは残ること、Ctrl+Z 1回で全部復元されること（＝`deleteNodesAndEdges`が履歴を1エントリしか積んでいないことの検証） | 自動 |
| `layout-stability.mjs` | 整列の差分的レイアウト（ELKのINTERACTIVE戦略。decisions.md §26） | `src/utils/layout.ts`のソースから実際のELKオプションを抽出し、3フェーズ戦略がすべて`INTERACTIVE`で位置ヒント（`x`/`y`）を渡していること（ドリフト検出）、抽出した実オプションで「エッジ1本追加→再整列」したときの平均移動量が閾値以下・兄弟ノードの並び順が維持されること。**ブラウザ・devサーバ不要の純Nodeテスト**（elkjsを直接実行） | 自動 |
| `layout-quality.mjs` | 整列アルゴリズム全体の品質（ケースコーパス×6アルゴリズムの総当たり。[layout-lab.md](./layout-lab.md)） | 各検出器（重なり・ハンドルの向き・エッジのノード貫通・エッジ交差・兄弟順の反転）がわざと壊した配置で実際に反応すること（**陽性確認・陰性確認**。指標が壊れて常に0を返すと以降の全チェックが無意味になるため）、ケースコーパス自体の整合性、全アルゴリズムで「全ノードの座標が有限で返る」「2回実行して完全一致（決定性）」「スコアがNaNにならない」こと、アルゴリズムごとの契約（`uniform`・`sugiyama-ext`・`elk-port`・`elk-port-ext`はノードが重ならない、`sugiyama-ext`はハンドルの向きどおりに配置する）を破らないこと。契約対象外の違反は失敗にせず件数を表示する。加えて、**固定seed（1..40）のランダムファズ**で生成したグラフでも契約が守られること（seed固定なのでflakyにならず、失敗時は再現コマンドがメッセージに出る）、**スコアがベースライン（`e2e/fixtures/layout-baseline.json`）より悪化していないこと**（件数系は1件でも増えたら失敗／幾何系は相対5%まで許容／実行時間は比較しない。意図した変更なら`npm run layout:baseline`で更新する）。**ブラウザ・devサーバ不要の純Nodeテスト**（esbuildでsrc配下の.tsを直接importして実行） | 自動 |
| `branch-layout-algorithms.mjs` | dev限定の整列アルゴリズム切り替え（`branch`/`flat-axis`/`sugiyama-ext`/`elk-port`/`elk-port-ext`。align-branch-layout.md） | `calculateBranchLayout`でright/bottom両方向の子が正しい軸に分離・再帰合成されること、循環グラフ・複数親グラフでクラッシュせず決定的（2回実行で同一結果）であること、`calculateFlatAxisLayout`で横系/縦系ノード群のx/y分散が期待通り分離すること、`calculateSugiyamaExtLayout`で右ハンドル子が前方・上/下ハンドル子が親のprimary帯に被って上/下に配置されること／rootが現在位置を保つこと／DOWN方向へ自然に回転すること／循環・複数親で決定的なこと、`calculateLayoutForAlign(..., 'uniform')`が既存`calculateLayout`と完全に同じ結果を返すこと（非破壊の保証）、`calculateElkPortLayout`でハンドル混在グラフの結果が`uniform`と変わること（ポート制約が実際に効いている陽性確認）／下ハンドル子でもRIGHT方向では前方の層に置かれること（ポートは取り付き面だけを制約し流れ方向は変えない、という仕様上の限界の固定）／`targetHandle`無しがソース面の反対面と同じ扱いになること／端点が欠けたエッジを除外してフォールバックに落ちないこと／循環・複数親・自己ループ・孤立ノードで決定的なこと。`calculateElkPortExtLayout`で上/下ハンドル子が親の上/下に置かれつつ層は単一方向のままであること（ポートのcrossオフセットの陽性確認）／3層をまたぐエッジが仮想ノードで通り道を確保すること／同じ層のノードが最小間隔を守ること（PAVA）／DOWN方向へ90度回転すること／循環・複数親・自己ループで決定的かつ外接矩形の左上が元の位置に留まること。**ブラウザ・devサーバ不要の純Nodeテスト**（esbuildでsrc配下の.tsを直接importして実行） | 自動 |
| `align-keybind.mjs` | 整列のキーバインド化（`Ctrl+Shift+L`）と選択ノードのみの部分整列 | ノード2個をドラッグでバラバラの位置に動かしてShift+クリックで選択、`Ctrl+Shift+L`で選択2ノードだけ位置が変わり非選択ノードは全て不変であること、Ctrl+Z 1回で選択2ノードの位置がドラッグ後の位置に戻ること（＝`applyLayout`が履歴を1エントリしか積んでいないことの検証）、選択なし状態での`Ctrl+Shift+L`はマップ全体を整列すること | 自動 |
| `context-menu-delete.mjs` | 右クリックメニューでの削除、選択クリア漏れ回帰、メニュー位置決め（anchorRect。decisions.md §47） | 右クリック→メニューが対象ノードに重ならずビューポート内に収まって表示されること、メニューからノード/エッジ削除、削除対象が選択中だった場合にuiStoreの選択がクリアされること（Undoボタンが無効になるまでの押下回数で検証） | 自動 |
| `menu-outside-click.mjs` | コンテキストメニュー/ファイルメニューの外側クリッククローズ | 右クリックメニュー・ファイルメニューがキャンバス空白クリックで閉じること、メニュー自身のボタンクリックは引き続き機能すること（キャプチャフェーズ化の回帰確認） | 自動 |
| `rect-select-delete.mjs` | Shift+ドラッグの矩形選択をuiStoreの複数選択へ橋渡し（`onSelectionChange`。decisions.md §45） | 全ノードを囲むShift+ドラッグの矩形選択で各ノードが選択状態(青枠)になること、Deleteキーで選択したノードがまとめて削除され保護されたルートノードのみ残ること（uiStoreへ未反映だとDeleteが無反応になる不具合の回帰確認） | 自動 |
| `png-export.mjs` | PNGエクスポートの実寸・見切れ | 出力画像の実寸がuseExportPng.tsの計算式と一致すること、四辺（外周1px）が背景色のみでノードが見切れていないこと | 自動 |
| `mobile-viewport.mjs` | モバイル表示・2タップ編集フロー、ドキュメントスクロール抑止（decisions.md §46） | ツールバーが画面上端から可視、React Flow Controlsがビューポート内に収まる、`window.scrollTo`後もドキュメントがスクロールせずツールバーが画面上端に留まること、1タップ目はエディタにフォーカスが入らない（選択のみ）、2タップ目で編集モードに入る | 自動 |

## 手動確認チェックリスト

以下はCDP（Chrome DevTools Protocol）経由のPlaywrightでは自動化できない、または
自動化する価値が低い項目。理由とともに記載する。実施したら日付とブラウザ/OSを控えておくとよい。

- **実IME（日本語IME等）での1文字目変換**: CDPの`Input.insertText`/`Input.imeSetComposition`では、
  実際のOS/ブラウザが発火するcompositionstart/compositionupdate/compositionendのイベント列を
  完全には再現できない。`ime-input.mjs`/`armed-focus-typing.mjs`で「打鍵前にフォーカスが
  contenteditableに当たっていること」（＝1文字目問題の真因の有無）自体は自動検証済みだが、
  変換候補が実際に正しく出るかは人間の確認が必要。**必ず次の2経路を両方確認すること**（過去に
  経路Bだけ未検証で不具合が再発した）:
  1. 経路A: ノードを1回クリックして選択（armed）→ そのままローマ字入力 → 1文字目から変換候補が出る
  2. 経路B: 空白を**ダブルクリック**してノードを作成 → 何もせずそのままローマ字入力 → 1文字目から変換候補が出る
  3. 経路C: ノードのハンドル（青い丸）から**エッジを引き伸ばして空白にドロップ**して新規ノードを作成 → そのままローマ字入力 → 1文字目から変換候補が出る（この経路のフォーカス奪取はCDPで再現できず自動テストで守れないため、実機確認が特に重要）
- **Android実機でのURLバー出入り時の100dvh挙動とソフトキーボード表示時のレイアウト**:
  Playwrightのモバイルエミュレーションは固定ビューポートで、実機のURLバーの出入りに伴う
  ビューポート変化やソフトキーボード表示時の`interactive-widget=resizes-content`の挙動を
  再現できない。手順: Android Chrome実機でページを開き、スクロールでURLバーを隠す/出す、
  ノードをタップしてソフトキーボードを表示する、の両方でツールバー・キャンバスのレイアウトが
  崩れないことを確認する。`mobile-viewport.mjs`は`window.scrollTo`によるドキュメントスクロール
  抑止（html/body非スクロール化。decisions.md §46）を自動検証済みだが、実機のタッチスクロール
  ジェスチャ（トップバー/左カラムを指で触って動かす操作）そのものはCDPでは再現できないため、
  上記の実機確認で併せて「触ってもトップバーが画面外へ消えないこと」を確認する。
- **Googleログインが必要な一連の機能**: Drive保存・オートセーブ・リネームのDrive反映・
  マップ一覧のソート・トークン失効時の再ログイン導線。実際のGoogleアカウントでのOAuth同意を
  伴うため自動化していない。手順: `docs/decisions.md`の該当決定（§2, 3, 9, 15）を参照しつつ、
  実際にログインしてDrive上のファイルが期待通り作成・更新・一覧表示されることを確認する。
- **PNGエクスポートの目視品質**: `png-export.mjs`は実寸・四辺の背景余白（見切れの有無）を
  ピクセル単位で自動検証しているが、フォントのアンチエイリアシングや配色など「見た目の質」の
  最終確認は人間の目視に委ねる。手順: エクスポートしたPNGを画像ビューアで開き、文字が
  読みやすいか、意図しない要素（ツールバー等）が写り込んでいないかを確認する。

## テストを書き足すときの流儀

- **1ファイル=1テーマ**。既存の一覧表にあるテーマの粒度を目安にする。1つのテーマに複数の
  観点がある場合は、ファイル内で`async function testXxx()`に分けて`run()`から順に呼び出す
  （`editing-keys.mjs`や`text-undo-redo.mjs`を参考にする）。
- **テスト本体でない共有モジュールは`e2e/lib/`に置く**。`run-all.mjs`は`e2e/*.mjs`を
  テストファイルとみなして`run()`を呼ぶため、直下に置くと「`run()`がexportされていません」で
  失敗する。サブディレクトリなら探索対象外になる（`lib/ts-loader.mjs`・`lib/layout-metrics.mjs`・
  `lib/layout-cases.mjs`がこれ。ブラウザ操作の共通処理だけは従来どおり`helpers.mjs`）。
- **テストの独立性を保つ**。`helpers.mjs`の`launchPage()`は呼ぶたびに新しいブラウザ
  コンテキストを作るため、localStorage/sessionStorageは常に空（初回訪問状態）から始まる。
  他のテストの状態に依存するテストを書かない。1テスト関数の中では`launchPage()`で作った
  ブラウザを`finally`ブロックで必ず`closeBrowser()`すること。
- **helpersを使う**。ノードのDOM構造（`.react-flow__node`、`.ProseMirror`、選択/編集中を
  示すクラス名等）に依存する処理は`e2e/helpers.mjs`の既存関数（`getNodeIds`、`isNodeEditing`、
  `isNodeSelected`、`getActiveElementInfo`等）を再利用する。同じDOM構造を複数ファイルで
  ベタ書きしない（CustomNode.tsx側の実装が変わったときの修正箇所を1箇所に保つため）。
- **アサーションは`assertTrue`/`assertEqual`を使う**。`console.log`で目視確認するだけの
  スクリプトは「恒久テスト」にならない（scratchpadで使っていたスクリプトが正にこれで、
  誤った期待値がコメントに書かれていても誰も検知できなかった実例が本タスク中に見つかっている。
  `docs/tuning.md`の既知の未対応事項を参照）。必ず例外を投げて失敗を検知できる形にする。
- **失敗しても壊れていないことを確認する（陽性確認）**。新しい退行テストを書いたら、
  対象のバグ修正を一時的に取り消した状態（`git stash`等）で実際にテストが失敗することを
  確認してから元に戻す。「常にPASSしてしまうテスト」は無意味なので、これを省略しない
  （`context-menu-delete.mjs`の作成時に、素朴な実装だと修正の有無に関わらずPASSしてしまう
  ケースが実際にあった。詳細はファイル内のコメント参照）。
- **スクリーンショットの置き場所**: `SCREENSHOT_DIR`（`e2e/screenshots/`）に保存する。
  `saveScreenshot(page, name)`ヘルパを使うと連番が自動で付く。このディレクトリはgit管理外
  （`.gitignore`）なので、恒久的に参照したい画像ではなく、あくまでデバッグ用途として扱うこと。
- **待機はタイムアウト付きの`waitForSelector`等を優先**し、固定`waitForTimeout`は
  アニメーション・デバウンス処理の完了待ちなど本当に必要な箇所のみに絞る（他のテストファイルの
  待機時間を参考にする。短すぎるとflakyになり、長すぎるとテスト全体が遅くなる）。
- **flakyなテストを見つけたら**、原因（要素の重なり・タイミング）を特定して安定化するか
  （本タスク中、エッジクリックがラベルオーバーレイや隣接エッジと座標的に重なって意図しない
  要素をクリックしてしまう問題が複数箇所で見つかり、`dispatchEvent`での直接発火や
  `getEdgePointNotTouchingNode`ヘルパで対処した）、安定化が難しい場合は理由をコメントに
  明記した上でテストから除外する。
