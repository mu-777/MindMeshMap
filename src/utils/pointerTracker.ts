// 直近のポインタ操作がタッチ由来だったかどうかを追跡するユーティリティ。
//
// armed-focus方式（CustomNode参照）では、ノードが選択された時点でTiptapエディタに
// 常時フォーカスを当てておくことでIMEの1文字目問題を解消しているが、この自動フォーカスを
// タッチ操作直後にも適用してしまうと、1タップ目でソフトキーボードが開いてしまい
// 「1タップ目=選択のみ、2タップ目=編集」というモバイルの意図した操作フローが崩れる。
// そのため、直近の操作がタッチ由来だったかをここで保持し、armed判定から除外する
let lastInteractionWasTouch = false;

if (typeof window !== 'undefined') {
  // capture不要（他のリスナーのstopPropagationの影響を受けたくないのでcaptureフェーズで購読）
  window.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      lastInteractionWasTouch = e.pointerType === 'touch';
    },
    { capture: true, passive: true }
  );
}

export function wasLastInteractionTouch(): boolean {
  return lastInteractionWasTouch;
}
