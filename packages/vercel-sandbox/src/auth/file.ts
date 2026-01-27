import path from "node:path";
import fs from "node:fs";
import { homedir } from "node:os";
import XDGAppPaths from "xdg-app-paths";
import { z } from "zod";
import { json } from "./zod";

const ZodDate = z.number().transform((seconds) => new Date(seconds * 1000));

const AuthFile = z.object({
  token: z.string().min(1).optional(),
  refreshToken: z.string().min(1).optional(),
  expiresAt: ZodDate.optional(),
});

const StoredAuthFile = json.pipe(AuthFile);

type AuthFile = z.infer<typeof AuthFile>;

// Returns whether a directory exists
const isDirectory = (path: string): boolean => {
  try {
    return fs.lstatSync(path).isDirectory();
  } catch (_) {
    // We don't care which kind of error occured, it isn't a directory anyway.
    return false;
  }
};

/**
 * Returns in which directory the config should be present.
 *
 * @internal The `VERCEL_AUTH_CONFIG_DIR` env var is for testing purposes only
 * and is not part of the public API.
 */
const getGlobalPathConfig = (): string => {
  if (process.env.VERCEL_AUTH_CONFIG_DIR) {
    return process.env.VERCEL_AUTH_CONFIG_DIR;
  }

  const vercelDirectories = XDGAppPaths("com.vercel.cli").dataDirs();

  const possibleConfigPaths = [
    ...vercelDirectories, // latest vercel directory
    path.join(homedir(), ".now"), // legacy config in user's home directory
    ...XDGAppPaths("now").dataDirs(), // legacy XDG directory
  ];

  // The customPath flag is the preferred location,
  // followed by the vercel directory,
  // followed by the now directory.
  // If none of those exist, use the vercel directory.
  return (
    possibleConfigPaths.find((configPath) => isDirectory(configPath)) ||
    vercelDirectories[0]
  );
};

export const getAuth = () => {
  try {
    const pathname = path.join(getGlobalPathConfig(), "auth.json");
    return StoredAuthFile.parse(fs.readFileSync(pathname, "utf8"));
  } catch {
    return null;
  }
};

export function updateAuthConfig(config: AuthFile): void {
  const pathname = path.join(getGlobalPathConfig(), "auth.json");
  fs.mkdirSync(path.dirname(pathname), { recursive: true });
  const content = {
    token: config.token,
    expiresAt:
      config.expiresAt && Math.round(config.expiresAt.getTime() / 1000),
    refreshToken: config.refreshToken,
  } satisfies z.input<typeof AuthFile>;
  fs.writeFileSync(pathname, JSON.stringify(content) + "\n");
}
