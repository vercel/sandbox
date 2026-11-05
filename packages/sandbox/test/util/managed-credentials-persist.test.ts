import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  persistConfiguration,
  resolvePersistPath,
} from "../../src/util/managed-credentials-persist";
import { parseConfig } from "../../src/util/managed-credentials-config";
import {
  loadConfigFromSandbox,
  toConfig,
} from "../../src/util/managed-credentials-reuse";
import { CliError } from "../../src/util/cli-error";

const config = parseConfig({
  source: { type: "git", url: "https://github.com/vercel/api.git" },
  commitAs: { name: "Ada Lovelace", email: "ada@example.com" },
  credentials: {
    github: [
      {
        repositories: ["vercel/api"],
        actions: ["github:issues:read", "git:write"],
        actAs: "@scubbo",
      },
    ],
  },
});

describe("output path resolution", () => {
  test("names the default file after the returned sbx_ identifier", () => {
    expect(
      resolvePersistPath({
        requested: "",
        sandboxId: "sbx_132456789",
        cwd: "/work",
      }),
    ).toBe("/work/sbx_132456789-credentials.json");
  });

  test("resolves a relative explicit path against the working directory", () => {
    expect(
      resolvePersistPath({
        requested: "out/config.json",
        sandboxId: "sbx_1",
        cwd: "/work",
      }),
    ).toBe("/work/out/config.json");
  });

  test("keeps an absolute explicit path", () => {
    expect(
      resolvePersistPath({
        requested: "/tmp/config.json",
        sandboxId: "sbx_1",
        cwd: "/work",
      }),
    ).toBe("/tmp/config.json");
  });

  test("rejects a directory-shaped path", () => {
    expect(() =>
      resolvePersistPath({
        requested: "out/",
        sandboxId: "sbx_1",
        cwd: "/work",
      }),
    ).toThrow(/expects a file path/);
  });

  test("refuses to guess a default name without an sbx_ identifier", () => {
    expect(() =>
      resolvePersistPath({ requested: "", sandboxId: "", cwd: "/work" }),
    ).toThrow(/did not include an sbx_\* identifier/);
  });
});

describe("writing", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "managed-credentials-persist-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test("writes a configuration that round-trips back through the loader", async () => {
    const path = join(directory, "config.json");
    await persistConfiguration({ config, path });

    const loaded = parseConfig(JSON.parse(await readFile(path, "utf8")));
    expect(loaded).toEqual(config);
  });

  test("persists source-free multi-repository groups without coalescing or inferring rights", async () => {
    const grouped = parseConfig({
      credentials: {
        github: [
          {
            repositories: ["acme/reference", "acme/widgets"],
            actions: ["github:issues:read", "github:labels:read"],
            actAs: "42",
          },
          {
            repositories: ["acme/widgets"],
            actions: ["github:issues:comment"],
            actAs: "42",
          },
        ],
      },
    });
    const path = join(directory, "grouped.json");
    await persistConfiguration({ config: grouped, path });
    const written = await readFile(path, "utf8");
    expect(written).toBe(`${JSON.stringify(grouped, null, 2)}\n`);
    expect(parseConfig(JSON.parse(written))).toEqual(grouped);
  });

  test("does not overwrite an existing file", async () => {
    const path = join(directory, "config.json");
    await writeFile(path, "user data", "utf8");

    await expect(persistConfiguration({ config, path })).rejects.toThrow(
      /already exists/,
    );
    // The user's file must survive untouched.
    expect(await readFile(path, "utf8")).toBe("user data");
  });

  test("reports an unwritable path as a persistence failure", async () => {
    await expect(
      persistConfiguration({
        config,
        path: join(directory, "missing", "config.json"),
      }),
    ).rejects.toThrow(CliError);
  });
});

describe("reuse from an existing sandbox", () => {
  test("reconstructs legacy source rights without widening the other grouped repository", async () => {
    const fetchSnapshot = vi.fn().mockResolvedValue({
      source: {
        type: "git",
        url: "https://github.com/acme/widgets.git",
        credentials: true,
      },
      commitAs: { name: "Grace Hopper", email: "grace@example.com" },
      credentials: {
        github: [
          {
            repositories: ["acme/widgets", "acme/reference"],
            actions: ["github:issues:read"],
            actAs: "42",
          },
        ],
      },
    });

    const result = await loadConfigFromSandbox({
      selector: "sbx_123",
      fetchSnapshot,
    });

    expect(fetchSnapshot).toHaveBeenCalledWith("sbx_123");
    expect(result).toEqual({
      source: { type: "git", url: "https://github.com/acme/widgets.git" },
      commitAs: { name: "Grace Hopper", email: "grace@example.com" },
      credentials: {
        github: [
          {
            repositories: ["acme/reference"],
            actions: ["github:issues:read"],
            actAs: "42",
          },
          {
            repositories: ["acme/widgets"],
            actions: ["github:issues:read", "git:write"],
            actAs: "42",
          },
        ],
      },
    });
  });

  test.each([false, true])(
    "preserves modern grouped rights without replaying derived commit credit (source: %s)",
    async (withSource) => {
      const source = withSource
        ? {
            source: {
              type: "git" as const,
              url: "https://github.com/acme/widgets.git",
              revision: "refs/heads/review",
              depth: 2,
            },
          }
        : {};
      const snapshot = {
        ...source,
        commitAs: { name: "Derived GitHub Name", email: "derived@example.com" },
        credentials: {
          github: [
            {
              repositories: ["acme/widgets", "acme/reference"],
              actions: ["git:write-workflows", "github:issues:read"],
              actAs: "42",
            },
            {
              repositories: ["acme/widgets"],
              actions: ["github:issues:comment"],
              actAs: "42",
            },
          ],
        },
      };
      const before = structuredClone(snapshot);
      const result = await loadConfigFromSandbox({
        selector: "sbx_modern",
        fetchSnapshot: vi.fn().mockResolvedValue(snapshot),
      });
      expect(result).toEqual({ ...source, credentials: snapshot.credentials });
      expect(result).not.toHaveProperty("commitAs");
      expect(snapshot).toEqual(before);
    },
  );

  test("rejects unsupported legacy read-only source rights instead of widening them", async () => {
    await expect(
      loadConfigFromSandbox({
        selector: "my-sandbox",
        fetchSnapshot: vi.fn().mockResolvedValue({
          source: {
            type: "git",
            url: "https://github.com/acme/widgets.git",
            credentials: "read",
          },
          credentials: { github: [] },
        }),
      }),
    ).rejects.toMatchObject({
      options: { reason: "configuration_unsupported" },
    });
  });

  test("accepts a sandbox name as well as an identifier", async () => {
    const fetchSnapshot = vi
      .fn()
      .mockResolvedValue({ credentials: { github: [] } });
    await loadConfigFromSandbox({ selector: "my-sandbox", fetchSnapshot });
    expect(fetchSnapshot).toHaveBeenCalledWith("my-sandbox");
  });

  test("reports a sandbox that has no configuration to reuse", async () => {
    await expect(
      loadConfigFromSandbox({
        selector: "plain-sandbox",
        fetchSnapshot: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toThrow(/does not report a managed-credentials configuration/);
  });

  test("refuses to copy a configuration with an unrecognized action", async () => {
    // Silently dropping it would understate the access being requested.
    expect(() =>
      toConfig(
        {
          credentials: {
            github: [
              {
                repositories: ["acme/widgets"],
                actions: ["github:repo:admin"],
              },
            ],
          },
        },
        "sbx_1",
      ),
    ).toThrow(/cannot replay without changing/);
  });

  test("carries no tokens, grant IDs, or approvals in the copied shape", async () => {
    const result = await loadConfigFromSandbox({
      selector: "sbx_123",
      fetchSnapshot: vi.fn().mockResolvedValue({
        source: { type: "git", url: "https://github.com/acme/widgets.git" },
        credentials: {
          github: [
            { repositories: ["acme/widgets"], actions: ["github:issues:read"] },
          ],
        },
      }),
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of ["token", "grant", "attestation", "approval"]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
  });
});
