import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  checkNodeVersion,
  compareVersions,
  createChangeset,
  findLatestVersion,
  parseNodeVersions,
  updateNodeVersion,
} from "./update-node-version.mjs";

const CONFIG = `target "node" {
  matrix = {
    node = [
      {
        major   = "22"
        version = "22.23.2"
      },
      {
        major   = "24"
        version = "24.19.0"
      },
      {
        major   = "26"
        version = "26.7.0"
      },
    ]
  }
}
`;

test("parses configured Node.js majors and versions", () => {
  assert.deepEqual(parseNodeVersions(CONFIG), [
    { major: "22", version: "22.23.2" },
    { major: "24", version: "24.19.0" },
    { major: "26", version: "26.7.0" },
  ]);
});

test("rejects duplicate and mismatched majors", () => {
  assert.throws(
    () => parseNodeVersions(`${CONFIG}\n${CONFIG}`),
    /Duplicate Node\.js major/,
  );
  assert.throws(
    () => parseNodeVersions(CONFIG.replace("22.23.2", "24.23.2")),
    /does not belong to major 22/,
  );
});

test("compares numeric versions", () => {
  assert.ok(compareVersions("24.19.1", "24.19.0") > 0);
  assert.ok(compareVersions("24.20.0", "24.19.9") > 0);
  assert.equal(compareVersions("26.7.0", "26.7.0"), 0);
  assert.throws(() => compareVersions("24.20.0-rc.1", "24.19.0"));
});

test("finds the newest stable release for one major", () => {
  const releases = [
    { version: "v26.8.0" },
    { version: "v24.20.0-rc.1" },
    { version: "v24.19.1" },
    { version: "v24.20.0" },
    { version: "v22.24.0" },
  ];

  assert.equal(findLatestVersion(releases, "24"), "24.20.0");
});

test("updates only the selected major", () => {
  const updated = updateNodeVersion(CONFIG, "24", "24.20.0");

  assert.deepEqual(parseNodeVersions(updated), [
    { major: "22", version: "22.23.2" },
    { major: "24", version: "24.20.0" },
    { major: "26", version: "26.7.0" },
  ]);
  assert.equal(
    updated,
    CONFIG.replace('version = "24.19.0"', 'version = "24.20.0"'),
  );
  assert.throws(() => updateNodeVersion(CONFIG, "20", "20.20.0"));
});

test("creates a patch changeset for the Node image", () => {
  assert.equal(
    createChangeset("24", "24.19.0", "24.20.0"),
    `---
"sandbox-image-node": patch
---

Update Node.js 24 from 24.19.0 to 24.20.0.
`,
  );
});

test("writes an update and changeset when a newer release exists", async () => {
  const directory = await mkdtemp(join(tmpdir(), "node-version-updater-"));
  const configPath = join(directory, "docker-bake.hcl");
  const changesetPath = join(directory, "update-node-24.md");
  await writeFile(configPath, CONFIG);

  const result = await checkNodeVersion({
    major: "24",
    configPath,
    changesetPath,
    fetchReleases: async () => [
      { version: "v24.20.0" },
      { version: "v22.24.0" },
    ],
  });

  assert.equal(result.updated, true);
  assert.equal(result.current, "24.19.0");
  assert.equal(result.latest, "24.20.0");
  assert.equal(
    await readFile(configPath, "utf8"),
    CONFIG.replace('version = "24.19.0"', 'version = "24.20.0"'),
  );
  assert.match(await readFile(changesetPath, "utf8"), /sandbox-image-node/);
});

test("leaves files untouched when the configured release is current", async () => {
  const directory = await mkdtemp(join(tmpdir(), "node-version-updater-"));
  const configPath = join(directory, "docker-bake.hcl");
  const changesetPath = join(directory, "update-node-24.md");
  await writeFile(configPath, CONFIG);

  const result = await checkNodeVersion({
    major: "24",
    configPath,
    changesetPath,
    fetchReleases: async () => [{ version: "v24.19.0" }],
  });

  assert.equal(result.updated, false);
  assert.equal(await readFile(configPath, "utf8"), CONFIG);
  await assert.rejects(readFile(changesetPath, "utf8"), { code: "ENOENT" });
});
