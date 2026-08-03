import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { useMapStore } from '../stores/mapStore';
import { useUIStore } from '../stores/uiStore';
import { useConfirmStore } from '../stores/confirmStore';
import { parseImportedMap, regenerateMapIds, ImportErrorReason } from '../utils/exportImport';

// インポート先。'replace' は今のマップを読み込んだマップで置き換える（従来の挙動）、
// 'append' は今のマップを残したまま別のツリーとして追加する（docs/decisions.md §60）
export type ImportTarget = 'replace' | 'append';

// インポートの結果。'cancelled' は未保存の変更があるときの確認ダイアログでユーザーが
// キャンセルした場合（＝失敗ではないのでエラー表示しない）
export type ImportOutcome =
  | { status: 'applied'; target: ImportTarget; nodeCount: number }
  | { status: 'cancelled' }
  | { status: 'invalid'; reason: ImportErrorReason };

/**
 * JSONテキストからマップを読み込んでエディタに反映する。
 * JSONファイルのインポートとJSONテキストのインポートで、検証・未保存確認・
 * 「Drive未保存の新規マップとして扱う」扱いを共通化するためのフック。
 */
export function useImportMap() {
  const { t } = useTranslation();
  const { isDirty, setCurrentMap, setDirty, appendNodesAndEdges } = useMapStore();
  const { setMultiSelection } = useUIStore();
  const { requestConfirm } = useConfirmStore();
  const { fitView } = useReactFlow();

  const importFromJsonText = useCallback(
    async (jsonText: string, target: ImportTarget = 'replace'): Promise<ImportOutcome> => {
      const result = parseImportedMap(jsonText);
      if (!result.ok) return { status: 'invalid', reason: result.reason };

      if (target === 'append') {
        // 今のマップは残るので未保存確認は要らない（何も失われない）。
        // IDを振り直してから足すことで、同じJSONを2回読んでも別のツリーになる
        const incoming = regenerateMapIds(result.map);
        appendNodesAndEdges(incoming.nodes, incoming.edges);
        // 座標はそのままなので既存ノードと重なりうる。追加分を選択状態にしておくと、
        // そのままドラッグや整列（Ctrl+Shift+L）でまとめて動かせる
        setMultiSelection(incoming.nodes.map((node) => node.id));
        setTimeout(() => fitView(), 50);
        return { status: 'applied', target, nodeCount: incoming.nodes.length };
      }

      if (isDirty) {
        const confirmed = await requestConfirm(t('dialogs.unsavedChangesContinue'));
        if (!confirmed) return { status: 'cancelled' };
      }

      // インポートしたマップはDrive未保存の状態として扱う（fileIdなし・isDirty=true）
      setCurrentMap(result.map, null);
      setDirty(true);
      setTimeout(() => fitView(), 50);
      return { status: 'applied', target, nodeCount: result.map.nodes.length };
    },
    [
      isDirty,
      requestConfirm,
      setCurrentMap,
      setDirty,
      appendNodesAndEdges,
      setMultiSelection,
      fitView,
      t,
    ]
  );

  return { importFromJsonText };
}
