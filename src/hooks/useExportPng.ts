import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toPng } from 'html-to-image';
import { useReactFlow, getNodesBounds, getViewportForBounds } from '@xyflow/react';
import { useMapStore } from '../stores/mapStore';
import { useToastStore } from '../stores/toastStore';

// PNGエクスポート画像の設定値。ここを変えれば書き出し画像の見た目・サイズを調整できる
const MAX_IMAGE_SIZE = 4096; // 画像の長辺の上限（px）。巨大なマップでもブラウザが固まらないようにクランプする
const EXPORT_PADDING = 0.1;
const EXPORT_MIN_ZOOM = 0.1;
const EXPORT_MAX_ZOOM = 2;
const EXPORT_BACKGROUND_COLOR = '#111827'; // bg-gray-900相当

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
      const bounds = getNodesBounds(nodes);

      // 縦横比を保ったまま、長辺がMAX_IMAGE_SIZEを超えないようにスケールする
      const scale = Math.min(1, MAX_IMAGE_SIZE / bounds.width, MAX_IMAGE_SIZE / bounds.height);
      const imageWidth = Math.max(1, Math.round(bounds.width * scale));
      const imageHeight = Math.max(1, Math.round(bounds.height * scale));

      const viewport = getViewportForBounds(
        bounds,
        imageWidth,
        imageHeight,
        EXPORT_MIN_ZOOM,
        EXPORT_MAX_ZOOM,
        EXPORT_PADDING
      );

      const viewportElement = document.querySelector('.react-flow__viewport') as HTMLElement | null;
      if (!viewportElement) {
        throw new Error('react-flow__viewport element not found');
      }

      const dataUrl = await toPng(viewportElement, {
        backgroundColor: EXPORT_BACKGROUND_COLOR,
        width: imageWidth,
        height: imageHeight,
        style: {
          width: `${imageWidth}px`,
          height: `${imageHeight}px`,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
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
