# 循環・ポート考慮の階層的グラフ描画（HV-drawing）に関するリサーチレポート

## 関心事の再定義と用語の注意

求められている問題設定は、次の3つの制約を同時に満たす階層的グラフ描画である。

1. **階層的（layered / hierarchical）描画**であること
2. **循環（cycles）を含むグラフ**を扱えること
3. **エッジがノードの上下左右のどのポート（port）につながるか**を考慮すること

まず重要な注意として、グラフ描画の学術文献では **「HV-drawing」は特定の狭い意味で使われる**。グラフ描画ハンドブック等の文献上の定義では、HV-drawing とは「二分木の upward orthogonal straight-line 描画で、各ノードの部分木の描画が水平または垂直の直線で分離されるもの」である（[*Handbook of Graph Drawing and Visualization*, Ch.55](https://www.csun.edu/~ctoth/Handbook/chap55.pdf); [Brown Univ. グラフ描画ハンドブック](https://cs.brown.edu/people/rtamassi/papers/ordal96/ordal96.html)）。つまり学術的には HV-drawing は **木（tree）向けの概念**であり、一般の循環含む有向グラフの階層描画を指す用語ではない。

したがって本レポートでは、ユーザの意図する「上下左右ポート考慮＋循環含む＋階層的」な問題を、学術・実用の双方で最も近く語彙として、以下の3系譜の交差点として扱う。

- **階層的描画の系譜**（Sugiyama 枠組み）
- **直交（orthogonal / Manhattan）エッジルーティングの系譜**（HV = Horizontal–Vertical 線分でエッジを描くこと）
- **ポート制約（port constraints）付き描画の系譜**

> 「HV」を読み替えるポイント：ユーザの言う「HV-drawing」は、エッジを水平・垂直線分（HVセグメント）で描く**直交描画（orthogonal drawing）**の意味合いが強い。これは [Tamassia, *Handbook*, Orthogonal Ch.](https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/orthogonal.pdf) が述べる通り「エッジを垂直・水平線分のみで描く」スタイルであり、ノード次数が4以下という制約を持つ（点ノードの場合）。ポート制約と組み合わせた直交ルーティングは、本問題の中核技術となる。

---

## アプローチの系譜マップ（概観）

```
                    階層的グラフ描画
                          │
              ┌───────────┴────────────┐
        Sugiyama 枠組み (1981)      直交描画 (Tamassia 流)
        4フェーズ・DAG前提            HVセグメント・次数≦4
              │                            │
     ┌────────┼────────┐              ポート制約付き
  循環の扱い  層割当  交差削減      直交ルーティング
     │        │        │                    │
  ┌──┴──┐  Longest   Barycenter      Rüegg, Schulze,
cycle  cyclic  Path     Median         Spönemann, Zink
break  level  Coffman   Sifting         (Kieler/ELK)
(FAS)  ing   Graham    ...
  │     │
  └─→ 実用化 ─→ Graphviz dot / ELK Layered / yFiles / OGDF
```

- **Sugiyama 枠組み**が階層描画の支配的骨格であり、循環は「cycle breaking（フィードバック弧集合の逆転）」で擬似的にDAG化してから処理するのが標準。
- 「循環を**保持したまま**描く」代替系譜として、Bachmaier らの **cyclic leveling / recurrent hierarchies（循環レベル・反復階層）** がある。
- 「ポート制約」は主に **Kieler/ELK 系**（Spönemann, Schulze, Zink ら）と **yFiles 商用**で体系化されており、Sugiyama の各フェーズにポート情報を浸透させる手法が確立している。
- **完全一致**（循環＋上下左右ポート＋階層＋直交/HV を全て1つの枠組みで）する単一の論文は稀だが、**ELK Layered** が実用上は最も近い統合実装である。

---

## 1. 学術的系譜

### 1.1 Sugiyama 枠組み（階層描画の骨格）

階層的グラフ描画で圧倒的に支配的なのは、Sugiyama, Tagawa, Toda (1981) が提案した **Sugiyama 枠組み** である（[Sugiyama et al., *IEEE Trans. SMC* 1981](https://www.semanticscholar.org/paper/Methods-for-Visual-Understanding-of-Hierarchical-Sugiyama-Tagawa/34c4e6af91b25f426fde84d1c4556256f07e6e81); [Tamassia, *Handbook*, Hierarchical Ch.](https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/hierarchical.pdf)）。この枠組みは入力有向グラフを層（layer）に分けて描画し、標準で **4フェーズ** からなる（[Tamassia, Hierarchical Ch.](https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/hierarchical.pdf); [arXiv:1808.10364 (Ortali & Tollis)](https://arxiv.org/abs/1808.10364)）。

| フェーズ | 役割 | 代表アルゴリズム |
|---|---|---|
| 1. Cycle removal（循環除去） | 辺の向きを一部逆転してDAG化 | Greedy Cycle Removal (Eades et al.), Berger–Shor, Gansner et al. dot ヒューリスティック, ILP/branch-and-cut |
| 2. Layer assignment（層割当） | 頂点を層に配置 | Longest-path, Coffman–Graham, network-simplex (Gansner et al.) |
| 3. Crossing reduction（交差削減） | 層内の頂点順序を決定 | Barycenter, Median, Sifting, Grid/Global Sifting, ILP |
| 4. Coordinate assignment（座標割当） | x座標を計算し、ダミー頂点を屈曲に置換 | Brandes–Köpf, Sander Pendulum, Gansner et al. LP, FastHierarchyLayout |

これらは [Tamassia, Hierarchical Ch.](https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/hierarchical.pdf) で網羅的に分類されている。効率改善としては Eiglsperger, Siebenhaller, Kaufmann がダミー頂点数を線形に抑え、計算量を O((|V|+|E|) log |E|) に改善した実装を示している（[Eiglsperger et al., *JGAA*](https://jgaa.info/index.php/jgaa/article/view/paper111)）。

> **フェーズ数の補足**：古典的な Sugiyama 説明では4フェーズだが、KLay/ELK のようにポートや直交ルーティングを扱う実装では、座標割当（coordinate assignment）に含まれていた処理を **node placement（節点配置）** と **edge routing（辺ルーティング）** に分け、5フェーズで説明することが多い（[Schulze et al., *JVLC 2014*](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/jvlc13.pdf); [Improved Vertical Segment Routing, Kiel](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/theses/thw-bt.pdf)）。

> Sugiyama 枠組みは **DAG（有向非巡回グラフ）を前提**とする。これが本問題の「循環を含む」という要件と直接ぶつかる点が、循環処理の系譜（1.2）につながる。

### 1.2 循環グラフの扱い：2つの哲学

循環を含むグラフを階層描画するには、大きく2つの立場がある。

#### (A) 循環を「破る」：フィードバック弧集合（標準路線）

Sugiyama 枠組みの第1フェーズは、辺の向きを逆転させてグラフをDAG化する **cycle removal** である（[Tamassia, Hierarchical Ch.](https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/hierarchical.pdf)）。逆転すべき辺集合を **フィードバック弧集合（Feedback Arc Set, FAS）** と呼び、最小FAS問題は NP-hard である。Tamassia は、FAS のうち「逆転によって非巡回化できるもの」を **フィードバック集合（Feedback Set, FS）** と区別し、各FSはFASだが逆は成り立たないと整理している（[Tamassia, Hierarchical Ch.](https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/hierarchical.pdf)）。

代表アルゴリズム：Greedy Cycle Removal（Eades et al., 線形時間）、Berger–Shor（近似比2未満で初の多項式アルゴリズム）、Gansner et al. の dot 用ヒューリスティック（SCCごとに処理）、Demetrescu–Finocchi の重み付きFAS、Even–Naor–Rao–Schieber の LP 基づく O(log|V| log log|V|) 近似、および branch-and-cut による厳密解法（[Tamassia, Hierarchical Ch.](https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/hierarchical.pdf)）。実用的には Graphviz の `dot` が代表例で、Kiel 大の ELK も `GREEDY`, `DEPTH_FIRST`, `INTERACTIVE`, `MODEL_ORDER` などの cycle breaking 戦略を選べる（[ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html); [arXiv:2311.00533](https://arxiv.org/pdf/2311.00533.pdf)）。

> 注意：逆転された辺は最終描画で「流れに逆らう」向きになり、循環構造は視覚的には折れ曲がり/back-edge として現れる。循環そのものをトポロジカルに保持したい場合は (B) を検討する。

#### (B) 循環を保持する系譜：cyclic leveling / recurrent hierarchies

Bachmaier, Brandenburg, Brunner らは、循環を **そのまま視覚的に保持する** 方向の系譜を開拓した。通常の水平レベル線ではなく、レベルを **円環（サイクル）上に並べた recurrent hierarchy（反復階層）** とし、周期的構造（周期スケジューリング、生化学パスウェイのサイクル、VLSI の反復セル構造など）を自然に表現する（[Infosun Passau 拡張枠組み論文](https://www.infosun.fim.uni-passau.de/~chris/down/FrameworkForDAGs.pdf)）。ただし Bachmaier 系も文脈によって cycle removal / 前処理を含むことがあり、任意の有向サイクルを無条件に完全保持するわけではない点には注意が必要である。標準 Sugiyama が循環を back-edge（逆行辺）として折れ曲がりで表現するのに対し、本系譜はサイクルを **レベルの円環構造として位相的に表現する** という cycle-aware な代替路線と理解するのが正確である。

- **Cyclic Leveling of Directed Graphs** — 循環レベル割当の基礎（[Bachmaier et al., *Springer GD 2009*](http://link.springer.com/10.1007/978-3-642-00219-9_34)）
- **Coordinate Assignment for Cyclic Level Graphs** — 循環レベルグラフの座標割当（[Bachmaier et al., *Springer GD 2009*](http://link.springer.com/10.1007/978-3-642-02882-3_8)）
- **Drawing Recurrent Hierarchies** — 4フェーズ（cycle removal→leveling→crossing reduction→coordinate assignment）の循環版を線形時間で構成し、辺あたり最大2屈曲、面積2次の最適 bound を示す（[Bachmaier et al., *JGAA* 2012](http://www.kurims.kyoto-u.ac.jp/EMIS/journals/JGAA/accepted/2012/BachmaierBrandenburgBrunnerFulop2012.16.2.pdf)）

これらは「循環を保持したい」という要件に直接応答する数少ない系譜であり、本問題で循環の視覚的保持が重要なら有力候補となる。なお Bachmaier らは放射状（radial）版も完成させており、radial + cyclic の組合せでトーラス上の無限スクロール可能な描画も議論されている（[Infosun Passau](https://www.infosun.fim.uni-passau.de/~chris/down/FrameworkForDAGs.pdf); [Bachmaier & Forster, radial Sugiyama](https://www.semanticscholar.org/paper/4aed95b979f01332dfc4e2680a1c210427fc4679)）。

> 実装上の注意：cyclic/recurrent 系譜は ELK や Graphviz の標準出力ではなく、主に学術実装にとどまる。実用化するには独自実装か、これらの論文アルゴリズムの移植が必要。

#### (C) その他：Sugiyama からの脱却

Ortali & Tollis は、Sugiyama の4フェーズを完全に離れ、**channel decomposition** と到達性情報を保持した階層描画を多項式時間で構成する代替枠組みを提案している（[Ortali & Tollis, *arXiv:1808.10364*](https://arxiv.org/abs/1808.10364); [*JGAA* 新枠組み](https://jgaa.info/index.php/jgaa/article/view/paper502)）。循環グラフの扱いについては cycle removal ステップを保つが、以降のフェーズ構造が異なる。参考として「Sugiyama 一辺倒ではない」ことを示す系譜である。

### 1.3 ポート制約付きレイヤード描画の系譜

「エッジがノードのどのポート（上下左右）につながるか」を扱うのが **ポート制約（port constraints）** の系譜である。ここは本問題との一致度が最も高い。

#### 5段階のポート制約モデル（Kieler / KLay → ELK）

Schulze, Spönemann, Hanxleden は、Sugiyama 系レイヤードアルゴリズムにポート制約を統合した **KLay Layered**（のちに ELK Layered の前身）を発表し、ポート制約を5段階の制約レベルとして体系化した（[Schulze et al., *J. Visual Languages & Computing* 2014](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/jvlc13.pdf)）。

| レベル | 意味 |
|---|---|
| **Free** | ポートはノード境界の任意の位置に置ける |
| **FixedSide** | 各ポートに north/east/south/west の「側」が割当済み |
| **FixedOrder** | 側は固定、かつ側内のポート順序も固定 |
| **FixedRatio** | 各ポートの相対位置が固定（リサイズでスケール） |
| **FixedPos** | 各ポートの相対位置が完全固定（レイアウトに変更不可） |

鍵となる工夫は、**アルゴリズムが進むにつれて制約レベルを緩いものから厳しいものへ持ち上げる** 点である。例えば Free→FixedSide では入力辺数と出力辺数を比較して west/east を割当て、FixedSide→FixedOrder ではポート順序問題を2層交差最小化と等価として解く（[Schulze et al., *JVLC 2014*](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/jvlc13.pdf)）。また、ノードの north/south 側ポートを扱うため **layout units**、ポートを迂回する **inverted ports**、ポート順序が未固定の場合のソート法などを導入している（[Schulze et al.](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/jvlc13.pdf)）。

このモデルはまさに「エッジがノードの上下左右のどのポートにつながるかを考慮する」要件の学術的定式化そのものである。

#### ポートグループ（port groups）

Zink, Walter, Baumeister, Wolff は、複雑機械のケーブル計画（コンポーネントのポートをつなぐ配線図）を題材に、**ポートグループ** を導入して Sugiyama 枠組みを拡張した。グループ内のポートは位置を変えられる（美学の改善に利用）が、グループ全体は連続したブロックを形成しなければならない。また枠組みが有向グラフを前提とするため、無向グラフのエッジ方向付け（向き付け）の複数手法を比較実験している（[Zink et al., *Computational Geometry* 2022](https://arxiv.org/abs/2008.10583); [Elsevier 版](https://www.sciencedirect.com/science/article/abs/pii/S0925772122000293)）。先行する Kieler（KLay）ライブラリと比較して交差数を10–30%減らしたと報告している（[Zink et al.](https://arxiv.org/abs/2008.10583)）。

#### データフロー図・ハイパーグラフでのポート制約

- **Spönemann, Fuhrmann, Hanxleden, Mutzel** はデータフロー図の階層レイアウトにおけるポート制約を扱った（[*Springer GD 2009*](http://link.springer.com/10.1007/978-3-642-11805-0_14)）。
- **upward planarization + ポート制約** の組合せでは、直交レイアウトにおいてポート制約は主にルーティング段階で考慮すればよい（ポートがノードの左右にある場合はノードを人工的に広げて屈曲点を追加）とし、upward-planarization にもポート制約を組み込む研究がある（[*Crossing Minimization and Layouts of Directed Hypergraphs with Port Constraints*, Osnabrück](https://tcs.informatik.uos.de/_media/pubs/gd10_preprint_hierachicalportconstraints_pdf.pdf)）。
- **Rüegg, Kieffer, Dwyer, Marriott, Wybrow** は、ポート付きデータフロー図の直交レイアウトを、**制約付きストレス最小化（constrained stress majorization）** で行う代替アプローチを提案。レイヤード法に比べ対称性を表現しやすく層間の余白を除去してコンパクトになるとしている（[Rüegg et al., *arXiv:1408.4626*](https://arxiv.org/abs/1408.4626)）。ポートの公式定義も与えており、データフロー図を G=(V,E,P,π)（ポート P、写像 π:P→V、辺 e=(p1,p2)）とモデル化している（[Rüegg et al.](https://arxiv.org/abs/1408.4626)）。
- 直交描画におけるポート/側制約の定義体系は、Tübingen 大の学位論文が詳しい。「ポート制約保存描画（port constraint preserving drawing）」「側制約保存描画」を厳密に定義している（[*Orthogonal Graph Drawing with Constraints*, Tübingen](https://publikationen.uni-tuebingen.de/xmlui/bitstream/handle/10900/49366/pdf/diss.pdf)）。

### 1.4 直交（orthogonal / HV / Manhattan）エッジルーティング

エッジを水平・垂直線分（HVセグメント）で描くのが直交描画である。Tamassia は直交描画を「エッジを垂直・水平線分のみで描くスタイルで、最小角度が最大でも π/2 になり、少数のエッジ方向で見栄えが良いが、点ノードでは次数が4を超えられない」と整理する（[Tamassia, *Handbook*, Orthogonal Ch.](https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/orthogonal.pdf)）。

HVセグメントの「方向制約」として **HV-restricted graph**（各辺に水平/垂直の向きが割当済み）を考え、与えられた向きを尊重する planar な strict orthogonal 描画が可能かを多項式時間で判定する研究もある（[*Drawing HV-Restricted Planar Graphs*, TU Berlin](https://page.math.tu-berlin.de/~felsner/Paper/hv-restr.pdf)）。これは「エッジがどの方向に出るか」を制約として扱う点でポート制約と親和性が高い。

Sugiyama 系レイアウト内での直交エッジルーティングについては、Sander が直交ハイパーエッジ（複数始点・終点の辺）を「segment crossing graph」という内部グラフで垂直セグメントを配置する手法を導入し（[Improved Vertical Segment Routing for Sugiyama Layouts, Kiel](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/theses/thw-bt.pdf)）、Kieler/ELK に継承されている。座標割当でのポート・直交辺の改良は、Kieler 大の学位論文がまとめている（[*Sugiyama Layouts for ...*, Kiel](https://macau.uni-kiel.de/servlets/MCRFileNodeServlet/dissertation_derivate_00007865/uru-diss.pdf)）。

> 直交ルーティングとポート制約の組合せは、本問題の「上下左右ポート」を視覚的に HV セグメントで実現する中核技術である。ELK Layered は「orthogonal routing を選択すれば任意のポート制約を尊重する」と明記している（[ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)）。

### 1.5 補足：model order（モデル順序）による制御

Domrös & von Hanxleden は、テキストモデル内の順序（model order）を cycle breaking・層割当・交差削減のタイブレーカ／強制制約として利用し、ユーザ意図をレイアウトに反映する手法を ELK に実装した。ポートの順序も考慮される（[Domrös & von Hanxleden, *arXiv:2406.11393*](https://arxiv.org/abs/2406.11393); [arXiv:2311.00533](https://arxiv.org/pdf/2311.00533.pdf)）。本問題で「ポートの上下左右をユーザが明示指定したい」場合に有力な制御手段となる。

---

## 2. 実用フレームワーク比較

### 2.1 ELK Layered（Eclipse Layout Kernel）— 最も近い統合実装

ELK Layered は Kiel 大の KLay Layered を起源とするレイヤードアルゴリズムで、Sugiyama 枠組みにポート制約を深く統合している（[ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)）。

- **ポート制約**：ELK 公式オプション `PortConstraints`（`UNDEFINED`/`FIXED_SIDE`/`FIXED_ORDER`/`FIXED_POS`）を公開する（[ELK Layout Options](https://eclipse.dev/elk/reference/options.html)）。その根底にある KLay/ELK 系のポート制約モデルは5段階 **`Free`/`FixedSide`/`FixedOrder`/`FixedRatio`/`FixedPos`** として定義されており、`FREE`（任意位置）と `FIXED_RATIO`（リサイズでスケールする相対位置固定）を含む（[Schulze et al., *JVLC 2014*](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/jvlc13.pdf)）。
- **ポート側**：`PortSide`（NORTH/EAST/SOUTH/WEST）。FIXED_SIDE/FIXED_ORDER 時に必須（[ELK Port Side](https://eclipse.dev/elk/reference/options/org-eclipse-elk-port-side.html)）。
- **ポート順序・整列・間隔**：`Consider Port Order`, `Port Alignment (North/East/South/West)`, `Port Spacing`, `Port Sorting Strategy`, `Crossing Counter Port Order Influence` など140以上のオプション（[ELK Layout Options](https://eclipse.dev/elk/reference/options.html); [arXiv:2311.00533](https://arxiv.org/pdf/2311.00533.pdf)）。
- **直交ルーティング＋ポート**：「orthogonal routing を選択すれば任意のポート制約を尊重し、actor-oriented モデルや回路スクマティックのブロック図レイアウトを可能にする」と明記（[ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)）。
- **循環**：cycle breaking 戦略として `GREEDY`, `DEPTH_FIRST`, `INTERACTIVE`, `MODEL_ORDER`, `GREEDY_MODEL_ORDER` を選択可能（[arXiv:2311.00533](https://arxiv.org/pdf/2311.00533.pdf)）。標準は「辺を逆転してDAG化」路線（1.2-A）。
- **複合グラフ**：クロス階層辺をもつ compound graph の完全レイアウトをサポート（[ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)）。

> 評価：本問題（循環＋上下左右ポート＋階層＋直交）に対し、**実用フレームワーク中で最も要件を満たす**。ただし循環は「破る」方式であり、循環をトポロジカルに保持したい場合は別途工夫が必要。

### 2.2 Graphviz `dot` — ポートは強力だが ortho と両立しない

Graphviz の `dot` は Sugiyama 系の代表実装で、ポートを **8方位のコンパス点（n/ne/e/se/s/sw/w/nw）** として扱う。`headport`/`tailport` 属性、または `a -> b:se` のようなポート名構文、レコードノード上で `a -> b:f0:se` のようにポート＋コンパス点を重ねて指定できる（[Graphviz, *Drawing graphs with dot*](https://graphviz.org/pdf/dotguide.pdf)）。

ただし重大な制約がある：直交ルーティング（`splines=ortho`）は **ポートを扱えない**。Graphviz 公式は「現在のルーティングはポートを処理しない」と明記し（[Graphviz splines 属性](https://graphviz.org/docs/attrs/splines/)）、コミュニティでも「`splines=ortho` はポート指定があると悲惨に失敗する。ポートが無ければ概ね動く」と報告されている（[Graphviz Forum](https://forum.graphviz.org/t/regarding-graphvizs-orthogonal-edge-routing/1889)）。ワークアラウンドとして `dot` で位置決め後に `gvpr` で Ortho を後処理する手法が知られている（[Graphviz Forum: Ortho edges workaround](https://forum.graphviz.org/t/ortho-edges-and-ports-a-partial-work-around/1937)）。

> 評価：ポート指定（上下左右）と階層描画は強力だが、**「HV/直交ルーティング」と「ポート」が両立しない**ため、HVセグメントでの描画を重視する本問題には不向き。循環は cycle breaking で処理。

### 2.3 yFiles — 商用で最も高機能

yWorks の yFiles（IncrementalHierarchicLayouter / HierarchicalLayout）は商用SDKで、ポート制約を **PortConstraint（単一制約）** と **PortCandidate / PortCandidateSet（複合制約）** の2系統で扱う。強（strong＝位置固定）/ 弱（weak＝側制約）のポート候補、コストによる優先度、ポートグループ（同一位置に複数エッジを集合）、グループノード境界でのポート配分などをサポートする（[yFiles IncrementalHierarchicLayouter API](https://docs.yfiles.com/yfiles/doc/api/y/layout/hierarchic/IncrementalHierarchicLayouter.html); [yFiles Advanced Layout Features](http://docs.yworks.com/yfiles/doc/developers-guide/layout_advanced_features.html)）。階層レイアウトで「直交ルーティングとポート制約を組み合わせ、ノードの指定側（west/north 等）や正確な位置にエッジを接続」できる（[yFiles Hierarchical Layout](https://www.yfiles.com/the-yfiles-sdk/features/automatic-layouts/hierarchical-layout); [yFiles Orthogonal Layout](https://docs.yfiles.com/yfiles-html/dguide/orthogonal_layout/)）。

yFiles は循環も自動処理する。公式ドキュメントは「グラフ内の循環依存は自動的に検出・解決される（Cyclic dependencies between nodes in a graph are automatically detected and resolved）」と明記する（[yFiles Hierarchical Layout ガイド](https://docs.yworks.com/yfiles-html/dguide/automatic-layouts-main-chapter/hierarchical_layout.html)）。つまり内部的に cycle breaking 相当の処理を行い、残った back-edge は back-loop routing として処理する。

> 評価：循環（自動検出・解決）＋上下左右ポート＋階層＋直交を商用レベルで最もシームレスに統合。ライセンス費用が前提。

### 2.4 OGDF — 学術的モジュール性、ポートは一部弱い

OGDF（Open Graph Drawing Framework）は `SugiyamaLayout` を3交換可能フェーズ（ranking / crossMin / layout）のモジュール構成で実装する。ranking は `LongestPathRanking`（デフォルト）や `CoffmanGrahamRanking`、crossMin は `BarycenterHeuristic`/`MedianHeuristic`/`SiftingHeuristic`/`GlobalSifting`/`SplitHeuristic`、layout は `FastHierarchyLayout`/`OptimalHierarchyLayout` など（[OGDF SugiyamaLayout](https://ogdf.github.io/doc/ogdf/classogdf_1_1_sugiyama_layout.html); [OGDF ハンドブック章](https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/ogdf.pdf); [OGDF Crossing Min Modules](https://ogdf.github.io/doc/ogdf/group__gd-layered-crossmin.html)）。非巡回化は ranking モジュール内で acyclic 部分グラフを計算して行う（[OGDF SugiyamaLayout](https://ogdf.github.io/doc/ogdf/classogdf_1_1_sugiyama_layout.html)）。直交描画は `OrthoLayout`（planarization 枠組み `PlanarizationLayout` 経由）で提供される（[OGDF サンプル](https://www.ogdf.uni-osnabrueck.de/doc/ex-layout.html)）。

> 評価：Sugiyama のモジュール性・カスタマイズ性は最高だが、ELK ほどのリッチな「ポート制約レベル」の第一級サポートは薄い。直交は別経路（planarization）なので、Sugiyama 内でポート＋直交を密に統合したい場合は自前の拡張が必要。オープンソースで研究用途に適する。

---

## 3. タクソノミ表：アプローチ × 要件対応

| アプローチ / 実装 | 循環対応 | 循環の保持 | 上下左右ポート | 階層的 | 直交/HV | 学術基盤 | 実装 |
|---|---|---|---|---|---|---|---|
| Sugiyama 標準（cycle breaking） | ○（FAS逆転） | ✗（破る） | △（拡張で可） | ○ | △（別ルーティング） | [STT81](https://www.semanticscholar.org/paper/Methods-for-Visual-Understanding-of-Hierarchical-Sugiyama-Tagawa/34c4e6af91b25f426fde84d1c4556256f07e6e81) | Graphviz, ELK, OGDF, yFiles |
| Cyclic leveling / recurrent hierarchies | ○ | ○（保持） | ✗（非搭載） | ○（循環レベル） | △ | [Bachmaier et al.](http://www.kurims.kyoto-u.ac.jp/EMIS/journals/JGAA/accepted/2012/BachmaierBrandenburgBrunnerFulop2012.16.2.pdf) | 学術実装中心 |
| ポート制約付きレイヤード（Kieler/ELK流） | ○（cycle breaking） | ✗ | ○（5段階モデル） | ○ | ○（orthogonal 時） | [Schulze et al. 2014](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/jvlc13.pdf) | ELK Layered |
| ポートグループ拡張（Zink et al.） | ○（無向の向き付け） | ✗ | ○（グループ） | ○ | △ | [Zink et al. 2022](https://arxiv.org/abs/2008.10583) | 研究実装 |
| ストレス最小化ポート付き直交 | △ | ✗ | ○ | △（階層でない） | ○ | [Rüegg et al. 2014](https://arxiv.org/abs/1408.4626) | dagre/商用参考 |
| upward planarization + ポート | ○ | ✗ | ○ | ○ | ○ | [Osnabrück GD'10](https://tcs.informatik.uos.de/_media/pubs/gd10_preprint_hierachicalportconstraints_pdf.pdf) | 研究実装 |
| Ortali–Tollis 枠組み（非Sugiyama） | ○ | ✗ | ✗ | ○ | △ | [arXiv:1808.10364](https://arxiv.org/abs/1808.10364) | 研究実装 |

凡例：○＝直接対応、△＝部分的/拡張で対応、✗＝非対応

---

## 4. 最も近い一致と推奨実装戦略

### 4.1 完全一致 vs 部分一致

- 本調査範囲では、**完全一致**（循環保持＋上下左右ポート＋階層＋直交/HV を1枠組みで）する単一の既存研究・実装は確認できなかった。これは未開拓の交差点領域である。
- **最も近い部分一致**は、**ポート制約付きレイヤード描画（Kieler/ELK 系）＋ cycle breaking** の組合せである。すなわち [Schulze et al. 2014](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/jvlc13.pdf) の5段階ポートモデルを ELK Layered 実装で使い、循環は標準の cycle breaking でDAG化する構成。これに orthogonal routing を選べば、上下左右ポートを HV セグメントで接続する描画が得られる（[ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)）。

### 4.2 推奨戦略（要件の優先順位別）

1. **循環の視覚的保持が不要（破ってよい）なら**：**ELK Layered** を採用。`PortConstraints=FIXED_SIDE/FIXED_ORDER`, `PortSide` で上下左右を指定し、orthogonal routing を有効化。cycle breaking は `GREEDY` または `MODEL_ORDER`（ユーザ意図を反映）を選ぶ。商用品質が必要なら **yFiles** に置き換え。検証と理論は [Schulze et al. 2014](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/jvlc13.pdf) と [Domrös & von Hanxleden 2024](https://arxiv.org/abs/2406.11393) が参照。

2. **循環をトポロジカルに保持したいなら**：[Bachmaier et al. の recurrent hierarchies](http://www.kurims.kyoto-u.ac.jp/EMIS/journals/JGAA/accepted/2012/BachmaierBrandenburgBrunnerFulop2012.16.2.pdf) のアルゴリズムをベースに独自実装し、そこに [Schulze et al.](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/jvlc13.pdf) のポート制約レベル持ち上げ手法と [Sander の直交ハイパーエッジルーティング](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/theses/thw-bt.pdf) を組み合わせる必要がある。ELK のソース（phase ごとの processor: `PORT_SIDE_PROCESSOR`, `INVERTED_PORT_PROCESSOR`, `NORTH_SOUTH_PORT_PREPROCESSOR` 等, [arXiv:2311.00533](https://arxiv.org/pdf/2311.00533.pdf)）を、cyclic leveling 版の層構造に移植するのが現実的な経路。

3. **HV-restricted 的な「辺ごとの水平/垂直方向指定」を重視するなら**：[TU Berlin, Drawing HV-Restricted Planar Graphs](https://page.math.tu-berlin.de/~felsner/Paper/hv-restr.pdf) の理論と、ポート制約保存描画の定義（[Tübingen 論文](https://publikationen.uni-tuebingen.de/xmlui/bitstream/handle/10900/49366/pdf/diss.pdf)）を基礎にする。

### 4.3 ギャップと研究機会

- ELK はポート＋直交＋cycle breaking まで統合するが、**循環保持（cyclic leveling）はELKに統合されていない**。ここが最大のギャップ。
- [Zink et al.](https://arxiv.org/abs/2008.10583) のポートグループは交差削減で優れるが、循環保持とも直交ルーティング最適化とも同時には評価されていない。
- 「循環保持＋ポート＋直交」の三者統合は、Bachmaier系循環レベル描画にELKのポート処理パイプラインを接続する新規実装として価値ある方向である。

---

## 5. アノテーテッド参考文献

### 学術（階層描画・Sugiyama）
- **Sugiyama, Tagawa, Toda (1981)**, "Methods for Visual Understanding of Hierarchical System Structures" — 階層描画の原典。Manhattan 系拡張も含む。([Semantic Scholar](https://www.semanticscholar.org/paper/Methods-for-Visual-Understanding-of-Hierarchical-Sugiyama-Tagawa/34c4e6af91b25f426fde84d1c4556256f07e6e81))
- **Tamassia (ed.), Handbook of Graph Drawing, Hierarchical Ch.** — Sugiyama 4フェーズの網羅的分類、FAS/FS の区別、各フェーズの代表アルゴリズムと著者。([PDF](https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/hierarchical.pdf))
- **Tamassia, Handbook, Orthogonal Ch.** — 直交描画の定義・HV制約・次数制限。([PDF](https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/orthogonal.pdf))
- **Tamassia, Handbook, Ch.55 (CSUN)** — upward / hv-drawing の公式定義。([PDF](https://www.csun.edu/~ctoth/Handbook/chap55.pdf))
- **Eiglsperger, Siebenhaller, Kaufmann**, *JGAA* — Sugiyama の効率実装、O((|V|+|E|) log|E|)。([JGAA](https://jgaa.info/index.php/jgaa/article/view/paper111))

### 学術（循環保持）
- **Bachmaier et al.**, "Cyclic Leveling of Directed Graphs", GD 2009。([Springer](http://link.springer.com/10.1007/978-3-642-00219-9_34))
- **Bachmaier et al.**, "Coordinate Assignment for Cyclic Level Graphs", GD 2009。([Springer](http://link.springer.com/10.1007/978-3-642-02882-3_8))
- **Bachmaier et al.**, "Drawing Recurrent Hierarchies", *JGAA* 2012 — 4フェーズ循環版、線形時間、面積2次の最適 bound。([JGAA/EMIS](http://www.kurims.kyoto-u.ac.jp/EMIS/journals/JGAA/accepted/2012/BachmaierBrandenburgBrunnerFulop2012.16.2.pdf))
- **Bachmaier & Forster**, radial Sugiyama 適応。([Semantic Scholar](https://www.semanticscholar.org/paper/4aed95b979f01332dfc4e2680a1c210427fc4679))
- **Infosun Passau 拡張枠組み** — radial + cyclic（トーラス）の統合視点。([PDF](https://www.infosun.fim.uni-passau.de/~chris/down/FrameworkForDAGs.pdf))
- **Ortali & Tollis**, "Algorithms and Bounds for Drawing Directed Graphs" — Sugiyama 脱却の channel decomposition 枠組み。([arXiv:1808.10364](https://arxiv.org/abs/1808.10364); [JGAA 新枠組み](https://jgaa.info/index.php/jgaa/article/view/paper502))

### 学術（ポート制約）
- **Schulze, Spönemann, Hanxleden**, *J. Visual Languages & Computing* 2014 — KLay Layered、5段階ポート制約モデル、layout units、inverted ports。([PDF, Kiel](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/jvlc13.pdf))
- **Zink, Walter, Baumeister, Wolff**, *Computational Geometry* 2022 — ポートグループ、無向グラフの向き付け、Kieler 比較。([arXiv](https://arxiv.org/abs/2008.10583); [Elsevier](https://www.sciencedirect.com/science/article/abs/pii/S0925772122000293))
- **Spönemann, Fuhrmann, Hanxleden, Mutzel**, "Port Constraints in Hierarchical Layout of Data Flow Diagrams", GD 2009。([Springer](http://link.springer.com/10.1007/978-3-642-11805-0_14))
- **Rüegg, Kieffer, Dwyer, Marriott, Wybrow**, "Stress-Minimizing Orthogonal Layout of Data Flow Diagrams with Ports" — ポート定義とストレス最小化直交。([arXiv:1408.4626](https://arxiv.org/abs/1408.4626))
- **Crossing Minimization and Layouts of Directed Hypergraphs with Port Constraints**, Osnabrück — upward planarization + ポート。([PDF](https://tcs.informatik.uos.de/_media/pubs/gd10_preprint_hierachicalportconstraints_pdf.pdf))
- **Orthogonal Graph Drawing with Constraints**, Tübingen — ポート/側制約の厳密定義。([PDF](https://publikationen.uni-tuebingen.de/xmlui/bitstream/handle/10900/49366/pdf/diss.pdf))

### 学術（直交/HV・ルーティング）
- **Drawing HV-Restricted Planar Graphs**, TU Berlin — HV方向制約の判定。([PDF](https://page.math.tu-berlin.de/~felsner/Paper/hv-restr.pdf))
- **Improved Vertical Segment Routing for Sugiyama Layouts**, Kiel — Sander の直交ハイパーエッジ、segment crossing graph。([PDF](https://rtsys.informatik.uni-kiel.de/~biblio/downloads/theses/thw-bt.pdf))
- **Sugiyama Layouts for ...（Kieler 学位論文）** — 座標割当でのポート・直交辺改良。([PDF, Kiel](https://macau.uni-kiel.de/servlets/MCRFileNodeServlet/dissertation_derivate_00007865/uru-diss.pdf))
- **Domrös & von Hanxleden**, "Diagram Control and Model Order for Sugiyama Layouts" — model order による cycle breaking/層割当/交差削減の制御。([arXiv:2406.11393](https://arxiv.org/abs/2406.11393))

### 実用フレームワーク
- **ELK Layered** — アルゴリズム概要、orthogonal+ポート対応、compound graph。([Eclipse](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html))
- **ELK Port Side / Layout Options** — ポート側・制約・整列オプション。([Port Side](https://eclipse.dev/elk/reference/options/org-eclipse-elk-port-side.html); [Options](https://eclipse.dev/elk/reference/options.html))
- **ELK 内部構造解説** — phase processor 一覧、model order、140オプション。([arXiv:2311.00533](https://arxiv.org/pdf/2311.00533.pdf))
- **Graphviz dot guide** — コンパス点ポート、headport/tailport、レコードノード。([PDF](https://graphviz.org/pdf/dotguide.pdf))
- **Graphviz splines 属性** — ortho はポート非対応の公式記述。([Graphviz](https://graphviz.org/docs/attrs/splines/))
- **yFiles IncrementalHierarchicLayouter** — PortConstraint/PortCandidate/PortCandidateSet、ポートグループ。([API](https://docs.yfiles.com/yfiles/doc/api/y/layout/hierarchic/IncrementalHierarchicLayouter.html))
- **yFiles Hierarchical / Advanced Features / Orthogonal** — 階層＋直交＋ポートの統合。([Hierarchical](https://www.yfiles.com/the-yfiles-sdk/features/automatic-layouts/hierarchical-layout); [Advanced](http://docs.yworks.com/yfiles/doc/developers-guide/layout_advanced_features.html); [Orthogonal](https://docs.yfiles.com/yfiles-html/dguide/orthogonal_layout/))
- **OGDF SugiyamaLayout** — モジュール構成、ranking/crossMin/layout、acyclic 部分グラフ。([OGDF](https://ogdf.github.io/doc/ogdf/classogdf_1_1_sugiyama_layout.html); [Handbook章](https://cs.brown.edu/people/rtamassi/gdhandbook/chapters/ogdf.pdf); [Crossing Min](https://ogdf.github.io/doc/ogdf/group__gd-layered-crossmin.html))

---

## 6. まとめ

本問題（循環＋上下左右ポート＋階層的＋HV/直交）は、学術的には **Sugiyama 枠組み（階層）× ポート制約付きレイヤード描画（Kieler/ELK 系）× 直交ルーティング** の3系譜の交差点に位置する。完全一致する既存研究はなく、未開拓の交差点領域である。

- **実用で最も近い**のは **ELK Layered**（orthogonal routing で任意のポート制約を尊重、cycle breaking 内蔵）。商用なら **yFiles**。
- **循環を破ってよい**なら上記で要件を満たす。**循環を保持したい**なら **Bachmaier らの cyclic leveling / recurrent hierarchies** が唯一の系譜だが、ポート・直交とは未統合であり、ELK のポート処理パイプラインを循環レベル版へ移植する独自実装が必要。
- **Graphviz** はポートが強力だが ortho と両立しない点に注意。
- **OGDF** はモジュール性・カスタマイズ性で研究開発に適するが、ポート制約の第一級サポートは ELK に劣る。

次のステップとして、ELK Layered のソース（特に `NORTH_SOUTH_PORT_PREPROCESSOR`, `INVERTED_PORT_PROCESSOR`, `PORT_SIDE_PROCESSOR`, orthogonal edge routing モジュール）を読み解き、循環保持版レベル構造へこれらを接続するプロトタイプを設計することが、本問題を完全一致に近づける最短経路と考えられる。
