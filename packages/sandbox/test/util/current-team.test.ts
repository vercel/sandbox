import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  getConfigFilePath,
  getGlobalPathConfig,
} from "@vercel/cli-config/paths";
import { readVercelCurrentTeam } from "../../src/util/current-team";

vi.mock("@vercel/cli-config/paths", () => ({
  getConfigFilePath: vi.fn(),
  getGlobalPathConfig: vi.fn(),
}));
let directory: string;
let configPath: string;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("VERCEL_AUTH_CONFIG_DIR", "");
  directory = await mkdtemp(join(tmpdir(), "sandbox-current-team-config-"));
  configPath = join(directory, "config.json");
  vi.mocked(getGlobalPathConfig).mockReturnValue(directory);
  vi.mocked(getConfigFilePath).mockReturnValue(configPath);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

test("uses shared Vercel config paths and never changes the file", async () => {
  const contents = JSON.stringify({
    currentTeam: "team_selected",
    unrelated: "private-config-canary",
  });
  await writeFile(configPath, contents);
  expect(readVercelCurrentTeam()).toBe("team_selected");
  expect(getConfigFilePath).toHaveBeenCalledWith(directory);
  expect(await readFile(configPath, "utf8")).toBe(contents);
});

test("missing configuration leaves account inference available", () => {
  expect(readVercelCurrentTeam()).toBeUndefined();
});

test.each([{}, { currentTeam: null }])(
  "missing selection is not a selected team (%j)",
  async (config) => {
    await writeFile(configPath, JSON.stringify(config));
    expect(readVercelCurrentTeam()).toBeUndefined();
  },
);

test.each([42, "", " team_selected", "team_selected\n"])(
  "rejects invalid selected team %j",
  async (currentTeam) => {
    await writeFile(configPath, JSON.stringify({ currentTeam }));
    expect(readVercelCurrentTeam).toThrow(
      "Could not read the team selected in Vercel CLI configuration",
    );
  },
);

test("malformed JSON never exposes configuration contents", async () => {
  await writeFile(configPath, "private-config-canary: malformed");
  let error: unknown;
  try {
    readVercelCurrentTeam();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).not.toContain("private-config-canary");
});

test("uses the same test-only configuration override as saved authentication", async () => {
  vi.stubEnv("VERCEL_AUTH_CONFIG_DIR", directory);
  await writeFile(configPath, JSON.stringify({ currentTeam: "team_selected" }));
  expect(readVercelCurrentTeam()).toBe("team_selected");
  expect(getGlobalPathConfig).not.toHaveBeenCalled();
  expect(getConfigFilePath).not.toHaveBeenCalled();
});
