import type { PaneModel, PtyOptions, SplitDirection } from "./types.js";

export type PaneFactory = (options: PtyOptions) => PaneModel;

let idCounter = 0;

export function splitPane(
  root: PaneModel,
  targetId: string,
  direction: SplitDirection,
  newPtyOptions: PtyOptions,
  createPane?: PaneFactory,
): PaneModel {
  const usedIds = new Set(collectNodes(root).map((node) => node.id));
  return splitPaneAt(root, targetId, direction, newPtyOptions, usedIds, createPane);
}

function splitPaneAt(
  root: PaneModel,
  targetId: string,
  direction: SplitDirection,
  newPtyOptions: PtyOptions,
  usedIds: Set<string>,
  createPane?: PaneFactory,
): PaneModel {
  if (root.id === targetId && !root.children) {
    const newPane = createPane?.(newPtyOptions) ?? {
      id: nextUniqueId(usedIds, "pane"),
      ptyOptions: newPtyOptions,
    };
    return {
      id: nextUniqueId(usedIds, "split"),
      direction,
      children: [{ id: root.id, ptyOptions: root.ptyOptions }, newPane],
    };
  }

  if (!root.children) return root;

  return {
    ...root,
    children: root.children.map((child) =>
      splitPaneAt(child, targetId, direction, newPtyOptions, usedIds, createPane),
    ),
  };
}

export interface ClosePaneResult {
  root: PaneModel | undefined;
  focusedId: string | undefined;
}

export async function closePane(
  root: PaneModel,
  targetId: string,
  terminateLeaf: (leaf: PaneModel) => Promise<void>,
): Promise<ClosePaneResult> {
  const leaves = collectLeaves(root);
  const targetIndex = leaves.findIndex((leaf) => leaf.id === targetId);
  const target = leaves[targetIndex];
  if (!target) return { root, focusedId: undefined };

  await terminateLeaf(target);
  const nextRoot = removeLeaf(root, targetId);
  const nextLeaves = nextRoot ? collectLeaves(nextRoot) : [];
  const focusedId = nextLeaves[Math.min(targetIndex, nextLeaves.length - 1)]?.id;
  return { root: nextRoot, focusedId };
}

export function findPane(root: PaneModel, id: string): PaneModel | undefined {
  if (root.id === id) return root;
  if (!root.children) return undefined;

  for (const child of root.children) {
    const found = findPane(child, id);
    if (found) return found;
  }
  return undefined;
}

export function nextLeaf(root: PaneModel, currentId: string): string | undefined {
  const leaves = collectLeaves(root);
  const index = leaves.findIndex((leaf) => leaf.id === currentId);
  if (index === -1 || index === leaves.length - 1) return leaves[0]?.id;
  return leaves[index + 1]?.id;
}

export function prevLeaf(root: PaneModel, currentId: string): string | undefined {
  const leaves = collectLeaves(root);
  const index = leaves.findIndex((leaf) => leaf.id === currentId);
  if (index <= 0) return leaves[leaves.length - 1]?.id;
  return leaves[index - 1]?.id;
}

function collectLeaves(root: PaneModel): PaneModel[] {
  if (!root.children) return [root];
  return root.children.flatMap(collectLeaves);
}

export function removeLeaf(root: PaneModel, targetId: string): PaneModel | undefined {
  const target = findPane(root, targetId);
  if (target === undefined || target.children !== undefined) return root;

  return removeNode(root, targetId);
}

function removeNode(root: PaneModel, targetId: string): PaneModel | undefined {
  if (root.id === targetId) return undefined;
  if (!root.children) return root;

  let nextChildren: PaneModel[] | undefined;
  for (const [index, child] of root.children.entries()) {
    const nextChild = removeNode(child, targetId);
    if (nextChild === child) {
      if (nextChildren !== undefined) nextChildren.push(child);
      continue;
    }

    nextChildren ??= root.children.slice(0, index);
    if (nextChild !== undefined) nextChildren.push(nextChild);
  }

  if (nextChildren === undefined) return root;
  if (nextChildren.length === 0) return undefined;
  return { ...root, children: nextChildren };
}

function collectNodes(root: PaneModel): PaneModel[] {
  return [root, ...(root.children?.flatMap(collectNodes) ?? [])];
}

function nextUniqueId(usedIds: Set<string>, prefix: string): string {
  let id = "";
  do {
    id = `${prefix}-${++idCounter}`;
  } while (usedIds.has(id));
  usedIds.add(id);
  return id;
}
