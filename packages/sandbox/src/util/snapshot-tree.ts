import chalk from "chalk";
import { timeAgo } from "./output";

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

export type RenderSnapshotTreeParams =
  | {
      currentSnapshotId: string;
      currentSnapshotExpiresAt?: number;
      ancestors: TreeResponse;
      descendants: TreeResponse;
      current?: TreeNode;
      hideCurrent?: false;
    }
  | {
      /**
       * Suppress the "current" snapshot node. Used when rendering a
       * single-direction paginated view, where the anchor was already shown
       * on the previous page.
       */
      hideCurrent: true;
      ancestors: TreeResponse;
      descendants: TreeResponse;
    };

function formatExpires(expiresAt: number | undefined): string {
  if (expiresAt === undefined) {
    return chalk.gray("never");
  }

  const ms = expiresAt - Date.now();
  if (ms <= 0) {
    return chalk.red("expired");
  }

  const formatted = timeAgo(expiresAt);
  return ms <= 60 * 60 * 1000 ? chalk.red(formatted) : chalk.green(formatted);
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
  const totalCount = parseInt(count, 10);
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
  const { ancestors, descendants } = params;
  const hideCurrent = params.hideCurrent === true;
  const currentSnapshotId = hideCurrent ? undefined : params.currentSnapshotId;
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
  if (!hideCurrent) {
    const { currentSnapshotId: id, currentSnapshotExpiresAt } = params;
    const currentTreeNode =
      params.current ??
      ancestors.snapshots.find((n) => n.snapshot.id === id) ??
      descendants.snapshots.find((n) => n.snapshot.id === id);
    const currentNode: TreeNode = currentTreeNode ?? {
      snapshot: {
        id,
        sourceSessionId: "",
        expiresAt: currentSnapshotExpiresAt,
      },
      siblings: [],
      count: "1",
    };
    pushNode(currentNode, true);
  }

  // Ancestors (parent at top, root at bottom)
  const ancestorNodes = ancestors.snapshots.filter(
    (n) => n.snapshot.id !== currentSnapshotId,
  );
  for (const node of ancestorNodes) {
    pushNode(node, false);
  }

  // Root marker: only meaningful in the bidirectional (non-paginated) view.
  // In a single-direction paginated view we can't tell whether the root has
  // been reached from ancestors alone, and it would be wrong to render
  // "(root)" when paginating descendants.
  if (!hideCurrent) {
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
  }

  return lines.join("\n");
}
