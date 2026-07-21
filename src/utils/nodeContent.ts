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
