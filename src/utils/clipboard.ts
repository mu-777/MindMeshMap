/**
 * テキストをクリップボードにコピーする。成功したらtrueを返す。
 *
 * navigator.clipboard はセキュアコンテキスト（https / localhost）でしか使えず、
 * ブラウザによってはユーザー操作起点でないと拒否される。失敗した場合は
 * 一時的なtextareaを作ってdocument.execCommand('copy')にフォールバックする。
 * どちらも失敗したらfalseを返すので、呼び出し側は「手動でコピーしてください」と案内すること
 * （JSONテキストのエクスポートでは、テキストエリア自体が手動コピーの逃げ道になっている）。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // execCommandのフォールバックへ進む
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    // 画面外に置く（display:noneやvisibility:hiddenだと選択できずコピーできない）。
    // readOnlyにしないとiOSでソフトキーボードが立ち上がることがある
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
