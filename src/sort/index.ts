import { Configuration } from '../config';
import {
  ImportNode,
  UnusedId,
} from '../parser';

export default function sortImports(
  nodes: ImportNode[],
  usedIds: Set<string>,
  unusedIds: UnusedId[],
  config: Configuration,
) {
  const usedNodes = nodes
    .map(n => n.removeUnusedNames(usedIds, unusedIds))
    .filter((n): n is ImportNode => !!n);
  return groupNodes(usedNodes, config).map(g => sortAndMergeNodes(g));
}

function groupNodes(nodes: ImportNode[], config: Configuration) {
  const DEFAULT_LEVEL = 20;
  const { groupRules } = config;
  const groups = new Map<number, ImportNode[]>();
  const scripts: ImportNode[] = [];
  nodes.forEach(n => {
    if (n.isScript) return scripts.push(n);
    if (groupRules)
      for (const r of groupRules) if (n.match(r.regex)) return addNode(n, r.level, groups);
    addNode(n, DEFAULT_LEVEL, groups);
  });
  return [
    ...(scripts.length ? [scripts] : []),
    // Sort groups by level.
    ...[...groups.entries()].sort(([a], [b]) => a - b).map(([_, g]) => g),
  ];
}

function addNode(node: ImportNode, level: number, groups: Map<number, ImportNode[]>) {
  const g = groups.get(level) ?? [];
  g.push(node);
  groups.set(level, g);
}

function sortAndMergeNodes(nodes: ImportNode[]) {
  const merged = nodes
    .sort((a, b) => a.compare(b))
    .reduce((r, n) => {
      if (!r.length) return [n];
      const last = r[r.length - 1];
      if (last.merge(n)) return r;
      return [...r, n];
    }, new Array<ImportNode>());
  merged.forEach(n => n.sortBindingNames());
  // Sort nodes again because binding names may have changed.
  return merged.sort((a, b) => a.compare(b));
}
