// OGP画像の生成スクリプト（ロケール別）。
//   en → public/og-image.png     （デフォルト。index.html の og:image が参照）
//   ja → public/og-image.ja.png  （日本語版。共有URLをロケール別に用意する場合の手動用）
// 実行: リポジトリルートで `node docs/assets/og-image.gen.mjs`
//   （devDependency の playwright + Chromium で HTML をスクリーンショット）
// 文言の調整は下の LOCALES / 共通の TITLE・URL、グラフの見た目は nodes / edges を編集する。
//
// 注意: OGP画像は「1URL＝1枚」で静的に固定され、閲覧者の言語でSNS側が自動切替することはできない
//       （クローラはJS非実行、GitHub Pagesはロケール別HTMLの出し分け不可）。
//       そのため「共有時に必ず出る」デフォルトを英語(og-image.png)にしている。
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const W = 1200, H = 630;
const TITLE_HTML = 'Mind<span class="mesh">Mesh</span>Map'; // ブランド名（全ロケール共通）
const URL_TEXT = 'mu-777.github.io/MindMeshMap';

// --- 右側グラフの配置（循環 A→B→C→D→A ＋ メッシュ横断リンク A→M→C）。座標は全ロケール共通 ---
const geometry = {
  A: { x: 758, y: 190, w: 142, h: 62 },
  B: { x: 1042, y: 218, w: 142, h: 62 },
  C: { x: 990, y: 452, w: 142, h: 62 },
  D: { x: 702, y: 408, w: 142, h: 62 },
  M: { x: 876, y: 318, w: 142, h: 62, selected: true },
};
// 中心ノード(M)を軸に外周4ノードを時計回りに回転（画面上の向き）。
// Diverge→右, Connect→右下, Verify→下, Converge→左上、と全体が少し回った配置になる。
const GRAPH_ROTATE_DEG = 12;
{
  const th = (GRAPH_ROTATE_DEG * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
  const px = geometry.M.x, py = geometry.M.y; // 中心は固定
  for (const [id, n] of Object.entries(geometry)) {
    if (id === 'M') continue;
    const dx = n.x - px, dy = n.y - py;
    n.x = px + dx * c - dy * s;
    n.y = py + dx * s + dy * c;
  }
}
// 左のロゴ＋タイトルのロックアップとの間に余白を作り、グラフを画面右半分の中央に寄せる。
// タイトルとの詰まり／右余白を微調整したいときはこの値を変える。
const GRAPH_OFFSET = { x: 24, y: 26 };
for (const n of Object.values(geometry)) { n.x += GRAPH_OFFSET.x; n.y += GRAPH_OFFSET.y; }
// bow は弧の張り出し量。ループ(A→B→C→D→A)は負値で外側（中心と反対）へ膨らませる。
const edges = [
  { from: 'A', to: 'B', cycle: true, bow: -26 },
  { from: 'B', to: 'C', cycle: true, bow: -30 },
  { from: 'C', to: 'D', cycle: true, bow: -26 },
  { from: 'D', to: 'A', cycle: true, bow: -30 },
  { from: 'A', to: 'M', bow: -14 },
  { from: 'M', to: 'C', bow: -14 },
];

// --- ロケール別の文言 ---
const LOCALES = {
  en: {
    out: '../../public/og-image.png',
    tagline: ['A graph-structured mind map editor', 'that allows cycles'],
    taglineFont: 30,
    chips: ['Auto Layout', 'Keyboard-first', 'Rich text', 'Google Drive sync'],
    labels: { A: 'Diverge', B: 'Connect', C: 'Verify', D: 'Converge', M: 'Merge' },
    nodeFont: 21,
  },
  ja: {
    out: '../../public/og-image.ja.png',
    tagline: ['循環を含むグラフ構造が描ける', 'マインドマップエディタ'],
    taglineFont: 29,
    chips: ['自動レイアウト', 'キーボード操作', 'リッチテキスト', 'Google Drive同期'],
    labels: { A: '発散', B: '連想', C: '検証', D: '収束', M: '統合' },
    nodeFont: 22,
  },
};

// 矩形中心から境界までの距離（単位ベクトル方向）
function borderDist(n, ux, uy) {
  const hw = n.w / 2, hh = n.h / 2;
  const tx = Math.abs(ux) < 1e-6 ? Infinity : hw / Math.abs(ux);
  const ty = Math.abs(uy) < 1e-6 ? Infinity : hh / Math.abs(uy);
  return Math.min(tx, ty);
}

function edgePath(e) {
  const s = geometry[e.from], t = geometry[e.to];
  const dx = t.x - s.x, dy = t.y - s.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const gap = 7;
  const p0 = { x: s.x + ux * (borderDist(s, ux, uy) + gap), y: s.y + uy * (borderDist(s, ux, uy) + gap) };
  const tStart = borderDist(t, ux, uy) + gap + 6; // 矢印分の余白
  const p1 = { x: t.x - ux * tStart, y: t.y - uy * tStart };
  const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
  const px = -uy, py = ux; // 垂直方向
  const bow = e.bow ?? 0;
  const cx = mx + px * bow, cy = my + py * bow;
  const ang = (Math.atan2(p1.y - cy, p1.x - cx) * 180) / Math.PI; // 終点接線 → 矢印角度
  return { d: `M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`, tip: p1, ang };
}

const edgeSvg = edges.map((e) => {
  const { d, tip, ang } = edgePath(e);
  const stroke = e.cycle ? '#63b3ed' : '#3f5a7d';
  const width = e.cycle ? 3.4 : 2.6;
  const op = e.cycle ? 0.95 : 0.7;
  const a = 9;
  const arrow = `<g transform="translate(${tip.x.toFixed(1)} ${tip.y.toFixed(1)}) rotate(${ang.toFixed(1)})">
      <path d="M 0 0 L ${-a} ${-a * 0.6} L ${-a * 0.7} 0 L ${-a} ${a * 0.6} Z" fill="${stroke}" opacity="${op}"/>
    </g>`;
  return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" opacity="${op}"/>${arrow}`;
}).join('\n');

// public/logo.svg のメッシュモチーフを流用したロゴマーク
const logoMark = `<svg class="brandmark" viewBox="50 50 100 100" width="62" height="62">
  <g stroke="#5b9fe6" stroke-width="2.4" fill="none" opacity="0.55" stroke-linecap="round">
    <path d="M 72.5 100 Q 86.25 85 100 85"/><path d="M 72.5 100 Q 86.25 115 100 115"/>
    <path d="M 100 85 Q 105 100 100 115"/>
    <path d="M 100 85 Q 113.75 70 127.5 70"/><path d="M 100 85 Q 113.75 110 127.5 110"/>
    <path d="M 100 115 Q 113.75 90 127.5 90"/><path d="M 100 115 Q 113.75 130 127.5 130"/>
    <path d="M 129.5 70 Q 135 80 129.5 90"/><path d="M 129.5 110 Q 135 120 129.5 130"/>
  </g>
  <g>
    <circle cx="72.5" cy="100" r="7" fill="#5b9fe6" stroke="#63b3ed" stroke-width="2"/>
    <circle cx="100" cy="85" r="7" fill="#5b9fe6" stroke="#63b3ed" stroke-width="2"/>
    <circle cx="100" cy="115" r="7" fill="#5b9fe6" stroke="#63b3ed" stroke-width="2"/>
    <circle cx="127.5" cy="70" r="7" fill="#5b9fe6" stroke="#63b3ed" stroke-width="2"/>
    <circle cx="127.5" cy="90" r="7" fill="#5b9fe6" stroke="#63b3ed" stroke-width="2"/>
    <circle cx="127.5" cy="110" r="7" fill="#5b9fe6" stroke="#63b3ed" stroke-width="2"/>
    <circle cx="127.5" cy="130" r="7" fill="#5b9fe6" stroke="#63b3ed" stroke-width="2"/>
  </g>
</svg>`;

function buildHtml(loc) {
  const nodeHtml = Object.entries(geometry).map(([id, n]) => {
    const left = n.x - n.w / 2, top = n.y - n.h / 2;
    const cls = n.selected ? 'node sel' : 'node';
    return `<div class="${cls}" style="left:${left}px;top:${top}px;width:${n.w}px;height:${n.h}px">${loc.labels[id]}</div>`;
  }).join('\n');
  const chips = loc.chips.map((c) => `<span class="chip">${c}</span>`).join('');
  const tagline = loc.tagline.join('<br>');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${W}px; height:${H}px; }
  .stage {
    position:relative; width:${W}px; height:${H}px; overflow:hidden;
    font-family:'Meiryo','DejaVu Sans',sans-serif;
    background:
      radial-gradient(760px 620px at 86% 46%, rgba(59,130,246,0.20), rgba(59,130,246,0) 62%),
      radial-gradient(680px 520px at 8% 14%, rgba(96,165,250,0.10), rgba(96,165,250,0) 60%),
      linear-gradient(150deg, #0b1120 0%, #0f1830 52%, #0b111f 100%);
  }
  .dots { position:absolute; inset:0;
    background-image: radial-gradient(rgba(148,163,184,0.10) 1.3px, transparent 1.3px);
    background-size: 30px 30px; background-position: -6px -6px; }
  .glowline { position:absolute; left:0; top:0; width:6px; height:100%;
    background:linear-gradient(180deg,#3b82f6,#63b3ed 55%,#5b9fe6); box-shadow:0 0 24px rgba(59,130,246,0.6); }
  .left { position:absolute; left:74px; top:0; height:100%; width:585px;
    display:flex; flex-direction:column; justify-content:center; }
  .titlerow { display:flex; align-items:center; gap:18px; }
  .brandmark { flex:0 0 auto; }
  .title { color:#f1f5f9; font-size:68px; font-weight:800; line-height:1.02; letter-spacing:-1px;
    text-shadow:0 2px 20px rgba(0,0,0,0.4); }
  .title .mesh { color:#63b3ed; }
  .tagline { margin-top:24px; margin-left:24px; color:#cbd5e1; font-size:${loc.taglineFont}px; font-weight:700; line-height:1.5; }
  .chips { margin-top:32px; margin-left:24px; display:flex; flex-wrap:wrap; gap:11px; max-width:520px; }
  .chip { font-size:18px; font-weight:700; color:#9fc4f5; padding:8px 15px; border-radius:999px;
    background:rgba(59,130,246,0.12); border:1px solid rgba(96,165,250,0.34); }
  .url { margin-top:38px; margin-left:24px; color:#93c5fd; font-size:21px; font-weight:700; letter-spacing:0.5px;
    display:flex; align-items:center; gap:10px; }
  .url .uicon { flex:0 0 auto; opacity:0.85; }

  .graph { position:absolute; inset:0; }
  .node { position:absolute; display:flex; align-items:center; justify-content:center;
    color:#e6edf6; font-size:${loc.nodeFont}px; font-weight:700; border-radius:12px;
    background:linear-gradient(180deg,#243244,#1b2636); border:2px solid #3a495e;
    box-shadow:0 8px 22px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.05); }
  .node.sel { border-color:#3b82f6; box-shadow:0 0 0 4px rgba(59,130,246,0.28), 0 10px 26px rgba(0,0,0,0.45); }
  .node::before, .node::after { content:''; position:absolute; width:10px; height:10px; border-radius:50%;
    background:#60a5fa; border:2px solid #24303f; }
  .node::before { left:-6px; top:50%; transform:translateY(-50%); }
  .node::after { right:-6px; top:50%; transform:translateY(-50%); }
</style></head>
<body>
  <div class="stage">
    <div class="dots"></div>
    <div class="glowline"></div>
    <svg class="graph" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${edgeSvg}</svg>
    <div class="graph">${nodeHtml}</div>
    <div class="left">
      <div class="titlerow">${logoMark}<div class="title">${TITLE_HTML}</div></div>
      <div class="tagline">${tagline}</div>
      <div class="chips">${chips}</div>
      <div class="url"><svg class="uicon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#93c5fd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9s1.3-6.4 3.8-9z"/></svg><b>${URL_TEXT}</b></div>
    </div>
  </div>
</body></html>`;
}

const browser = await chromium.launch();
for (const [code, loc] of Object.entries(LOCALES)) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(buildHtml(loc), { waitUntil: 'networkidle' });
  const outPng = fileURLToPath(new URL(loc.out, import.meta.url));
  await page.screenshot({ path: outPng });
  await page.close();
  console.log(`[${code}] wrote ${outPng}`);
}
await browser.close();
