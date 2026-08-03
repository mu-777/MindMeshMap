import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { useUIStore } from '../../stores/uiStore';
import { useMapStore } from '../../stores/mapStore';
import { useToastStore } from '../../stores/toastStore';
import { useImportMap, ImportTarget } from '../../hooks/useImportMap';
import { pickSubMap, serializeMapToJsonText } from '../../utils/exportImport';
import { copyTextToClipboard } from '../../utils/clipboard';

// 「コピーしました」の表示を元に戻すまでの時間（ms）
const COPIED_FEEDBACK_MS = 2000;

// 「選択したノードのみ」を選べるようにする最小の選択数。整列（Toolbar.tsxのhandleAutoLayout）と
// 同じ基準にそろえている。1個だけの切り出しは用途が薄いので出さない
const MIN_SELECTION_FOR_PARTIAL_EXPORT = 2;

/**
 * JSONテキストのエクスポート／インポートダイアログ（ファイル経由ではなくクリップボード経由）。
 * モードはuiStoreのjsonTextDialogModeで持つ（開いている間はグローバルショートカットを
 * 止める必要があるため。docs/decisions.md参照）。
 *
 * - export: 現在のマップのJSONを読み取り専用テキストエリアに表示。手動選択でも
 *   「クリップボードにコピー」ボタンでもコピーできる
 * - import: 空のテキストエリアに貼り付け／直接入力し、「読み込む」で検証してから反映する。
 *   検証に失敗したらダイアログは閉じずに理由を表示する（入力を捨てない）
 */
export function JsonTextDialog() {
  const { t } = useTranslation();
  const mode = useUIStore((state) => state.jsonTextDialogMode);
  const closeJsonTextDialog = useUIStore((state) => state.closeJsonTextDialog);
  const selectedNodeIds = useUIStore((state) => state.selectedNodeIds);
  const currentMap = useMapStore((state) => state.currentMap);
  const { addToast } = useToastStore();
  const { importFromJsonText } = useImportMap();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [importText, setImportText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isOnlySelected, setIsOnlySelected] = useState(false);
  const [importTarget, setImportTarget] = useState<ImportTarget>('replace');

  // 部分エクスポートを選べるのは複数選択中のときだけ。ダイアログはモーダルなので、
  // 開いている間に選択が変わることはない
  const canExportSelection = selectedNodeIds.length >= MIN_SELECTION_FOR_PARTIAL_EXPORT;
  // 追加先のマップが無ければ「今のマップに追加」は選べない（置き換えるしかない）
  const canAppend = !!currentMap;

  const exportText = useMemo(() => {
    if (mode !== 'export' || !currentMap) return '';
    const target =
      isOnlySelected && canExportSelection ? pickSubMap(currentMap, selectedNodeIds) : currentMap;
    return serializeMapToJsonText(target);
  }, [mode, currentMap, isOnlySelected, canExportSelection, selectedNodeIds]);

  // ダイアログを開くたびに入力・エラー・コピー表示をリセットする。
  // 「選択したノードのみ」は**常にOFFで開く**（選択中でも既定はマップ全体。
  // エクスポートの既定が状況で変わらないほうが事故らない。docs/decisions.md §59）。
  // エクスポートは開いた直後にCtrl+Cできるよう全選択、インポートはすぐ貼り付けられるようフォーカスする
  useEffect(() => {
    if (!mode) return;
    setImportText('');
    setErrorMessage(null);
    setIsCopied(false);
    setIsOnlySelected(false);
    setImportTarget('replace');
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    if (mode === 'export') textarea.select();
  }, [mode]);

  // コピー完了表示は一定時間で自動的に元に戻す
  useEffect(() => {
    if (!isCopied) return;
    const timer = setTimeout(() => setIsCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [isCopied]);

  const handleCopy = useCallback(async () => {
    const ok = await copyTextToClipboard(exportText);
    if (ok) {
      setIsCopied(true);
      setErrorMessage(null);
    } else {
      setErrorMessage(t('jsonText.copyFailed'));
    }
  }, [exportText, t]);

  const handleImport = useCallback(async () => {
    const outcome = await importFromJsonText(importText, importTarget);
    if (outcome.status === 'invalid') {
      setErrorMessage(t(`importError.${outcome.reason}`));
      return;
    }
    // cancelled（未保存確認でキャンセル）の場合は入力を残したまま開いておく
    if (outcome.status !== 'applied') return;
    addToast({
      type: 'success',
      message:
        outcome.target === 'append'
          ? t('toast.importAppendSuccess', { n: outcome.nodeCount })
          : t('toast.importSuccess'),
    });
    closeJsonTextDialog();
  }, [importText, importTarget, importFromJsonText, addToast, closeJsonTextDialog, t]);

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl/Cmd+Enterで読み込む（テキストエリア内のEnterは改行のままにしたいため修飾キー必須）
      if (mode === 'import' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleImport();
      }
    },
    [mode, handleImport]
  );

  if (!mode) return null;

  const isExport = mode === 'export';

  return (
    <Modal
      isOpen={true}
      onClose={closeJsonTextDialog}
      title={isExport ? t('jsonText.exportTitle') : t('jsonText.importTitle')}
      maxWidthClass="max-w-2xl"
      footer={
        <div className="flex justify-end gap-2">
          {isExport ? (
            <button
              onClick={handleCopy}
              data-testid="json-text-copy"
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            >
              {isCopied ? t('jsonText.copied') : t('jsonText.copy')}
            </button>
          ) : (
            <>
              <button
                onClick={closeJsonTextDialog}
                className="rounded px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleImport}
                data-testid="json-text-load"
                className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
              >
                {t('jsonText.load')}
              </button>
            </>
          )}
        </div>
      }
    >
      <p className="mb-2 text-xs text-gray-400">
        {isExport ? t('jsonText.exportHint') : t('jsonText.importHint')}
      </p>

      {/* 部分エクスポート。複数選択中のときだけ出す（選択が無ければ説明する必要もない） */}
      {isExport && canExportSelection && (
        <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={isOnlySelected}
            onChange={(e) => setIsOnlySelected(e.target.checked)}
            data-testid="json-text-only-selected"
            className="h-4 w-4 cursor-pointer accent-blue-600"
          />
          {t('jsonText.onlySelected', { n: selectedNodeIds.length })}
        </label>
      )}
      {isExport && canExportSelection && isOnlySelected && (
        // エッジが黙って減ることへの説明。両端が選択内にあるエッジしか残さない（decisions.md §58）
        <p className="mb-2 text-xs text-gray-500">{t('jsonText.onlySelectedHint')}</p>
      )}

      {/* インポート先（置き換え／今のマップに追加）。既定は従来どおり置き換え（decisions.md §60） */}
      {!isExport && canAppend && (
        <div className="mb-2 flex flex-col gap-1">
          {(['replace', 'append'] as const).map((target) => (
            <label
              key={target}
              className="flex cursor-pointer items-center gap-2 text-sm text-gray-300"
            >
              <input
                type="radio"
                name="json-text-import-target"
                value={target}
                checked={importTarget === target}
                onChange={() => setImportTarget(target)}
                data-testid={`json-text-target-${target}`}
                className="h-4 w-4 cursor-pointer accent-blue-600"
              />
              {t(target === 'replace' ? 'jsonText.targetReplace' : 'jsonText.targetAppend')}
            </label>
          ))}
          {importTarget === 'append' && (
            // 座標をそのまま使うので既存ノードと重なりうる。ポップアップは出さず、ここに小さく書く
            <p className="text-xs text-gray-500">{t('jsonText.targetAppendHint')}</p>
          )}
        </div>
      )}

      <textarea
        ref={textareaRef}
        data-testid="json-text-area"
        value={isExport ? exportText : importText}
        readOnly={isExport}
        onChange={(e) => {
          setImportText(e.target.value);
          setErrorMessage(null);
        }}
        onKeyDown={handleTextareaKeyDown}
        placeholder={isExport ? undefined : t('jsonText.importPlaceholder')}
        spellCheck={false}
        className="h-[40vh] w-full resize-none rounded border border-gray-600 bg-gray-900 p-3 font-mono text-xs text-gray-200 focus:border-blue-500 focus:outline-none"
      />

      {errorMessage && (
        <p data-testid="json-text-error" className="mt-2 text-sm text-red-400">
          {errorMessage}
        </p>
      )}
    </Modal>
  );
}
