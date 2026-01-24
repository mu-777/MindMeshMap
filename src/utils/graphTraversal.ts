import { MapNode, MapEdge } from '../types';

export interface GraphRelations {
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
  siblings: Map<string, string[]>;
}

/**
 * グラフの関係性を構築（循環対応）
 */
export function buildGraphRelations(
  nodes: MapNode[],
  edges: MapEdge[]
): GraphRelations {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const siblings = new Map<string, string[]>();

  // 初期化
  for (const node of nodes) {
    parents.set(node.id, []);
    children.set(node.id, []);
    siblings.set(node.id, []);
  }

  // 親子関係を構築
  for (const edge of edges) {
    const parentList = parents.get(edge.target);
    const childList = children.get(edge.source);

    if (parentList && !parentList.includes(edge.source)) {
      parentList.push(edge.source);
    }
    if (childList && !childList.includes(edge.target)) {
      childList.push(edge.target);
    }
  }

  // 兄弟関係を構築（同じ親を持つノード）
  for (const node of nodes) {
    const nodeParents = parents.get(node.id) || [];
    const siblingSet = new Set<string>();

    for (const parent of nodeParents) {
      const parentChildren = children.get(parent) || [];
      for (const child of parentChildren) {
        if (child !== node.id) {
          siblingSet.add(child);
        }
      }
    }

    siblings.set(node.id, Array.from(siblingSet));
  }

  return { parents, children, siblings };
}

/**
 * ルートノードを取得（親がいないノード）
 */
export function getRootNodes(
  nodes: MapNode[],
  edges: MapEdge[]
): MapNode[] {
  const hasParent = new Set(edges.map((e) => e.target));
  return nodes.filter((node) => !hasParent.has(node.id));
}

/**
 * 親ノードを取得
 */
export function getParentNodes(
  nodeId: string,
  relations: GraphRelations,
  nodes: MapNode[]
): MapNode[] {
  const parentIds = relations.parents.get(nodeId) || [];
  return nodes.filter((n) => parentIds.includes(n.id));
}

/**
 * 子ノードを取得
 */
export function getChildNodes(
  nodeId: string,
  relations: GraphRelations,
  nodes: MapNode[]
): MapNode[] {
  const childIds = relations.children.get(nodeId) || [];
  return nodes.filter((n) => childIds.includes(n.id));
}

/**
 * 兄弟ノードを取得
 */
export function getSiblingNodes(
  nodeId: string,
  relations: GraphRelations,
  nodes: MapNode[]
): MapNode[] {
  const siblingIds = relations.siblings.get(nodeId) || [];
  return nodes.filter((n) => siblingIds.includes(n.id));
}

/**
 * 次の兄弟ノードを取得
 */
export function getNextSibling(
  nodeId: string,
  relations: GraphRelations,
  nodes: MapNode[]
): MapNode | null {
  const siblings = getSiblingNodes(nodeId, relations, nodes);
  if (siblings.length === 0) return null;

  // 位置でソートして次を探す
  const currentNode = nodes.find((n) => n.id === nodeId);
  if (!currentNode) return null;

  const sortedSiblings = [...siblings].sort((a, b) => {
    // 水平方向（x）でソート
    if (a.position.x !== b.position.x) {
      return a.position.x - b.position.x;
    }
    // 垂直方向（y）でソート
    return a.position.y - b.position.y;
  });

  // 現在のノードより右/下にある最初のノード
  for (const sibling of sortedSiblings) {
    if (
      sibling.position.x > currentNode.position.x ||
      (sibling.position.x === currentNode.position.x &&
        sibling.position.y > currentNode.position.y)
    ) {
      return sibling;
    }
  }

  // 見つからなければ最初の兄弟に戻る
  return sortedSiblings[0] || null;
}

/**
 * 前の兄弟ノードを取得
 */
export function getPrevSibling(
  nodeId: string,
  relations: GraphRelations,
  nodes: MapNode[]
): MapNode | null {
  const siblings = getSiblingNodes(nodeId, relations, nodes);
  if (siblings.length === 0) return null;

  const currentNode = nodes.find((n) => n.id === nodeId);
  if (!currentNode) return null;

  const sortedSiblings = [...siblings].sort((a, b) => {
    if (a.position.x !== b.position.x) {
      return b.position.x - a.position.x;
    }
    return b.position.y - a.position.y;
  });

  // 現在のノードより左/上にある最初のノード
  for (const sibling of sortedSiblings) {
    if (
      sibling.position.x < currentNode.position.x ||
      (sibling.position.x === currentNode.position.x &&
        sibling.position.y < currentNode.position.y)
    ) {
      return sibling;
    }
  }

  // 見つからなければ最後の兄弟に戻る
  return sortedSiblings[0] || null;
}

/**
 * 指定方向にある最も近いノードを取得
 */
export function getNearestNodeInDirection(
  nodeId: string,
  direction: 'up' | 'down' | 'left' | 'right',
  nodes: MapNode[]
): MapNode | null {
  const currentNode = nodes.find((n) => n.id === nodeId);
  if (!currentNode) return null;

  const candidates: { node: MapNode; distance: number }[] = [];

  for (const node of nodes) {
    if (node.id === nodeId) continue;

    const dx = node.position.x - currentNode.position.x;
    const dy = node.position.y - currentNode.position.y;

    let isInDirection = false;
    switch (direction) {
      case 'up':
        // 上方向: y が小さく、主に垂直方向
        isInDirection = dy < -10 && Math.abs(dy) > Math.abs(dx) * 0.5;
        break;
      case 'down':
        // 下方向: y が大きく、主に垂直方向
        isInDirection = dy > 10 && Math.abs(dy) > Math.abs(dx) * 0.5;
        break;
      case 'left':
        // 左方向: x が小さく、主に水平方向
        isInDirection = dx < -10 && Math.abs(dx) > Math.abs(dy) * 0.5;
        break;
      case 'right':
        // 右方向: x が大きく、主に水平方向
        isInDirection = dx > 10 && Math.abs(dx) > Math.abs(dy) * 0.5;
        break;
    }

    if (isInDirection) {
      const distance = Math.sqrt(dx * dx + dy * dy);
      candidates.push({ node, distance });
    }
  }

  if (candidates.length === 0) return null;

  // 最も近いノードを返す
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0].node;
}

/**
 * 循環を検出（デバッグ用）
 */
export function detectCycles(edges: MapEdge[]): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) {
      adjacency.set(edge.source, []);
    }
    adjacency.get(edge.source)!.push(edge.target);
  }

  function dfs(node: string): void {
    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const neighbors = adjacency.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (recursionStack.has(neighbor)) {
        // 循環を検出
        const cycleStart = path.indexOf(neighbor);
        if (cycleStart !== -1) {
          cycles.push([...path.slice(cycleStart), neighbor]);
        }
      }
    }

    path.pop();
    recursionStack.delete(node);
  }

  const allNodes = new Set<string>();
  for (const edge of edges) {
    allNodes.add(edge.source);
    allNodes.add(edge.target);
  }

  for (const node of allNodes) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  return cycles;
}
