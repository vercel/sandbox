const VALID_NAME_RE = /^[a-z_][a-z0-9_-]*$/;
const MAX_NAME_LENGTH = 32;

/**
 * Validate a Linux username or group name.
 * Throws if the name is invalid or could be used for command injection.
 */
export function validateName(name: string, kind: "username" | "group name") {
  if (!name) {
    throw new Error(`Invalid ${kind}: must not be empty`);
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(
      `Invalid ${kind} "${name}": must be at most ${MAX_NAME_LENGTH} characters`,
    );
  }
  if (!VALID_NAME_RE.test(name)) {
    throw new Error(
      `Invalid ${kind} "${name}": must match ${VALID_NAME_RE} (lowercase letters, digits, hyphens, underscores)`,
    );
  }
}
