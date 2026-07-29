# グラフ描画におけるSugiyamaフレームワークの最新進展と意図的レイアウトに関する学術調査報告

## 1. 階層型グラフ描画と意図的レイアウトへのパラダイムシフト

階層型グラフ描画（Layered Graph Drawing）において、Sugiyamaフレームワークは有向グラフの論理的フローを可視化するための最も堅牢な体系として確立されている [cite: 1, 2, 3]。このフレームワークは伝統的に、「サイクル除去」「階層割り当て」「交差削減」「横座標割り当て」「エッジルーティング」という5つの独立したパイプラインフェーズで構成されている [cite: 4, 5, 6, 7]。

しかし、従来の幾何学的・美学的指標（交差数やエッジ折れ曲がり数の最小化）に偏重した最適化プロセスは、設計者がソースコードやモデル内に暗黙的に埋め込んだ論理構造、すなわち読み手の「メンタルマップ」を破壊するという副作用を抱えていた [cite: 4, 9, 10, 11]。この課題に対し、2010年代後半から、テキスト定義の順序（モデル順序）をレイアウトエンジンが能動的に解釈し、論理的セマンティクスを維持したまま幾何学的最適化を行う「意図的レイアウト（Semantic-aware / Model Order Preserving Layout）」へのパラダイムシフトが起きており、学術・産業の両面で重要な転換点を迎えている [cite: 4, 12, 13, 14, 15]。

## 2. 意図的レイアウトとモデル順序維持技術の進化

近年の研究では、モデル順序（Model Order）を最適化の第一級市民として扱い、各フェーズで動的に反映する手法が提案されている [cite: 4, 7, 12]。

### 2.1 Diagram Control and Model Order for Sugiyama Layouts

Sören Domrösらの研究は、グラフィカルモデリングにおける定義順序を各フェーズで制御する方法論を提示している [cite: 4, 15]。

* サイクル除去: 単純な逆向きエッジの最小化（FAS問題）ではなく、記述上の前後関係を優先してエッジの向きを保存する。これにより、論理的な「前方」への流れが維持される [cite: 4, 7]。
* 階層割り当て: テキストモデルで連続定義された要素群が、空間的にも一貫して整列されるよう保証し、処理フローの連続性を視覚化する [cite: 4, 12]。
* 交差削減: 交差削減のスイープ処理において、重心法などでタイブレーク（交差数が同等）が発生した際、モデル順序と最も整合性の高い配置を能動的に選択することで、ランダムな乱れを抑止する [cite: 4, 7, 10]。

### 2.2 Determining Sugiyama Topology with Model Order

Graph Drawing 2024で発表された本研究は、入力モデルが「幅優先探索（BFS）」順序であることを仮定し、交差削減フェーズを完全にスキップするシングルパスアルゴリズムを提唱している [cite: 13, 14]。

* 動作原理: ノードの出現順に階層割り当てと配列決定を同時に行い、時間計算量 \mathcal{O}(n + e) を実現する [cite: 14]。
* 意義: ソートや反復計算を排除した超高速処理により、大規模ソースコードからのリアルタイムなシステム構成図描画において極めて強力な基盤技術となる [cite: 14]。

### 2.3 Preserving Order during Crossing Minimization in Sugiyama Layouts

ポート制約付きグラフにおいて、実ノード、ダミーノード、ポートの初期順序を保持する手法である [cite: 7, 10, 18]。

* レイアウトの安定性: 初期トポロジーから定義された順序関数を重心法のソート制約（部分順序）として埋め込む [cite: 7, 10, 12]。これにより、エッジ交差を抑制しつつ、インタラクティブな編集前後での視覚的一貫性を厳格に保護する [cite: 7, 10, 11]。

## 3. 意図的レイアウトおよびモデル順序制御手法の機能比較

手法・文献名 | 対象フェーズ | 主なアルゴリズム・アプローチ | 実装上のメリットとトレードオフ
-- | -- | -- | --
Diagram Control & Model Order [cite: 4, 15] | サイクル除去、層割り当て、交差削減、座標割り当て | モデル定義順を各フェーズの重み付き評価関数・制約条件として統合 [cite: 4]。| 幾何学的指標とセマンティクスのバランスを最適化 [cite: 4, 12]。抽出難易度が言語に依存 [cite: 4]。
Determining Sugiyama Topology [cite: 14] | 層割り当て、交差削減、ダミーノード挿入 | BFS順を仮定したシングルパスの動的割り当てアルゴリズム [cite: 14]。 | \mathcal{O}(n + e) の超高速処理 [cite: 14]。入力順序が不適切な場合、交差数が増大するリスク [cite: 14]。
Preserving Order [cite: 7, 10] | 2部グラフ交差削減、ポートソート | ポート、実ノード、ダミーノードに対する制約付き重心スイープ [cite: 7, 10]。 | インタラクティブ編集時の「レイアウトの安定性」を保証 [cite: 11]。既存エンジンへの統合が容易 [cite: 7, 19]。

## 4. 省スペース・コンパクト・レイヤーフリー階層レイアウトの極限

従来の厳格な階層構造は、複数階層を跨ぐエッジによるダミーノード生成と描画領域の肥大化を招いていた [cite: 5, 17, 20]。GD 2025で発表された「Shape-Metrics (SM)」アプローチは、従来のトポロジー・シェイプ・メトリクス（TSM）パイプラインを「脱構築」し、交差削減よりもエッジの折れ曲がり最小化を優先する設計思想を提示している [cite: 17, 21, 23]。

* 直線直交描画（Rectilinear Drawing）の探索: 折れ曲がりゼロの描画を理想状態とし、4方向ラベル \mathcal{L} = \{L, R, D, U\} を用いた「シェイプグラフ」を定義する [cite: 17, 23, 24]。
* SAT定式化: グラフが折れ曲がりゼロで描画可能であるための必要十分条件として、「すべてのシンプルサイクルが完全である（4つの方向ラベルをすべて含む）」ことを数学的に証明した [cite: 23, 24]。この制約を充足可能性問題（SAT）として定式化し、GlucoseやKissatといった高速SATソルバで探索する [cite: 22, 23]。
* エッジの動的分割（Subdivision）: SATが充足不能（Unsatisfiable）な場合、ボトルネックとなるエッジを特定してダミーノードを挿入（分割）する [cite: 21, 23, 24]。この分割点が最終的な「折れ曲がり（Bend）」となり、SATが充足されるまでプロセスを繰り返すことで、幾何学的に平仄の取れたコンパクトな描画を実現する [cite: 21, 23]。

## 5. 人間らしい配置手法とアスペクト比適応技術

数理的最適化と人間の美的な感覚（対称性や均整）を融合させる「Human-like」なアプローチが進化を遂げている [cite: 16, 26, 27]。

### 5.1 HOLA (Human-like Orthogonal Network Layout)

人間中心の設計を統合した先駆的な直交レイアウト手法である [cite: 27, 28, 30]。

1. コーツリー分離: グラフを「2連結コア」と「周辺ツリー」に分解する [cite: 16, 27]。
2. コアの力学最適化: コア部分に力学モデル（ストレス最小化）を適用し、対称性や大域的な構造を抽出する [cite: 16, 27]。
3. ツリー再接続: 直交化されたコアに対し、独立して処理された周辺ツリーを最適な面に貪欲法で再接続する [cite: 16, 27]。 ユーザー調査では、プロのデザイナーの手描きに近い、極めて高い可読性評価を得ている [cite: 26, 27, 30]。

### 5.2 ARCOL (Aspect Ratio Constrained Orthogonal Layout)

HOLAにアスペクト比（AR）制約を統合した最新手法である [cite: 16]。

* ソフト制約化: 力学モデルのエネルギー関数にターゲットARに基づいた正規化スケーリングを導入することで、数学的背景に基づきノードの初期分散を指定の矩形フレームへと緩やかに誘導する [cite: 16]。
* AR対応ツリー再接続: 再接続時のバウンディングボックスのAR変化率を評価するカスタムコスト関数を設計し、指定された表示解像度や枠内に収まるよう制御する [cite: 16]。

## 6. 大規模階層グラフにおけるスケーリングと座標計算の数理的修正

横座標割り当ての標準手法であるBrandes-Köpf (BK) アルゴリズムにおいて、2001年の発表以来20年間にわたり見過ごされてきた構造的な数理的欠陥が指摘された [cite: 31, 32]。

* Type 1 競合におけるデッドロック: ブロック圧縮処理中に特定のノード順序で無限ループやノードの重なりが発生する不具合である [cite: 19, 32]。
* ノード順序の逆転（Order Violation）: 4方向からのスイープ結果を統合（Merge）する段階において、局所的に密なグラフで第3フェーズの左右順序が逆転し、意図しない交差を局所的に再発生させる問題である [cite: 19, 32, 33]。
* 修正案（BK-Err）の意義: 線形時間を維持したままこれらの構造的欠陥を解消する修正疑似コードが定式化された。これは、Eclipse Layout Kernel (ELK) などの産業界をリードする描画エンジンの新標準（New Standard）として採用されており、大規模データ描画の安定性を担保する上で不可欠な修正となっている [cite: 19, 31, 32, 34]。

## 7. 本調査における厳選文献の統合比較マトリクス

文献名 | 出版年・採択媒体 | 分類カテゴリ | 主な技術的革新性・動作機序 | 主な適用先・解決する課題
-- | -- | -- | --  | --
Diagram Control & Model Order [cite: 4, 15] | 2024 / DIAGRAMS | Semantic-aware | モデル定義順をサイクル除去や重心法のタイブレーク制約に統合 [cite: 4]。 | DSLと図面間のメンタルマップ、トポロジーの保存 [cite: 4, 9]。
Determining Sugiyama Topology [cite: 14] | 2024 / GD | Semantic-aware / Performance | BFS順を前提とした \mathcal{O}(n+e) シングルパス層割り当てと交差削減スキップ [cite: 14]。 | 大規模トポロジーのリアルタイム可視化 [cite: 14]。
Preserving Order in crossingMin [cite: 7, 10] | 2022 / IVAPP | Semantic-aware / Interactive | ノード・ポートの初期順序を重心法スイーププロセスで一貫保護 [cite: 7, 10]。 | インタラクティブ編集時のレイアウト安定性の確保 [cite: 10, 11]。
A Walk on the Wild Side [cite: 17, 21] | 2025 / GD | Compact / Layer-free | SATによるrectilinear描画構築と最小ダミー頂点分割（Shape-Metrics） [cite: 21, 23]。 | 折れ曲がり最小化と幾何学的に平仄の取れたコンパクト直交描画 [cite: 21]。
HOLA [cite: 28, 30] | 2016 / IEEE TVCG | Human-like | コアと周辺ツリーの分離、力学最適化、貪欲な面配置 [cite: 16, 27]。 | プロの手描きに近い、対称性と可読性に優れた自然な配置 [cite: 27, 28]。
ARCOL [cite: 16] | 2026 / arXiv | Human-like / Adaptability | HOLAへのソフトAR制約と、AR対応ツリー再接続コストの導入 [cite: 16]。 | 任意の表示解像度・AR枠内への美観を損なわない適合 [cite: 16]。
BK algorithm Erratum [cite: 31, 32] | 2020 / arXiv | Scaling / Coordinate Assignment | Type 1競合デッドロックと、統合段階（Merge stage）での順序逆転バグの数理的修正 [cite: 19, 32]。 | 座標割り当ての堅牢性向上と、不必要な交差再発生の完全排除 [cite: 19, 32]。

## 8. 総合評価と将来展望

本調査により、現代のグラフ描画技術は「機械的な指標の最適化」から「人間とシステムのセマンティクスの協調」へと進化していることが明らかになった。

1. セマンティクスと効率性の両立: モデル順序を活用した意図的レイアウトは、単なる可視化から、システムモデリング環境のセマンティクスを表現するインテリジェントな表現層へと昇華している [cite: 4, 14]。
2. TSMパイプラインの脱構築: Shape-Metricsアプローチによる「シェイプ優先」の設計思想やARCOLの空間適応技術は、従来のトポロジー優先設計を再構築し、デバイス適合性の高い柔軟なレイアウト生成を可能にした [cite: 16, 17, 21]。
3. 数理的一貫性と産業標準への統合: BKアルゴリズムの修正に代表される基礎理論の堅牢化は、産業用ツールにおける大規模データ描画の信頼性を直接的に向上させている [cite: 19, 32, 34]。

今後は、これらの高度なアルゴリズムが、マイクロサービスの接続可視化、自動運転のデータフロー解析、生物学的パスウェイ解析などの広範な領域において、よりレスポンシブかつ直感的なインターフェースを提供していくと展望される [cite: 2, 34, 35, 36]。

##9. 参考文献

1. Layered graph drawing - Wikipedia, https://en.wikipedia.org/wiki/Layered_graph_drawing
2. Sugiyama Algorithm | PDF | Theoretical Computer Science | Discrete Mathematics - Scribd, https://www.scribd.com/document/991255989/Sugiyama-Algorithm
3. (PDF) Sugiyama Algorithm - ResearchGate, https://www.researchgate.net/publication/303226437_Sugiyama_Algorithm
4. [Literature Review] Diagram Control and Model Order for Sugiyama Layouts - Moonlight, https://www.themoonlight.io/en/review/diagram-control-and-model-order-for-sugiyama-layouts
5. Sugiyama Layouts for Prescribed Drawing Areas - MACAU, https://macau.uni-kiel.de/servlets/MCRFileNodeServlet/dissertation_derivate_00007865/uru-diss.pdf
6. gen_sugiyama - Rust - Docs.rs, https://docs.rs/gen-sugiyama
7. Preserving Order during Crossing Minimization in Sugiyama Layouts, https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/ivapp22.pdf
8. Universal Quality Metrics for Graph Drawings: Which Graphs Excite Us Most?, https://d-nb.info/1383085811/34
9. Model Order : Reconciling Automatic Layout and User Intentions - MACAU - Christian-Albrechts-Universität zu Kiel, https://macau.uni-kiel.de/receive/macau_mods_00006344?lang=en
10. Preserving Order during Crossing Minimization in Sugiyama Layouts - ResearchGate, https://www.researchgate.net/publication/358262575_Preserving_Order_during_Crossing_Minimization_in_Sugiyama_Layouts
11. IPSep-CoLa: An Incremental Procedure for Separation Constraint Layout of Graphs, https://www.researchgate.net/publication/6715571_IPSep-CoLa_An_Incremental_Procedure_for_Separation_Constraint_Layout_of_Graphs
12. Model Order in Sugiyama Layouts - SciTePress, https://www.scitepress.org/Papers/2023/116567/116567.pdf
13. Determining Sugiyama Topology with Model Order (Poster Abstract) - DROPS, https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.GD.2024.48
14. Determining Sugiyama Topology with Model Order - DROPS, https://drops.dagstuhl.de/storage/00lipics/lipics-vol320-gd2024/LIPIcs.GD.2024.48/LIPIcs.GD.2024.48.pdf
15. [2406.11393] Diagram Control and Model Order for Sugiyama Layouts - arXiv, https://arxiv.org/abs/2406.11393
16. ARCOL: Aspect Ratio Constrained Orthogonal Layout - arXiv, https://arxiv.org/html/2603.29618v1
17. A Walk on the Wild Side: A Shape-First Methodology for Orthogonal Drawings - DROPS, https://drops.dagstuhl.de/storage/00lipics/lipics-vol357-gd2025/LIPIcs.GD.2025.35/LIPIcs.GD.2025.35.pdf
18. Preserving Order during Crossing Minimization in Sugiyama Layouts - SciTePress, https://www.scitepress.org/Papers/2022/108338/108338.pdf
19. nulab/autog: Graph autolayout library in Go - GitHub, https://github.com/nulab/autog
20. An efficient implementation of sugiyama's algorithm for layered graph drawing - SciSpace, https://scispace.com/pdf/an-efficient-implementation-of-sugiyama-s-algorithm-for-2m230eptxq.pdf
21. A Walk on the Wild Side: A Shape-First Methodology for Orthogonal Drawings - DROPS, https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.GD.2025.35
22. DOMUS: Drawing Orthogonal Metrics Using (the) Shape - GitHub, https://github.com/shape-metrics/domus
23. [Literature Review] A Walk on the Wild Side: a Shape-First Methodology for Orthogonal Drawings - Moonlight, https://www.themoonlight.io/en/review/a-walk-on-the-wild-side-a-shape-first-methodology-for-orthogonal-drawings
24. A Walk on the Wild Side: a Shape-First Methodology for Orthogonal Drawings - arXiv, https://arxiv.org/html/2508.19416v1
25. The Turing Test for Graph Drawing Algorithms - The University of Arizona, https://www2.cs.arizona.edu/~kobourov/GD20-turing.pdf
26. The Turing Test for Graph Drawing Algorithms - Research Unit of Computer Graphics | TU Wien, https://www.cg.tuwien.ac.at/research/publications/2020/Purchase-2020-gd/Purchase-2020-gd-paper.pdf
27. HOLA: Human-like Orthogonal Network Layout - UBC Computer Science, https://www.cs.ubc.ca/~tmm/courses/547-15/slides/emily-hola.pdf
28. HOLA: Human-like Orthogonal Network Layout - IEEE Computer Society, https://www.computer.org/csdl/journal/tg/2016/01/07192690/13rRUy0qnLI
29. GitHub - skieffer/hola: Human-like Orthogonal Layout Algorithm, https://github.com/skieffer/hola
30. HOLA: Human-like orthogonal network layout - Monash University, https://research.monash.edu/en/publications/hola-human-like-orthogonal-network-layout/
31. [PDF] Erratum: Fast and Simple Horizontal Coordinate Assignment - Semantic Scholar, https://www.semanticscholar.org/paper/Erratum%3A-Fast-and-Simple-Horizontal-Coordinate-Brandes-Walter/6117d268d7f980d8685b6f89f82113eab96dd874
32. [2008.01252] Erratum: Fast and Simple Horizontal Coordinate Assignment - arXiv, https://arxiv.org/abs/2008.01252
33. Sugiyama Layout — PyGraphistry Documentation, https://pygraphistry.readthedocs.io/en/latest/api/layout/sugiyama.html
34. Ulf Rüegg - DBLP, https://dblp.org/pid/145/0327
35. Layered Graph Layout - yWorks, https://www.yworks.com/pages/layered-graph-layout
36. Hierarchy-Aware Layer Sweep - Christian-Albrechts-Universität zu Kiel, https://rtsys.informatik.uni-kiel.de/~biblio/downloads/theses/alan-mt.pdf
