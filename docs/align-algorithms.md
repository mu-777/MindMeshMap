# 整列アルゴリズムの詳細仕様

現在実装されている6つの整列（Align）アルゴリズムが、**各フェーズで何を入力に取り、何を計算し、何を出力するか**だけを
書いたリファレンス。コードを開かずに手順を追えること、開くときは目的の関数へ直行できることを目的にしている。

- なぜその方式を採ったか・不採用案・今後どれを残すか → [align-branch-layout.md](./align-branch-layout.md)
- 測定結果・評価環境の使い方 → [layout-lab.md](./layout-lab.md)
- 調整定数の索引（現在値） → [tuning.md](./tuning.md)
- グラフ描画分野の一般的な背景 → [graph-drawing-primer.md](./graph-drawing-primer.md) / [layout-prior-art.md](./layout-prior-art.md)

> **実装リンクについて**: 行番号は執筆時点のもの。**安定したアンカーは関数名のほう**なので、
> ずれていたら関数名で検索すること。

| アルゴリズム | 実装ファイル | エントリ関数 | ELK | 一言で |
|---|---|---|---|---|
| `uniform` | [layout.ts](../src/utils/layout.ts) | `calculateLayout` | 1回 | ハンドルを無視してELK layeredに丸投げする |
| `branch` | [branchLayout.ts](../src/utils/branchLayout.ts) | `calculateBranchLayout` | バケット数ぶん | 子をハンドル別に4方向へ分け、部分グラフごとにELKを呼んで箱を再帰合成する |
| `flat-axis` | [flatAxisLayout.ts](../src/utils/flatAxisLayout.ts) | `calculateFlatAxisLayout` | 2回 | 横系エッジだけ・縦系エッジだけでELKを2回まわし、ノードごとにx/yを使い分ける |
| `sugiyama-ext` | [sugiyamaExtLayout.ts](../src/utils/sugiyamaExtLayout.ts) | `calculateSugiyamaExtLayout` | — | スギヤマの層割当をハンドル役割で変える。上/下ハンドルの子を親に被せて上下に置く |
| `elk-port` | [elkPortLayout.ts](../src/utils/elkPortLayout.ts) | `calculateElkPortLayout` | 1回 | `uniform` と同じELK layeredに、ハンドルをポートとして渡す |
| `elk-port-ext` | [elkPortExtLayout.ts](../src/utils/elkPortExtLayout.ts) | `calculateElkPortExtLayout` | — | ポート制約付き階層レイアウトを、ELK非依存で5フェーズに書き下したもの |

---

## 0. 全アルゴリズム共通の土台

### 0.1 入出力

すべて [`calculateLayoutForAlign()`](../src/utils/alignAlgorithm.ts#L14-L34)（ディスパッチャ）から呼ばれ、
同じ型を受け取り同じ型を返す。

```ts
// 入力
nodes: MapNode[]   // { id, content, position:{x,y}, width?, height? }
edges: MapEdge[]   // { id, source, target, sourceHandle?, targetHandle?, label? }
direction: 'RIGHT' | 'DOWN'      // マップの layoutDirection

// 出力
LayoutResult = { nodes: { id: string; position: {x,y} }[] }
```

見落としやすい性質が4つある。

1. **`position` はノードの左上**（中心ではない）。中心が要るアルゴリズムは自分で `+ width/2` する。
2. **`width`/`height` は呼び出し側が実測値を詰めてから渡す**（0.5参照）。無い場合のフォールバックは
   各実装内の定数 `DEFAULT_NODE_WIDTH=180` / `DEFAULT_NODE_HEIGHT=60`。
3. **`position` は「整列前の現在位置」であり、入力の一部**。全アルゴリズムが差分的レイアウト
   （現在の階層・兄弟順をなるべく保つ。[decisions.md §26](./decisions.md)）なので、同じグラフでも
   現在位置が違えば結果が変わる。
4. **返す位置は必ず全ノードぶん**。位置計算から外れたノードは入力位置をそのまま返す。

### 0.2 ハンドル（エッジがノードのどの面から出ているか）

| | |
|---|---|
| 実装 | [`classifyEdgeSide(edge, fallbackDirection)`](../src/utils/branchLayout.ts#L29-L36) |
| 入力 | `MapEdge`、フォールバック用の `LayoutDirection` |
| 出力 | `HandleSide = 'top' \| 'bottom' \| 'left' \| 'right'` |

```
sourceHandle が top/bottom/left/right → そのまま
それ以外（未設定・旧データ）          → RIGHT なら 'right'、DOWN なら 'bottom'
```

`uniform` 以外の全アルゴリズムと評価環境（`e2e/lib/layout-metrics.mjs`）が**この1関数を共用する**。
判定を二重に実装すると、片方だけ変わったときに指標が静かに嘘をつくため。

`targetHandle`（入力側の面）を見るのは `elk-port` と `elk-port-ext` だけ。無効・未設定なら
**ソース面の反対面**（right↔left, top↔bottom）にフォールバックする
（[`resolveTargetSide()`](../src/utils/elkPortLayout.ts#L74-L80) / [`targetSideOf()`](../src/utils/elkPortExtLayout.ts#L105-L111)）。

### 0.3 primary / cross 座標系とハンドル役割

`sugiyama-ext` と `elk-port-ext` は、RIGHT/DOWN の分岐をコード全体に散らさないために座標を読み替える。

| | primary（流れ方向） | cross（直交方向） |
|---|---|---|
| RIGHT | x | y |
| DOWN | y | x |

サイズも同様（RIGHT なら primarySize=width / crossSize=height、DOWN なら逆）。実装は各ファイルの
`primarySize` / `crossSize` / `currentCenterPC` / `centerPCtoTopLeft`
（[sugiyama-ext](../src/utils/sugiyamaExtLayout.ts#L74-L104) / [elk-port-ext](../src/utils/elkPortExtLayout.ts#L114-L128)）。
**この読み替えだけで DOWN が「90度回転した RIGHT」として処理される**ので、方向分岐は座標変換関数の中にしか無い。

ハンドルも方向を基準にした**役割**へ写像する:

| 役割 | RIGHT時のハンドル | DOWN時のハンドル |
|---|---|---|
| `forward`（流れ方向） | right | bottom |
| `backward`（流れの逆） | left | top |
| `crossNeg`（直交・負側） | top | left |
| `crossPos`（直交・正側） | bottom | right |

同じ写像を [`handleRole()`](../src/utils/sugiyamaExtLayout.ts#L47-L71) と
[`portRole()`](../src/utils/elkPortExtLayout.ts#L79-L102) が**それぞれ独立に持っている**。用途が違う
（前者は「役割で層を変える」、後者は「役割で取り付き位置を変える」）ため、どちらかを削除するときに
巻き込まれないよう意図的に共有していない。

### 0.4 ELKへ渡す共通オプション

`uniform` / `branch` / `flat-axis` / `elk-port` はいずれも elkjs の `layered` を使い、方向以外の
オプションを [`ELK_BASE_LAYOUT_OPTIONS`](../src/utils/layout.ts#L14-L26) で共有する。

```
elk.algorithm                             : layered
elk.spacing.nodeNode                      : 50
elk.layered.spacing.nodeNodeBetweenLayers : 80
elk.layered.cycleBreaking.strategy        : INTERACTIVE
elk.layered.layering.strategy             : INTERACTIVE
elk.layered.nodePlacement.strategy        : BRANDES_KOEPF
elk.layered.crossingMinimization.strategy : INTERACTIVE
```

3つの `INTERACTIVE` が差分安定性の本体で、それぞれ**ELKに渡した現在座標をヒントとして使う**:

| オプション | 現在座標の使われ方 |
|---|---|
| `cycleBreaking` | 循環エッジをどちら向きに反転するかを決める |
| `layering` | レイヤー割当を現在位置に寄せる |
| `crossingMinimization` | 層内の並び順を現在の上下（左右）関係で初期化する |

そのため、ELKへ渡す `children` には必ず現在位置を `x`/`y` として載せる。**このオプション値の並びと
位置ヒントの引き渡しを変えると `e2e/layout-stability.mjs` がソーステキストのドリフト検出で意図的に失敗する。**

### 0.5 呼び出し側（アルゴリズムの外側）でやっていること

[`useAutoLayout.applyLayout()`](../src/hooks/useAutoLayout.ts) が2つ。

1. **実測サイズのマージ**: React Flow の `node.measured`（v12）を `MapNode.width/height` に詰めてから渡す。
   `MapNode` 自体には測定値が書き込まれないため、これをしないと全アルゴリズムが 180×60 前提で計算してしまう。
2. **部分整列（2件以上のノードを選択して整列）のときの平行移動**: 選択ノードと「両端が選択内に収まるエッジ」
   だけを部分グラフとして渡し、返ってきた結果の外接矩形の左上が**元の選択範囲の外接矩形の左上**に一致するよう
   平行移動する。アルゴリズムから見れば部分整列は普通のケースと完全に同じ。

マップ全体の整列ではこの平行移動をしないので、**原点付近へ正規化する方式（ELK系）はマップ全体が飛び、
現在位置を基準にする方式（`sugiyama-ext` / `elk-port-ext`）はその場に留まる**、という違いがそのまま画面に出る。

---

## 1. `uniform` — 素の ELK layered

[`calculateLayout()`](../src/utils/layout.ts#L88-L96) は
[`runElkLayout()`](../src/utils/layout.ts#L31-L83) の薄いラッパー。`runElkLayout` は `branch` / `flat-axis`
からも共用される低レベル関数で、`elk.direction` に `UP`/`LEFT` も受け取れる（`branch` がそれを使う）。

```
MapNode[] + MapEdge[] + direction
      ↓  ELKグラフへの変換（ハンドル情報はここで捨てられる）
ElkNode{children[], edges[]}
      ↓  elk.layout()（非同期）
ElkNode{children[] に x,y が入って返る}
      ↓  x,y をそのまま採用
LayoutResult
```

### フェーズ1: ELKグラフの構築

| | |
|---|---|
| 入力 | `nodes: MapNode[]`, `edges: MapEdge[]`, `elkDirection` |
| 出力 | ELKのグラフオブジェクト（`{ id:'root', layoutOptions, children, edges }`） |
| 実装 | [layout.ts#L44-L59](../src/utils/layout.ts#L44-L59) |

```ts
layoutOptions = { ...ELK_BASE_LAYOUT_OPTIONS, 'elk.direction': elkDirection }
children      = { id, width: n.width||180, height: n.height||60, x: n.position.x, y: n.position.y }
edges         = { id, sources:[e.source], targets:[e.target] }
```

**`sourceHandle` / `targetHandle` はこの変換に登場しない**＝ELKに渡る前に捨てられる。

### フェーズ2: ELK実行と結果の取り出し

| | |
|---|---|
| 入力 | 上記グラフ |
| 出力 | `LayoutResult`（`children[].x/y` をそのまま左上座標として採用） |
| 実装 | [layout.ts#L61-L82](../src/utils/layout.ts#L61-L82) |

例外時は `console.error` して**入力位置をそのまま返す**（＝整列が起きない）。端点が `nodes` に無いエッジが
あるとELKが例外を投げるので、この経路に落ちる。

### この手順から言えること

- 全エッジが `elk.direction` の一方向に流される。下ハンドルに繋いだ子でも RIGHT では右隣の層に置かれる。
- ノードの重なりはELKの `spacing` が保証する。
- 結果はELKが原点付近（左上 12,12 あたり）へ正規化する。マップ全体の整列では位置が大きく動く。

---

## 2. `branch` — 再帰的ブランチ合成

```
MapNode[] + MapEdge[] + direction
      ↓  フェーズ1: buildSpanningForest()
{ rootIds: string[], treeChildren: Map<親id, 採用した子エッジ[]> }
      ↓  フェーズ2: computeSubtreeBox()（root ごとにボトムアップ再帰・内部でELKを何度も呼ぶ）
SubtreeBox（root中心のローカル左上座標 + 箱サイズ）
      ↓  フェーズ3: 絶対座標化（単一rootならroot位置基準／複数rootならもう1回ELK）
LayoutResult
```

### 中間データ構造: `SubtreeBox`

[branchLayout.ts#L58-L65](../src/utils/branchLayout.ts#L57-L64)

```ts
interface SubtreeBox {
  width: number;   // 箱の外接矩形の幅（常に非負）
  height: number;
  minX: number;    // 原点(0,0)から見た箱の実際の左上オフセット。
  minY: number;    //   LEFT/UP方向の子孫を持つと負になる＝非対称な箱
  localPositions: Map<nodeId, {x,y}>;  // このノード自身を原点(0,0)とした「左上」座標
}
```

`minX`/`minY` が要るのは、ELKが「position＝左上、サイズは右下方向へ伸びる」箱モデルしか持たないため。
子ノード自身の座標をそのまま位置ヒントに渡すと、左・上方向へのはみ出しが間隔計算に反映されず**兄弟と実際に
重なる**（過去に踏んだバグ）。

### フェーズ1: BFS全域木の構築

| | |
|---|---|
| 入力 | `nodes: MapNode[]`, `edges: MapEdge[]` |
| 出力 | `{ rootIds: string[]; treeChildren: Map<string, MapEdge[]> }` |
| 実装 | [`buildSpanningForest()` branchLayout.ts#L79-L138](../src/utils/branchLayout.ts#L78-L137) |

1ノードが複数の親を持ちうるので「主たる親」を1つ選ぶ。

1. 両端が `nodes` にあるエッジだけで入次数を数える。
2. 出辺の隣接リストを `edges` 配列順で作る（辿り順を決定的にするため）。
3. **入次数0のノード群（`nodes` 配列順）を同時にキューへ積む多元BFS**を回す。入次数0が1つも無ければ
   `nodes[0]` を仮rootにする。各ノードについて**最初に発見された経路の親エッジ**を tree edge にする。
   - 「1つ目のrootの全子孫を辿り切ってから2つ目へ」ではないので、複数親から到達可能なノードは
     **ホップ数が短い側のroot**に割り当たる。
4. それでも未訪問のノードが残ったら（入次数0が存在しない孤立循環成分）、`nodes` 配列順で最初の未訪問ノードを
   仮rootにしてBFSをやり直す。成分の数だけ繰り返す。

tree edge に選ばれなかったエッジ（循環・複数親の非採用側）は**位置計算から除外**される。描画には残る。

### フェーズ2: サブツリー箱のボトムアップ合成

| | |
|---|---|
| 入力 | `nodeId`, `nodesById`, `treeChildren`, `fallbackDirection` |
| 出力 | `SubtreeBox`（自分＋全子孫のローカル座標と箱サイズ） |
| 実装 | [`computeSubtreeBox()` branchLayout.ts#L144-L245](../src/utils/branchLayout.ts#L143-L244) |

1. 自分の位置を `(0,0)` に置き、`localPositions` に入れる。
2. tree edge の子を `classifyEdgeSide` で最大4バケットに分ける。処理順は
   [`SIDES = ['right','bottom','left','top']`](../src/utils/branchLayout.ts#L18)。各バケット内は `edges` 配列順を保つ。
3. バケットごとに:
   1. **バケット内の子を先に再帰**して `SubtreeBox` を確定させる。
   2. 「原子ノード」の配列を組む:

      | | position（ELKへの位置ヒント） | size |
      |---|---|---|
      | 自分自身 | `node.position`（現在の絶対座標） | 実サイズ |
      | 各子 | `childNode.position + (box.minX, box.minY)` = **箱の実際の左上** | `box.width × box.height` |

      位置ヒントを同じ絶対座標系に揃えることで、`INTERACTIVE` 戦略が親と子を一貫して解釈できる。
   3. `runElkLayout(atomicNodes, atomicEdges, sideToElkDirection(side))` を呼ぶ。方向の対応は
      [`sideToElkDirection()`](../src/utils/branchLayout.ts#L38-L49)（`right→RIGHT` / `left→LEFT` / `bottom→DOWN` / `top→UP`）。
   4. 相対オフセットを求める: `offset = childPos - selfPos - (box.minX, box.minY)`
      （渡すときに足した分を引き戻す）。子の箱の `localPositions` 全部にこのオフセットを足して自分の座標系へ統合する。
4. 全バケットを処理したら、`localPositions` と各ノードの**実サイズ**から外接矩形を取り直して
   `width`/`height`/`minX`/`minY` を更新する。

### フェーズ3: 絶対座標化

| | |
|---|---|
| 入力 | `rootIds`, root ごとの `SubtreeBox` |
| 出力 | `LayoutResult` |
| 実装 | [`calculateBranchLayout()` branchLayout.ts#L251-L313](../src/utils/branchLayout.ts#L250-L312) |

- **rootが1つ**: そのrootの現在位置を原点として `localPositions` を平行移動する（**rootは動かない**）。
- **rootが複数（森）**: 各rootの箱を原子ノードにして（位置ヒントは `root.position + box.minX/minY`）
  `runElkLayout(..., direction)` をもう1回呼び、その結果を基準に各ツリーを平行移動する。

### この手順から言えること

- 右の子は右へ、下の子は下へ、と**ハンドルどおりの方向に伸びる**。
- **同一ノードの異なるバケット同士は互いを知らない**（独立した `runElkLayout` 呼び出しなので）。
  right バケットの子孫と bottom バケットの子孫が視覚的に重なることがある、設計に内在する制限。
- ノード1つにつきバケット数ぶんELKを呼ぶので、規模が大きいと呼び出し回数が効いてくる。

---

## 3. `flat-axis` — 2パス軸射影

```
MapNode[] + MapEdge[] + direction
      ↓  フェーズ1: エッジを軸で二分
horizontalEdges[] / verticalEdges[]
      ↓  フェーズ2: 全ノード × 各エッジ集合でELKを2回（並行）
横パスの座標Map / 縦パスの座標Map
      ↓  フェーズ3: ノードごとに支配軸を決めて採用するパスを選ぶ
LayoutResult
```

実装はすべて [`calculateFlatAxisLayout()` flatAxisLayout.ts#L29-L69](../src/utils/flatAxisLayout.ts#L29-L69)。

### フェーズ1: エッジを軸で二分

| | |
|---|---|
| 入力 | `edges: MapEdge[]`, `direction` |
| 出力 | `horizontalEdges: MapEdge[]`, `verticalEdges: MapEdge[]` |
| 実装 | [`sideAxis()` flatAxisLayout.ts#L20-L22](../src/utils/flatAxisLayout.ts#L20-L22) |

`classifyEdgeSide` の結果を `left`/`right` → 横系、`top`/`bottom` → 縦系に落とす。

### フェーズ2: ELKを2回

| | |
|---|---|
| 入力 | **全ノード** × 片方のエッジ集合 |
| 出力 | `Map<nodeId, {x,y}>` を2つ |
| 実装 | [flatAxisLayout.ts#L45-L50](../src/utils/flatAxisLayout.ts#L45-L50)（`Promise.all` で並行） |

- 横系エッジのみ、方向 `RIGHT` 固定
- 縦系エッジのみ、方向 `DOWN` 固定

どちらも全ノードを渡すので、対象外のエッジしか持たないノードは「孤立ノード」として配置される。

### フェーズ3: 支配軸の決定と座標の採用

| | |
|---|---|
| 入力 | 2つの座標Map、`edges`（支配軸の決定に使う） |
| 出力 | `LayoutResult` |
| 実装 | [flatAxisLayout.ts#L52-L68](../src/utils/flatAxisLayout.ts#L52-L68) |

支配軸 = そのノードへの**入エッジのうち `edges` 配列で最初に現れるもの**の軸。入エッジが無いノード（root等）は
マップの `layoutDirection` にフォールバック（RIGHT→横系、DOWN→縦系）。決まった軸に対応するパスの
**x と y の両方**を採用する。

### この手順から言えること

x と y が**別々の最適化結果からの寄せ集め**なので、重なり回避も向きの一致も保証されない。実装量は最小で、
`branch` の再帰合成の複雑さが実際に見合うかを測るベースラインという位置づけ。

---

## 4. `sugiyama-ext` — スギヤマの層割当をハンドル役割で変える

ELKを使わない**完全同期**実装（`await` が1つも無い）。「右ハンドルの子は右の階層へ、上/下ハンドルの子は
**親に少し被せて**上/下へ」を実現するために、ELKでは表現できない「半レイヤーぶんの重なり」を自前で扱う。

```
MapNode[] + MapEdge[] + direction
      ↓  フェーズ1+2: buildLayeredForest()  ※層番号は内部利用のみ
{ rootIds: string[], treeChildren: Map<親id, 主たる親エッジ[]> }
      ↓  フェーズ3+4: layoutSubtree()（root ごとにボトムアップ再帰）
Box（root中心を原点(0,0)とした (primary,cross) 中心座標 + 外接範囲）
      ↓  root の現在中心をアンカーに (p,c)→(x,y) 変換、ツリーごとの外接矩形も算出
ツリーごとの { positions: Map<id,{x,y}>, bbox: Rect }
      ↓  フェーズ5: separateTrees() → 各ツリーの平行移動量
LayoutResult
```

### 中間データ構造: `Box`

[sugiyamaExtLayout.ts#L211-L217](../src/utils/sugiyamaExtLayout.ts#L212-L218)

```ts
interface Box {
  centers: Map<nodeId, { p: number; c: number }>;  // 根の「中心」を原点(0,0)とした各ノードの「中心」
  pMin, pMax: number;   // 箱の外接範囲（primary方向）。根の中心から見た相対値
  cMin, cMax: number;   // 箱の外接範囲（cross方向）
}
```

`SubtreeBox`（`branch`）が**左上**座標なのに対し、こちらは**中心**座標であることに注意。合成は
[`mergeChildBox(parent, child, offP, offC)`](../src/utils/sugiyamaExtLayout.ts#L221-L234) が、子の全 `centers` を
平行移動して親へ取り込み、外接範囲を更新する。

### フェーズ1+2: 循環除去とレイヤー割当（＝主たる親の選択）

| | |
|---|---|
| 入力 | `nodes: MapNode[]`, `edges: MapEdge[]`, `direction` |
| 出力 | `{ rootIds: string[]; treeChildren: Map<string, MapEdge[]> }` |
| 実装 | [`buildLayeredForest()` sugiyamaExtLayout.ts#L129-L207](../src/utils/sugiyamaExtLayout.ts#L130-L208) |

**層番号そのものは返さない。**内部で計算した層は「どの入辺を主たる親にするか」の判定にだけ使い、
外へ出るのは森の構造だけ。座標は次のフェーズが箱の再帰合成で決める。

1. **循環除去（[L146-L161](../src/utils/sugiyamaExtLayout.ts#L147-L162)）**: DFSで**後退辺を除いてDAG化**する。
   訪問中（gray）のノードへ向かう辺が後退辺。DFSの起点は入次数0のノードを `nodes` 配列順に、
   残った孤立循環成分も配列順に拾う。
   - 入力: 出辺隣接リスト（`edges` 配列順）／出力: `dagOut: Map<string, MapEdge[]>`
2. **トポロジカル順（[L163-L178](../src/utils/sugiyamaExtLayout.ts#L164-L179)）**: 決定的Kahn法。
   残りのうち `nodes` 配列順で最初の入次数0を選ぶ（見つからなければ配列順先頭）。
   - 入力: `dagOut`／出力: `topo: string[]`
3. **ロンゲストパスで層を決めつつ親を選ぶ（[L180-L192](../src/utils/sugiyamaExtLayout.ts#L181-L193)）**:
   辺を辿るときの層の増分は[`roleDelta()`](../src/utils/sugiyamaExtLayout.ts#L109-L119)で役割ごとに変える。

   | 役割 | 増分 |
   |---|---|
   | `forward` | +1 |
   | `backward` | -1 |
   | `crossNeg` / `crossPos` | +0.5 |

   `topo` 順に走査し、`候補 = layer[u] + roleDelta(役割)` がそれまでの層より深ければ
   `layer[target]` を更新し**その辺を主たる親にする**。つまり**候補となる親が複数あるときは、
   そのノードの層が最も深くなる辺を選ぶ**。`A1→B1→C1→D1` と `A1→B2→D1` があるとき、
   D1 は浅い B2 ではなく深い C1 の子になる。
   - 入力: `topo`, `dagOut`／出力: `layer: Map<string, number>`（内部利用）, `parentEdge: Map<string, MapEdge|null>`
4. **森の組み立て（[L194-L206](../src/utils/sugiyamaExtLayout.ts#L195-L207)）**: `parentEdge` が null のノードが root。
   それ以外は親の `treeChildren` へ入れる。

`+0.5` は「被せる」ことを表すだけの重みで、座標には直接使われない（実際の被り量はフェーズ4の
`CROSS_OVERLAP_RATIO`）。

### フェーズ3+4: サブツリー箱の再帰合成（交差削減と座標割当を一体で行う）

| | |
|---|---|
| 入力 | `nodeId`, `nodesById`, `treeChildren`, `direction` |
| 出力 | `Box`（自分＋全子孫の中心座標と外接範囲） |
| 実装 | [`layoutSubtree()` sugiyamaExtLayout.ts#L239-L347](../src/utils/sugiyamaExtLayout.ts#L240-L348) |

`w = primarySize(自分)`, `h = crossSize(自分)` と置く。

1. 自分を `(0,0)` に置き、箱を `pMin=-w/2, pMax=w/2, cMin=-h/2, cMax=h/2` で初期化する。
2. 子を `handleRole` で4バケット（`forward`/`backward`/`crossNeg`/`crossPos`）に分ける（[L260-L264](../src/utils/sugiyamaExtLayout.ts#L261-L265)）。
3. **forward群**（[`placeForwardLike(edges, +1)`](../src/utils/sugiyamaExtLayout.ts#L285-L305)）:
   1. **並び順**（[`orderForwardLike()`](../src/utils/sugiyamaExtLayout.ts#L272-L283)）: 子ごとに
      「その子の現在cross座標」と「その子の **forward 孫**たちの現在cross座標」の平均＝バリセンタを求め、昇順に並べる。
   2. 並べた順に**子サブツリーを再帰**して箱を得る。
   3. cross方向に順に積む: 箱の上端が `cursor` に来るよう中心を `cursor - b.cMin` に置き、
      `cursor += (b.cMax - b.cMin) + SIBLING_GAP`。
   4. 群の総cross幅 `totalCross` を求め、全体を `-totalCross/2` だけずらして**親のcross中心(0)へ中央寄せ**する。
   5. primary方向は **箱の後端 `b.pMin` を `+(w/2 + PRIMARY_GAP)` に揃える**
      （オフセット `cP = w/2 + PRIMARY_GAP - b.pMin`）。
4. **backward群**（`placeForwardLike(edges, -1)`）: 同じ処理で、primaryだけ鏡像。
   **箱の前端 `b.pMax` を `-(w/2 + PRIMARY_GAP)` に揃える**。
5. **箱の現在のcross範囲をスナップショット**（[L312-L313](../src/utils/sugiyamaExtLayout.ts#L313-L314)）:
   `middleCMin = box.cMin`, `middleCMax = box.cMax`。この時点では親＋forward/backward群までが入っている。
6. **crossPos群（下/右。[L323-L332](../src/utils/sugiyamaExtLayout.ts#L324-L333)）**:
   - 並び順は現在cross座標の昇順（見た目の上→下）をそのまま保つ（[`orderByCrossAsc()`](../src/utils/sugiyamaExtLayout.ts#L318-L319)）。
   - `nextTop = middleCMax + CROSS_GAP` から**外側へ**順に積む。箱の上端を `nextTop` に合わせ
     （中心 `= nextTop - b.cMin`）、`nextTop = 中心 + b.cMax + CROSS_GAP` で更新。
     **forward群の外から積むので、cross群のサブツリーと forward群のサブツリーは cross方向で重ならない。**
   - primary方向は [`crossChildPrimary()`](../src/utils/sugiyamaExtLayout.ts#L322) で
     **箱の後端を「親の後端 `-w/2` から `w × CROSS_OVERLAP_RATIO` だけ前方」に揃える**
     （`-w/2 + w*ratio - b.pMin`）。これが「親のprimary帯に被せる」の実体。`ratio`=0 なら全被り、1 なら被らない。
7. **crossNeg群（上/左。[L334-L344](../src/utils/sugiyamaExtLayout.ts#L335-L345)）**: crossPos の鏡像。
   `nextBottom = middleCMin - CROSS_GAP` から上へ積む。**見た目の順序を保つため現在cross昇順を反転**して
   （下側の子ほど親に近くなるように）下から積み上げる。箱の下端を `nextBottom` に合わせ（中心 `= nextBottom - b.cMax`）、
   `nextBottom = 中心 + b.cMin - CROSS_GAP` で更新。

### フェーズ5: ツリーの配置と分離

| | |
|---|---|
| 入力 | root ごとの `Box`、各rootの現在中心 |
| 出力 | `LayoutResult` |
| 実装 | [`calculateSugiyamaExtLayout()` sugiyamaExtLayout.ts#L418-L464](../src/utils/sugiyamaExtLayout.ts#L419-L465) |

1. **アンカーと座標変換（[L430-L448](../src/utils/sugiyamaExtLayout.ts#L431-L449)）**: 各rootについて、
   `Box.centers` の各 `(p,c)` に**そのrootの現在中心**を足し、
   [`centerPCtoTopLeft()`](../src/utils/sugiyamaExtLayout.ts#L92-L99) で左上座標へ戻す。
   同時にツリーごとの外接矩形 `Rect` を求める。**rootは動かない**（メンタルマップ保持）。
2. **ツリー間の分離**（[`separateTrees(bboxes)`](../src/utils/sugiyamaExtLayout.ts#L362-L412)）:
   - 入力: `Rect[]`（ツリーごとの外接矩形）／出力: `{dx,dy}[]`（ツリーごとの平行移動量）
   - 各矩形を全周 `TREE_MARGIN/2` だけ膨らませる（実効ギャップ = `TREE_MARGIN`）。
   - 全ペア `(i<j)` を固定順に走査し、重なっているペアを**食い込みが小さい方の軸**に沿って**半分ずつ**押し離す
     （中心の前後関係で押す向きを決める）。
   - 動きが無くなるまで、最大 `TREE_SEPARATION_MAX_ITER` 回繰り返す。
   - **重ならないツリーはオフセット0＝rootが1pxも動かない。**
3. オフセットを各ツリーの全ノードに足して返す。`Box` に入らなかったノードは入力位置のまま。

### この手順から言えること

- 上/下ハンドルの子が親のprimary帯に被り、かつ forward群と cross方向で重ならない。
- rootは（ツリー同士が重ならない限り）現在位置を保つ。
- cross群のサブツリーが**さらに深い階層**で forward側の孫と近接するケースは、各ノード局所での分離しか
  していないため完全には保証されない。

---

## 5. `elk-port` — ELK layered にポートを渡す

`uniform` との差分は**ポート（=React Flowのハンドル）を明示的にELKへ渡すことだけ**。レイアウトオプションと
位置ヒントの渡し方は `uniform` と共有している。実装はすべて
[`calculateElkPortLayout()` elkPortLayout.ts#L86-L157](../src/utils/elkPortLayout.ts#L86-L157)。

```
MapNode[] + MapEdge[] + direction
      ↓  フェーズ1: 端点が揃わないエッジを除外
validEdges[]
      ↓  フェーズ2: エッジごとの取り付き面 → ノードごとの「使われている面」
edgeSides[{source,target}] / usedSides: Map<nodeId, Set<HandleSide>>
      ↓  フェーズ3: ポート付きELKグラフの構築
ElkNode{children[{ports[]}], edges[ポートID参照]}
      ↓  フェーズ4: elk.layout()
LayoutResult
```

### フェーズ1: エッジのフィルタ

| | |
|---|---|
| 入力 | `nodes`, `edges` |
| 出力 | `validEdges: MapEdge[]`（両端が `nodes` に存在するものだけ） |
| 実装 | [elkPortLayout.ts#L95-L97](../src/utils/elkPortLayout.ts#L95-L97) |

`uniform` と違いここで弾かないと、ELKがポートを解決できずレイアウト実行ごと失敗してフォールバック
（＝整列が起きない）に落ちる。

### フェーズ2: 取り付き面の確定

| | |
|---|---|
| 入力 | `validEdges`, `direction` |
| 出力 | `edgeSides: {source, target}[]`（`validEdges` と同じ添字）, `usedSides: Map<nodeId, Set<HandleSide>>` |
| 実装 | [elkPortLayout.ts#L99-L109](../src/utils/elkPortLayout.ts#L99-L109) |

- 出力側 = `classifyEdgeSide(edge, direction)`
- 入力側 = [`resolveTargetSide()`](../src/utils/elkPortLayout.ts#L74-L80)（`targetHandle`、無効ならソース面の反対面）

使われていない面のポートは作らない（空ポートはELKの間隔計算を無駄に膨らませるだけ）。

### フェーズ3: ポート付きELKグラフの構築

| | |
|---|---|
| 入力 | `nodes`, `validEdges`, `edgeSides`, `usedSides` |
| 出力 | ELKのグラフオブジェクト |
| 実装 | [elkPortLayout.ts#L113-L141](../src/utils/elkPortLayout.ts#L113-L141) |

```ts
// ノード（uniform と同じ {id,width,height,x,y} に加えて）
layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' }   // ポートを持つノードだけ
ports: [{ id: `${nodeId}::${side}`, width: 0, height: 0,
          layoutOptions: { 'elk.port.side': PORT_SIDE[side] } }]
// エッジ（ノードIDではなくポートIDを参照する）
{ id, sources: [`${e.source}::${出力面}`], targets: [`${e.target}::${入力面}`] }
```

| 決めごと | 内容 | 実装 |
|---|---|---|
| 面の対応 | top→NORTH / bottom→SOUTH / left→WEST / right→EAST。**描画上の実際の面に1対1**（`elk.direction` に応じた回転はELK側が吸収する） | [`PORT_SIDE`](../src/utils/elkPortLayout.ts#L40-L45) |
| ポートの粒度 | **面ごとに1つ。同じ面から出入りする全エッジがそれを共有する**。React Flowのハンドルも各辺に1つ（`CustomNode.tsx`）なので実描画と同じモデルになる | [L124-L129](../src/utils/elkPortLayout.ts#L125-L133) |
| ポートのサイズ | 0。ポート位置が辺上の1点になり、実際のハンドル位置（辺の中点）と一致する | [`PORT_SIZE`](../src/utils/elkPortLayout.ts#L57) |
| ポートID | `<nodeId>::<side>`。ELKは `sources`/`targets` をノードIDとポートIDのどちらとしても解決するので、ノードIDと衝突しない形にする必要がある（ノードIDは `<epoch>-<英数字>` でコロンを含まない） | [`portId()`](../src/utils/elkPortLayout.ts#L64-L66) |

### フェーズ4: ELK実行

| | |
|---|---|
| 入力 | 上記グラフ |
| 出力 | `LayoutResult` |
| 実装 | [elkPortLayout.ts#L143-L156](../src/utils/elkPortLayout.ts#L143-L156) |

`children[].x/y` をそのまま採用。例外時は入力位置を返す。

### この手順から言えること

- ELKのポート制約は**単一の流れ方向を保ったまま「取り付き面と面内順序」を制御する**仕組みで、
  「上ハンドルの枝だけ流れ方向を上向きに変える」ことはできない。**下ハンドルの子も RIGHT では
  右隣の層に置かれ、エッジだけが下面から出て回り込む。**
- ポート面は層内の順序とノード配置に影響するので、`uniform` とは結果が変わる。
- ELKが計算するエッジの曲げ点は `LayoutResult` に含まれず、アプリは React Flow のベジェで
  ハンドル間を結び直す。**ポート制約の利得のうち「賢い配線」の部分は画面に現れない。**

---

## 6. `elk-port-ext` — ポート制約付き階層レイアウトの自前実装

5と同じ枠組み（単一の流れ方向＋ポートで取り付き面を制約）を、ELKに依存せず5フェーズに書き下したもの
（**完全同期**）。座標は 0.3 の primary/cross で扱う。エントリは
[`calculateElkPortExtLayout()` elkPortExtLayout.ts#L337-L562](../src/utils/elkPortExtLayout.ts#L338-L563)。

```
MapNode[] + MapEdge[] + direction
      ↓  フェーズ1: breakCycles()
dagEdges: {source,target,edge,reversed}[]   ← 必ずDAG
      ↓  フェーズ2: assignLayers()
layerOf: Map<nodeId, number>
      ↓  実ノードのLNode化
lnodes: LNode[]（real=true のみ） / indexOf: Map<nodeId, index>
      ↓  フェーズ3: 仮想ノードで長いエッジを分解
lnodes（仮想ノード追加済み） / ledges: LEdge[]（すべてちょうど1層をまたぐ）
      ↓  索引構築 + 初期順序
layers: number[][] / edgesIntoLayer: LEdge[][] / 各LNodeの order
      ↓  フェーズ4: 交差削減（バリセンタ掃引）
layers（交差最小の順序） / 各LNodeの order
      ↓  フェーズ5: 座標割当（PAVA掃引）
各LNodeの cross
      ↓  primary軸の積み上げ → (p,c)→(x,y) → 入力の外接矩形左上へ平行移動
LayoutResult
```

### 6.0 中間データ構造とポートオフセット

[elkPortExtLayout.ts#L132-L149](../src/utils/elkPortExtLayout.ts#L133-L150)

```ts
interface LNode {
  id: string;          // 実ノードは元のID、仮想ノードは `~dummy~<n>`
  real: boolean;       // false = 仮想ノード（長いエッジの通り道）
  layer: number;
  order: number;       // 層内の位置（0始まり）
  cross: number;       // cross座標（中心）
  crossSize: number;   // 仮想ノードは 0
  primarySize: number; // 仮想ノードは 0
  weight: number;      // 座標割当での優先度。実=1 / 仮想=DUMMY_WEIGHT
}
interface LEdge {
  from: number; to: number;              // LNode の index
  fromOffset: number; toOffset: number;  // 端点のポート位置（ノード中心からの cross方向のずれ）
}
```

**ポートのcrossオフセット**（[`portCrossOffset()`](../src/utils/elkPortExtLayout.ts#L153-L164)）:

| 役割 | crossオフセット |
|---|---|
| `forward` / `backward` | `0`（その面のcross方向の中央に付く） |
| `crossNeg` | `-(crossSize/2 + PORT_STUB)` |
| `crossPos` | `+(crossSize/2 + PORT_STUB)` |

**これがこのアルゴリズムのポート制約の全部**。ELKが北/南ポートのために同じ層へダミーノードを挿入して
確保する空間を、ダミーを実体化せずオフセットで表現している。以降のフェーズ4・5はこのオフセットを
バリセンタ／希望位置の計算に混ぜるだけ。

### 6.1 フェーズ1: 循環除去

| | |
|---|---|
| 入力 | `nodes: MapNode[]`, `edges: MapEdge[]`, `direction` |
| 出力 | `{ source, target, edge, reversed }[]`（`source`→`target` は必ず前進向き） |
| 実装 | [`breakCycles()` elkPortExtLayout.ts#L171-L195](../src/utils/elkPortExtLayout.ts#L172-L196) |

1. 全ノードを**現在のprimary中心**でソートし、同値は `nodes` 配列順で割って**全順序 `rank`** を与える。
2. 各エッジについて `rank[source] > rank[target]` なら向きを反転する（`reversed: true` で記録）。
   両端が `nodes` に無いエッジと自己ループは捨てる。
3. 全順序に沿って向き付けしたので、**結果は必ずDAG**。追加の循環判定が要らないのがこの作り方の利点。

`edge`（元の `MapEdge`）を持ち回すのは、フェーズ3で `sourceHandle`/`targetHandle` を読むため。
**反転したエッジではレイアウト上の from 側が元の target 面になる**ので、面の入れ替えもフェーズ3で行う。

### 6.2 フェーズ2: レイヤー割当

| | |
|---|---|
| 入力 | `nodes`, `dagEdges`, `direction` |
| 出力 | `Map<nodeId, number>`（0始まりの連番。空き番号なし） |
| 実装 | [`assignLayers()` elkPortExtLayout.ts#L203-L244](../src/utils/elkPortExtLayout.ts#L204-L245) |

1. **現在位置から層を作る**（[L208-L228](../src/utils/elkPortExtLayout.ts#L209-L229)）:
   各ノードの現在のprimary区間 `[中心 - primarySize/2, 中心 + primarySize/2]` を求めて左端でソートし、
   順に走査して「直前までの層のprimary範囲と重なっている間は同じ層」に入れる。重ならなくなったら次の層へ。
   **現在の見た目の階層をそのまま層にする＝差分性はここが担保する。**
2. **エッジ制約で押し出す**（[L230-L237](../src/utils/elkPortExtLayout.ts#L231-L238)）:
   [`topoOrder()`](../src/utils/elkPortExtLayout.ts#L248-L272)（決定的Kahn法）の順に走査し、
   `layer[target] = max(layer[target], layer[source] + 1)`。DAGなので1回なめれば収束する。
3. **空き番号を詰める**（[L239-L243](../src/utils/elkPortExtLayout.ts#L240-L244)）。

### 6.3 実ノードのLNode化

| | |
|---|---|
| 入力 | `nodes`, `layerOf`, `direction` |
| 出力 | `lnodes: LNode[]`（`real=true` のみ）, `indexOf: Map<nodeId, index>` |
| 実装 | [elkPortExtLayout.ts#L353-L368](../src/utils/elkPortExtLayout.ts#L354-L369) |

`cross` の初期値は**現在のcross中心**、`weight` は 1。以降フェーズ5までこの `cross` を書き換えていく。

### 6.4 フェーズ3: 仮想ノードで長いエッジを分解

| | |
|---|---|
| 入力 | `dagEdges`, `lnodes`, `indexOf`, `direction` |
| 出力 | `lnodes`（仮想ノード追加済み）, `ledges: LEdge[]`（**すべてちょうど1層をまたぐ**） |
| 実装 | [elkPortExtLayout.ts#L370-L415](../src/utils/elkPortExtLayout.ts#L371-L416) |

エッジごとに:

1. 元の `sourceHandle`/`targetHandle` から面を取り、**反転していれば入れ替える**（[L378-L381](../src/utils/elkPortExtLayout.ts#L379-L382)）。
2. `portRole` → `portCrossOffset` で `fromOffset` / `toOffset` を求める。
3. `span = layer[to] - layer[from]` が 1 以下なら、そのまま1本の `LEdge` にする。
4. `span >= 2` なら**中間層ごとに仮想ノードを1つ挿し、鎖状につなぐ**:
   - 仮想ノードの `cross` 初期値は、両端のポート位置 `from.cross + fromOffset` と `to.cross + toOffset` を
     **層で線形補間**した値。
   - `crossSize=0`, `primarySize=0`, `weight = DUMMY_WEIGHT`。
   - **ポートのオフセットは鎖の両端（実ノード側）にだけ効かせる**。間の仮想ノードは点として扱うので
     オフセット0でつなぐ。

これ以降のフェーズは「すべてのエッジがちょうど1層をまたぐ」前提で書ける。

### 6.5 索引構築と初期順序

| | |
|---|---|
| 入力 | `lnodes`, `ledges` |
| 出力 | `layers: number[][]`（層 → LNode index の並び）, `edgesIntoLayer: LEdge[][]`, 各 `LNode.order` |
| 実装 | [elkPortExtLayout.ts#L417-L442](../src/utils/elkPortExtLayout.ts#L418-L443) |

- `edgesIntoLayer[l]` = 層 `l-1` と層 `l` をつなぐエッジ。
- **初期順序**は `現在のcross座標 + ポートによる偏り` の昇順（同値は LNode 追加順で決定的）。
  偏り = 入辺ごとの `fromOffset - toOffset` の平均。下ハンドルで繋がれた子は正（下寄り）、
  上ハンドルなら負（上寄り）になる。
  **同じ面に繋がった兄弟同士は偏りが等しいので、現在の並び順はそのまま保たれる**
  （差分性を壊さずにポート制約だけを順序へ持ち込む）。

### 6.6 フェーズ4: 交差削減

| | |
|---|---|
| 入力 | `layers`（初期順序）, `edgesIntoLayer`, 各 `LNode.order` |
| 出力 | `layers`（総交差数が最小だった順序）, 各 `LNode.order` |
| 実装 | [elkPortExtLayout.ts#L444-L478](../src/utils/elkPortExtLayout.ts#L445-L479) |

1. 初期順序での総交差数を「最良」として記録する。
   交差数は [`countCrossings()`](../src/utils/elkPortExtLayout.ts#L275-L287) が隣接層ごとに、
   2辺 `a`,`b` について `(order[a.from]-order[b.from]) * (order[a.to]-order[b.to]) < 0` を数える。
2. `ORDERING_SWEEPS` 回、**下向き掃引（層1→末尾）と上向き掃引（末尾-2→0）**を交互に行う。
   各層を [`sortByBarycenter(layerIndex, fromPrev)`](../src/utils/elkPortExtLayout.ts#L452-L467) で並べ替える:

   ```
   下向き（fromPrev=true） : bary = mean( order[le.from] + le.fromOffset / ORDER_PITCH )
   上向き（fromPrev=false）: bary = mean( order[le.to]   + le.toOffset   / ORDER_PITCH )
   ```

   バリセンタは**順序index空間**で計算するので、ポートのオフセット(px)は `ORDER_PITCH`
   （＝1ノードぶんの縦ピッチの目安）で割って「およそ何ノードぶんか」へ換算して足す。
   **つながりが無いノードは現在の order をそのまま使う＝動かない。**
3. 1往復ごとに総交差数を測り、**それまでの最良より小さいときだけ**その順序を控える。
4. 最後に最良の順序を復元する。**初期順序も候補に入っているので、交差が減らないなら現在の並びが保たれる。**

### 6.7 フェーズ5: 座標割当（cross軸）

| | |
|---|---|
| 入力 | `layers`（確定した順序）, `edgesIntoLayer`, 各 `LNode.cross`（現在位置） |
| 出力 | 各 `LNode.cross`（確定した cross座標） |
| 実装 | [elkPortExtLayout.ts#L480-L522](../src/utils/elkPortExtLayout.ts#L481-L523) |

各層の配置を、次の問題として解く。

> 層内の並び順を保ち、隣り合う要素が `gap[i]` 以上離れている、という制約のもとで
> `Σ wᵢ (cᵢ - dᵢ)²` を最小化する中心座標 `c` を求める

| 記号 | 中身 | 実装 |
|---|---|---|
| `gap[i]` | `crossSizeᵢ/2 + crossSizeᵢ₊₁/2 +`（両方が実ノードなら `NODE_GAP`、片方でも仮想なら `LANE_GAP`） | [`gapsFor()`](../src/utils/elkPortExtLayout.ts#L484-L490) |
| `wᵢ` | `LNode.weight`（実=1 / 仮想=`DUMMY_WEIGHT`） | |
| `dᵢ` | 希望位置（下記） | [`placeLayer()`](../src/utils/elkPortExtLayout.ts#L492-L508) |

制約 `cᵢ₊₁ - cᵢ ≥ gap[i]` は `tᵢ = cᵢ -（gapの累積）` と置くと単なる単調非減少になるので、
**等調回帰＝PAVA（pool adjacent violators）で厳密に解ける**
（[`solveOrderedPlacement(desired, weights, gaps)`](../src/utils/elkPortExtLayout.ts#L297-L332)。
入力3配列 → 出力は中心座標の配列）。局所解が無く、掃引回数以外に隠れたパラメータが無いのが利点。

1. **初期配置**（[L507-L516](../src/utils/elkPortExtLayout.ts#L510-L519)）: 希望位置＝現在のcross座標として
   PAVAを1回かけ、**重なりだけ解消する**。
2. **掃引**（[L519-L522](../src/utils/elkPortExtLayout.ts#L520-L523)）: `PLACEMENT_SWEEPS` 回、**前向き掃引（層1→末尾。希望位置を前の層から取る）と
   後ろ向き掃引（末尾-2→0。次の層から取る）**を交互に行う。希望位置は
   **相手側のポート位置に、自分のポートオフセットを打ち消す形で合わせた値**の平均:

   ```
   前向き  : d = lnodes[le.from].cross + le.fromOffset - le.toOffset
   後ろ向き: d = lnodes[le.to].cross   + le.toOffset   - le.fromOffset
   ```

   つながりが無いノードは現在位置を希望位置にする（動かない）。

### 6.8 primary軸と最終変換

| | |
|---|---|
| 入力 | `layers`, 各 `LNode.layer` / `cross` / `primarySize` |
| 出力 | `LayoutResult` |
| 実装 | [elkPortExtLayout.ts#L524-L561](../src/utils/elkPortExtLayout.ts#L525-L562) |

1. **層の積み上げ**: `layerStart[l] = layerStart[l-1] + (層 l-1 の最大primaryサイズ) + LAYER_GAP`。
   層内は**左揃え**（ELKと同じ）＝同じ層のノードは同じ `layerStart` を使う。
2. **実ノードだけ** (primary, cross) → (x, y) へ戻す。左上座標は
   RIGHT なら `{ x: layerStart, y: cross - height/2 }`、DOWN なら `{ x: cross - width/2, y: layerStart }`。
3. **整列後の外接矩形の左上が、入力の外接矩形の左上に一致するよう全体を平行移動する。**
   ELK本体は原点付近へ正規化するためマップ全体が飛ぶが、自前実装ではその必要が無いので元の位置に留める。

### この手順から言えること

- **ノードの重なりは起きない。**層内はフェーズ5が最小間隔を守った配置を厳密に解き、層と層は `LAYER_GAP` で離れる。
- `elk-port` と同じく**流れ方向は単一のまま**。上/下ハンドルの子は cross方向で親の上/下へ引っぱられるが、
  層は前方に進む。
- 仮想ノードが層内で場所を取るので、長いエッジの通り道が確保される。
- フェーズが独立していて入出力も切れているので差し替えやすい（改善の入口は
  [align-branch-layout.md](./align-branch-layout.md)「方針G」）。

---

## 付録A: どのアルゴリズムがどの入力を見るか

| | `sourceHandle` | `targetHandle` | 現在位置 | 実測サイズ | ELK |
|---|---|---|---|---|---|
| `uniform` | — | — | ヒント | ✅ | 1回 |
| `branch` | ✅ | — | ヒント・基準 | ✅ | バケット数ぶん |
| `flat-axis` | ✅ | — | ヒント | ✅ | 2回 |
| `sugiyama-ext` | ✅ | — | 並び順・親選択・基準 | ✅ | — |
| `elk-port` | ✅ | ✅ | ヒント | ✅ | 1回 |
| `elk-port-ext` | ✅ | ✅ | 循環除去・層・並び順・基準 | ✅ | — |

「基準」＝結果の絶対位置がその値を基準に決まる（＝原点付近へ正規化しない）。

## 付録B: 循環・複数親の扱いの違い

すべてのアルゴリズムが「循環エッジと複数親の非採用側を位置計算から除外する（描画は残す）」が、
**どれを除外するかの規則が違う**。

| | 循環の断ち方 | 複数親のどちらを採るか |
|---|---|---|
| `uniform` / `flat-axis` | ELK の `cycleBreaking: INTERACTIVE`（現在座標から向きを決める） | ELK任せ |
| `branch` | BFS で最初に到達した経路だけを木辺にする | **ホップ数が短い側**のroot |
| `sugiyama-ext` | DFS の後退辺を除去 | **層が最も深くなる入辺**（ロンゲストパス） |
| `elk-port` | ELK の `cycleBreaking: INTERACTIVE` | ELK任せ |
| `elk-port-ext` | 現在のprimary順の全順序に対して逆行する辺を**反転**（除外ではない） | 除外しない（全入辺が層と座標に効く） |

評価環境がハンドルの向きを採点するとき、この違いのせいで不公平にならないよう
「targetの入次数が1、かつDFSの後退辺でない」エッジだけを対象にしている
（[layout-lab.md](./layout-lab.md)「ハンドル向きの曖昧さ除外」）。
