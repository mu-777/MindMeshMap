# 整列アルゴリズムの詳細仕様

現在実装されている8つの整列（Align）アルゴリズムが、**各フェーズで何を入力に取り、何を計算し、何を出力するか**だけを
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
| `sugiyama-port` | [sugiyamaPortLayout.ts](../src/utils/sugiyamaPortLayout.ts) | `calculateSugiyamaPortLayout` | — | `sugiyama-ext` 派生。親をハンドルの向きで選び、同列の複数親を許し、cross群を親の隣に置く |
| `elk-port` | [elkPortLayout.ts](../src/utils/elkPortLayout.ts) | `calculateElkPortLayout` | 1回 | `uniform` と同じELK layeredに、ハンドルをポートとして渡す |
| `elk-port-ext` | [elkPortExtLayout.ts](../src/utils/elkPortExtLayout.ts) | `calculateElkPortExtLayout` | — | `elk-port` と同じ結果を出すことを目標に、ELK layeredをELK非依存で再実装したもの |
| `elk-port-pava` | [elkPortPavaLayout.ts](../src/utils/elkPortPavaLayout.ts) | `calculateElkPortPavaLayout` | — | 同じ枠組みをELKに寄せず最小構成で書いた版。座標割当は等調回帰(PAVA)、現在位置を保つ |

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
（[`resolveTargetSide()`](../src/utils/elkPortLayout.ts#L74-L80) / [`targetSideOf()`](../src/utils/elkPortExtLayout.ts#L88-L94)）。

### 0.3 primary / cross 座標系とハンドル役割

`sugiyama-ext` と `elk-port-ext` は、RIGHT/DOWN の分岐をコード全体に散らさないために座標を読み替える。

| | primary（流れ方向） | cross（直交方向） |
|---|---|---|
| RIGHT | x | y |
| DOWN | y | x |

サイズも同様（RIGHT なら primarySize=width / crossSize=height、DOWN なら逆）。実装は各ファイルの
`primarySize` / `crossSize` / `currentCenterPC` / `centerPCtoTopLeft`
（[sugiyama-ext](../src/utils/sugiyamaExtLayout.ts#L74-L104) / [elk-port-ext](../src/utils/elkPortExtLayout.ts#L96-L110)）。
**この読み替えだけで DOWN が「90度回転した RIGHT」として処理される**ので、方向分岐は座標変換関数の中にしか無い。

ハンドルも方向を基準にした**役割**へ写像する:

| 役割 | RIGHT時のハンドル | DOWN時のハンドル |
|---|---|---|
| `forward`（流れ方向） | right | bottom |
| `backward`（流れの逆） | left | top |
| `crossNeg`（直交・負側） | top | left |
| `crossPos`（直交・正側） | bottom | right |

同じ写像を [`handleRole()`](../src/utils/sugiyamaExtLayout.ts#L47-L71) /
[`portRole()`（elk-port-ext）](../src/utils/elkPortExtLayout.ts#L62-L85) /
[`portRole()`（elk-port-pava）](../src/utils/elkPortPavaLayout.ts#L85-L108) の**3つが独立に持っている**。
用途が違う（`handleRole` は「役割で層を変える」、`elk-port-ext` は「役割でダミーを作る」、
`elk-port-pava` は「役割で取り付き位置をずらす」）ため、どれかを削除するときに巻き込まれないよう
意図的に共有していない。

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

## 6. `elk-port-ext` — ELK layered の自前再実装

5（`elk-port`）が elkjs にやらせている計算を、**同じ結果になることを目標に**ELK非依存で書き直したもの
（**完全同期**）。座標は 0.3 の primary/cross で扱う。エントリは
[`calculateElkPortExtLayout()` elkPortExtLayout.ts](../src/utils/elkPortExtLayout.ts)。

**ELK 0.9.1 のソース（EPL-2.0）を読んで書いている**が、移植ではない。「どのクラスが何をしているか」を
読み取ったうえで、このアプリに要る部分だけをベタ書きしてある（ELKの関数・データ型はimportせず、
他アルゴリズムとの共通化のための抽象も持ち込まない）。elkjs 0.9.3 が同梱するのは ELK 0.9.x なので、
参照したのは近いバージョンだが完全に同一のリビジョンではない。

7（`elk-port-pava`）と枠組みは同じだが目標が違う。7は「同じ考え方を素直に書くとどうなるか」、
6は「ELKと同じ答えを出すこと」。したがって6は、素直に書けば選ばないような処理（原点への正規化・
ノード数順の成分パッキング・**交差削減をしないこと**など）もELKに合わせてある。

```
MapNode[] + MapEdge[] + direction
      ↓  フェーズ0: 端点欠け・自己ループの分離、各エッジの取り付き面 → PortRole
prepared: PreparedEdge[] / selfLoops: SelfLoop[]
      ↓  連結成分の分離（Union-Find）
成分ごとに以下を実行:
      ↓  フェーズ1: breakCycles()          … 現在のprimary順で逆行辺を反転
dagEdges: PreparedEdge[]                    ← 必ずDAG
      ↓  フェーズ2: assignLayers()         … 現在のprimary区間で層にまとめ、辺制約で押し出す
layerOf: Map<nodeId, number>
      ↓  フェーズ3a: north/southポートのダミー化
      ↓  フェーズ3b: 長いエッジをダミーの鎖に分解
lnodes: LNode[] / ledges: LEdge[]（すべてちょうど1層をまたぐ）
      ↓  フェーズ4: orderLayersInteractive() … 現在座標で層内を並べ替えるだけ（交差削減はしない）
layers: number[][]
      ↓  フェーズ5: placeBrandesKoepf()    … 4パス＋実行可能で最小幅のパスを採用
各LNodeの cross
      ↓  層のprimary積み上げ（左揃え・LAYER_GAP）
成分ごとの (p,c) 中心座標 + ダミー込みのcross範囲
      ↓  成分パッキング（ノード数順・COMPONENT_GAP）→ (p,c)→(x,y) → 原点+PADDING → 整数丸め
LayoutResult
```

### 6.0 ELKのどの実装に対応しているか

`ELK_BASE_LAYOUT_OPTIONS` が選ぶ実装クラスは次のとおり。**ここを取り違えると「よかれと思った改善」で
ELKから離れる**ので、フェーズを触る前に必ず確認する。

| オプション | ELKが選ぶ実装 | このファイルの対応 |
|---|---|---|
| `cycleBreaking.strategy=INTERACTIVE` | `InteractiveCycleBreaker` | `breakCycles()` |
| `layering.strategy=INTERACTIVE` | `InteractiveLayerer` | `assignLayers()` |
| `crossingMinimization.strategy=INTERACTIVE` | **`InteractiveCrossingMinimizer`** | `orderLayersInteractive()` |
| `nodePlacement.strategy=BRANDES_KOEPF` | `BKNodePlacer` / `BKAligner` / `BKCompactor` | `placeBrandesKoepf()` / `bkPass()` |

**最重要**: `crossingMinimization.strategy=INTERACTIVE` のとき、ELKはバリセンタ掃引を行う
`LayerSweepCrossingMinimizer` を**使わない**。`InteractiveCrossingMinimizer` は
**各層を現在の座標で並べ替えるだけで、交差削減を一切しない**（詳細は 6.6）。

### 6.0.1 実挙動から確定した定数

定数はソースを読むだけでは決まらない（既定値がオプションの組み合わせで変わるため）ので、
**小さなグラフをelkjsに食わせて出力から逆算**して裏を取った
（すべて `elk.direction=RIGHT`、ノード180×60、[layout.ts](../src/utils/layout.ts) の
`ELK_BASE_LAYOUT_OPTIONS` を使用）。

| 観測 | 入力 | ELKの出力 | 読み取れること |
|---|---|---|---|
| 正規化 | 孤立ノード1つを (1000,500) に置く | `(12,12)` | 出力は原点＋`PADDING=12`へ飛ぶ。現在位置は保たれない |
| 層間隔 | `p -right-> c` | `p=(12,12) c=(272,12)` | 272-12-180 = 80 ＝ `LAYER_GAP`。層は左揃え |
| 層内間隔 | 右子2つ | `c1=(272,12) c2=(272,122)` | 122-12-60 = 50 ＝ `NODE_GAP` |
| north/southポート | `p -bottom-> c` | `c=(272,92)` | 子の上端が親の下端＋20。親子の高さを20〜200に振っても常に20 |
| 〃 の内訳 | `elk.spacing.edgeNode` を 40 にする | 20 → 80 | 20 = 2×`EDGE_NODE_GAP`。「大きさ0のダミーを挟み、両側に`edgeNode`ずつ空ける」形 |
| 長いエッジの通り道 | 直鎖＋直通エッジ、`edgeNode` を 0/1/10/100 | 隣接ノードが 43/44/53/143 | 通り道の半幅が0.5＝`EDGE_THICKNESS=1`。出力は整数に丸められている |
| 連結成分 | 2成分 | 成分間の隙間が20 | `COMPONENT_GAP=20`。`elk.separateConnectedComponents` が既定で有効 |
| 成分の順序 | 3ノード木×3＋孤立ノード1（孤立を配列の最後に置く） | 孤立ノードが先頭 | 現在位置でも入力順でもなく**ノード数の少ない順** |
| 座標割当 | 右子2つを持つ親 | 親が下の子と完全に一致 | 4パスの平均（balanced）ではなく**単一パスの値**がそのまま出る |
| 位置の基準 | 高さ200と20のノードを同じ層に置く | 中心の順に並ぶ | `interactiveReferencePoint` の既定は **CENTER**（左上ではない） |

### 6.1 フェーズ0: 前処理とポート面

エッジごとに `classifyEdgeSide()`（source側）と `targetSideOf()`（target側。`targetHandle` が
無効ならsource面の反対面）で取り付き面を決め、`portRole()` で方向基準の役割に変換する
（`forward` / `backward` / `crossNeg` / `crossPos`。対応表は 0.3）。

**自己ループはエッジにはしないが捨てもしない**。ELKは自己ループの両端のポートについてもダミーを作り、
そのぶんノードが押されるため、`SelfLoop` として持ち回ってフェーズ3aでダミーだけ作る。
これを落とすと自己ループを含むケースが一律10pxずれる。

### 6.2 連結成分の分離

Union-Findで成分に分け、**成分ごとに独立にレイアウトしてから積む**（`elk.separateConnectedComponents`
既定=trueに相当）。積む順は**ノード数の少ない順、同数なら入力配列の初出順**で、現在位置は見ない。
成分の外接矩形は**ダミーを含めて**測る（通り道が上端に来ると実ノードがそのぶん内側に入るため）。

### 6.3 フェーズ1: 循環除去 / フェーズ2: レイヤー割当

どちらも現在のprimary座標を基準にするので、「今の階層を保つ」差分性はここで担保される。

**循環除去**（`breakCycles()` / `InteractiveCycleBreaker`）は2段構え:

1. 相手が**厳密に手前**にあるエッジ（targetの中心primary < sourceの中心primary）だけを反転する。
2. それでも残る循環（primaryが同値のノード同士など）を、ノード配列順のDFSで見つけて後退辺を反転する。

7（`elk-port-pava`）のように「全順序を作って逆行辺を全部反転する」ほうが短く書けるが、
それだと**同値のときにも反転してしまう**ためELKと結果が変わる。

**レイヤー割当**（`assignLayers()` / `InteractiveLayerer`）は、現在のprimary区間
`[左端, 右端]` が重なるノードを同じ層にまとめ（＝区間の連結成分）、そのあとエッジが必ず1層以上
前進するように押し出して、空いた層番号を詰める。

### 6.4 フェーズ3a: north/southポートのダミー化

**この方式の中心**。ELKのポート制約は「エッジが上下面に取り付く」ことを、
**そのノード自身の層に大きさ0のダミーを置き、エッジをダミー同士で結ぶ**という形で表現する。

- ダミーは「実ノード＋面」につき**1つ**。同じ面から出る複数のエッジは共有する
  （[elkPortLayout.ts](../src/utils/elkPortLayout.ts) が面ごとに1ポートしか作らないのと同じモデル）。
- `crossNeg`（RIGHT時のtop）なら実ノードの負側、`crossPos`（bottom）なら正側に隣接して置く。
- 実ノードとダミーの最小間隔は `EDGE_NODE_GAP`（10）なので、
  「上下ハンドルの子は親の外側20px（=10×2）から始まる」という観測どおりの結果になる。

`forward` / `backward` のポートはノードのcross中心に付くため、ダミーを作らず実ノードをそのまま端点にする。
結果として**ダミー展開後のエッジはすべて中心同士を結ぶ**ので、フェーズ5は素直な形で書ける。

### 6.5 フェーズ3b: 長いエッジの分解

2層以上をまたぐエッジを、中間層の `longEdge` ダミーの鎖に分解する（`LongEdgeSplitter`）。
ダミーのcrossサイズは `EDGE_THICKNESS`(=1)で、これが「通り道」として層内に場所を取る。

並べ替えキーは後段（6.6）で決まるので、ここでは**元エッジ両端のアンカー位置**をダミーに持たせておく。
アンカーは**ノードの左上**を使う。ELKはここで `LPort.getAbsoluteAnchor()`（= ノード位置 + ポート位置 +
ポートアンカー）を見るが、`FIXED_SIDE` のポート座標が決まるのはフェーズ4の直前なので、
この時点ではポート位置もアンカーも0＝実質ノードの左上になる。面ごとの位置（右端・下端など）を使うと
通り道の上下が入れ替わってELKと結果が変わる。

### 6.6 フェーズ4: 層内の順序決め

**交差削減は一切しない**。`InteractiveCrossingMinimizer` は各層を「現在の座標」で並べ替えるだけで、
バリセンタ掃引も交差カウントも行わない（`LayerSweepCrossingMinimizer` は
`crossingMinimization.strategy=LAYER_SWEEP` のときの実装であって、INTERACTIVEでは選ばれない）。

並べ替えキーは種類ごとに違う:

| 種類 | キー |
|---|---|
| 実ノード | 現在位置の**中心cross**（`interactiveReferencePoint` の既定が CENTER のため） |
| nsPortダミー | 元ノードの**cross方向の端**（負側ダミー＝始端 / 正側ダミー＝終端） |
| longEdgeダミー | 元エッジを、その層の代表primary位置 `pivot` で**線形補間**したcross |

`pivot` は「その層の実ノードのうち、primary始端が**正のもの**だけの中心の平均」。0以下を除くのは
ELKの `if (node.getPosition().x > 0)` をそのまま写したもの（ダミーは入力位置を持たない＝0扱いなので
自然に除外される）。補間は、`pivot` が元エッジの両端より外側なら端の値をそのまま使う。

キーが同値のときは「負側ダミー → 実ノード → 正側ダミー」の順序制約で解く
（ELKの `IN_LAYER_SUCCESSOR_CONSTRAINTS` に相当）。それ以外の同値は元の並び順を保つ。

**ここをバリセンタ掃引にすると交差が 799 → 563 に減ってしまい、ELKから離れる。**
この方式に限り「スコアが良くなる」ことは再現失敗を意味する。

### 6.7 フェーズ5: 座標割当（Brandes–Köpf）

[Brandes & Köpf (2002)](./layout-prior-art.md) を、ELKの `BKNodePlacer` が採っている選択に合わせて実装する。

1. **type-1 conflictのマーキング**（`markType1Conflicts()`）: 内部セグメント（ダミー同士のエッジ）と
   それを跨ぐ非内部セグメントの交差を検出し、後者に印を付ける。印の付いたエッジは整列に使わない
   ＝長いエッジがまっすぐ保たれる。
2. **4パス**（`bkPass()`）: ELKの (hdir, vdir) = (RIGHT,DOWN) (RIGHT,UP) (LEFT,DOWN) (LEFT,UP) の順。
   **hdirが層をなめる向き**（RIGHT=前から/先行ノードに揃える、LEFT=後ろから/後続に揃える）、
   **vdirが層内をなめる向き**。各パスは**垂直整列**（隣接層の中央値の相手に揃えてブロックを作る）→
   **水平圧縮**（ブロック単位に詰める）。4通りは層順・層内順を反転した「見え方」を作って1つの実装で
   回し、層内反転したパスは最後に符号を戻す。
3. **クラス間の圧縮**: 連結していないブロック群（クラス）同士の距離は、原論文の単一 `shift` ではなく
   **クラスグラフの辺**として溜め、入次数0から伝播させて決める（ELKの `placeClasses`）。
   原論文の単純なshiftはノードサイズが一様で連結なグラフを前提にしているため、
   大きさの違うノードや非連結成分があると詰めきれない。
4. **採用**: 4つを平均する「バランス化」は**この構成では使われない**。ELKの条件は
   `produceBalancedLayout = (fixedAlignment==NONE && !favorStraightEdges) || fixedAlignment==BALANCED`
   で、`favorStraightEdges` は `edgeRouting=ORTHOGONAL`（layeredの既定）のとき true になるため。
   したがって**層内の順序・間隔を破っていないパスのうち、広がりが最小のもの**を採る（同値なら先頭優先）。
   広がりは**ブロック単位の外接**で測る（ELKの `layoutSize()`）。座標だけで測るとノードの大きさが
   効かず、別のパスが選ばれてしまう。実測でも、バランス化を有効にすると一致率が 72% → 66% に落ちる。
5. 最後の保険として、層ごとに順序どおりの間隔を復元する（採用した配置が実行可能なら何も動かない）。

### 6.8 primary軸と最終変換

層ごとに「その層の最大primaryサイズ ＋ `LAYER_GAP`」で積み、層内は左揃え。
成分パッキング後、(primary, cross) を (x, y) に戻し、**原点＋`PADDING`(12) へ正規化**して
**整数に丸める**（どちらもELKの挙動に合わせたもので、7とはここが決定的に違う）。

### この手順から言えること

- **ノードの重なりは起きない**（フェーズ5の最後に間隔を復元するため）。
- **整列するとマップ全体が原点付近へ飛ぶ**。ELK本体（`uniform` / `elk-port`）と同じ挙動で、
  現在位置を保つ7（`elk-port-pava`）や `sugiyama-ext` とは対照的。
- `elk-port` と同じく**流れ方向は単一のまま**。上/下ハンドルの子は cross方向で親の外へ押されるが、
  層は前方に進む。
- ELKと**完全一致するのは43ケース中25件・ノード単位で73%**（測定は `npm run layout:parity`、
  読み方は [layout-lab.md](./layout-lab.md)「ELK再現度」）。残差の主因は Brandes–Köpf の
  圧縮まわりの細部で、既知の未実装差分は逆向きポート（`InvertedPortProcessor`）。
- **スコアが `elk-port` より良くなったら、それは再現の失敗**。この方式だけは指標を「近さ」で読む。

---

## 7. `elk-port-pava` — ポート制約付き階層レイアウトの最小構成実装

5と同じ枠組み（単一の流れ方向＋ポートで取り付き面を制約）を、ELKに依存せず5フェーズに書き下したもの
（**完全同期**）。座標は 0.3 の primary/cross で扱う。エントリは
[`calculateElkPortPavaLayout()` elkPortPavaLayout.ts#L343-L568](../src/utils/elkPortPavaLayout.ts#L344-L569)。

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

### 7.0 中間データ構造とポートオフセット

[elkPortPavaLayout.ts#L138-L155](../src/utils/elkPortPavaLayout.ts#L139-L156)

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

**ポートのcrossオフセット**（[`portCrossOffset()`](../src/utils/elkPortPavaLayout.ts#L159-L170)）:

| 役割 | crossオフセット |
|---|---|
| `forward` / `backward` | `0`（その面のcross方向の中央に付く） |
| `crossNeg` | `-(crossSize/2 + PORT_STUB)` |
| `crossPos` | `+(crossSize/2 + PORT_STUB)` |

**これがこのアルゴリズムのポート制約の全部**。ELKが北/南ポートのために同じ層へダミーノードを挿入して
確保する空間を、ダミーを実体化せずオフセットで表現している。以降のフェーズ4・5はこのオフセットを
バリセンタ／希望位置の計算に混ぜるだけ。

### 7.1 フェーズ1: 循環除去

| | |
|---|---|
| 入力 | `nodes: MapNode[]`, `edges: MapEdge[]`, `direction` |
| 出力 | `{ source, target, edge, reversed }[]`（`source`→`target` は必ず前進向き） |
| 実装 | [`breakCycles()` elkPortPavaLayout.ts#L177-L201](../src/utils/elkPortPavaLayout.ts#L178-L202) |

1. 全ノードを**現在のprimary中心**でソートし、同値は `nodes` 配列順で割って**全順序 `rank`** を与える。
2. 各エッジについて `rank[source] > rank[target]` なら向きを反転する（`reversed: true` で記録）。
   両端が `nodes` に無いエッジと自己ループは捨てる。
3. 全順序に沿って向き付けしたので、**結果は必ずDAG**。追加の循環判定が要らないのがこの作り方の利点。

`edge`（元の `MapEdge`）を持ち回すのは、フェーズ3で `sourceHandle`/`targetHandle` を読むため。
**反転したエッジではレイアウト上の from 側が元の target 面になる**ので、面の入れ替えもフェーズ3で行う。

### 7.2 フェーズ2: レイヤー割当

| | |
|---|---|
| 入力 | `nodes`, `dagEdges`, `direction` |
| 出力 | `Map<nodeId, number>`（0始まりの連番。空き番号なし） |
| 実装 | [`assignLayers()` elkPortPavaLayout.ts#L209-L250](../src/utils/elkPortPavaLayout.ts#L210-L251) |

1. **現在位置から層を作る**（[L208-L228](../src/utils/elkPortPavaLayout.ts#L215-L235)）:
   各ノードの現在のprimary区間 `[中心 - primarySize/2, 中心 + primarySize/2]` を求めて左端でソートし、
   順に走査して「直前までの層のprimary範囲と重なっている間は同じ層」に入れる。重ならなくなったら次の層へ。
   **現在の見た目の階層をそのまま層にする＝差分性はここが担保する。**
2. **エッジ制約で押し出す**（[L230-L237](../src/utils/elkPortPavaLayout.ts#L237-L244)）:
   [`topoOrder()`](../src/utils/elkPortPavaLayout.ts#L254-L278)（決定的Kahn法）の順に走査し、
   `layer[target] = max(layer[target], layer[source] + 1)`。DAGなので1回なめれば収束する。
3. **空き番号を詰める**（[L239-L243](../src/utils/elkPortPavaLayout.ts#L246-L250)）。

### 7.3 実ノードのLNode化

| | |
|---|---|
| 入力 | `nodes`, `layerOf`, `direction` |
| 出力 | `lnodes: LNode[]`（`real=true` のみ）, `indexOf: Map<nodeId, index>` |
| 実装 | [elkPortPavaLayout.ts#L359-L374](../src/utils/elkPortPavaLayout.ts#L360-L375) |

`cross` の初期値は**現在のcross中心**、`weight` は 1。以降フェーズ5までこの `cross` を書き換えていく。

### 7.4 フェーズ3: 仮想ノードで長いエッジを分解

| | |
|---|---|
| 入力 | `dagEdges`, `lnodes`, `indexOf`, `direction` |
| 出力 | `lnodes`（仮想ノード追加済み）, `ledges: LEdge[]`（**すべてちょうど1層をまたぐ**） |
| 実装 | [elkPortPavaLayout.ts#L376-L421](../src/utils/elkPortPavaLayout.ts#L377-L422) |

エッジごとに:

1. 元の `sourceHandle`/`targetHandle` から面を取り、**反転していれば入れ替える**（[L378-L381](../src/utils/elkPortPavaLayout.ts#L385-L388)）。
2. `portRole` → `portCrossOffset` で `fromOffset` / `toOffset` を求める。
3. `span = layer[to] - layer[from]` が 1 以下なら、そのまま1本の `LEdge` にする。
4. `span >= 2` なら**中間層ごとに仮想ノードを1つ挿し、鎖状につなぐ**:
   - 仮想ノードの `cross` 初期値は、両端のポート位置 `from.cross + fromOffset` と `to.cross + toOffset` を
     **層で線形補間**した値。
   - `crossSize=0`, `primarySize=0`, `weight = DUMMY_WEIGHT`。
   - **ポートのオフセットは鎖の両端（実ノード側）にだけ効かせる**。間の仮想ノードは点として扱うので
     オフセット0でつなぐ。

これ以降のフェーズは「すべてのエッジがちょうど1層をまたぐ」前提で書ける。

### 7.5 索引構築と初期順序

| | |
|---|---|
| 入力 | `lnodes`, `ledges` |
| 出力 | `layers: number[][]`（層 → LNode index の並び）, `edgesIntoLayer: LEdge[][]`, 各 `LNode.order` |
| 実装 | [elkPortPavaLayout.ts#L423-L448](../src/utils/elkPortPavaLayout.ts#L424-L449) |

- `edgesIntoLayer[l]` = 層 `l-1` と層 `l` をつなぐエッジ。
- **初期順序**は `現在のcross座標 + ポートによる偏り` の昇順（同値は LNode 追加順で決定的）。
  偏り = 入辺ごとの `fromOffset - toOffset` の平均。下ハンドルで繋がれた子は正（下寄り）、
  上ハンドルなら負（上寄り）になる。
  **同じ面に繋がった兄弟同士は偏りが等しいので、現在の並び順はそのまま保たれる**
  （差分性を壊さずにポート制約だけを順序へ持ち込む）。

### 7.6 フェーズ4: 交差削減

| | |
|---|---|
| 入力 | `layers`（初期順序）, `edgesIntoLayer`, 各 `LNode.order` |
| 出力 | `layers`（総交差数が最小だった順序）, 各 `LNode.order` |
| 実装 | [elkPortPavaLayout.ts#L450-L484](../src/utils/elkPortPavaLayout.ts#L451-L485) |

1. 初期順序での総交差数を「最良」として記録する。
   交差数は [`countCrossings()`](../src/utils/elkPortPavaLayout.ts#L281-L293) が隣接層ごとに、
   2辺 `a`,`b` について `(order[a.from]-order[b.from]) * (order[a.to]-order[b.to]) < 0` を数える。
2. `ORDERING_SWEEPS` 回、**下向き掃引（層1→末尾）と上向き掃引（末尾-2→0）**を交互に行う。
   各層を [`sortByBarycenter(layerIndex, fromPrev)`](../src/utils/elkPortPavaLayout.ts#L458-L473) で並べ替える:

   ```
   下向き（fromPrev=true） : bary = mean( order[le.from] + le.fromOffset / ORDER_PITCH )
   上向き（fromPrev=false）: bary = mean( order[le.to]   + le.toOffset   / ORDER_PITCH )
   ```

   バリセンタは**順序index空間**で計算するので、ポートのオフセット(px)は `ORDER_PITCH`
   （＝1ノードぶんの縦ピッチの目安）で割って「およそ何ノードぶんか」へ換算して足す。
   **つながりが無いノードは現在の order をそのまま使う＝動かない。**
3. 1往復ごとに総交差数を測り、**それまでの最良より小さいときだけ**その順序を控える。
4. 最後に最良の順序を復元する。**初期順序も候補に入っているので、交差が減らないなら現在の並びが保たれる。**

### 7.7 フェーズ5: 座標割当（cross軸）

| | |
|---|---|
| 入力 | `layers`（確定した順序）, `edgesIntoLayer`, 各 `LNode.cross`（現在位置） |
| 出力 | 各 `LNode.cross`（確定した cross座標） |
| 実装 | [elkPortPavaLayout.ts#L486-L528](../src/utils/elkPortPavaLayout.ts#L487-L529) |

各層の配置を、次の問題として解く。

> 層内の並び順を保ち、隣り合う要素が `gap[i]` 以上離れている、という制約のもとで
> `Σ wᵢ (cᵢ - dᵢ)²` を最小化する中心座標 `c` を求める

| 記号 | 中身 | 実装 |
|---|---|---|
| `gap[i]` | `crossSizeᵢ/2 + crossSizeᵢ₊₁/2 +`（両方が実ノードなら `NODE_GAP`、片方でも仮想なら `LANE_GAP`） | [`gapsFor()`](../src/utils/elkPortPavaLayout.ts#L490-L496) |
| `wᵢ` | `LNode.weight`（実=1 / 仮想=`DUMMY_WEIGHT`） | |
| `dᵢ` | 希望位置（下記） | [`placeLayer()`](../src/utils/elkPortPavaLayout.ts#L498-L514) |

制約 `cᵢ₊₁ - cᵢ ≥ gap[i]` は `tᵢ = cᵢ -（gapの累積）` と置くと単なる単調非減少になるので、
**等調回帰＝PAVA（pool adjacent violators）で厳密に解ける**
（[`solveOrderedPlacement(desired, weights, gaps)`](../src/utils/elkPortPavaLayout.ts#L303-L338)。
入力3配列 → 出力は中心座標の配列）。局所解が無く、掃引回数以外に隠れたパラメータが無いのが利点。

1. **初期配置**（[L507-L516](../src/utils/elkPortPavaLayout.ts#L516-L525)）: 希望位置＝現在のcross座標として
   PAVAを1回かけ、**重なりだけ解消する**。
2. **掃引**（[L519-L522](../src/utils/elkPortPavaLayout.ts#L526-L529)）: `PLACEMENT_SWEEPS` 回、**前向き掃引（層1→末尾。希望位置を前の層から取る）と
   後ろ向き掃引（末尾-2→0。次の層から取る）**を交互に行う。希望位置は
   **相手側のポート位置に、自分のポートオフセットを打ち消す形で合わせた値**の平均:

   ```
   前向き  : d = lnodes[le.from].cross + le.fromOffset - le.toOffset
   後ろ向き: d = lnodes[le.to].cross   + le.toOffset   - le.fromOffset
   ```

   つながりが無いノードは現在位置を希望位置にする（動かない）。

### 7.8 primary軸と最終変換

| | |
|---|---|
| 入力 | `layers`, 各 `LNode.layer` / `cross` / `primarySize` |
| 出力 | `LayoutResult` |
| 実装 | [elkPortPavaLayout.ts#L530-L567](../src/utils/elkPortPavaLayout.ts#L531-L568) |

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
  [align-branch-layout.md](./align-branch-layout.md)「方針G'」）。

---

## 8. `sugiyama-port` — 親子関係をハンドルの向きから決める（方針Hの `sugiyama-ext` 派生）

`sugiyama-ext`（§4）と**フェーズの骨格は同じ**（循環除去 → 親の選択 → 箱のボトムアップ再帰合成 →
rootアンカー＋ツリー分離、ELK非依存の同期実装）。違うのは次の3点だけで、他は§4を読めばよい。

| | `sugiyama-ext`（§4） | `sugiyama-port`（本節） |
|---|---|---|
| 主たる親の選び方 | ロンゲストパス（最も深い層になる入辺） | **ハンドルの向き**が第一基準（下記 8.1） |
| 同点の親が複数 | 先着1本に決め打ち | **同列の複数親として全部採用**（下記 8.3） |
| バケットの配置順 | forward群 → cross群を常に**その外側**へ | **現在位置から読み取ったパターンで切り替える**（下記 8.2）。親の隣に置く場合はforward群を**primary方向へ逃がす** |

```
MapNode[] + MapEdge[] + direction
      ↓  フェーズ1+2: buildHierarchy()
{ rootIds, ownChildren, sharedChildren, parentsOf, forwardChildIds }
      ↓  フェーズ3+4: layoutSubtree()（root ごとにボトムアップ再帰）
Box（§4と同一の構造）
      ↓  フェーズ5: §4と同一（rootの現在中心をアンカーに変換 → separateTrees）
LayoutResult
```

### 8.1 フェーズ1+2: 循環除去と親の選択

| | |
|---|---|
| 入力 | `nodes`, `edges`, `direction` |
| 出力 | `Hierarchy`（下記） |
| 実装 | [`buildHierarchy()` sugiyamaPortLayout.ts#L174-L318](../src/utils/sugiyamaPortLayout.ts#L174-L318) |

循環除去（DFSで後退辺を除外）とトポロジカル順は§4と同じ。違うのは**入辺の採点**
（[L254-L315](../src/utils/sugiyamaPortLayout.ts#L254-L315)）。トポロジカル順に各ノードを見て、
その**入辺すべてを3要素の辞書式キーで採点し、最大キーの入辺を全部**親にする。

| 順位 | キー | 意味 |
|---|---|---|
| 1 | `inbound` = ターゲット面が `backward` か（RIGHT時: 左ハンドルに入っている） | エッジは「相手の**入り口**の面」に入っているのが正規 |
| 2 | `outbound` = ソース面が `forward` か（RIGHT時: 右ハンドルから出ている） | エッジは「自分の**出口**の面」から出ているのが正規 |
| 3 | `depth` = `layer[source] + layerDelta(...)` | ここまで同点なら§4と同じロンゲストパス |

`layerDelta`（[L136-L146](../src/utils/sugiyamaPortLayout.ts#L136-L146)）は§4の `roleDelta` の拡張で、
**ソース面だけでなくターゲット面も見る**:

| ソース面の役割 | ターゲット面 | 増分 | 意味 |
|---|---|---|---|
| `forward` | 問わず | +1 | 通常の1層前進 |
| `backward` | 問わず | -1 | 1層後退 |
| `crossNeg`/`crossPos` | `backward` | +0.5 | 上/下から出て相手の入り口に入る＝半層ぶん前進（§4と同じ） |
| `crossNeg`/`crossPos` | それ以外 | 0 | 上下に並べただけ＝**同じ層**として扱う |

つまり「右ハンドル → 左ハンドル」が正規の親子関係であるという前提を、キー1・2で明示的に効かせる。
**深さ（キー3）は同点を崩すためだけに使う**ので、「浅いが左ハンドルに入っている親」が
「深いが上ハンドルに入っている親」に勝つ。ここが§4との最大の違い。

出力 `Hierarchy` は次の5つ:

| フィールド | 中身 |
|---|---|
| `rootIds` | 入辺を持たないノード |
| `ownChildren` | 親ID → 単一の親を持つ子の `ParentLink[]`（親のバケットへ入る） |
| `sharedChildren` | ノードID → **そこをLCAとする複数親の子ID[]** |
| `parentsOf` | 子ID → 採用した `ParentLink[]`（1本以上） |
| `forwardChildIds` | 親ID → forward役割で採用された子ID[]（バリセンタ計算用。木の所有関係とは独立） |

`ParentLink = { edge, parentId, childId, role }` で、`role`（ソース面の役割）がそのまま配置バケットになる
（＝ハンドル向きの保証は§4と同じ仕組みで担保される）。

複数親の子の取り付け先は**木の上での最小共通祖先（LCA）**
（[`lcaOf()` L235-L247](../src/utils/sugiyamaPortLayout.ts#L235-L247)）。トポロジカル順に処理するので
子を見る時点で親の木上の位置は確定しており、1パスで決まる。親が別ツリーに散っていてLCAが無い場合は、
先頭の親の普通の子として扱う（＝§4と同じ挙動へフォールバック）。

### 8.2 フェーズ3+4: サブツリー箱の再帰合成

| | |
|---|---|
| 入力 | `nodeId`, `nodesById`, `Hierarchy`, `direction` |
| 出力 | `Box`（§4と同一） |
| 実装 | [`layoutSubtree()` sugiyamaPortLayout.ts#L365-L640](../src/utils/sugiyamaPortLayout.ts#L365-L640) |

**確定させる順番が§4と違う**。自分を `(0,0)` に置いたあと:

0. **cross群（crossNeg / crossPos）ごとに配置パターンを決める**
   （[`crossPlacementMode()` L416-L432](../src/utils/sugiyamaPortLayout.ts#L416-L432)）。判定材料は
   **Align実行時点の現在位置だけ**で、構造は見ない。

   | パターン | 意味 | 扱い |
   |---|---|---|
   | `hug` | 親の補足情報 | 親のすぐ隣を確保し、forward群をprimary方向へ逃がす（1.） |
   | `outside` | 親と並ぶ別の情報 | forward群の外側へ積む（§4と同じ扱い。3.） |

   判定は「そのバケットのうち**親にいちばん近い子**の親側の端」が、
   「親自身の端」と「forward/backward群の**直接の子**の端」のうち外側（＝内側の枠）より
   **外にあるか**。外にあれば `outside`。バケット単位・面ごと（上と下で独立）に決める。
   - **なぜ「いちばん近い子」だけを見るか**: 2番目以降の子は1番目の外側に積まれるので、全員を見ると
     整列後の位置が別パターンに分類され、**Alignを押すたびに2つの配置を往復する**。
   - **なぜ「直接の子」だけか**: 孫まで含めると、深いforward群を持つ親でほぼ常に `hug` になり、
     パターン分けが効かなくなる。
1. **`hug` のcross群（[`placeCrossBucket()` L442-L464](../src/utils/sugiyamaPortLayout.ts#L442-L464)）を最初に置く**。
   親のcross方向の端から `CROSS_GAP` だけ外へ、現在のcross座標の順を保って積む（crossNegは反転して
   親側から積む）。primary方向は§4と同じ「親の帯に被せる」揃えだが、**被り量は2択**:
   その子がforward群の帯（±`fanHalf`）に入り込むなら `CROSS_OVERLAP_RATIO_INSIDE`(0.2)、
   入り込まないなら `CROSS_OVERLAP_RATIO`(0.8)。
   **被りを深くする目的は「forward群を前へ押し出す量を減らすこと」だけ**なので、押し出しが起きない子には
   効かせない。これは同時に、**パターン判定が揺れうるケース（forward群が親より小さいとき）で
   `hug` と `outside` の出力を一致させる**役目も持つ（＝Alignを繰り返しても見た目が変わらない）。
   置いた箱の外接範囲は `crossExtents` に控える。
2. **forward / backward群（[`placeForwardLike()` L481-L524](../src/utils/sugiyamaPortLayout.ts#L481-L524)）**:
   並び順（バリセンタ）とcross方向の積み方・中央寄せは§4と同じ。違いは primary の基準線で、
   **`crossExtents` のどれかと cross方向で重なる子は、その箱の前(後)へ `PRIMARY_GAP` 空けて逃がす**。
   逃がす単位は `ESCAPE_FORWARD_AS_GROUP` で切り替わる: `true` なら**いちばん遠くまで逃げる子に
   合わせて群全員を同じ線へ**（同じ層の兄弟のprimaryが揃う）、`false` なら**実際に重なった子だけ**。
   どちらでも重なりは起きない（同じバケットの兄弟はcross方向で既に分離しているため）。
3. **`outside` のcross群を、親＋forward群の外側へ積む**（§4のcross群と同じ扱い。
   `box.cMax + CROSS_GAP` / `box.cMin - CROSS_GAP` から積む）。forward群の外に出るので、
   **forward群をprimary方向へ押し出さない**＝primary方向に伸びない。
4. **複数親の子（[L534-L637](../src/utils/sugiyamaPortLayout.ts#L534-L637)）を最後に置く**。すべての親が
   同じ箱の中に置き終わっているので、親たちの確定位置から決められる。
   **まず親IDの集合でグループ分けし、集合が同じ子どうしは「同列の兄弟」として1つの群にまとめる**
   （`A→B,A→C` / `B→D,C→D` / `B→E,C→E` の `D`・`E` のように、同じ親を共有する子は兄弟だから）。
   群ごとに:
   - 各子について、親たちが望む「箱の中心位置」と「後端の最小位置」を求める
     （[`sharedAnchor()` L552-L586](../src/utils/sugiyamaPortLayout.ts#L552-L586)）。望む中心は `role` ごとに決まる
     （forward/backward = 親のcross中心、crossNeg/crossPos = 親の端から `CROSS_GAP` 外）。
   - **cross方向**: 群の子を（forward群と同じバリセンタ順で）`SIBLING_GAP` を空けて積み、
     **群全体の中心を「親たちが望む中心」の平均へ合わせる**。
   - **primary方向**: 各子の「後端の最小位置」の最大を基準線にし、そこから
     **cross方向に重なる既配置ノードすべての前へ出るまで押し出す**（2. と同じ「逃がす向きはprimary」の
     原則。逃がす単位も `ESCAPE_FORWARD_AS_GROUP` に従う）。**押し出しの相手は群の外側だけ**で、
     群の中の兄弟同士はcross方向で既に分離しているため相手にしない。

   > **群にまとめずに1つずつ置くと壊れる**: 同じ親を持つ子は同じバリセンタを望むので、
   > 後から置く子が「cross方向で重なるものの前へ逃がす」規則に引っかかり、
   > **並ぶべき兄弟がprimary方向に1層ずつずれていく**（実際に一度そうなった。回帰テストは
   > `e2e/branch-layout-algorithms.mjs` の31b）。
   >
   > **この手順が最後でなければならない**: 親の確定位置を使うので、この箱に属するノードは
   > 3. までに全部置き終わっている必要がある。3. と順序を逆にすると、`outside` のcross群の中に
   > 親がいる子がアンカーを見つけられず、**座標が返らないまま初期位置に取り残されて他のノードと
   > 重なる**（ファズ seed=48 で検出。回帰テストは同ファイルの32c）。

### この手順から言えること

- **ノードの重なりは起きない**（箱どうしの分離は§4と同じ。cross群とforward群、複数親の子は
  「cross方向で重なるならprimary方向へ逃がす」で必ず解消される）。
- **上/下ハンドルの子が親の隣に来るか、forward群の外側に来るかは、Align実行時点の現在位置で決まる**
  （同じグラフでも初期位置が違えば別の配置になる。[layout-lab.md](./layout-lab.md) のケース軸Eと同じ考え方）。
- **判定は整列後の位置でも同じ結果になる**ように作ってあるので、Alignを繰り返しても配置は変わらない。
- **同列の複数親を持つ子は親たちの中間に来る**（どちらか一方の真横に寄らない）。
  **同じ親の集合を共有する子どうしは同じ層に並ぶ**（兄弟として扱われる）。
- 逃がす向きがprimaryなので、**cross方向には広がらない代わりにprimary方向に伸びる**。
  実測の差（面積・貫通・交差）は [layout-lab.md](./layout-lab.md)、判断の経緯は
  [align-branch-layout.md](./align-branch-layout.md)「方針H」。
- cross群のサブツリーが大きいほどforward群が前方へ押し出されるので、
  **cross群は「補足的な小さい情報」である前提**の設計になっている。


---

## 付録A: どのアルゴリズムがどの入力を見るか

| | `sourceHandle` | `targetHandle` | 現在位置 | 実測サイズ | ELK |
|---|---|---|---|---|---|
| `uniform` | — | — | ヒント | ✅ | 1回 |
| `branch` | ✅ | — | ヒント・基準 | ✅ | バケット数ぶん |
| `flat-axis` | ✅ | — | ヒント | ✅ | 2回 |
| `sugiyama-ext` | ✅ | — | 並び順・親選択・基準 | ✅ | — |
| `sugiyama-port` | ✅ | ✅ | 並び順・基準 | ✅ | — |
| `elk-port` | ✅ | ✅ | ヒント | ✅ | 1回 |
| `elk-port-ext` | ✅ | ✅ | 循環除去・層・並び順 | ✅ | — |
| `elk-port-pava` | ✅ | ✅ | 循環除去・層・並び順・基準 | ✅ | — |

「基準」＝結果の絶対位置がその値を基準に決まる（＝原点付近へ正規化しない）。

## 付録B: 循環・複数親の扱いの違い

すべてのアルゴリズムが「循環エッジと複数親の非採用側を位置計算から除外する（描画は残す）」が、
**どれを除外するかの規則が違う**。

| | 循環の断ち方 | 複数親のどちらを採るか |
|---|---|---|
| `uniform` / `flat-axis` | ELK の `cycleBreaking: INTERACTIVE`（現在座標から向きを決める） | ELK任せ |
| `branch` | BFS で最初に到達した経路だけを木辺にする | **ホップ数が短い側**のroot |
| `sugiyama-ext` | DFS の後退辺を除去 | **層が最も深くなる入辺**（ロンゲストパス） |
| `sugiyama-port` | DFS の後退辺を除去 | **ハンドルの向きが正規に近い入辺**（同点なら深さ、それでも同点なら**両方採る**＝複数親を許す） |
| `elk-port` | ELK の `cycleBreaking: INTERACTIVE` | ELK任せ |
| `elk-port-ext` / `elk-port-pava` | 現在のprimary順の全順序に対して逆行する辺を**反転**（除外ではない） | 除外しない（全入辺が層と座標に効く） |

評価環境がハンドルの向きを採点するとき、この違いのせいで不公平にならないよう
「targetの入次数が1、かつDFSの後退辺でない」エッジだけを対象にしている
（[layout-lab.md](./layout-lab.md)「ハンドル向きの曖昧さ除外」）。
