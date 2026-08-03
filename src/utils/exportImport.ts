import { MindMap } from '../types';
import { generateId } from './idGenerator';

// エクスポートするJSONのインデント幅。人がテキストエリアで読む・チャットに貼ることを
// 想定して整形済み（2スペース）で出す。ファイル版・テキスト版で同じ文字列を使う
const JSON_INDENT = 2;

/**
 * マップをエクスポート用のJSONテキストに変換する。
 * JSONファイルのダウンロード（exportMapAsJson）とJSONテキストのコピーで共通の文字列を使う。
 */
export function serializeMapToJsonText(map: MindMap): string {
  return JSON.stringify(map, null, JSON_INDENT);
}

/**
 * 指定したノードIDだけを含む部分マップ（誘導部分グラフ）を切り出す。
 *
 * エッジは**両端が選択に含まれるものだけ**を残す。片端だけのエッジを残すと
 * parseImportedMapの参照切れ検証に引っかかり、自分でエクスポートしたJSONを
 * 自分でインポートできなくなるため（docs/decisions.md §58）。
 * name等のメタデータは元のマップのまま引き継ぐ（インポート側でDrive未保存の
 * 新規マップとして扱われるので、id/createdAtをここで作り直す必要はない）。
 */
export function pickSubMap(map: MindMap, nodeIds: string[]): MindMap {
  const ids = new Set(nodeIds);
  return {
    ...map,
    nodes: map.nodes.filter((node) => ids.has(node.id)),
    edges: map.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
  };
}

/**
 * マップのノード・エッジのIDをすべて新しいIDに振り直したコピーを返す
 * （エッジのsource/targetも新IDへ張り替える）。
 *
 * 「今のマップに追加」でインポートするときに使う。既存ノードとのID衝突を防ぐためで、
 * **同じJSONを2回追加すれば別々のツリーが2つできる**（IDが同じものを同一視して
 * マージすることはしない。docs/decisions.md §60）。
 */
export function regenerateMapIds(map: MindMap): MindMap {
  const idMap = new Map(map.nodes.map((node) => [node.id, generateId()]));
  return {
    ...map,
    nodes: map.nodes.map((node) => ({ ...node, id: idMap.get(node.id)! })),
    // 端点が欠けたエッジはparseImportedMapで弾かれている前提なので、ここでは必ず引ける
    edges: map.edges.map((edge) => ({
      ...edge,
      id: generateId(),
      source: idMap.get(edge.source)!,
      target: idMap.get(edge.target)!,
    })),
  };
}

/**
 * マップをJSONファイルとしてダウンロードする
 */
export function exportMapAsJson(map: MindMap): void {
  const json = serializeMapToJsonText(map);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${map.name}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ノードの形状チェック（id: string / content: string / position.{x,y}: number）
function isValidNodeShape(
  value: unknown
): value is { id: string; content: string; position: { x: number; y: number } } {
  if (!value || typeof value !== 'object') return false;
  const node = value as Record<string, unknown>;
  if (typeof node.id !== 'string' || typeof node.content !== 'string') return false;

  const position = node.position;
  if (!position || typeof position !== 'object') return false;
  const { x, y } = position as Record<string, unknown>;
  return typeof x === 'number' && typeof y === 'number';
}

// エッジの形状チェック（id / source / target: string）
function isValidEdgeShape(
  value: unknown
): value is { id: string; source: string; target: string } {
  if (!value || typeof value !== 'object') return false;
  const edge = value as Record<string, unknown>;
  return (
    typeof edge.id === 'string' &&
    typeof edge.source === 'string' &&
    typeof edge.target === 'string'
  );
}

// インポート失敗の理由。手書き・貼り付けのJSONを直す手がかりになるよう、
// 「JSONとして壊れている」「マップの形が違う」「エッジの参照先がない」を区別する
// （i18nキー importError.<reason> に1対1で対応する）
export type ImportErrorReason = 'empty' | 'invalidJson' | 'invalidShape' | 'danglingEdge';

export type ImportResult =
  | { ok: true; map: MindMap }
  | { ok: false; reason: ImportErrorReason };

/**
 * インポートされたJSON文字列をパースし、MindMapとして最低限の形状を検証する。
 * 失敗時は理由（ImportErrorReason）を返すので、呼び出し側でメッセージを出し分けられる。
 * layoutDirectionが'DOWN'|'RIGHT'以外の場合は'RIGHT'に矯正する。
 */
export function parseImportedMap(jsonText: string): ImportResult {
  if (!jsonText.trim()) return { ok: false, reason: 'empty' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, reason: 'invalidJson' };
  }

  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'invalidShape' };
  const map = parsed as Record<string, unknown>;

  if (typeof map.name !== 'string') return { ok: false, reason: 'invalidShape' };
  if (!Array.isArray(map.nodes) || !map.nodes.every(isValidNodeShape)) {
    return { ok: false, reason: 'invalidShape' };
  }
  if (!Array.isArray(map.edges) || !map.edges.every(isValidEdgeShape)) {
    return { ok: false, reason: 'invalidShape' };
  }

  const nodeIds = new Set(map.nodes.map((node) => node.id));
  const hasDanglingEdge = map.edges.some(
    (edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target)
  );
  if (hasDanglingEdge) return { ok: false, reason: 'danglingEdge' };

  if (map.layoutDirection !== 'DOWN' && map.layoutDirection !== 'RIGHT') {
    map.layoutDirection = 'RIGHT';
  }

  return { ok: true, map: map as unknown as MindMap };
}
