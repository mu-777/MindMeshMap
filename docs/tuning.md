# 調整パラメータ一覧

挙動チューニングの際に変更しうる定数と、その場所・意味の一覧。コードを探さずに調整箇所へ辿り着くためのインデックス。値を変更したらこのドキュメントも更新すること。

設計上の決定事項（なぜこの方式か・不採用案）は [decisions.md](./decisions.md) を参照。
E2Eテスト（挙動を変更した際の回帰確認手段）は [testing.md](./testing.md) を参照。

## 保存・同期

| 定数 | 場所 | 現在値 | 意味 |
|---|---|---|---|
| `DRAFT_SAVE_DEBOUNCE_MS` | `src/stores/mapStore.ts` | 500 | ローカル下書き（localStorage）保存のデバウンス時間（ms） |
| `AUTO_SAVE_DELAY_MS` | `src/hooks/useAutoSave.ts` | 3000 | Google Drive オートセーブのデバウンス時間（ms）。変更が止まってからこの時間後に保存 |
| `LOCAL_AUTO_SAVE_DELAY_MS` | `src/hooks/useLocalAutoSave.ts` | 3000 | この端末（localStorage）への明示保存のオートセーブのデバウンス時間（ms）。`AUTO_SAVE_DELAY_MS`と同値・同思想（未ログイン時、既に名前付き保存済みのマップのみ対象） |
| 履歴上限 | `src/stores/mapStore.ts` の `saveToHistory` | 50 | Undo/Redo の履歴保持件数 |

## レイアウト（整列）

ELKグラフの構築・実行そのものは `src/utils/layout.ts` の低レベル関数 `runElkLayout`（既存の`calculateLayout`はこれを固定方向で呼ぶ薄いラッパー）。決定の経緯（差分的レイアウト・INTERACTIVE戦略）は [decisions.md §26](./decisions.md) を参照。

| 定数 | 現在値 | 意味 |
|---|---|---|
| `elk.spacing.nodeNode` | 50 | 同一レイヤー内のノード間隔（px） |
| `elk.layered.spacing.nodeNodeBetweenLayers` | 80 | レイヤー間の間隔（px） |
| `nodeWidth` / `nodeHeight`（デフォルト引数） | 180 / 60 | ノードの実測サイズ（`n.width`/`n.height`）が無い場合にELKへ渡す概算サイズ（px） |
| 3フェーズの戦略（cycleBreaking / layering / crossingMinimization） | すべて `INTERACTIVE` | 現在のノード座標をヒントに使う差分的整列。値を変えると `e2e/layout-stability.mjs` がドリフト検出で意図的にFAILする（変える場合はテストとdecisions.md §26も同期すること） |

### 整列アルゴリズム（本番=sugiyama-ext・dev限定で切り替え可）

ノードの右側についた子と上/下についた子を別方向でレイアウトする代替アルゴリズム（各方式の計算内容は [align-algorithms.md](./align-algorithms.md)、設計経緯は [align-branch-layout.md](./align-branch-layout.md) 参照）。**本番ビルドの既定は `sugiyama-port`**（暫定採用。[decisions.md §53](./decisions.md)）。`uniform`/`branch`/`flat-axis`/`sugiyama-ext`/`sugiyama-port`/`elk-port`/`elk-port-ext`/`elk-port-pava` の比較切り替えUIは引き続きdev限定で残してある（他候補はまだ削除していない）。

| 項目 | 内容 |
|---|---|
| 切り替えUI | `src/components/Editor/Toolbar.tsx`。デスクトップ表示のみ、`import.meta.env.DEV`が真の場合だけ表示される`<select>`（レイアウト方向selectと整列ボタンの間） |
| 状態管理フック | `src/hooks/useAlignAlgorithmDebug.ts`。`import.meta.env.DEV`が偽なら常に既定の`'sugiyama-port'`（`DEFAULT_ALGORITHM`）を返しsetterは何もしない（UIの出し分けとは独立に、フック自体にもガードを入れている） |
| 保存先 | `localStorage`キー `mindmeshmap-debug-align-algorithm`（`AlignAlgorithm`型の値以外・読み取り失敗時は既定の`'sugiyama-port'`にフォールバック。本番＝dev既定を揃えている） |
| アルゴリズム実装 | `src/utils/branchLayout.ts`（`branch`＝再帰的ブランチ合成）、`src/utils/flatAxisLayout.ts`（`flat-axis`＝2パス軸射影）、`src/utils/sugiyamaExtLayout.ts`（`sugiyama-ext`＝スギヤマ拡張。ELK不使用の自前実装）、`src/utils/sugiyamaPortLayout.ts`（`sugiyama-port`＝そのハンドル起点版。親をハンドルの向きで選び複数親を許す。ELK不使用）、`src/utils/elkPortLayout.ts`（`elk-port`＝ELK layeredのポート制約版）、`src/utils/elkPortExtLayout.ts`（`elk-port-ext`＝ELK layeredの自前再実装。ELK不使用）、`src/utils/elkPortPavaLayout.ts`（`elk-port-pava`＝同じ枠組みの最小構成実装。座標割当はPAVA）、`src/utils/holaLiteLayout.ts`（`hola-lite`＝HOLAの最小構成再実装。層を持たず子を4面へ対称に伸ばす。ELK不使用）、`src/utils/alignAlgorithm.ts`（`calculateLayoutForAlign`：各アルゴリズムを振り分けるディスパッチャ） |
| 統合箇所 | `src/hooks/useAutoLayout.ts`の`applyLayout`（部分整列・全体整列の両方） |
| テスト | `e2e/branch-layout-algorithms.mjs`（各アルゴリズム固有の設計意図を手書きの小さなグラフで確認）、`e2e/layout-quality.mjs`（ケースコーパス×全アルゴリズムの総当たりで不変条件を検証）。どちらもブラウザ不要の純Nodeテスト |
| 評価環境 | `npm run layout:sheet`（`scripts/layout-contact-sheet.mjs`）でコンタクトシート（SVG）と採点表を生成する。**下記の定数を変えたら `node scripts/layout-contact-sheet.mjs --scale --compare` で影響（改善と悪化の両方）を確認し、意図した変更なら `npm run layout:baseline` でベースラインを更新する**（更新しないと回帰テストが失敗する）。広い範囲のランダム検証は `npm run layout:fuzz`。詳細は [layout-lab.md](./layout-lab.md) |

`sugiyama-ext`のチューニング定数（すべて`src/utils/sugiyamaExtLayout.ts`冒頭）:

| 定数 | 現在値 | 意味 |
|---|---|---|
| `PRIMARY_GAP` | 60 | 層と層の間隔（流れ方向、px）。**export済み**。`src/hooks/useNodeCreation.ts`の子ノード作成（`Tab`）でも、親の実測primaryサイズに加える間隔として共有する（[decisions.md §44](./decisions.md)参照） |
| `CROSS_GAP` | 10 | 積み重ねる兄弟の間隔（直交方向、px） |
| `SIBLING_GAP` | 8 | forward/backward群の兄弟サブツリー間の間隔（直交方向、px）。**export済み**。`useNodeCreation.ts`の兄弟ノード作成（`Enter`/`Shift+Enter`）の`boxGap`計算でも共有する（[decisions.md §44](./decisions.md)参照） |
| `CROSS_OVERLAP_RATIO` | 0.8 | 上/下ハンドル子を親の流れ方向の帯にどれだけ被せるか。0=全被り、0.5=前半分に被る、1=被らない |
| `TREE_MARGIN` | 40 | 複数root（複数ツリー）が重なるとき空けるツリー間の最小マージン（px） |
| `TREE_SEPARATION_MAX_ITER` | 200 | ツリー分離（押し離し）反復の上限。通常は数回で収束する |
| `DEFAULT_NODE_WIDTH` / `DEFAULT_NODE_HEIGHT` | 180 / 60 | ノードの実測サイズ（React Flowの`node.measured`）が無い場合のフォールバック既定サイズ（px）。**export済み**。`useNodeCreation.ts`でも実測が取れない場合（新規作成する空ノード等）のフォールバックとして共有する |

`sugiyama-port`のチューニング定数（すべて`src/utils/sugiyamaPortLayout.ts`冒頭）。**定数は`sugiyama-ext`と共有していない**（片方を削除するときに巻き込まれないようにするため。値を揃えるかどうかは方式ごとに判断し、意図的にずらすなら[align-branch-layout.md](./align-branch-layout.md)「方針H」に理由を書く。現在 `CROSS_OVERLAP_RATIO` だけ `sugiyama-ext` の 0.8 と違う値になっている）。

**値の定義は実装の1箇所だけ**にしてある: `CROSS_OVERLAP_RATIO` / `CROSS_OVERLAP_RATIO_INSIDE` / `ESCAPE_FORWARD_AS_GROUP` は `export` してあり、`e2e/branch-layout-algorithms.mjs` は期待値をハードコードせずこれらをimportして計算する。**値を変えるときに直すのは実装とこの表の2箇所だけ**（テストは自動で追従する）:

| 定数 | 現在値 | 意味 |
|---|---|---|
| `PRIMARY_GAP` | 60 | 層と層の間隔（流れ方向、px）。**cross群と重なったforward子を逃がす距離もこれ** |
| `CROSS_GAP` | 10 | 積み重ねる兄弟の間隔（直交方向、px）。**上/下ハンドル子が親から離れる距離そのもの**（方針Hではcross群が親のすぐ隣に来るため） |
| `SIBLING_GAP` | 8 | forward/backward群の兄弟サブツリー間の間隔（直交方向、px） |
| `CROSS_OVERLAP_RATIO`（export） | 0.7 | 上/下ハンドル子を親の流れ方向の帯にどれだけ被せるか。0=全被り、1=被らない。**一律に下げても面積・移動量しか改善せず、エッジのノード貫通は改善しない**（実測は[align-branch-layout.md](./align-branch-layout.md)「方針H」） |
| `CROSS_OVERLAP_RATIO_INSIDE`（export） | 0.2 | 同上。ただし**forward群の帯に入り込む子だけ**に使う値（被りを深くする＝forward群を前へ押し出す量が減る）。押し出しが起きない子には効かせないので、`CROSS_OVERLAP_RATIO` と同じ値にすると「配置パターン判定が曖昧なときに2パターンの出力が一致する」性質（＝Alignの反復で往復しない）は保たれるが、押し出し量の抑制は効かなくなる |
| cross群の配置パターン | （定数ではない） | 上/下ハンドル子を「親のすぐ隣（`hug`）」に置くか「forward群の外側（`outside`）」に置くかは、**Align実行時点の現在位置から自動判定**する（しきい値の定数は無い。判定規則と理由は[decisions.md §50](./decisions.md)、判定量を配置量と揃えて冪等にした経緯は[§57](./decisions.md)）。パターン分けをやめて常に片方にしたい場合は `crossPlacementMode()` の戻り値を固定する |
| `ESCAPE_FORWARD_AS_GROUP`（export） | `true` | cross群と重なったforward子を逃がす単位。`true`=forward群ごと同じ線に揃える（同じ層の兄弟のprimaryが揃うが面積・交差・移動量は悪化）／`false`=実際に重なった子だけ逃がす。**目視比較のための一時的なフラグで、1行で切り替わる**（実測の差は[align-branch-layout.md](./align-branch-layout.md)「方針H」の表。決めたらフラグごと畳む） |
| `TREE_MARGIN` | 40 | 複数root（複数ツリー）が重なるとき空けるツリー間の最小マージン（px） |
| `TREE_SEPARATION_MAX_ITER` | 200 | ツリー分離（押し離し）反復の上限 |
| `DEFAULT_NODE_WIDTH` / `DEFAULT_NODE_HEIGHT` | 180 / 60 | 実測サイズが無い場合のフォールバック既定サイズ（px）。**この方式ではexportしない**（手動ノード作成は`sugiyamaExtLayout.ts`側と共有している） |

`elk-port`のチューニング定数（`src/utils/elkPortLayout.ts`冒頭）:

| 定数 | 現在値 | 意味 |
|---|---|---|
| `PORT_SIZE` | 0 | ELKに渡すポート（=React Flowのハンドル）の大きさ（px）。0ならポート位置が辺上の1点になり、実際のハンドル位置および評価環境のアンカー計算（`e2e/lib/layout-metrics.mjs`の`anchorOf`）と一致する。正の値にするとポートがノードの外側に張り出し、そのぶんレイヤー間隔が広がる |
| `PORT_SIDE` | top→NORTH / bottom→SOUTH / left→WEST / right→EAST | ハンドル面とELKのポート面の対応。`elk.direction`に応じた回転はELK側が吸収するので、描画上の実際の面に1対1で対応させる。取り違えるとコーパス全体のハンドル向き不一致が跳ね上がり、ベースライン回帰テストが検知する |

ELKに渡すレイアウトオプション自体（INTERACTIVE戦略・spacing）は`uniform`と共有している（`src/utils/layout.ts`の`ELK_BASE_LAYOUT_OPTIONS`）。**ここを変えると`uniform`・`branch`・`flat-axis`・`elk-port`のすべてが同時に動く**（かつ`e2e/layout-stability.mjs`がドリフト検出でFAILする）。`elk-port-ext`・`elk-port-pava`・`sugiyama-port`はELKを使わないので影響を受けない（ただし`elk-port-ext`は`ELK_BASE_LAYOUT_OPTIONS`の値を自前の定数として写しているので、あちらを変えたらこちらも合わせる）。

`elk-port-ext`の定数（すべて`src/utils/elkPortExtLayout.ts`冒頭）。**これらは「好みで調整するつまみ」ではなく、`elk-port`（elkjs本体）と同じ結果を出すための再現用の値**なので、変えるとELK再現度（`npm run layout:parity`）が落ちる。対応するELKの実装クラスと観測ケースは[align-algorithms.md](./align-algorithms.md) §6.0、フェーズごとの改善の入口は[align-branch-layout.md](./align-branch-layout.md)「方針G」を先に読むこと:

| 定数 | 現在値 | 対応するELKオプション | 意味 |
|---|---|---|---|
| `LAYER_GAP` | 80 | `nodeNodeBetweenLayers`（明示指定） | 層と層の間隔（primary方向、px） |
| `NODE_GAP` | 50 | `spacing.nodeNode`（明示指定） | 同じ層に並ぶ実ノード同士の最小間隔（cross方向、px） |
| `EDGE_NODE_GAP` | 10 | `spacing.edgeNode`（ELK既定値） | 実ノードとダミーの最小間隔。**上/下ハンドルの子が親の外側から始まる距離（=この2倍）を決める** |
| `EDGE_EDGE_GAP` | 10 | `spacing.edgeEdge`（ELK既定値） | ダミー同士の最小間隔 |
| `COMPONENT_GAP` | 20 | `spacing.componentComponent`（ELK既定値） | 連結成分同士の最小間隔 |
| `PADDING` | 12 | `elk.padding`（ELK既定値） | 正規化後、内容の左上が来る位置 |
| `EDGE_THICKNESS` | 1 | `elk.edgeThickness`（ELK既定値） | 長いエッジのダミーがcross方向に確保する通り道の幅。奇数なので座標が.5刻みになり、最終出力を整数に丸める必要がある |

**このアルゴリズムには交差削減の掃引回数のような「効きを強める」つまみは無い**。`crossingMinimization.strategy=INTERACTIVE` のELKは交差削減自体を行わない（層内を現在座標で並べ替えるだけ）ため、掃引を足すとスコアは良くなるがELKから離れる。詳細は[layout-lab.md](./layout-lab.md)「ELK再現度」の鉄則。

`elk-port-pava`のチューニング定数（すべて`src/utils/elkPortPavaLayout.ts`冒頭）。こちらは
**ELK再現が目的ではないので自由に調整してよい**（改善の入口は[align-branch-layout.md](./align-branch-layout.md)「方針G'」）:

| 定数 | 現在値 | 意味 |
|---|---|---|
| `LAYER_GAP` | 80 | 層と層の間隔（primary方向、px）。ELKの`nodeNodeBetweenLayers`に合わせている |
| `NODE_GAP` | 50 | 同じ層に並ぶ実ノード同士の最小間隔（cross方向、px）。ELKの`nodeNode`に合わせている |
| `LANE_GAP` | 16 | 仮想ノード（長いエッジの通り道）に隣接する部分の最小間隔（cross方向、px）。線1本ぶんの幅しか要らないので実ノード同士より狭い。大きくすると長いエッジの通り道が広く取られ、描画面積が増える |
| `PORT_STUB` | 20 | 直交方向の面（RIGHT時のtop/bottom）に付いたポートの、ノード端からの張り出し量（px）。**大きくすると上/下ハンドルの子が親から強く離れる＝ポート制約の効きが強まる** |
| `PLACEMENT_SWEEPS` | 4 | 座標割当（PAVA）の掃引回数。1回＝前向き＋後ろ向きの1往復 |
| `ORDERING_SWEEPS` | 4 | 交差削減の掃引回数。**0にすると交差削減が丸ごと止まり、兄弟順の反転率が0.045→0.006に改善する代わりに交差209→801・貫通52→229に悪化する**（トレードオフの実測値はalign-branch-layout.md「方針G'」） |
| `DUMMY_WEIGHT` | 8 | 仮想ノードの配置優先度（実ノードを1としたときの重み）。大きいほど長いエッジがまっすぐになる |
| `ORDER_PITCH` | 110（`DEFAULT_NODE_HEIGHT + NODE_GAP`） | 交差削減のバリセンタは順序index空間で計算するため、ポートのcrossオフセット(px)を「およそ何ノードぶんか」へ換算する際の縦ピッチの目安 |

`hola-lite`のチューニング定数（すべて`src/utils/holaLiteLayout.ts`冒頭）。**層を持たない4方向対称の方式なので、sugiyama系の「層の間隔」に相当するのは`GROWTH_GAP`だけ**（改善の入口は[align-branch-layout.md](./align-branch-layout.md)「方針I」）:

| 定数 | 現在値 | 意味 |
|---|---|---|
| `GROWTH_GAP` | 60 | 親と子の間隔（子が伸びる向き、px）。**4面とも同じ値**（方向で非対称にしない）。**export済み**（`e2e/branch-layout-algorithms.mjs`の設計意図テストが期待値に使う）。上げると全方向に間延びし、下げると密になる |
| `SIBLING_GAP` | 8 | 同じ面に並ぶ兄弟サブツリーの箱どうしの間隔（px）。**export済み** |
| `QUADRANT_GAP` | 20 | 別の面へ伸びた群どうし（例: 右の子の群と上の子の群）の間隔（px）。上/下の群を横へ逃がす／外へ押し出すときの余白でもある |
| `COMPONENT_MARGIN` | 40 | 成分（強制フォレスト1本ぶん）の外接矩形どうしの最小マージン（px）。sugiyama系の`TREE_MARGIN`に相当 |
| `SEPARATION_MAX_ITER` | 200 | 成分の押し離し反復の上限。通常は数回で収束する |
| `STRESS_MAX_ITER` | 100 | ストレス最適化（SMACOF）の反復上限。**この段はcoreを含む成分が2つ以上あるときだけ走る**ので、木だけのマップでは0回 |
| `STRESS_EPSILON` | 0.5 | ストレス最適化の打ち切り閾値（1反復の最大移動量, px） |
| `STRESS_LINK_GAP` | 80 | 成分間エッジ1本あたりの理想距離に足す余白（px）。理想距離＝両端の箱の半径（外接円）＋この値。**40に下げると交差27→25の代わりに貫通47→51**（実測。面積はほぼ変わらない） |

いずれかに決まったら、決定記録を`decisions.md`へ移し、不採用側のファイル・この切り替えUI・関連テストを削除する予定（`align-branch-layout.md`「今後の運び」参照）。

**手動でのノード作成（`Enter`/`Shift+Enter`/`Tab`）も上記のPRIMARY_GAP/SIBLING_GAP/DEFAULT_NODE_WIDTH/DEFAULT_NODE_HEIGHTを共有するようになった**（自動整列との間隔の一致。詳細は[decisions.md §44](./decisions.md)）。手動作成用の実測サイズ取得ロジック（`measuredPrimarySize`/`measuredCrossSize`、React Flowの`node.measured`から取得）は`src/hooks/useNodeCreation.ts`冒頭。

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

## UI表示（ツールバー・エッジラベル）

| 定数 | 場所 | 現在値 | 意味 |
|---|---|---|---|
| `TITLE_SIDE_GAP` | `src/components/Editor/Toolbar.tsx` | 16（px） | 中央タイトルのmaxWidthをクランプする際、左右UIグループとの間に追加で確保する余白。詳細は[decisions.md §34](./decisions.md)参照 |
| `EDITING_LABEL_Z_INDEX` | `src/components/Editor/CustomEdge.tsx` | 1500 | 編集中のエッジラベル（input+✕）のz-index。選択中ノードのz-index（≈1000）を確実に上回る値。詳細は[decisions.md §35](./decisions.md)参照 |
| `EDGE_LABEL_INPUT_WIDTH` | `src/components/Editor/CustomEdge.tsx` | 84（px） | 編集中のエッジラベルinputの幅。未指定だとブラウザ既定幅（size=20相当、実測168px）で広すぎるため明示している。エッジラベル入力欄の幅を変えたいときはここだけを変える |
| `CONTEXT_MENU_GAP` | `src/components/Editor/ContextMenu.tsx` | 8（px） | ノードのコンテキストメニューと対象ノード（anchorRect）/ビューポート端との間に空ける余白。詳細は[decisions.md §47](./decisions.md)参照 |

## リッチテキスト（ノード内Tiptapエディタ）

| 定数 | 場所 | 現在値 | 意味 |
|---|---|---|---|
| リンクの色 | `src/index.css` の `.ProseMirror a` | `#63b3ed`（下線あり） | 自動リンク化されたURLの見た目。Tailwind preflightで`a`は`color:inherit`・下線なしになるため明示している。詳細は[decisions.md §42](./decisions.md)参照 |
| リストのpadding/margin | `src/index.css` の `.ProseMirror ul/ol/li` | padding-left: 1.25rem、margin: 0.25rem 0 | 箇条書き/番号付きリストのインデント・行間。typographyプラグイン不使用のためスコープCSSで指定している。詳細は[decisions.md §41](./decisions.md)参照 |

## ノード編集・IME（armed-focus方式）

| 定数 | 場所 | 現在値 | 意味 |
|---|---|---|---|
| `FOCUS_GUARD_FRAMES` | `src/components/Editor/CustomNode.tsx`（`focusWithRetry`、armed・編集モード両方で使用） | 20（フレーム数、≒320ms） | 新規ノード作成直後、フォーカスを監視して奪われたら取り戻し続けるフレーム数。visibility:hidden解除待ち（ダブルクリック作成）とd3-dragのpointerup後のフォーカス奪取（ハンドルドラッグ作成）の両方に対応する。採用理由・背景は[decisions.md §13](./decisions.md)参照 |
| 新規作成ノードの初期content | `src/utils/nodeContent.ts` の `EMPTY_NODE_CONTENT` | 空paragraph | 新規ノードは空（Placeholder表示）。IMEのcompositionを壊す`clearContent`を不要にするための設計。詳細は[decisions.md §13](./decisions.md)参照 |
| onConnectEnd直後のonPaneClick無視期間 | `src/components/Editor/MindMapCanvas.tsx` の `justConnectedRef` リセット `setTimeout` | 300（ms） | ハンドルドラッグでの新規ノード作成直後、pointerupが誘発するonPaneClickによる選択・編集の解除を防ぐためにガードする期間。詳細は[decisions.md §13](./decisions.md)参照 |

## タッチ・マウス操作

| 定数 | 場所 | 現在値 | 意味 |
|---|---|---|---|
| `LONG_PRESS_DURATION` | `src/components/Editor/CustomNode.tsx` / `CustomEdge.tsx` | 500 | ノード/エッジ長押し（コンテキストメニュー表示）の判定時間（ms） |
| `LONG_PRESS_DELAY` | `src/components/Editor/MindMapCanvas.tsx` | 500 | キャンバス空白の長押し（ノード作成）の判定時間（ms） |
| `MOVE_THRESHOLD` | `MindMapCanvas.tsx` / `CustomNode.tsx` のタッチ処理 | 10 | 長押し判定をキャンセルする指の移動量（px） |
| `thresholdX` / `thresholdY` / `offsetStep` | `src/hooks/useNodeCreation.ts` の `adjustPositionToAvoidOverlap` | 150 / 60 / 100 | キーボードでのノード作成時の重複判定しきい値とずらし量（px） |
| `EMPTY_NODE_WIDTH` / `EMPTY_NODE_HEIGHT` | `src/utils/nodeContent.ts` | 150 / 44 | 空ノード（`EMPTY_NODE_CONTENT`）をレンダリングしたときの実寸（px）。`CustomNode` の `min-w-[150px]` と1行ぶんの高さで決まる。ハンドルから backward 側へ引き伸ばして作る新規ノードを「ドロップ点＝forward 面」に置くためのずらし量に使う（[decisions.md §52](./decisions.md)）。`CustomNode` の最小幅・パディング・行高を変えたら測り直す（React Flowノードの boundingBox ÷ ズーム倍率。`e2e/edge-drop-handle-side.mjs` がズレを検出する）。実測サイズ不明時のフォールバックである `DEFAULT_NODE_WIDTH`/`DEFAULT_NODE_HEIGHT`（180/60）とは別物 |

## ストレージキー

**変更すると既存ユーザーのデータ・設定が引き継がれなくなる**ため、原則変更しない。変更する場合は旧キーからのマイグレーションを実装すること。

| キー | ストレージ | 場所 | 内容 |
|---|---|---|---|
| `mindmeshmap-draft` | localStorage | `src/stores/mapStore.ts` | 編集中マップの下書き（map / fileId / isDirty） |
| `mindmeshmap-local-maps` | localStorage | `src/stores/localMapStore.ts` | 未ログイン時に明示保存したマップ一覧（マップIDをキーにした`Record<string, MindMap>`）。Google Driveとは別系統 |
| `mindmeshmap-auth` | sessionStorage | `src/stores/authStore.ts` | 認証状態（トークン・有効期限・ユーザー情報。アイコン画像URLを含む）。タブ単位 |
| `mindmap-keybinds` | localStorage | `src/stores/keybindStore.ts` | キーバインド設定 |
| `mindmap-has-visited` | localStorage | `src/data/defaultMap.ts` | 初回訪問フラグ（デフォルトマップ表示判定） |
| `mindmeshmap-maplist-sort` | localStorage | `src/components/Sidebar/MapList.tsx` | マップ一覧の並び順（`updatedDesc` / `updatedAsc` / `createdDesc` / `createdAsc`） |
| `MindMeshMap`（フォルダ名） | Google Drive | `src/hooks/useGoogleDrive.ts` の `FOLDER_NAME` | マップ保存先フォルダ。変更すると既存マップが一覧から見えなくなる |

## 既知の未対応事項（将来対応の候補）

2026-07 の UX 改善（decisions.md 記載の一連の対応）時点で、認識した上で対応を見送った項目。対応する際はここから消すこと。

- **og:image 未設定**: 詳細は [decisions.md §10](./decisions.md)。1200×630 の PNG 素材を作成したら `index.html` に追加。
- **新規マップの初期文言が英語ハードコード**: `src/stores/mapStore.ts` の新規空マップ作成（`createEmptyMap`）のルートノード `Root Node` とマップ名 `New Map` は i18n されていない。日本語/中国語 UI で新規マップを作ると英語のルートノードになる。（通常のノード作成は空ノード化したため該当しない）
- **整列（`sugiyama-port`）で、Alignの1回目と2回目で配置が変わることがある**:
  cross群（上/下ハンドルの子）の `hug` / `outside` 判定が**cross子ノード本体の位置**を見るのに対し、
  配置は**サブツリーの箱ごと**動かすため、cross子が自分の子をcross方向に持つと
  「箱は親にくっついているのにノード本体は親から遠い」状態になり、2回目の整列で `hug`→`outside` に
  反転する。**3回目以降は安定する**（往復＝振動はしない）。ケースコーパス43件中1件（`f-scale50` で797px）。
  **意図して受け入れた制限**で、判定をサブツリーの箱に揃えれば不動点にできるがエッジのノード貫通が
  91→104 に悪化する。採用理由・不採用にした変種の実測値は [decisions.md §57](./decisions.md)。
  本気で直すなら「配置側もcross子ノード本体を基準にする」（重なり回避の作り直しを伴う）。
- **ノードの色分け・見た目カスタマイズ**: 分類・強調のための色付け機能はない。
- **ノード検索**: ノード数が増えたときにテキストで検索する手段がない。
- **ローカル下書きの複数タブ動作**: 後勝ち（last-write-wins）。詳細は [decisions.md §1](./decisions.md)。
- **連続する2アクション以降、最初のUndo/Redoが1ステップ分ではなく2ステップ分を巻き戻す/やり直すことがある**:
  E2Eテスト（`e2e/text-undo-redo.mjs`）作成中に発見。`src/stores/mapStore.ts`の`undo()`は、
  「まだhistory配列に反映されていない最新状態(`currentMap`)を、Redoで失わないよう
  `history[historyIndex]`へ書き戻してから`historyIndex`を1つ戻す」という設計になっている
  （コード中のコメント参照）。この書き戻しは、直前のアクションが「今回のセッションで最初の
  アクション」の場合（＝`history[historyIndex]`が`saveToHistory()`によって作られた
  現在状態と同一内容の冗長な複製である場合）は正しく動作するが、2つ目以降の連続アクションでは
  `history[historyIndex]`は既に前のアクションの正当な直前スナップショットを保持しているため、
  それを`currentMap`（＝2つ目のアクション後の状態）で上書きしてしまい、1つ前のスナップショットが
  失われる。結果として、2アクション目の直後に最初のUndoを押すと2アクション分（両方）が
  一気に取り消され、1アクション目の状態を経由できない（Redo側も同様に2ステップ分進む）。
  3アクション目以降は、その時点で「まだ配列に反映されていない未フラッシュのアクション」が
  常に1つに保たれるため、以降のUndo/Redoは正しく1ステップずつ動く（問題が起きるのは
  「直近に2つ以上のアクションが連続し、その間Undo/Redoを一度も挟んでいない」瞬間の
  最初の1回のみ）。
  **再現手順**: 空白ダブルクリックでノードを2回連続追加（間にUndo/Redoを挟まない）→
  Ctrl+Zを1回だけ押す → ノードが2個とも消える（1個だけ消えて1アクション目の状態に
  戻ることを期待するはず）。
  **考えられる修正方向**: `undo()`で`history[historyIndex]`を上書きするのではなく、
  `historyIndex + 1`の位置に`currentMap`を追加する（＝`saveToHistory()`と対称的に、
  「現在の生きた状態」を配列の一歩先に積んでから移動する）设計に変更する。ただし
  `redo()`側の境界条件（`history.length - 1`との比較）も合わせて見直す必要があり、
  Undo/Redo全体のインデックス管理を再設計する範囲の変更になるため、今回のE2Eテスト整備
  タスクのスコープでは修正せず、事実の記録のみ行う。
  **対応状況**: 未修正。E2Eテスト（`e2e/text-undo-redo.mjs`）では、この既知の制限を
  回避するため、複数アクション後のUndo/Redoは「1回ごとの正確な歩数」ではなく
  「繰り返せば最終的に収束する」ことのみを検証している。
- **Google Identity Servicesのスクリプトタグが最大4重に読み込まれる**: `useGoogleAuth`（`src/hooks/useGoogleAuth.ts`）は呼び出しごとに独立して `https://accounts.google.com/gsi/client` の `<script>` タグを `document.body` に追加・アンマウント時に除去する。この hook は `GoogleAuthButton` / `useAutoSave`（`App.tsx`） / `useSaveMap`（`Toolbar.tsx`） / `MapList.tsx` の計4箇所から呼ばれており、アプリ起動時に同一スクリプトが最大4回重複してリクエスト・実行されうる。各呼び出しは自分が追加したタグだけを正しくクリーンアップするためリーク（アンマウント後も残り続ける）ではなく、マウント時に一度だけ発生する無駄なネットワーク往復・スクリプト実行コストに留まる。対応するなら「GISスクリプト読み込み」を`useAutoLayout`等と同様の1箇所の共有フック/コンポーネントに集約するのが妥当だが、今回のバッチのスコープ外のため見送った。
