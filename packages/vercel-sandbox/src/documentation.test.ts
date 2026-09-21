import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Application, normalizePath, TSConfigReader } from "typedoc";
import { expect, it } from "vitest";

const packageRoot = resolve(__dirname, "..");
const repositoryRoot = resolve(packageRoot, "../..");

const hiddenFieldNames = ["commitAs", "credentials"];

it("omits internal creation options from generated API documentation", async () => {
  const application = await Application.bootstrap(
    {
      entryPoints: [resolve(packageRoot, "src/index.ts")],
      logLevel: "Error",
      tsconfig: resolve(packageRoot, "tsconfig.json"),
    },
    [new TSConfigReader()],
  );
  const project = await application.convert();
  expect(project).toBeDefined();

  const documentation = JSON.stringify(
    application.serializer.projectToObject(
      project!,
      normalizePath(repositoryRoot),
    ),
  );
  for (const field of hiddenFieldNames) {
    expect(documentation).not.toContain(`"name":"${field}"`);
  }
  expect(documentation).not.toContain("github:pull-request:create");
  expect(documentation).not.toContain("github:issues:read");
});

it("omits internal creation option names from tracked documentation", () => {
  const files = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "*.md",
      "*.mdx",
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const documentation = files
    .map((file) => readFileSync(resolve(repositoryRoot, file), "utf8"))
    .join("\n");

  expect(documentation).not.toContain("commitAs");
  expect(documentation).not.toContain("source.credentials");
  expect(documentation).not.toContain("credentials.github");
  expect(documentation).not.toMatch(/credentials\s*:\s*true/);
  expect(documentation).not.toMatch(/credentials\s*:\s*\{\s*github\s*:/);
  expect(documentation).not.toContain("github:pull-request:create");
  expect(documentation).not.toContain("github:issues:read");
});
