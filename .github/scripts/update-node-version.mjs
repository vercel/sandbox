import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_CONFIG = "images/docker-bake.hcl";
const NODE_RELEASES_URL = "https://nodejs.org/dist/index.json";
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseNodeVersions(config) {
  const versions = [];
  const pattern = /major\s*=\s*"(\d+)"\s*\n\s*version\s*=\s*"([^"]+)"/g;

  for (const match of config.matchAll(pattern)) {
    if (!VERSION_PATTERN.test(match[2])) {
      throw new Error(
        `Invalid Node.js version for major ${match[1]}: ${match[2]}`,
      );
    }

    versions.push({ major: match[1], version: match[2] });
  }

  if (versions.length === 0) {
    throw new Error("No Node.js versions found in the Bake configuration");
  }

  const majors = new Set();
  for (const { major, version } of versions) {
    if (majors.has(major)) {
      throw new Error(
        `Duplicate Node.js major in Bake configuration: ${major}`,
      );
    }
    if (!version.startsWith(`${major}.`)) {
      throw new Error(`Node.js ${version} does not belong to major ${major}`);
    }
    majors.add(major);
  }

  return versions;
}

export function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }

  return 0;
}

export function findLatestVersion(releases, major) {
  if (!Array.isArray(releases)) {
    throw new Error("Node.js release index must be an array");
  }

  const versions = releases
    .map((release) => release?.version)
    .filter((version) => typeof version === "string" && version.startsWith("v"))
    .map((version) => version.slice(1))
    .filter((version) => VERSION_PATTERN.test(version))
    .filter((version) => version.startsWith(`${major}.`));

  if (versions.length === 0) {
    throw new Error(`No stable Node.js releases found for major ${major}`);
  }

  return versions.reduce((latest, version) =>
    compareVersions(version, latest) > 0 ? version : latest,
  );
}

export function updateNodeVersion(config, major, nextVersion) {
  parseVersion(nextVersion);
  if (!nextVersion.startsWith(`${major}.`)) {
    throw new Error(`Node.js ${nextVersion} does not belong to major ${major}`);
  }

  const entries = parseNodeVersions(config);
  const current = entries.find((entry) => entry.major === major);
  if (!current) {
    throw new Error(`Node.js major ${major} is not configured`);
  }

  const entryPattern = new RegExp(
    `(major\\s*=\\s*"${escapeRegExp(major)}"\\s*\\n\\s*version\\s*=\\s*")${escapeRegExp(current.version)}(")`,
  );
  const updated = config.replace(entryPattern, `$1${nextVersion}$2`);

  if (updated === config) {
    throw new Error(`Failed to update Node.js major ${major}`);
  }

  return updated;
}

export function createChangeset(major, currentVersion, nextVersion) {
  return `---\n"sandbox-image-node": patch\n---\n\nUpdate Node.js ${major} from ${currentVersion} to ${nextVersion}.\n`;
}

export async function checkNodeVersion({
  major,
  configPath = DEFAULT_CONFIG,
  changesetPath = `.changeset/update-node-${major}.md`,
  fetchReleases = fetchNodeReleases,
  write = true,
}) {
  const config = await readFile(configPath, "utf8");
  const entries = parseNodeVersions(config);
  const current = entries.find((entry) => entry.major === major);

  if (!current) {
    throw new Error(`Node.js major ${major} is not configured`);
  }

  const latest = findLatestVersion(await fetchReleases(), major);
  const updated = compareVersions(latest, current.version) > 0;

  if (updated && write) {
    await writeFile(configPath, updateNodeVersion(config, major, latest));
    await writeFile(
      changesetPath,
      createChangeset(major, current.version, latest),
    );
  }

  return {
    major,
    current: current.version,
    latest,
    updated,
    configPath,
    changesetPath,
  };
}

async function fetchNodeReleases() {
  const response = await fetch(NODE_RELEASES_URL, {
    headers: { "user-agent": "vercel-sandbox-node-version-updater" },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Node.js releases: ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}

function parseVersion(version) {
  const match = VERSION_PATTERN.exec(version);
  if (!match) {
    throw new Error(`Invalid stable Node.js version: ${version}`);
  }
  return match.slice(1).map(Number);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseArguments(args) {
  const options = {};

  for (const argument of args) {
    if (argument === "--list-majors") {
      options.listMajors = true;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument.startsWith("--major=")) {
      options.major = argument.slice("--major=".length);
    } else if (argument.startsWith("--config=")) {
      options.configPath = argument.slice("--config=".length);
    } else if (argument.startsWith("--changeset=")) {
      options.changesetPath = argument.slice("--changeset=".length);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const configPath = options.configPath ?? DEFAULT_CONFIG;

  if (options.listMajors) {
    const config = await readFile(configPath, "utf8");
    console.log(
      JSON.stringify(parseNodeVersions(config).map(({ major }) => major)),
    );
    return;
  }

  if (!options.major) {
    throw new Error("Pass --major=<major> or --list-majors");
  }

  const result = await checkNodeVersion({
    major: options.major,
    configPath,
    changesetPath: options.changesetPath,
    write: !options.dryRun,
  });
  console.log(JSON.stringify(result));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
