import { GITHUB_API_CREDENTIAL_ACTIONS } from "@vercel/sandbox";
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { CliError } from "./cli-error";

export const MANAGED_CREDENTIALS_GATE = "__VERCEL_SANDBOX_MANAGED_CREDENTIALS";
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_REPOSITORIES = 25;
const execFileAsync = promisify(execFile);
const owner = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?";
const repositoryPattern = new RegExp(`^${owner}/[A-Za-z0-9._-]{1,100}$`);

function isRepository(value: string) {
  return (
    repositoryPattern.test(value) && ![".", ".."].includes(value.split("/")[1])
  );
}

function isHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

const httpsUrl = z.string().refine(isHttpsUrl);
const sourceSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("git"),
      url: httpsUrl,
      depth: z.number().int().min(1).optional(),
      revision: z.string().min(1).optional(),
    })
    .strict(),
  z.object({ type: z.literal("tarball"), url: httpsUrl }).strict(),
  z
    .object({
      type: z.literal("snapshot"),
      snapshotId: z.string().regex(/^snap_[A-Za-z0-9]+$/),
    })
    .strict(),
]);

const unique = (values: readonly string[]) =>
  new Set(values).size === values.length;
const credentialGroup = z
  .object({
    repositories: z
      .array(z.string().refine(isRepository))
      .min(1)
      .max(MAX_REPOSITORIES)
      .refine((values) => unique(values.map((value) => value.toLowerCase()))),
    actions: z
      .array(z.enum(GITHUB_API_CREDENTIAL_ACTIONS))
      .min(1)
      .max(GITHUB_API_CREDENTIAL_ACTIONS.length)
      .refine(unique),
    actAs: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .max(16)
      .refine((value) => Number.isSafeInteger(Number(value)))
      .optional(),
  })
  .strict();

const creationSchema = z
  .object({
    source: sourceSchema.optional(),
    commitAs: z
      .object({
        name: z
          .string()
          .min(1)
          .max(256)
          .refine((value) => value.trim().length > 0),
        email: z.email().max(320),
      })
      .strict()
      .optional(),
    credentials: z
      .object({
        github: z.array(credentialGroup).max(MAX_REPOSITORIES),
      })
      .strict()
      .optional(),
  })
  .strict();

export type CreationInput = z.infer<typeof creationSchema>;

export interface CreationOptions {
  gitSource?: string;
  commitAsName?: string;
  commitAsEmail?: string;
  commitAsMe?: boolean;
  noCommitAsMe?: boolean;
  github?: boolean;
  noGithub?: boolean;
  githubRepositories: string[];
  githubActions: string[];
  githubActAs?: string;
  file?: string;
}

export function hasCreationOptions(options: CreationOptions) {
  return (
    options.gitSource !== undefined ||
    options.commitAsName !== undefined ||
    options.commitAsEmail !== undefined ||
    options.commitAsMe !== undefined ||
    options.noCommitAsMe !== undefined ||
    options.github !== undefined ||
    options.noGithub !== undefined ||
    options.githubRepositories.length > 0 ||
    options.githubActions.length > 0 ||
    options.githubActAs !== undefined ||
    options.file !== undefined
  );
}

export async function resolveCreationInput(
  options: CreationOptions,
): Promise<CreationInput> {
  if (!hasCreationOptions(options)) return {};
  if (process.env[MANAGED_CREDENTIALS_GATE] !== "1") {
    throw new CliError(
      `Managed credential inputs are experimental. Set ${MANAGED_CREDENTIALS_GATE}=1 to use them.`,
      {
        reason: "feature_unavailable",
      },
    );
  }
  if (options.file !== undefined) {
    if (options.file === "")
      throw new CliError("--file requires a file path or - for stdin.");
    if (hasCreationOptions({ ...options, file: undefined })) {
      throw new CliError(
        "--file cannot be combined with Git source or GitHub credential options. Put the complete request in the file.",
      );
    }
    const content =
      options.file === "-"
        ? await readStdinPayload()
        : await readFilePayload(options.file);
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      // JSON.parse's error can contain the input, including an accidentally
      // supplied secret. Never include it in diagnostics.
      throw new CliError(
        "--file must contain valid UTF-8 JSON. Check the input file's JSON syntax.",
      );
    }
    return validateCreationInput(value);
  }

  if (options.github !== undefined && options.noGithub !== undefined) {
    throw new CliError("--github and --no-github cannot be used together.");
  }
  if (options.commitAsMe !== undefined && options.noCommitAsMe !== undefined) {
    throw new CliError(
      "--commit-as-me and --no-commit-as-me cannot be used together.",
    );
  }
  const useGlobalIdentity =
    options.noCommitAsMe !== undefined
      ? !options.noCommitAsMe
      : options.commitAsMe;
  if (
    useGlobalIdentity &&
    (options.commitAsName !== undefined || options.commitAsEmail !== undefined)
  ) {
    throw new CliError(
      "--commit-as-me cannot be combined with --commit-as-name or --commit-as-email.",
    );
  }
  if (
    useGlobalIdentity &&
    (options.gitSource === undefined || !managedRepository(options.gitSource))
  ) {
    throw new CliError(
      "--commit-as-me requires an HTTPS GitHub source. Pass --git-source https://github.com/<OWNER>/<REPOSITORY>.git.",
    );
  }
  const hasGroup =
    options.githubRepositories.length > 0 ||
    options.githubActions.length > 0 ||
    options.githubActAs !== undefined;
  const githubEnabled =
    options.noGithub !== undefined ? !options.noGithub : options.github;
  if (githubEnabled === false && hasGroup) {
    throw new CliError(
      "GitHub credential options cannot be combined with disabled GitHub API forwarding.",
    );
  }
  if (
    hasGroup &&
    (!options.githubRepositories.length || !options.githubActions.length)
  ) {
    throw new CliError(
      "A GitHub credential group requires --github-repository and --github-action. Repeat each option to add values.",
    );
  }
  if (
    (options.commitAsName !== undefined) !==
    (options.commitAsEmail !== undefined)
  ) {
    throw new CliError(
      "A commit identity requires both --commit-as-name and --commit-as-email.",
    );
  }

  const commitAs = useGlobalIdentity
    ? await readGlobalGitIdentity()
    : options.commitAsName !== undefined
      ? { name: options.commitAsName, email: options.commitAsEmail }
      : undefined;

  return validateCreationInput({
    ...(options.gitSource !== undefined
      ? { source: { type: "git", url: options.gitSource } }
      : {}),
    ...(commitAs !== undefined ? { commitAs } : {}),
    ...(hasGroup || githubEnabled
      ? {
          credentials: {
            github: hasGroup
              ? [
                  {
                    repositories: options.githubRepositories,
                    actions: options.githubActions,
                    ...(options.githubActAs !== undefined
                      ? { actAs: options.githubActAs }
                      : {}),
                  },
                ]
              : [],
          },
        }
      : {}),
  });
}

async function readGlobalGitIdentity(): Promise<{
  name: string;
  email: string;
}> {
  try {
    const [name, email] = await Promise.all(
      ["user.name", "user.email"].map(async (key) => {
        const { stdout } = await execFileAsync(
          "git",
          ["config", "--global", key],
          {
            encoding: "utf8",
            maxBuffer: 4096,
            timeout: 5000,
          },
        );
        return stdout.replace(/\n+$/, "");
      }),
    );
    if (!name || !email) throw new Error("Missing global Git identity");
    return { name, email };
  } catch {
    throw new CliError(
      "Can't use --commit-as-me without Git's global user.name and user.email. Set both with git config --global, or pass --commit-as-name and --commit-as-email.",
    );
  }
}

export function validateCreationInput(value: unknown): CreationInput {
  const parsed = creationSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      field: issue.path.join(".") || "$",
      message:
        issue.code === "unrecognized_keys"
          ? "Unknown fields are not supported."
          : "Invalid or missing value.",
    }));
    throw new CliError(
      `Invalid creation input at ${issues[0].field}. Use source, commitAs, and credentials with the documented field types.`,
      { data: { issues } },
    );
  }
  const input = parsed.data;
  const repositories = new Set<string>();
  if (input.commitAs) {
    const repository =
      input.source?.type === "git"
        ? managedRepository(input.source.url)
        : undefined;
    if (!repository) {
      throw new CliError(
        "A commit identity requires an HTTPS GitHub Git source. Pass --git-source https://github.com/<OWNER>/<REPOSITORY>.git or set source in --file.",
      );
    }
    repositories.add(repository.toLowerCase());
  }
  const identities = new Map<string, string | undefined>();
  for (const group of input.credentials?.github ?? []) {
    for (const name of group.repositories) {
      const repository = name.toLowerCase();
      if (
        identities.has(repository) &&
        identities.get(repository) !== group.actAs
      ) {
        throw new CliError(
          "GitHub credentials require one identity per repository. Use the same actAs for every occurrence of a repository.",
        );
      }
      identities.set(repository, group.actAs);
      repositories.add(repository);
    }
  }
  if (repositories.size > MAX_REPOSITORIES) {
    throw new CliError(
      `Managed credentials support at most ${MAX_REPOSITORIES} distinct repositories, including the Git source.`,
    );
  }
  return input;
}

export function managedRepository(value: string): string | undefined {
  const match = /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+)$/i.exec(value);
  if (!match) return;
  const repository = `${match[1]}/${match[2].replace(/\.git$/i, "")}`;
  return isRepository(repository) ? repository : undefined;
}

async function readFilePayload(path: string): Promise<string> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NONBLOCK,
  ).catch(() => {
    throw new CliError(
      "Can't read --file. Check that the path names a readable JSON file.",
    );
  });
  try {
    if (!(await handle.stat()).isFile())
      throw new CliError("--file must name a regular JSON file.");
    const buffer = Buffer.alloc(MAX_PAYLOAD_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        size,
        buffer.length - size,
        null,
      );
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > MAX_PAYLOAD_BYTES)
      throw new CliError("--file must not exceed 64 KiB.");
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        buffer.subarray(0, size),
      );
    } catch {
      throw new CliError("--file must contain valid UTF-8 JSON.");
    }
  } finally {
    await handle.close();
  }
}

async function readStdinPayload(): Promise<string> {
  if (process.stdin.isTTY)
    throw new CliError(
      "--file - requires piped JSON input. Redirect a JSON file to stdin or pass its path with --file.",
    );
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onError);
      process.stdin.pause();
      if (error) reject(error);
      else {
        try {
          resolve(
            new TextDecoder("utf-8", { fatal: true }).decode(
              Buffer.concat(chunks),
            ),
          );
        } catch {
          reject(new CliError("--file must contain valid UTF-8 JSON."));
        }
      }
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_PAYLOAD_BYTES)
        finish(new CliError("--file must not exceed 64 KiB."));
      else chunks.push(buffer);
    };
    const onEnd = () => finish();
    const onError = () => finish(new CliError("Can't read JSON from stdin."));
    const timer = setTimeout(
      () =>
        finish(
          new CliError(
            "Timed out reading --file - after 30s. Finish the JSON input and close stdin.",
          ),
        ),
      30_000,
    );
    process.stdin.on("data", onData).once("end", onEnd).once("error", onError);
    process.stdin.resume();
  });
}
