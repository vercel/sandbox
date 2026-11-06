import * as cmd from "cmd-ts";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { create } from "../../src/commands/create";
import type { Sandbox } from "@vercel/sandbox";
import { apiConfiguration as apiDocument } from "../fixtures/managed-credentials";

const { createSandbox, hasBounds, inferActor } = vi.hoisted(() => ({
  createSandbox: vi.fn(),
  hasBounds: vi.fn(),
  inferActor: vi.fn(),
}));
vi.mock("../../src/client", () => ({
  sandboxClient: { create: createSandbox },
}));
vi.mock("../../src/util/managed-credentials-project-bounds", () => ({
  hasProjectBounds: hasBounds,
}));
vi.mock("../../src/util/managed-credentials-actor", () => ({ inferActor }));
vi.mock("../../src/util/check-latest-version", () => ({
  startLatestVersionCheck: () => undefined,
}));
vi.mock("../../src/telemetry/agent", () => ({
  detectAgentName: async () => undefined,
}));

let directory: string;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("VERCEL_AUTH_TOKEN", "fixture-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 403 })),
  );
  directory = await mkdtemp(join(tmpdir(), "sandbox-api-config-"));
  hasBounds.mockResolvedValue(true);
  createSandbox.mockResolvedValue({
    name: "configured",
    interactivePort: 8443,
    routes: [],
    currentSession: () => ({ sessionId: "sbx_apifile", status: "running" }),
  });
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

async function invoke(file: string, extra: string[] = []) {
  return cmd.run(create, [
    "--scope=team_fixture",
    "--project=project_fixture",
    `--credentials-github-from-config-file=${file}`,
    "--yes",
    "--silent",
    ...extra,
  ]);
}

test("one API-shaped document survives file input, request construction, persistence and replay unchanged", async () => {
  const document = apiDocument();
  const sdkFields: Pick<
    NonNullable<Parameters<typeof Sandbox.create>[0]>,
    "source" | "credentials"
  > = document;
  expect(sdkFields).toBe(document);
  const original = JSON.stringify(document, null, 4) + "\n";
  const input = join(directory, "request.json");
  const persisted = join(directory, "persisted.json");
  await writeFile(input, original);
  await invoke(input, [
    `--credentials-github-persist-configuration=${persisted}`,
  ]);
  expect(createSandbox).toHaveBeenCalledOnce();
  const first = createSandbox.mock.calls[0][0];
  expect(first.source).toEqual(document.source);
  expect(first.credentials).toEqual(document.credentials);
  expect(first).not.toHaveProperty("commitAs");
  expect(first.teamId).toBe("team_fixture");
  expect(first.projectId).toBe("project_fixture");
  expect(await readFile(input, "utf8")).toBe(original);
  const saved = JSON.parse(await readFile(persisted, "utf8"));
  expect(saved).toEqual(document);
  expect(Object.keys(saved.source)).toEqual(Object.keys(document.source!));
  expect(
    saved.credentials.github.map(
      (group: { repositories: string[] }) => group.repositories,
    ),
  ).toEqual(document.credentials.github.map((group) => group.repositories));
  createSandbox.mockClear();
  await invoke(persisted);
  const second = createSandbox.mock.calls[0][0];
  expect(second.source).toEqual(document.source);
  expect(second.credentials).toEqual(document.credentials);
  expect(inferActor).not.toHaveBeenCalled();
});

test("rejects commitAs in configuration files before requesting access", async () => {
  const input = join(directory, "retired-field.json");
  await writeFile(
    input,
    JSON.stringify({
      ...apiDocument(),
      commitAs: { name: "Ada", email: "ada@example.com" },
    }),
  );
  await expect(invoke(input)).rejects.toThrow(
    "Unknown fields are not supported.",
  );
  expect(createSandbox).not.toHaveBeenCalled();
  expect(hasBounds).not.toHaveBeenCalled();
});
