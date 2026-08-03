# CLAUDE.md — MindMeshMap 固有の作業ルール

全リポジトリ共通のルールはユーザーのグローバル `AGENTS.md` に従う。ここにはこのリポジトリ固有の事情だけを書く。
コード構成・技術スタック・コーディング規則はコードと [README.md](README.md) を読めば分かるので、ここには書かない。

---

## このプロジェクトの前提

- **バックエンドなしの静的サイト**。GitHub Pages（`https://mu-777.github.io/MindMeshMap/`）に配信し、データはブラウザの localStorage / sessionStorage とユーザー自身の Google Drive にのみ置く。サーバを必要とする提案（DB・API サーバ・サーバ側セッション等）は、ランニングコストゼロ方針に反するので出す前に必ず確認する。
- **`master` への push = 本番デプロイ**（`.github/workflows/deploy.yml` が自動でビルドして Pages に公開する）。commit/push は指示があったときだけ、というグローバルルールがここでは特に効く。push は「公開」なので、まとめて実行する前に必ず確認する。
- **デスクトップとモバイル（タッチ）の両方が対象**。マウス前提の変更を入れるときは必ずタッチ側の挙動（1タップ選択→再タップ編集、長押しメニュー、ソフトキーボード、100dvh）への影響も考える。
- **UI 文言は i18n（`src/locales/` の en / ja / zh）**。文言を追加・変更したら 3 言語すべて同じキーで同期する。1 言語だけ直した状態で終わらせない。
- **秘匿情報**: Google OAuth クライアント ID は `.env`（gitignore 済み）と GitHub Actions の `secrets.VITE_GOOGLE_CLIENT_ID` から注入する。値をコードに書かない。

---

## ドキュメントの役割分担（コード変更と同じ作業内で更新する）

| ファイル | 役割 | 更新が必要になるタイミング |
|---|---|---|
| [README.md](README.md) | 確定した仕様・操作方法・セットアップ手順 | ユーザーから見える挙動を変えたとき。検討中・比較・今後の予定は書かない |
| [docs/decisions.md](docs/decisions.md) | 設計決定記録（採用理由・**不採用案とその理由**・再検討の条件） | 選択肢を比較して何かを決めたとき。ユーザーとの議論で方針が決まったときも指示を待たず追記する。番号付き（§N）で末尾に追加し、既存決定を覆した場合は元の項に「改訂」節を足して経緯を残す |
| [docs/tuning.md](docs/tuning.md) | 調整パラメータの索引（定数名・ファイル・現在値・意味） | チューニング定数を追加・変更したとき。値を変えたら表の現在値も直す。「既知の未対応事項」に載っている項目に対応したらそこから消す |
| [docs/testing.md](docs/testing.md) | E2E の実行手順・テストケース一覧・**手動確認チェックリスト**・テストを書く流儀 | テストを追加・変更したとき、自動化できない確認項目が増えたとき |
| [docs/layout-lab.md](docs/layout-lab.md) | 整列アルゴリズムの評価環境（コンタクトシート・ファズ・ベースライン）の使い方 | 評価環境そのものを変えたとき |
| [docs/align-algorithms.md](docs/align-algorithms.md) | 整列アルゴリズム9方式の詳細仕様（フェーズ単位の入出力・手順・データ構造。採用理由や評価は書かない） | アルゴリズムの計算内容を変えたとき・方式を追加/削除したとき。**`src/utils/*Layout.ts` を編集したら行番号アンカー（`...ts#L12-L34`）がずれるので、行数が変わる編集をしたら該当リンクを直す**（コメント1行の増減でもずれる） |
| [docs/align-branch-layout.md](docs/align-branch-layout.md) | 整列アルゴリズム各方式（uniform / branch / flat-axis / sugiyama-ext / sugiyama-port / elk-port / elk-port-ext / elk-port-pava / hola-lite）の設計メモと今後の運び | 整列方式の設計を変えたとき |
| [docs/graph-drawing-primer.md](docs/graph-drawing-primer.md) / [docs/layout-prior-art.md](docs/layout-prior-art.md) | グラフ描画分野の背景知識・先行研究の地図（読み物、めったに変わらない） | 新しい先行事例を調べたとき |

- **決定記録と tuning は相互リンクする**。同じ事実が README・decisions・tuning に分散するときは、片方だけ直さず必ず整合させる。
- 整列（レイアウト）まわりを触る前に、少なくとも `decisions.md` の §25・§26・§39・§44・§49・§50・§53・§56 と `align-branch-layout.md` に目を通す（各方式が実際に何を計算しているかは `align-algorithms.md`）。過去に一度決めた方針を知らずに戻すのが一番起きやすい事故。

---

## 完了の定義（このリポジトリでの具体手順）

実装したら、返す前に最低限ここまでやる。

```bash
npm run lint
npm run build        # tsc -b + vite build。型エラーはここで出る
npm run dev          # http://localhost:5173/MindMeshMap/ （パスの /MindMeshMap/ を忘れない）
npm run test:e2e     # 別シェルで。dev サーバが起動していないと失敗する
```

- **E2E は dev サーバ起動が前提**。初回は `npx playwright install chromium` が必要。失敗時のスクリーンショットは `e2e/screenshots/`（git 管理外）。
- **dev サーバは自分の検証用に自由に立ててよいが、ユーザーにボールを返す直前に自分が立てたものは落とす**（落とした旨の報告は不要）。ユーザーは自分で確認するとき自分で立てるので、ポートが埋まっていると邪魔になる。
- **整列アルゴリズムのチューニング定数（`src/utils/sugiyamaExtLayout.ts` / `src/utils/sugiyamaPortLayout.ts` / `src/utils/elkPortExtLayout.ts` / `src/utils/holaLiteLayout.ts` 冒頭など）を変えたら**、追加でこれを回す:
  ```bash
  node scripts/layout-contact-sheet.mjs --scale --compare   # 改善と悪化の両方を確認
  npm run layout:baseline                                   # 意図した変更ならベースライン更新
  npm run layout:fuzz                                       # 広い範囲のランダム検証（任意）
  ```
  ベースラインを更新しないと回帰テスト（`e2e/layout-quality.mjs`）が落ちる。逆に、意図しない悪化を無視してベースラインだけ更新しない。
- **ユーザーの目視確認が要るもの**（見た目・アニメーション・レイアウト）は、dev サーバか `npm run build && npm run preview` で「すぐ見られる URL」を添えて渡す。

## WSL では確認できないこと（自動確認済みと手動確認待ちを必ず区別して報告する）

以下は自動テストで守れない。触ったら報告に「実機確認待ち」として明示する。詳細な手順は [docs/testing.md](docs/testing.md) の手動確認チェックリスト。

- **実 IME での 1 文字目変換**。過去に複数回再発した不具合。経路A（クリック選択→そのまま入力）・経路B（空白ダブルクリック作成→そのまま入力）・経路C（ハンドルからドラッグして作成→そのまま入力）の**3経路すべて**。特に経路 C は CDP で再現できず自動テストで守れない。
- **Android/iOS 実機**でのソフトキーボード表示時のレイアウト、URL バー出入りに伴う 100dvh の挙動、タッチスクロールでトップバーが消えないこと。
- **Google ログインを伴う機能**（Drive 保存・オートセーブ・リネーム反映・マップ一覧ソート・トークン失効時の再ログイン導線）。OAuth 同意を伴うため自動化していない。
- **PNG エクスポートの目視品質**（寸法・余白は自動検証済み、見た目の質は人間の目）。

## E2E テストを書き足すとき

流儀は [docs/testing.md](docs/testing.md)「テストを書き足すときの流儀」に集約してある。特に外しやすいのは 2 点:

- **テスト本体でない共有モジュールは `e2e/lib/` へ**。`e2e/` 直下は `run-all.mjs` が「`run()` を export するテストファイル」とみなすため、ヘルパを直下に置くと失敗する。
- **陽性確認を省かない**。退行テストを書いたら、修正を一時的に戻した状態（`git stash` 等）で実際に FAIL することを確認する。「常に PASS するテスト」を作った実例が過去にある。

---

## 触る前に確認すべき地雷

- **ストレージキー**（`mindmeshmap-draft` ほか、一覧は [docs/tuning.md](docs/tuning.md)「ストレージキー」）は**既存ユーザーのデータを壊すので原則変更しない**。変える場合は旧キーからのマイグレーションをセットで実装する。Google Drive のフォルダ名 `MindMeshMap` も同様（変えると既存マップが一覧から消える）。
- **ノード編集・IME まわり（armed-focus 方式）**は 3 回目の試行でようやく安定した領域（[decisions.md §13](docs/decisions.md)）。安易に触らず、変えるなら `e2e/ime-input.mjs` / `armed-focus-typing.mjs` を通した上で実 IME の手動確認まで行う。
- **Undo/Redo には既知のバグがある**（連続 2 アクション直後の最初の Undo が 2 ステップ戻る）。原因・再現手順・修正方向は [docs/tuning.md](docs/tuning.md)「既知の未対応事項」に記録済み。触るならインデックス管理の再設計になる、と分かった上で着手する。
- **整列アルゴリズムは現在 `sugiyama-port` が本番既定**（[decisions.md §53](docs/decisions.md)）で、`uniform` / `branch` / `flat-axis` / `sugiyama-ext` / `elk-port` / `elk-port-ext` / `elk-port-pava` / `hola-lite` は比較用に dev 限定 UI で残してある暫定状態。**`sugiyama-port` は `sugiyama-ext` の改善版**（親をハンドルの向きで選ぶ／同列の複数親を許す／cross群の置き場所を現在位置から判定する。[decisions.md §49・§50](docs/decisions.md)）で、既定を移した後も目視比較用に `sugiyama-ext` を残している。**`elk-port-ext` だけは評価軸が違う**（良いスコアではなく `elk-port` と同じ結果になることが目標。`npm run layout:parity` で一致度を測る）。アルゴリズムを追加するときに触る箇所の一覧は [layout-lab.md](docs/layout-lab.md)「拡張のしかた」。どれかに決めたら不採用側のファイル・切り替え UI・関連テストを削除する（[align-branch-layout.md](docs/align-branch-layout.md)「今後の運び」）。勝手に整理も、勝手に既定変更もしない。
- **整列は「ゼロから配置し直さない」差分的レイアウトが仕様**（現在の階層・兄弟順・循環エッジの向きを保つ。[decisions.md §26](docs/decisions.md)）。ここを崩す変更は `e2e/layout-stability.mjs` がドリフト検出で意図的に FAIL する。テストが落ちたら「テストを緩める」のではなく仕様に反していないか先に疑う。
