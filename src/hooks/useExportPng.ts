import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toPng } from 'html-to-image';
import { useReactFlow } from '@xyflow/react';
import { useMapStore } from '../stores/mapStore';
import { useToastStore } from '../stores/toastStore';

// PNGエクスポート画像の設定値。ここを変えれば書き出し画像の見た目・サイズを調整できる
const MAX_IMAGE_SIZE = 4096; // 画像の長辺の上限（px）。巨大なマップでもブラウザが固まらないようにクランプする
// エクスポート画像の四辺に付ける余白（px、スケール適用後の実ピクセル数）。
// 以前はgetViewportForBoundsの比率指定（EXPORT_PADDING = 0.1）を使っていたが、
// 内部でzoomをクランプする挙動により右端・下端のノードが見切れる問題があったため、
// 変換（transform）を自前で計算する実装に置き換えた
const EXPORT_PADDING_PX = 40;
const EXPORT_BACKGROUND_COLOR = '#111827'; // bg-gray-900相当
// data-id要素が見つからない場合のフォールバック概算サイズ（px）
const FALLBACK_NODE_WIDTH = 150;
const FALLBACK_NODE_HEIGHT = 60;

/**
 * 現在のマインドマップをPNG画像としてダウンロードするフック。
 * React Flow公式のdownload-imageパターン
 * （https://reactflow.dev/examples/misc/download-image）を踏襲する。
 */
export function useExportPng() {
  const { t } = useTranslation();
  const { getNodes } = useReactFlow();
  const { currentMap } = useMapStore();
  const { addToast } = useToastStore();

  const exportPng = useCallback(async () => {
    if (!currentMap) return;

    try {
      const nodes = getNodes();

      // getNodesBounds()はnode.measured（ResizeObserverによる実測サイズ）を前提にしているが、
      // このアプリではonNodesChangeの'dimensions'変更を状態に反映していないためmeasuredが常に
      // 空で、ノードをサイズ0の点として扱ってしまい右端・下端のノードが見切れていた。
      // そのため実測値はgetNodes()のposition（ドラッグ中の最新値を含む）と、DOM要素の
      // offsetWidth/offsetHeight（transformの影響を受けないレイアウト実寸）から直接組み立てる
      const nodeRects = nodes.map((node) => {
        const el = document.querySelector(`.react-flow__node[data-id="${CSS.escape(node.id)}"]`);
        const width = el instanceof HTMLElement ? el.offsetWidth : FALLBACK_NODE_WIDTH;
        const height = el instanceof HTMLElement ? el.offsetHeight : FALLBACK_NODE_HEIGHT;
        return { x: node.position.x, y: node.position.y, width, height };
      });
      const minX = Math.min(...nodeRects.map((r) => r.x));
      const minY = Math.min(...nodeRects.map((r) => r.y));
      const maxX = Math.max(...nodeRects.map((r) => r.x + r.width));
      const maxY = Math.max(...nodeRects.map((r) => r.y + r.height));
      const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

      // 縦横比を保ったまま、長辺（余白込み）がMAX_IMAGE_SIZEを超えないようにスケールする
      const scale = Math.min(
        1,
        MAX_IMAGE_SIZE / (bounds.width + 2 * EXPORT_PADDING_PX),
        MAX_IMAGE_SIZE / (bounds.height + 2 * EXPORT_PADDING_PX)
      );
      const imageWidth = Math.round((bounds.width + 2 * EXPORT_PADDING_PX) * scale);
      const imageHeight = Math.round((bounds.height + 2 * EXPORT_PADDING_PX) * scale);

      const viewportElement = document.querySelector('.react-flow__viewport') as HTMLElement | null;
      if (!viewportElement) {
        throw new Error('react-flow__viewport element not found');
      }

      // getViewportForBoundsは内部でzoomをクランプするため、余白比率指定だと
      // ノードが多い/大きいマップで意図した余白にならず端が見切れることがあった。
      // ここではflow座標pを画像ピクセルへ写す変換を明示的に計算する：
      // CSSのtranslate→scaleの合成により p は translate + scale*p に写るので、
      // 「bounds.x - PADDING」が画像左端（0px）に来るようtranslateを決める
      const translateX = (EXPORT_PADDING_PX - bounds.x) * scale;
      const translateY = (EXPORT_PADDING_PX - bounds.y) * scale;

      const dataUrl = await toPng(viewportElement, {
        backgroundColor: EXPORT_BACKGROUND_COLOR,
        width: imageWidth,
        height: imageHeight,
        style: {
          width: `${imageWidth}px`,
          height: `${imageHeight}px`,
          transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
        },
      });

      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${currentMap.name}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (error) {
      console.error('PNG export failed:', error);
      addToast({ type: 'error', message: t('toast.exportPngFailed') });
    }
  }, [currentMap, getNodes, addToast, t]);

  return { exportPng };
}
