import chalk from "chalk";

interface SnapshotData {
  id: string;
  sourceSessionId: string;
  expiresAt?: number;
  parentId?: string;
}

interface TreeNode {
  snapshot: SnapshotData;
  siblings: SnapshotData[];
  count: string;
}

interface TreeResponse {
  snapshots: TreeNode[];
  pagination: { count: number; next: string | null };
}

export interface RenderSnapshotTreeParams {
  currentSnapshotId: string;
  currentSnapshotExpiresAt?: number;
  ancestors: TreeResponse;
  descendants: TreeResponse;
}

function compactDuration(expiresAt: number | undefined): string {
  if (expiresAt === undefined) return "never";
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "expired";
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days > 0) return `${days}d`;
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours > 0) return `${hours}h`;
  const minutes = Math.max(1, Math.floor(ms / (1000 * 60)));
  return `${minutes}m`;
}

function formatExpires(expiresAt: number | undefined): string {
  const dur = compactDuration(expiresAt);
  if (dur === "never") return chalk.gray("never");
  if (dur === "expired") return chalk.red("expired");
  const ms = (expiresAt ?? 0) - Date.now();
  return ms <= 60 * 60 * 1000 ? chalk.red(dur) : chalk.green(dur);
}

function renderNode(
  id: string,
  expiresAt: number | undefined,
  isCurrent: boolean,
): string {
  const bullet = isCurrent ? chalk.magenta.bold("●") : chalk.magenta("●");
  const suffix = isCurrent ? `  ${chalk.green("◂ current")}` : "";
  return `${bullet} ${chalk.yellow(id)}   expires: ${formatExpires(expiresAt)}${suffix}`;
}

function renderSiblings(siblings: SnapshotData[], count: string): string[] {
  const lines: string[] = [];
  const maxShow = 5;
  const shown = siblings.slice(0, maxShow);
  const totalCount = parseInt(count);
  const hasPlus = count.endsWith("+");
  const totalSiblings = totalCount - 1; // count includes the main snapshot
  const remaining = totalSiblings - shown.length;

  for (let i = 0; i < shown.length; i++) {
    const isLast = i === shown.length - 1 && remaining <= 0;
    const connector = isLast ? "╰──" : "├──";
    lines.push(`│   ${connector} ${chalk.gray(shown[i].sourceSessionId)}`);
  }

  if (remaining > 0) {
    const suffix = hasPlus ? "+" : "";
    lines.push(
      `│   ╰── ${chalk.gray(`+${remaining}${suffix} more sandboxes`)}`,
    );
  }

  return lines;
}

export function renderSnapshotTree(
  params: RenderSnapshotTreeParams,
): string {
  const {
    currentSnapshotId,
    currentSnapshotExpiresAt,
    ancestors,
    descendants,
  } = params;
  const lines: string[] = [];

  // Helper: push a snapshot node with optional siblings and a trailing connector
  const pushNode = (
    node: TreeNode,
    isCurrent: boolean,
  ) => {
    lines.push("│");
    lines.push(
      renderNode(node.snapshot.id, node.snapshot.expiresAt, isCurrent),
    );
    if (node.siblings.length > 0) {
      lines.push(...renderSiblings(node.siblings, node.count));
    }
  };

  // Descendants (newest at top, reversed from asc order)
  const descendantNodes = descendants.snapshots.filter(
    (n) => n.snapshot.id !== currentSnapshotId,
  );
  if (descendantNodes.length > 0) {
    for (const node of [...descendantNodes].reverse()) {
      pushNode(node, false);
    }
  }

  // Current snapshot
  const currentTreeNode =
    ancestors.snapshots.find(
      (n) => n.snapshot.id === currentSnapshotId,
    ) ??
    descendants.snapshots.find(
      (n) => n.snapshot.id === currentSnapshotId,
    );
  const currentNode: TreeNode = currentTreeNode ?? {
    snapshot: {
      id: currentSnapshotId,
      sourceSessionId: "",
      expiresAt: currentSnapshotExpiresAt,
    },
    siblings: [],
    count: "1",
  };
  pushNode(currentNode, true);

  // Ancestors (parent at top, root at bottom)
  const ancestorNodes = ancestors.snapshots.filter(
    (n) => n.snapshot.id !== currentSnapshotId,
  );
  for (const node of ancestorNodes) {
    pushNode(node, false);
  }

  // Root marker: show when we've reached the end of ancestor pagination
  const lastAncestor = ancestorNodes[ancestorNodes.length - 1];
  const hasReachedEnd = ancestors.pagination.next === null;
  if (hasReachedEnd) {
    if (
      (lastAncestor && !lastAncestor.snapshot.parentId) ||
      ancestorNodes.length === 0
    ) {
      lines.push("│");
      lines.push(`${chalk.white("○")} ${chalk.gray("(root)")}`);
    }
  }

  return lines.join("\n");
}
