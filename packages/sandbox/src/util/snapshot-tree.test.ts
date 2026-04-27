import { describe, expect, test, beforeAll, afterAll, vi } from "vitest";
import {
  renderSnapshotTree,
  type RenderSnapshotTreeParams,
} from "./snapshot-tree";

// Strip ANSI escape codes so assertions don't depend on chalk's color level.
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;
const strip = (s: string) => s.replace(ANSI_REGEX, "");

interface SnapshotData {
  id: string;
  sourceSessionId: string;
  expiresAt?: number;
  parentId?: string;
}

function makeSnapshot(overrides: Partial<SnapshotData> = {}): SnapshotData {
  return {
    id: "snap_default",
    sourceSessionId: "sbx_default",
    ...overrides,
  };
}

function makeTreeNode(
  snapshot: SnapshotData,
  siblings: SnapshotData[] = [],
  count?: string,
) {
  return {
    snapshot,
    siblings,
    count: count ?? String(siblings.length + 1),
  };
}

function emptyTree() {
  return {
    snapshots: [] as ReturnType<typeof makeTreeNode>[],
    pagination: { count: 0, next: null },
  };
}

describe("renderSnapshotTree", () => {
  const NOW = 1_700_000_000_000;

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  test("renders only the current snapshot with a root marker when there are no ancestors or descendants", () => {
    const output = renderSnapshotTree({
      currentSnapshotId: "snap_current",
      currentSnapshotExpiresAt: NOW + 7 * 24 * 60 * 60 * 1000,
      ancestors: emptyTree(),
      descendants: emptyTree(),
    });

    const plain = strip(output);
    expect(plain).toContain("snap_current");
    expect(plain).toContain("◂ current");
    expect(plain).toContain("expires: 7d");
    expect(plain).toContain("(root)");
  });

  test("renders current snapshot with ancestors walking upward", () => {
    const current = makeSnapshot({
      id: "snap_current",
      parentId: "snap_parent",
    });
    const parent = makeSnapshot({ id: "snap_parent", parentId: "snap_root" });
    const root = makeSnapshot({ id: "snap_root" });

    const params: RenderSnapshotTreeParams = {
      currentSnapshotId: "snap_current",
      currentSnapshotExpiresAt: NOW + 2 * 60 * 60 * 1000,
      ancestors: {
        snapshots: [makeTreeNode(parent), makeTreeNode(root)],
        pagination: { count: 2, next: null },
      },
      descendants: emptyTree(),
    };

    const plain = strip(renderSnapshotTree(params));
    const currentIdx = plain.indexOf("snap_current");
    const parentIdx = plain.indexOf("snap_parent");
    const rootIdx = plain.indexOf("snap_root");

    // current is above parent, parent is above root
    expect(currentIdx).toBeGreaterThan(-1);
    expect(parentIdx).toBeGreaterThan(currentIdx);
    expect(rootIdx).toBeGreaterThan(parentIdx);
    // root marker rendered after we reach the end with a root-less ancestor
    expect(plain).toContain("(root)");
  });

  test("renders descendants with newest at top (reversed from asc order)", () => {
    // API returns descendants in ascending order (child, grandchild, …). We
    // expect the rendered output to have the newest (last) at the top.
    const child = makeSnapshot({ id: "snap_child" });
    const grandchild = makeSnapshot({ id: "snap_grandchild" });

    const params: RenderSnapshotTreeParams = {
      currentSnapshotId: "snap_current",
      ancestors: emptyTree(),
      descendants: {
        snapshots: [makeTreeNode(child), makeTreeNode(grandchild)],
        pagination: { count: 2, next: null },
      },
    };

    const plain = strip(renderSnapshotTree(params));
    const grandchildIdx = plain.indexOf("snap_grandchild");
    const childIdx = plain.indexOf("snap_child");
    const currentIdx = plain.indexOf("snap_current");

    expect(grandchildIdx).toBeGreaterThan(-1);
    expect(childIdx).toBeGreaterThan(grandchildIdx);
    expect(currentIdx).toBeGreaterThan(childIdx);
  });

  test("marks only the current snapshot with the 'current' indicator", () => {
    const parent = makeSnapshot({ id: "snap_parent" });
    const child = makeSnapshot({ id: "snap_child" });

    const plain = strip(
      renderSnapshotTree({
        currentSnapshotId: "snap_current",
        ancestors: {
          snapshots: [makeTreeNode(parent)],
          pagination: { count: 1, next: null },
        },
        descendants: {
          snapshots: [makeTreeNode(child)],
          pagination: { count: 1, next: null },
        },
      }),
    );

    const currentMatches = plain.match(/◂ current/g) ?? [];
    expect(currentMatches).toHaveLength(1);

    const currentLine = plain.split("\n").find((l) => l.includes("◂ current"));
    expect(currentLine).toContain("snap_current");
    expect(currentLine).not.toContain("snap_parent");
    expect(currentLine).not.toContain("snap_child");
  });

  test("does not duplicate the current snapshot when it appears in ancestors", () => {
    const currentNode = makeTreeNode(
      makeSnapshot({ id: "snap_current", expiresAt: NOW + 60 * 60 * 1000 }),
    );
    const parentNode = makeTreeNode(makeSnapshot({ id: "snap_parent" }));

    const plain = strip(
      renderSnapshotTree({
        currentSnapshotId: "snap_current",
        ancestors: {
          snapshots: [currentNode, parentNode],
          pagination: { count: 2, next: null },
        },
        descendants: emptyTree(),
      }),
    );

    const occurrences = plain.match(/snap_current/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(plain).toContain("snap_parent");
  });

  test("does not duplicate the current snapshot when it appears in descendants", () => {
    const currentNode = makeTreeNode(makeSnapshot({ id: "snap_current" }));
    const childNode = makeTreeNode(makeSnapshot({ id: "snap_child" }));

    const plain = strip(
      renderSnapshotTree({
        currentSnapshotId: "snap_current",
        ancestors: emptyTree(),
        descendants: {
          snapshots: [currentNode, childNode],
          pagination: { count: 2, next: null },
        },
      }),
    );

    const occurrences = plain.match(/snap_current/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(plain).toContain("snap_child");
  });

  test("renders siblings below a node up to the max-show limit", () => {
    const parent = makeSnapshot({ id: "snap_parent" });
    const siblings = [
      makeSnapshot({ id: "snap_s1", sourceSessionId: "sbx_s1" }),
      makeSnapshot({ id: "snap_s2", sourceSessionId: "sbx_s2" }),
    ];

    const plain = strip(
      renderSnapshotTree({
        currentSnapshotId: "snap_current",
        ancestors: {
          snapshots: [makeTreeNode(parent, siblings, "3")],
          pagination: { count: 1, next: null },
        },
        descendants: emptyTree(),
      }),
    );

    expect(plain).toContain("sbx_s1");
    expect(plain).toContain("sbx_s2");
    expect(plain).not.toContain("more sandboxes");
  });

  test("renders '+N more sandboxes' when siblings exceed the max-show limit", () => {
    const parent = makeSnapshot({ id: "snap_parent" });
    // 7 siblings total (count = 8, main + 7 siblings), max shown is 5
    const siblings = Array.from({ length: 7 }, (_, i) =>
      makeSnapshot({ id: `snap_s${i}`, sourceSessionId: `sbx_s${i}` }),
    );

    const plain = strip(
      renderSnapshotTree({
        currentSnapshotId: "snap_current",
        ancestors: {
          snapshots: [makeTreeNode(parent, siblings, "8")],
          pagination: { count: 1, next: null },
        },
        descendants: emptyTree(),
      }),
    );

    // First 5 sessions visible
    for (let i = 0; i < 5; i++) {
      expect(plain).toContain(`sbx_s${i}`);
    }
    // remaining = totalSiblings(7) - shown(5) = 2
    expect(plain).toContain("+2 more sandboxes");
  });

  test("renders '+N+ more sandboxes' when the count is truncated (e.g. '10+')", () => {
    const parent = makeSnapshot({ id: "snap_parent" });
    // Server returned "10+" with 9 siblings (CHILDREN_PER_NODE_LIMIT - 1)
    const siblings = Array.from({ length: 9 }, (_, i) =>
      makeSnapshot({ id: `snap_s${i}`, sourceSessionId: `sbx_s${i}` }),
    );

    const plain = strip(
      renderSnapshotTree({
        currentSnapshotId: "snap_current",
        ancestors: {
          snapshots: [makeTreeNode(parent, siblings, "10+")],
          pagination: { count: 1, next: null },
        },
        descendants: emptyTree(),
      }),
    );

    // remaining = totalSiblings(9) - shown(5) = 4, with "+" suffix
    expect(plain).toContain("+4+ more sandboxes");
  });

  test("renders the root marker when ancestors have no parent and pagination is exhausted", () => {
    const root = makeSnapshot({ id: "snap_root" /* no parentId */ });

    const plain = strip(
      renderSnapshotTree({
        currentSnapshotId: "snap_current",
        ancestors: {
          snapshots: [makeTreeNode(root)],
          pagination: { count: 1, next: null },
        },
        descendants: emptyTree(),
      }),
    );

    expect(plain).toContain("(root)");
  });

  test("does not render the root marker when ancestor pagination has a next cursor", () => {
    const ancestor = makeSnapshot({
      id: "snap_ancestor",
      parentId: "snap_older",
    });

    const plain = strip(
      renderSnapshotTree({
        currentSnapshotId: "snap_current",
        ancestors: {
          snapshots: [makeTreeNode(ancestor)],
          pagination: { count: 1, next: "snap_ancestor" },
        },
        descendants: emptyTree(),
      }),
    );

    expect(plain).not.toContain("(root)");
  });

  test("does not render the root marker when the last ancestor still has a parentId", () => {
    // Pagination reached the end but the final ancestor has a parent, meaning
    // the chain continues outside this project (or was otherwise unreachable).
    const ancestor = makeSnapshot({
      id: "snap_ancestor",
      parentId: "snap_unreachable",
    });

    const plain = strip(
      renderSnapshotTree({
        currentSnapshotId: "snap_current",
        ancestors: {
          snapshots: [makeTreeNode(ancestor)],
          pagination: { count: 1, next: null },
        },
        descendants: emptyTree(),
      }),
    );

    expect(plain).not.toContain("(root)");
  });

  test("formats 'never' when no expiration is set on the current snapshot", () => {
    const plain = strip(
      renderSnapshotTree({
        currentSnapshotId: "snap_current",
        currentSnapshotExpiresAt: undefined,
        ancestors: emptyTree(),
        descendants: emptyTree(),
      }),
    );

    expect(plain).toContain("expires: never");
  });

  test("formats 'expired' when the expiration is in the past", () => {
    const plain = strip(
      renderSnapshotTree({
        currentSnapshotId: "snap_current",
        currentSnapshotExpiresAt: NOW - 60 * 1000,
        ancestors: emptyTree(),
        descendants: emptyTree(),
      }),
    );

    expect(plain).toContain("expires: expired");
  });

  test("formats compact durations in days / hours / minutes", () => {
    const parent = makeSnapshot({
      id: "snap_parent_days",
      expiresAt: NOW + 3 * 24 * 60 * 60 * 1000,
    });
    const grandparent = makeSnapshot({
      id: "snap_grandparent_hours",
      expiresAt: NOW + 5 * 60 * 60 * 1000,
    });
    const greatGrandparent = makeSnapshot({
      id: "snap_ggp_minutes",
      expiresAt: NOW + 30 * 60 * 1000,
    });

    const plain = strip(
      renderSnapshotTree({
        currentSnapshotId: "snap_current",
        currentSnapshotExpiresAt: NOW + 24 * 60 * 60 * 1000,
        ancestors: {
          snapshots: [
            makeTreeNode(parent),
            makeTreeNode(grandparent),
            makeTreeNode(greatGrandparent),
          ],
          pagination: { count: 3, next: "snap_ggp_minutes" },
        },
        descendants: emptyTree(),
      }),
    );

    expect(plain).toContain("expires: 1d");
    expect(plain).toContain("expires: 3d");
    expect(plain).toContain("expires: 5h");
    expect(plain).toContain("expires: 30m");
  });

  test("renders a minute minimum of 1 for sub-minute expirations", () => {
    const plain = strip(
      renderSnapshotTree({
        currentSnapshotId: "snap_current",
        currentSnapshotExpiresAt: NOW + 10 * 1000, // 10s remaining
        ancestors: emptyTree(),
        descendants: emptyTree(),
      }),
    );

    expect(plain).toContain("expires: 1m");
  });

  test("does not throw when the current snapshot is absent from both ancestor and descendant lists", () => {
    expect(() =>
      renderSnapshotTree({
        currentSnapshotId: "snap_current",
        currentSnapshotExpiresAt: NOW + 1000 * 60 * 60 * 24,
        ancestors: emptyTree(),
        descendants: emptyTree(),
      }),
    ).not.toThrow();
  });

  test("suppresses the current-snapshot node when hideCurrent is true", () => {
    const parent = makeSnapshot({
      id: "snap_parent",
      parentId: "snap_grandparent",
    });
    const grandparent = makeSnapshot({ id: "snap_grandparent" });

    const plain = strip(
      renderSnapshotTree({
        currentSnapshotId: "snap_anchor_already_shown",
        hideCurrent: true,
        ancestors: {
          snapshots: [makeTreeNode(parent), makeTreeNode(grandparent)],
          pagination: { count: 2, next: null },
        },
        descendants: emptyTree(),
      }),
    );

    expect(plain).toContain("snap_parent");
    expect(plain).toContain("snap_grandparent");
    expect(plain).not.toContain("snap_anchor_already_shown");
    expect(plain).not.toContain("◂ current");

    const idxParent = plain.indexOf("snap_parent");
    const idxGrandparent = plain.indexOf("snap_grandparent");
    expect(idxGrandparent).toBeGreaterThan(idxParent);
  });

  test("renders the full picture: descendants at top, current in middle, ancestors below", () => {
    const child = makeSnapshot({ id: "snap_child" });
    const parent = makeSnapshot({
      id: "snap_parent",
      parentId: "snap_root",
    });
    const root = makeSnapshot({ id: "snap_root" });

    const plain = strip(
      renderSnapshotTree({
        currentSnapshotId: "snap_current",
        ancestors: {
          snapshots: [makeTreeNode(parent), makeTreeNode(root)],
          pagination: { count: 2, next: null },
        },
        descendants: {
          snapshots: [makeTreeNode(child)],
          pagination: { count: 1, next: null },
        },
      }),
    );

    const idxChild = plain.indexOf("snap_child");
    const idxCurrent = plain.indexOf("snap_current");
    const idxParent = plain.indexOf("snap_parent");
    const idxRoot = plain.indexOf("snap_root");
    const idxRootMarker = plain.indexOf("(root)");

    expect(idxChild).toBeGreaterThan(-1);
    expect(idxCurrent).toBeGreaterThan(idxChild);
    expect(idxParent).toBeGreaterThan(idxCurrent);
    expect(idxRoot).toBeGreaterThan(idxParent);
    expect(idxRootMarker).toBeGreaterThan(idxRoot);
  });
});
