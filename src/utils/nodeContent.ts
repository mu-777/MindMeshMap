// 新規作成ノードの初期content（Tiptap JSON文字列）。
//
// テキストを空（paragraphのみ）にしている理由:
//  - Placeholder拡張が案内文言を表示するため、空でも「入力してください」と分かる。
//  - 「作成直後にタイプ開始したら既存テキストを消して置き換える」ためのクリア処理
//    （clearContent）が不要になる。clearContentはProseMirrorのドキュメントをまるごと
//    差し替えるトランザクションで、IMEのcomposition開始と同じタイミングで走ると
//    進行中のcompositionを壊し「1文字目だけ英数字になる」不具合の一因になっていた。
//    空ノードにすることでこの処理自体を撤廃できる。詳細は docs/decisions.md §13 参照。
export const EMPTY_NODE_CONTENT = JSON.stringify({
  type: 'doc',
  content: [{ type: 'paragraph' }],
});

// 空ノード（EMPTY_NODE_CONTENT）がレンダリングされたときの実寸（flow座標）。1行ぶんの高さと
// 最小幅で決まるので定数として扱える。CustomNodeのクラス（`min-w-[150px]` / `px-3 py-2` /
// `border-2` / 本文の行高）を変えたらこの値も測り直す（実測方法: React Flowノードの
// boundingBox ÷ ズーム倍率）。
// 用途は「まだReact Flowの実測(node.measured)が無い作成直後のノードの寸法が要る」場所だけ。
// 既存ノードの寸法フォールバックには sugiyamaExtLayout.ts の DEFAULT_NODE_WIDTH/HEIGHT を使う
// （あちらは「サイズ不明なノードの代表値」で、こちらは「空ノードの実寸」なので別物）
export const EMPTY_NODE_WIDTH = 150;
export const EMPTY_NODE_HEIGHT = 44;
