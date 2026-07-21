# グラフ描画（Graph Drawing）入門 — 「Alignは何をやっているのか」の学術的地図

MindMeshMapの「整列（Align）」が学術的にどういう分野の、どういう問題なのかを、情報系の学部生が読んで
全体像をつかめるようにまとめた解説。個別の設計判断ではなく「分野そのもの」の地図を提供するのが目的。

- MindMeshMap固有の整列の実装・設計判断 → [decisions.md §26](./decisions.md)（差分安定化）、[align-branch-layout.md](./align-branch-layout.md)（方向混在ブランチ）
- 本アプリの問題設定に**そっくりな既存研究・製品**を対応づけたレポート → [layout-prior-art.md](./layout-prior-art.md)（先行研究・先行事例）
- この記事は、それらの背景にある**学問分野全体**の見取り図

読む順番の目安: まず「1. この問題は何という分野か」と「2. 良いレイアウトとは（美的基準と最適化）」で
枠組みをつかみ、「3. 二大アプローチ」で分類の軸を得てから、「4. 主要パラダイム」を必要に応じて拾い読みするとよい。

---

## 1. この問題は何という分野か

ノードとエッジからなるグラフを、人間が見て意味を読み取れるように平面（や空間）へ配置する問題は、
**グラフ描画（Graph Drawing）** あるいは **グラフレイアウト（Graph Layout）**、応用寄りには
**ネットワーク可視化（Network Visualization）** と呼ばれる、確立した研究分野。

位置づけとしては、次の複数分野の交差点にある:

- **グラフ理論**（何が描けるか。平面性・彩色・連結性などの構造）
- **計算幾何学**（点・線分・領域をどう配置するか）
- **組合せ最適化 / 数理最適化**（「良い配置」を目的関数や制約として定式化して解く）
- **情報可視化・HCI**（人間にとって何が読みやすいか、という経験的・認知的な側面）

専門の国際会議として **International Symposium on Graph Drawing and Network Visualization（GD）** が
1992年から毎年開かれている。分野の標準的な教科書は次の2冊:

- Di Battista, Eades, Tamassia, Tollis, *Graph Drawing: Algorithms for the Visualization of Graphs*, Prentice Hall, 1999（通称「the GD textbook」）
- Tamassia (ed.), *Handbook of Graph Drawing and Visualization*, CRC Press, 2013（各トピックの専門家による章立ての handbook）

つまり、MindMeshMapのAlignは「思いつきの整列ロジック」ではなく、**40年以上の研究蓄積がある分野の応用の一つ**。

---

## 2. 「良いレイアウト」とは何か — 美的基準と、それが最適化問題になること

グラフ描画のいちばん根っこにある問いは「そもそも良い配置とは何か」。これは主観に見えて、実は
**美的基準（aesthetic criteria）** として定量化されており、実験的にも「どの基準が読みやすさに効くか」が
研究されている（例: エッジ交差の最小化が最も効果が大きい、という実験結果がよく引用される）。

代表的な美的基準:

| 基準 | 意味 | 直感 |
|---|---|---|
| **エッジ交差数** (edge crossings) | 線と線が交わる回数 | 交差が多いと目で追えない。最重要とされることが多い |
| **描画面積** (area) | 全体が収まる矩形の大きさ | 小さいほど一覧しやすい（が詰めすぎも読みにくい） |
| **折れ曲がり数** (bends) | 直角配線などでエッジが曲がる回数 | 少ないほど追いやすい（直交描画で重要） |
| **辺長の均一性** (uniform edge length) | エッジの長さが揃っているか | ばらつくと歪んで見える |
| **対称性** (symmetry) | 構造の対称性が絵にも出ているか | 人は対称性から構造を読む |
| **角度解像度** (angular resolution) | ノードから出る辺同士の角度 | 辺が重なって出ると区別できない |
| **メンタルマップの保持** (mental map) | 編集前後で配置がなるべく変わらないか | 少し編集しただけで全体が組み変わると混乱する |

ここで分野の性格を決める重要な事実がある。**これらの基準を最適化する多くの問題はNP困難**。

- **交差数最小化（crossing minimization）はNP困難**（Garey & Johnson 1983 が「crossing numberはNP完全」を示した）。
  階層レイアウトで使う「2層グラフの交差最小化」ですら、片方の層を固定してもNP困難。
- **折れ曲がり最小化**も、平面埋め込みの選び方まで含めると一般にNP困難。
- **最小面積の描画**なども多くの設定でNP困難。

だから実務のレイアウトエンジンは、**厳密な最適解を求めるのではなく、ヒューリスティック（発見的手法）や
近似で「十分に良い」解を高速に得る**。ここが「アルゴリズムなのか、数学的定式化＋最適化なのか」という
質問への答えになる。

> **答え: 両方であり、パラダイムによって比重が違う。**
> - **エネルギー最小化系（力学モデル）** は、「良さ」を1つの目的関数（エネルギー／ストレス）として
>   数式で定義し、それを**連続最適化**する。＝「数理最適化」の色が濃い。
> - **階層／直交系** は、問題を複数の**離散的な部分問題のパイプライン**に分解し、各段を個別の
>   アルゴリズムやヒューリスティック（一部はILP=整数計画で厳密化）で解く。＝「組合せアルゴリズム」の色が濃い。
> - どちらも根っこには「NP困難な最適化を、良い定式化と賢い近似で現実的に解く」という同じ精神がある。

---

## 3. 二大アプローチ — 分野を貫く2つの思想

主要な手法は、大きく2つの思想に分かれる。この軸を持っておくと、個別手法が地図の上に置ける。

**(A) エネルギー最小化 / 力学モデル（force-directed / energy-based）**
グラフを物理系に見立てる。「隣接ノードはバネで引き合い、全ノードは電荷のように反発する」といった
力学系を組み、系が落ち着く（エネルギーが最小になる）配置を探す。目的関数を決めて連続最適化する発想。
- 向いているもの: 無向グラフ、クラスタ構造の可視化、方向性のない「関係の網」
- 長所: 実装が素直、対称性が自然に出る、任意のグラフに一様に使える
- 短所: 局所解に落ちる、大規模だと遅い（工夫が要る）、階層や流れの表現は不得意

**(B) 組合せ的パイプライン（combinatorial / constructive）**
問題を段階に分け、各段で離散的な部分問題を解く。階層レイアウト（Sugiyama）や直交描画（TSM）が代表。
- 向いているもの: 有向グラフの「流れ」、DAG、UML、回路、組織図、そして**マインドマップ**
- 長所: 階層・方向・整列が明示的に制御できる、結果が構造化されて見える
- 短所: 段ごとにNP困難な部分があり各段はヒューリスティック、パラメータが多い

**MindMeshMapのAlignは (B) の階層レイアウト**（後述のSugiyamaフレームワーク）を使っている。
ELKの`layered`アルゴリズムがまさにそれ。

---

## 4. 主要パラダイムの歴史と中身

### 4-A. 力学モデル / エネルギー最小化（Force-Directed）

「グラフを物理シミュレーションで配置する」系譜。おそらく最も直感的で、最も広く実装されている。

- **Tutte のバリセントリック法（1963）**: 最古の部類。外周を固定し、各内部頂点を「隣接点の重心
  （バリセンター）」に置くと、連立一次方程式を解くだけで平面グラフの交差なし描画が得られる、という
  美しい結果。力学モデルの原型でもある。
- **Eades のスプリング・エンベッダ（1984）**: "A heuristic for graph drawing"。エッジをバネ、
  ノード間を反発力とみなす、現代的な力学モデルの出発点。厳密な物理ではなく「ほどよく効く」ヒューリスティック
  として提案された点が実務的。
- **Kamada & Kawai（1989）**: グラフ理論的距離（最短経路のホップ数）と、平面上のユークリッド距離が
  なるべく一致するように配置する。これは **ストレス（stress）最小化**という定式化で、統計学の
  **多次元尺度構成法（MDS）** と数学的に同じ。「良さ」を1つのストレス関数として書き下し最適化する、
  という(A)の思想の教科書的な例。
- **Fruchterman & Reingold（1991）**: "Graph drawing by force-directed placement"。全ノード対に
  反発力、エッジに引力を置き、「温度」を下げながら（焼きなまし風に）動かして振動を抑える。実装が
  平易で、今日の多くの実装（d3-forceなど）の直接の先祖。
- **ストレス・マジョライゼーション（Gansner, Koren, North 2004/2005）**: Kamada-Kawai のストレス
  最小化を、**マジョライゼーション**という最適化技法で安定・高速に解く。現代の高品質な力学レイアウトの
  定番（Graphvizの`neato`などが採用）。
- **多段階法 / 大規模グラフ向け（2000年代〜）**: ノードを粗くまとめた縮約グラフを先に配置し、
  段階的に詳細化する multilevel 手法（FM³, GRIP, Graphvizの`sfdp` など）。数万〜数百万ノードを
  現実的な時間で扱うための工夫。

この系譜の総説としては Kobourov, *Force-Directed Drawing Algorithms*（Handbook 第12章、arXiv:1201.3011）が読みやすい。

### 4-B. 階層レイアウト / Sugiyamaフレームワーク（Layered）★MindMeshMapが使う系譜

有向グラフを「層（レイヤー）」に分け、流れを一方向（上→下や左→右）に揃えて描く。組織図・フローチャート・
依存関係図・そしてマインドマップのような「親から子へ」の構造に最適。

原典は **Sugiyama, Tagawa, Toda（1981）** "Methods for Visual Understanding of Hierarchical System
Structures"（IEEE Trans. SMC）。この論文が提案した **4フェーズのパイプライン** が、今日まで
「Sugiyamaフレームワーク」として使われている。各フェーズがそれぞれ独立した（多くはNP困難な）部分問題:

```
入力: 有向グラフ（循環していてもよい）
  │
  ├─ フェーズ1: 循環除去 (Cycle Removal / Breaking)
  │     一部のエッジを一時的に逆向きにしてDAG（非循環）にする。
  │     「なるべく少ない逆転で」= 最大非巡回部分グラフ問題（NP困難）→ ヒューリスティック
  │
  ├─ フェーズ2: レイヤー割り当て (Layer Assignment / Ranking)
  │     各ノードを第何層に置くかを決める。手法:
  │       - 最長経路法（速いが横に広がりがち）
  │       - Coffman-Graham 法（層の幅に上限を設ける、1972）
  │       - ネットワーク単体法（network simplex, Gansner et al. 1993）★Graphvizの dot、ELKの既定
  │
  ├─ フェーズ3: 交差削減 (Crossing Reduction)
  │     各層内でのノードの左右順を決めて、エッジ交差を減らす。
  │     2層交差最小化ですらNP困難 → 層を上下に掃引しながら
  │     バリセンター法／メディアン法（隣接ノードの重心・中央値に寄せる）を反復。
  │     ★ELKの LAYER_SWEEP がこれ
  │
  └─ フェーズ4: 座標割り当て (Coordinate Assignment)
        層内の順序を保ったまま、実際のx座標（縦流れなら横位置）を決める。
        親子をなるべく真っ直ぐ／対称に並べる。
        Brandes-Köpf 法（"Fast and Simple Horizontal Coordinate Assignment", GD'01）が定番。
        線形時間で品質が良い。★ELKの BRANDES_KOEPF がこれ
```

**Gansner, Koutsofios, North, Vo（1993）** "A Technique for Drawing Directed Graphs" は、この
フレームワークを実用化した金字塔で、**Graphvizの`dot`エンジン**の基礎。フェーズ2にネットワーク単体法、
フェーズ4に補助グラフを使う4パス構成。

#### MindMeshMapのAlignとの対応（ここが要点）

MindMeshMapは [ELK](https://eclipse.dev/elk/) の`layered`アルゴリズム（＝Sugiyamaフレームワークの実装）を
使っている。`src/utils/layout.ts`でELKに渡しているオプションは、**そのまま上の4フェーズに1対1対応**する:

| ELKオプション（layout.ts） | Sugiyamaのフェーズ | 学術的な中身 |
|---|---|---|
| `cycleBreaking.strategy` | フェーズ1 循環除去 | 循環をどう断ち切るか |
| `layering.strategy` | フェーズ2 レイヤー割り当て | 既定は network simplex（Gansner 1993） |
| `crossingMinimization.strategy`（`LAYER_SWEEP`） | フェーズ3 交差削減 | バリセンター/メディアンの層掃引 |
| `nodePlacement.strategy`（`BRANDES_KOEPF`） | フェーズ4 座標割り当て | Brandes-Köpf 法（GD'01） |

つまり、これまで整列のチューニングで触ってきたオプションは、**それぞれ別の論文・別のNP困難部分問題に
対応する独立したノブ**だった、というのが分野の視点から見た正体。[decisions.md §26](./decisions.md) で
これらを軒並み`INTERACTIVE`に変えたのは「4-Fで説明するメンタルマップ保持のため、各フェーズの判断を
現在座標に寄せる」という操作にあたる。

### 4-C. 木（Tree）の描画

グラフが木（循環なし・親が一意）に限れば、専用のきれいなアルゴリズムがある。マインドマップの
「素直な部分」はほぼこれ。

- **Reingold & Tilford（1981）** "Tidier Drawings of Trees": 「同じ深さのノードは同じ高さに揃える」
  「部分木は形を保って左右に詰める」「親は子の中央に置く」といった審美規則を、部分木を左右から
  寄せていく方式で満たす。木レイアウトの古典。
- **Walker（1990）**: 二分木以外（多分木）でReingold-Tilfordが崩れる問題を修正。ただし O(n²)。
- **Buchheim, Jünger, Leipert（2002）** "Improving Walker's Algorithm to Run in Linear Time":
  それを **線形時間 O(n)** に改良。今日「tidy tree」と言えば大抵これ。

MindMeshMapの`align-branch-layout.md`の「方針A（branch）」で、子孫を先に箱にして再帰合成するのは、
この木レイアウトの「部分木を形を保って詰める」発想を、方向混在に拡張したもの。

### 4-D. 直交描画（Orthogonal）

エッジを水平・垂直の線分と直角の折れだけで描く。回路図・UML・ER図・地下鉄路線図のような
「かっちりした」図に向く。MindMeshMapは使っていないが、分野の主要な柱なので押さえておくとよい。

- **Tamassia（1987）** "On Embedding a Graph in the Grid with the Minimum Number of Bends"（SIAM J. Comput.）:
  平面埋め込みを固定したうえで、**折れ曲がり数の最小化を最小費用流（min-cost flow）問題として定式化**して
  厳密に解く、という鮮やかな結果。ここは「離散最適化としての厳密解」が効く珍しい部分。
- この上に立つのが **Topology-Shape-Metrics（TSM）フレームワーク**: ①トポロジ（平面埋め込みを決める）
  → ②シェイプ（各辺の折れ・角度を決める＝Tamassiaの流れ）→ ③メトリクス（実際の長さ・座標を決める）
  の3段。直交描画の標準的な枠組み。

### 4-E. 平面グラフ描画（Planar）

「交差なしで描けるグラフ（平面グラフ）を、実際に交差なしで描く」理論的に深い分野。

- **平面性判定**: 与えられたグラフが交差なしに描けるかは **線形時間 O(n)** で判定できる
  （Hopcroft & Tarjan 1974）。
- **直線で描けるか**: **Fáryの定理** — 平面グラフは必ず、すべての辺を**折れのない直線**で交差なく描ける。
- **格子の上に描く（面積の理論）**: de Fraysseix–Pach–Pollack と Schnyder が独立にほぼ同時（1990年前後）に、
  「n頂点の平面グラフは O(n)×O(n) の整数格子上に交差なし直線描画できる」ことを示した。面積 O(n²) は
  一般の平面グラフでは最良。理論寄りだが、「配置には面積という資源の下界がある」という視点をくれる。

### 4-F. 動的グラフ描画とメンタルマップ保持 ★decisions.md §26 の背景

グラフが編集で変化していくとき、**前の絵と次の絵をなるべく似せる**（ユーザーの頭の中の地図＝メンタルマップを
壊さない）ことを目標にする分野。静的な1枚絵の最適化とは別の目的関数が要る。

- 概念の原典は **Misue, Eades, Lai, Sugiyama（1995）** "Layout Adjustment and the Mental Map"。
  「近接関係」「順序関係」「トポロジ」をなるべく保て、という3つの保存モデルを提唱。
- 実務では、レイアウトエンジンに**前回の座標をヒントとして渡し**、各フェーズの判断（層・順序・循環の向き）を
  現在配置に寄せる。ELKの`INTERACTIVE`戦略群がこれ。商用では yFiles の "Use Drawing as Sketch"
  （incremental モード）が同じ思想。
- **これがまさに [decisions.md §26](./decisions.md) でやったこと**: 「エッジを1本足しただけで全体が
  組み変わる」問題を、INTERACTIVE化＝メンタルマップ保持で解決した。分野的にはど真ん中の話題。

### 4-G. その他のパラダイム（一望）

網羅のために、代表的なものだけ名前を挙げておく。

- **円形レイアウト（circular）**: ノードを円周に並べ、弦で結ぶ。クラスタ構造の比較に。
- **スペクトルレイアウト（spectral）**: グラフのラプラシアン行列の固有ベクトルを座標に使う。
  線形代数一発で大域的な配置が出る（Koren らの研究）。
- **行列表現（matrix / adjacency matrix）**: 交差が原理的に起きないので密なグラフに強い。ノードリンク図の対極。
- **アークダイアグラム、ハイブ図、エッジバンドリング**: 特定用途の可視化テクニック。

---

## 5. 制約ベースレイアウト（Constraint-Based）★align-branch-layout.md の方針D

力学モデル（4-A）に「この2ノードは左右に最低50px離す」「これらは同じ高さに揃える」といった
**制約（constraint）** を課して同時に解く、ハイブリッド路線。方向混在のような要求を1回のソルブで
自然に表現できるのが強み。

- **IPSEP-COLA（Dwyer, Koren, Marriott 2006）**: 分離制約（separation constraint）付きの
  ストレス最小化を、勾配射影法で増分的に解く。「軸ごとに最低間隔を保証する」制約が張れるので、
  有向グラフの流れも、重なり回避も、グループ化も統一的に扱える。
- 実装が **[WebCola](https://github.com/tgdwyer/WebCola)（cola.js）**。`align-branch-layout.md`の
  方針D（見送り案）で「横系エッジは軸=x、縦系エッジは軸=yの分離制約を張れば混在方向を1回で扱える」と
  書いたのは、まさにこの枠組みの応用。

---

## 6. 実装・ライブラリの見取り図

理論と実装をつなぐ主要なソフトウェア。「どのライブラリがどのパラダイムか」を知っておくと選定が早い。

| ライブラリ | 主なパラダイム | 備考 |
|---|---|---|
| **Graphviz** | dot=階層(Sugiyama)、neato=ストレスMDS、fdp/sfdp=力学、twopi=放射、circo=円形 | 事実上の標準。1990年代からのAT&T製 |
| **OGDF**（Open Graph Drawing Framework） | ほぼ全パラダイムのC++実装 | 研究者向けの網羅的ライブラリ |
| **ELK**（Eclipse Layout Kernel） | 階層(layered)が主力、ほか多数 | ★MindMeshMapが使用。Eclipse系ツールの図の自動配置から発展。`elkjs`はそのJavaScript版 |
| **yFiles** | 全パラダイム（商用） | 高品質。"Use Drawing as Sketch"等の実務機能が厚い |
| **d3-force** | 力学（Fruchterman-Reingold系） | Web可視化の定番。軽量 |
| **cola.js / WebCola** | 制約ベース（IPSEP-COLA） | 制約付き力学 |
| **dagre / dagre-d3** | 階層(Sugiyama)のJS実装 | 軽量なDAG向け。dot の簡易版的位置づけ |
| **Gephi / Cytoscape / Tulip** | 力学中心の可視化アプリ | 大規模ネットワーク探索向け |

MindMeshMapが `elkjs` の `layered` を選んでいるのは、マインドマップが「親→子の階層＋ときどき循環」という
**Sugiyamaフレームワークがど真ん中で得意とする構造**だから、という理由づけができる。

---

## 7. MindMeshMapのAlignは、この地図のどこにいるか

これまでの整理を、MindMeshMapの実装に引きつけてまとめる。

- **基盤**: 階層レイアウト（4-B、Sugiyamaフレームワーク）。ELK `layered` 経由。`layout.ts`のELK
  オプションが4フェーズにそのまま対応する（4-Bの対応表）。
- **差分安定化**（[decisions.md §26](./decisions.md)）: 動的グラフ描画・メンタルマップ保持（4-F）。
  各フェーズを`INTERACTIVE`にして現在座標へ寄せた。
- **方向混在ブランチ**（[align-branch-layout.md](./align-branch-layout.md)、検討中）:
  - 方針A（branch）= 木レイアウトの「部分木を箱にして再帰合成」（4-C）を方向混在へ拡張。
    入れ子グラフ（compound/clustered graph）を再帰的に配置する Eades & Feng（1996）の系譜でもある。
  - 方針D（見送り）= 制約ベースレイアウト（第5節、IPSEP-COLA / WebCola）。
- **循環対応**: フェーズ1の循環除去（4-B）。循環を一時的に逆向きにしてDAG化してから描く、という
  Sugiyamaの標準手順そのもの。

こうして見ると、MindMeshMapの整列まわりの一連の作業は、**グラフ描画という分野の主要トピックを
ひととおり実地でなぞっている**ことがわかる。

---

## 8. さらに学ぶには（Reading Guide）

学部生が「分野を勉強する」順路として。

1. **まず1枚もので俯瞰**: Kobourov, *Force-Directed Drawing Algorithms*（Handbook 12章 / arXiv:1201.3011）。
   力学モデルを軸に分野の空気がつかめる。
2. **教科書で体系化**: Di Battista, Eades, Tamassia, Tollis, *Graph Drawing: Algorithms for the
   Visualization of Graphs*（1999）。階層・直交・平面・木を通しで。
3. **辞書的に深掘り**: Tamassia (ed.), *Handbook of Graph Drawing and Visualization*（2013）。
   各トピックを専門家が1章ずつ。
4. **原典にあたる**（この記事で触れた基礎論文）:
   - Sugiyama, Tagawa, Toda (1981) — 階層レイアウトの原典
   - Gansner, Koutsofios, North, Vo (1993) — Graphviz dot の基礎
   - Brandes, Köpf (2001) — 座標割り当て
   - Eades (1984), Fruchterman & Reingold (1991), Kamada & Kawai (1989) — 力学モデル三部作
   - Reingold & Tilford (1981), Buchheim et al. (2002) — 木レイアウト
   - Tamassia (1987) — 直交描画・折れ最小化
   - Misue, Eades, Lai, Sugiyama (1995) — メンタルマップ保持（§26の背景）
   - Dwyer, Koren, Marriott (2006) — 制約ベース（WebCola の理論）
5. **手を動かす**: `elkjs` / `dagre` / `d3-force` / `cola.js` を実際に小さいグラフで動かし、
   同じグラフが各パラダイムでどう変わるかを見る。MindMeshMapのdev限定アルゴリズム切替
   （[tuning.md](./tuning.md) 参照）は、その実験環境そのものになっている。

---

### 出典・参考リンク

- International Symposium on Graph Drawing and Network Visualization（GD, 1992–）
- Sugiyama, Tagawa, Toda, "Methods for Visual Understanding of Hierarchical System Structures," IEEE Trans. SMC, 1981
- Gansner, Koutsofios, North, Vo, ["A Technique for Drawing Directed Graphs,"](https://www.graphviz.org/documentation/TSE93.pdf) IEEE TSE, 1993
- Brandes, Köpf, ["Fast and Simple Horizontal Coordinate Assignment,"](https://kops.uni-konstanz.de/handle/123456789/5863) GD 2001
- Eades, "A Heuristic for Graph Drawing," Congressus Numerantium, 1984
- Fruchterman, Reingold, ["Graph Drawing by Force-Directed Placement,"](https://onlinelibrary.wiley.com/doi/10.1002/spe.4380211102) Software: Practice and Experience, 1991
- Kamada, Kawai, "An Algorithm for Drawing General Undirected Graphs," Information Processing Letters, 1989
- Gansner, Koren, North, "Graph Drawing by Stress Majorization," GD 2004
- Reingold, Tilford, ["Tidier Drawings of Trees,"](https://reingold.co/tidier-drawings.pdf) IEEE TSE, 1981
- Buchheim, Jünger, Leipert, "Improving Walker's Algorithm to Run in Linear Time," GD 2002
- Tamassia, "On Embedding a Graph in the Grid with the Minimum Number of Bends," SIAM J. Comput., 1987
- de Fraysseix, Pach, Pollack, "How to Draw a Planar Graph on a Grid," Combinatorica, 1990 / Schnyder, "Embedding Planar Graphs on the Grid," SODA 1990
- Misue, Eades, Lai, Sugiyama, "Layout Adjustment and the Mental Map," J. Visual Languages & Computing, 1995
- Eades, Feng, "Multilevel Visualization of Clustered Graphs," GD 1996
- Dwyer, Koren, Marriott, "IPSEP-CoLa: An Incremental Procedure for Separation Constraint Layout of Graphs," IEEE TVCG, 2006
- Di Battista, Eades, Tamassia, Tollis, *Graph Drawing: Algorithms for the Visualization of Graphs*, Prentice Hall, 1999
- Tamassia (ed.), *Handbook of Graph Drawing and Visualization*, CRC Press, 2013（Kobourov 12章「Force-Directed Drawing Algorithms」含む）
- [Eclipse Layout Kernel (ELK)](https://eclipse.dev/elk/) / [Graphviz](https://graphviz.org/) / [WebCola](https://github.com/tgdwyer/WebCola)
