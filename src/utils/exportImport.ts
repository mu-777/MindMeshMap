import { MindMap } from '../types';

/**
 * マップをJSONファイルとしてダウンロードする
 */
export function exportMapAsJson(map: MindMap): void {
  const json = JSON.stringify(map, null, 2);
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

/**
 * インポートされたJSON文字列をパースし、MindMapとして最低限の形状を検証する。
 * パース失敗・形状不正・エッジの参照先ノード欠落のいずれかの場合はnullを返す。
 * layoutDirectionが'DOWN'|'RIGHT'以外の場合は'RIGHT'に矯正する。
 */
export function parseImportedMap(jsonText: string): MindMap | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const map = parsed as Record<string, unknown>;

  if (typeof map.name !== 'string') return null;
  if (!Array.isArray(map.nodes) || !map.nodes.every(isValidNodeShape)) return null;
  if (!Array.isArray(map.edges) || !map.edges.every(isValidEdgeShape)) return null;

  const nodeIds = new Set(map.nodes.map((node) => node.id));
  const hasDanglingEdge = map.edges.some(
    (edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target)
  );
  if (hasDanglingEdge) return null;

  if (map.layoutDirection !== 'DOWN' && map.layoutDirection !== 'RIGHT') {
    map.layoutDirection = 'RIGHT';
  }

  return map as unknown as MindMap;
}
