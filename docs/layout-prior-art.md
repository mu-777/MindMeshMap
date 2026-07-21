# 整列問題の先行研究・先行事例（Prior Art / Related Work）

MindMeshMapの「整列（Align）」が解こうとしている問題は、学術界・産業界で**すでに研究・実装されているもの**なのか。
「参考にしたい」という目的で、アプリの問題設定を分解し、それぞれに対応する既存研究・システムを対応づけたレポート。

- 分野全体の教科書的な地図 → [graph-drawing-primer.md](./graph-drawing-primer.md)（グラフ描画入門）
- アプリ側の設計判断・実装 → [decisions.md §26](./decisions.md)（差分安定化）、[align-branch-layout.md](./align-branch-layout.md)（方向混在・4方針）
- この記事は、それらの**背景にある既存研究・製品を、アプリの問題設定に正確に対応づける**ことに特化する

**結論を先に**: MindMeshMapの整列は、思いつきではなく**既存の複数の研究テーマの組み合わせ**にあたる。しかも
最も近い2つ（ポート制約付き階層レイアウト／Sugiyamaのmodel-order安定化）は、**アプリが既に使っている ELK を作った
研究グループ（KIELER、キール大 von Hanxleden 研）から出ている**。＝「参照すべき実装」がすでに依存ライブラリの中にある。

---

## 1. このアプリの問題設定（正確な言語化）

MindMeshMapの整列が満たそうとしている条件を分解すると、次の5つの部分問題になる。

| # | 部分問題 | 具体的にどういうことか |
|---|---|---|
| **P1** | ほぼ木＋交差リンクのグラフ | マインドマップは基本は木（親→子）だが、循環（A→B→C→A）や複数親も許す。「木に少数の余分な辺が付いた有向グラフ」 |
| **P2** | ハンドル（ポート）で方向が決まる | 子がノードのどの**ハンドル**（上/下/左/右）から出ているかで、伸びる向きが変わる（`sugiyama-ext`） |
| **P3** | 1ノードから複数方向へ分岐（混在方向） | 右ハンドルの子は右へ、上/下ハンドルの子は上/下へ。同じ親から**異なる流れ方向**の枝が出る |
| **P4** | 対話的エディタでの随時整列＋差分安定性 | ユーザーが自由に置いた図を、随時「整列」で整える。少しの編集で全体が組み変わらない（メンタルマップ保持） |
| **P5** | 手動配置の意図を尊重 | 完全自動配置ではなく、現在の配置をヒント／制約として使う（自由配置＋整列の併用モデル） |

以下、各部分問題に対応する先行研究・実装を挙げる。

---

## 2. 部分問題ごとの先行研究・先行事例

### P2. ハンドル（ポート）で方向が決まる ← **ポート制約付き階層レイアウト**（最も近い形式的一致）

「エッジがノードのどの面（ポート）から出入りするか」を制約として階層レイアウトに組み込む研究がまさにこれ。

- **Schulze, Spönemann, von Hanxleden, "Drawing Layered Graphs with Port Constraints", Journal of Visual Languages & Computing, 2014.** ★最も近い形式化。データフロー図・回路図のように「端子（ポート）の位置と順序が決まっている」グラフを Sugiyama 枠組みで描く。ポート制約に「どの面に置くか」「面内の順序」のレベルがあり、交差最小化・エッジ配線をポート対応に拡張する。**KIELER の KLay Layered（＝現 ELK の layered）がこの実装**。
- **"Layered Drawing of Undirected Graphs with Generalized Port Constraints", Graph Drawing 2020（[arXiv:2008.10583](https://arxiv.org/abs/2008.10583)）.** ポートを「グループ（プラグのソケットのように連続した塊）」まで一般化した拡張。

**アプリとの関係と重要な注意**: MindMeshMapの「ハンドルで方向が変わる」は、この研究の「ポートで**どの面から出るか**が決まる」と発想が同じ。ただし**ポート制約は、単一の全体流れ方向を保ったまま『エッジの取り付き面と順序』を制御するもの**で、「上ハンドルの枝だけ流れ方向を上向きに変える」ことまではしない。そこは下の P3 の領域。とはいえ、**アプリが使っている ELK はポート制約をネイティブに持っている**（`org.eclipse.elk.port*` 系オプション）ので、`sugiyama-ext` を自前実装する代わりに、少なくとも「ハンドル＝ポートの面指定」の部分は ELK の機能に載せられる可能性がある（→ 第4節）。

### P3. 1ノードから複数方向へ分岐（混在方向） ← **HV-drawing／混在木レイアウト／node placer**

「同じ親から出る枝が、あるものは右、あるものは下」という混在方向の木配置には、古典的な研究と産業的な実装の両方がある。

- **HV-drawing（水平・垂直混在の木描画）**: 各エッジを「右向き水平」か「下向き垂直」のいずれかにし、部分木を**水平合成／垂直合成**で再帰的に配置する分割統治法。面積最小化の理論（Crescenzi・Di Battista・Piperno ら、1990年代）がある。`sugiyama-ext`／`branch` の「子孫を箱にして再帰合成し、向きごとに配置」はこの HV-drawing の発想の一般化。教科書的な解説は Handbook の Tree Drawing 章（[Rusu, "Tree Drawing Algorithms"](https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/trees.pdf)）。
- **yFiles TreeLayout の "node placer"**: 商用ライブラリ yFiles の木レイアウトは、**ノードごとに異なる「配置器（node placer）」**（左右振り分け placer、二列 placer、バス placer など）を差し替えられる。`branch`／`sugiyama-ext` は事実上、独自の node placer を書いているのと同じ。[yFires Tree Layout](https://docs.yworks.com/yfiles-html/dguide/layout/tree_layouts.html)。「部分木を水平か垂直に並べる」`HVTreeLayouter` もこの系譜。
- **XMind の per-branch ストラクチャ／balanced map**: 1つのマップ内で枝ごとに Tree（左/右）・Org（上/下）等の構造を混在できる（[align-branch-layout.md](./align-branch-layout.md) の方針A実例と同じ）。製品レベルでの最も近い一致。
- **OrgChart 系の mixed layout**: 組織図で「非葉ノードは横一列、葉ノードは縦に積む」など、空間節約のために方向を混在させる実装（OrgChart JS 等）。

**アプリとの関係**: P3 は「ポート制約」では届かない、`sugiyama-ext` の核心。学術的には **HV-drawing／混在木**、産業的には **yFiles の node placer／XMind の per-branch 構造**が直接の先行事例。「参照するなら」ここ。

### P4. 随時整列＋差分安定性（メンタルマップ保持） ← **動的グラフ描画／model order**

「編集で少し変わったグラフを、前の絵となるべく似せて描き直す」テーマ。[decisions.md §26](./decisions.md) でやった INTERACTIVE 化はまさにこれ。

- **Misue, Eades, Lai, Sugiyama, "Layout Adjustment and the Mental Map", 1995.** メンタルマップ保持の原典（§26で既に引用）。
- **Beck, Burch, Diehl, Weiskopf, "A Taxonomy and Survey of Dynamic Graph Visualization", Computer Graphics Forum, 2017.** 動的グラフ可視化のサーベイ。ノード位置をなるべく保つ「dynamic stability（動的安定性）」を体系化。分野の地図として最適。
- **Archambault & Purchase, "The 'Map' in the mental map: Experimental results in dynamic graph drawing", Int. J. Human-Computer Studies, 2013.** 「メンタルマップを保つと本当に読みやすくなるのか」を実験で検証した研究。差分安定化の効用の根拠。
- **model order（Sugiyama の順序保存）＝ ELK 由来 ★**:
  - Domrös, Riepe, von Hanxleden, **"Model Order in Sugiyama Layouts"（VISIGRAPP/IVAPP 2023, [SciTePress](https://www.scitepress.org/Papers/2023/116567/116567.pdf)）**
  - **"Preserving Order during Crossing Minimization in Sugiyama Layouts"（IVAPP 2022）**
  - **"Diagram Control and Model Order for Sugiyama Layouts"（2024, [arXiv:2406.11393](https://arxiv.org/html/2406.11393v1)）**
  - これらは「入力の順序（model order）を、循環除去・レイヤー割当・交差最小化のタイブレークや制約として使い、レイアウトを安定・制御可能にする」研究。**ELK Layered の `considerModelOrder` 系オプションの理論的裏付け**であり、アプリが §26 で使った INTERACTIVE 戦略と同じ目的（現在の状態を尊重して安定化）を、別の切り口で提供する。
- **yFiles Incremental / From-Sketch Hierarchical Layout**: 「新規・変更部分だけを既存レイアウトに馴染ませ、残りは動かさない」産業実装。yEd の "Use Drawing as Sketch"。§26 で引用した思想の商用版。

**アプリとの関係**: P4 は§26で一度実装済み。さらに詰めるなら、ELK の model-order 系オプション（`considerModelOrder`）は、INTERACTIVE と併用/代替できる同じ ELK 由来の道具。

### P5. 手動配置の意図を尊重（自由配置＋整列） ← **制約ベース対話的オーサリング**

「ユーザーが置いた図を壊さず、制約を満たしながら整える」対話的エディタの研究。

- **Dwyer, Marriott, Wybrow, "Dunnart: A Constraint-Based Network Diagram Authoring Tool", Graph Drawing 2008/2009（[プロジェクト](https://users.monash.edu/~mwybrow/dunnart/)）.** ★アプリの操作モデルに非常に近い。整列・分布などの**配置制約**でスタイルを保ちつつ、ユーザーの操作に応じて**連続的にレイアウトを調整**し、**トポロジとメンタルマップを保持**する図オーサリングツール。
- **Dwyer, Marriott, Wybrow, "Topology-Preserving Constrained Graph Layout", Graph Drawing 2008.** 上の理論的核。ユーザーが見ている「どれがどれの上/左にあるか」を壊さずに再配置する。
- **IPSEP-COLA / WebCola**（[align-branch-layout.md](./align-branch-layout.md) 方針D）: 分離制約付きの安定レイアウト。制約ベース路線の実装。

### P1. ほぼ木＋交差リンクのグラフ ← **木描画＋compound/clustered graph**

- 木の中核: Reingold–Tilford、Buchheim ら（[graph-drawing-primer.md §4-C](./graph-drawing-primer.md)）。マインドマップ向けの**放射状（radial）／balloon** 変種もある（D3 の radial tidy tree 等）。
- 交差リンク・入れ子: Eades & Feng の compound/clustered graph（primer §4-A、方針Aの原典）。
- 循環: Sugiyama フェーズ1の循環除去（primer §4-B）。

---

## 3. 「まず参照すべき」最有力（近い順）

1. **ポート制約付き階層レイアウト**（Schulze/Spönemann/von Hanxleden 2014）＋ **ELK のポート機能** — P2の直撃。しかも実装が手元の ELK。
2. **Sugiyama の model order**（Domrös/von Hanxleden ら 2022–2024）＋ **ELK の `considerModelOrder`** — P4の直撃。これも手元の ELK。
3. **Dunnart / Topology-Preserving Constrained Layout**（Dwyer/Marriott/Wybrow 2008）— P5（自由配置＋整列＋安定）の操作モデルが最も近い。
4. **HV-drawing／yFiles node placer／XMind per-branch** — P3（混在方向）の先行事例。`sugiyama-ext` の位置づけ。

---

## 4. 実装への示唆（actionable）

- **「ハンドル＝ポート」は ELK にネイティブ機能がある**。`sugiyama-ext` はポート制約を自前で書き直している面がある。少なくとも「どの面からエッジが出るか／面内順序」は ELK のポート制約で表現でき、交差最小化・配線もポート対応版が動く。ただし**「上/下の枝だけ流れ方向を変える」P3 の部分は ELK のポート制約だけでは実現できない**（ポート制約は単一流れ方向を前提）。ここは HV-drawing／node placer 的な再帰合成が要る、という現状の判断（方針A/E）は妥当。
- **安定性（§26）は ELK の `considerModelOrder` でも追える**。現在の INTERACTIVE 戦略に加えて model-order 系オプションを検討すると、同じ ELK 由来の理論でさらに制御しやすくなる可能性。
- **`sugiyama-ext` は学術的には「ポート制約付き Sugiyama」と「HV-drawing（混在木）」のハイブリッド**、と位置づけられる。完全に新規ではなく、既存2テーマの組み合わせ。設計の妥当性の裏づけになり、用語で検索して既存の交差最小化・配線テクニックを借りられる。
- **操作モデル全体（自由配置＋随時整列＋安定）は Dunnart が最も近い先行事例**。UX 設計（どこまで自動化し、どこをユーザーに委ねるか）で迷ったら Dunnart の論文・デモが参考になる。

---

## 5. 参考文献

**ポート制約付き階層レイアウト（P2）**
- Schulze, Spönemann, von Hanxleden, "Drawing Layered Graphs with Port Constraints," *J. Visual Languages & Computing*, 2014.
- "Layered Drawing of Undirected Graphs with Generalized Port Constraints," *Graph Drawing* 2020, [arXiv:2008.10583](https://arxiv.org/abs/2008.10583).

**混在方向・木レイアウト（P3）**
- Crescenzi, Di Battista, Piperno ら, HV-drawing（水平垂直混在の木描画、最小面積）1990年代。概説: [Rusu, "Tree Drawing Algorithms," Handbook of Graph Drawing and Visualization, ch.5](https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/trees.pdf).
- yFiles: [Tree Layouts / node placers](https://docs.yworks.com/yfiles-html/dguide/layout/tree_layouts.html).
- XMind: [per-branch structure](https://xmind.com/user-guide/structure-new).

**動的グラフ描画・安定性・model order（P4）**
- Misue, Eades, Lai, Sugiyama, "Layout Adjustment and the Mental Map," *J. Visual Languages & Computing*, 1995.
- Beck, Burch, Diehl, Weiskopf, "A Taxonomy and Survey of Dynamic Graph Visualization," *Computer Graphics Forum* 36(1), 2017.
- Archambault, Purchase, "The 'Map' in the mental map: Experimental results in dynamic graph drawing," *Int. J. Human-Computer Studies* 71(11), 2013.
- Domrös, Riepe, von Hanxleden, "Model Order in Sugiyama Layouts," *VISIGRAPP/IVAPP* 2023, [SciTePress](https://www.scitepress.org/Papers/2023/116567/116567.pdf).
- "Preserving Order during Crossing Minimization in Sugiyama Layouts," *IVAPP* 2022.
- "Diagram Control and Model Order for Sugiyama Layouts," 2024, [arXiv:2406.11393](https://arxiv.org/abs/2406.11393).

**制約ベース対話的オーサリング（P5）**
- Dwyer, Marriott, Wybrow, "Dunnart: A Constraint-Based Network Diagram Authoring Tool," *Graph Drawing* 2008. [プロジェクト](https://users.monash.edu/~mwybrow/dunnart/).
- Dwyer, Marriott, Wybrow, "Topology-Preserving Constrained Graph Layout," *Graph Drawing* 2008.
- Dwyer, Koren, Marriott, "IPSEP-CoLa: An Incremental Procedure for Separation Constraint Layout of Graphs," *IEEE TVCG*, 2006. 実装: [WebCola](https://github.com/tgdwyer/WebCola).

**ツール・ライブラリ**
- [Eclipse Layout Kernel (ELK)](https://eclipse.dev/elk/)（KIELER 由来。ポート制約・model order の実装元）
- [yFiles](https://www.yfiles.com/)（incremental/from-sketch、node placer）
