import { sandboxClient } from "../client";
import type { SandboxCredentialSnapshot } from "./managed-credentials-reuse";

/**
 * Read an existing Sandbox's managed-credential request.
 *
 * `resume: false` keeps this a metadata read. Inspecting configuration must
 * never start a stopped Sandbox: that would bill the user for a lookup and
 * change state they did not ask to change.
 */
export async function fetchSandboxCredentialSnapshot(options: {
  selector: string;
  kind: "id" | "name";
  token: string;
  teamId: string;
  projectId: string;
  signal?: AbortSignal;
}): Promise<SandboxCredentialSnapshot | undefined> {
  const sandbox = await sandboxClient.get({
    // The API resolves both a Sandbox name and an sbx_* identifier in this
    // slot, which is how the other commands accept either spelling.
    name: options.selector,
    resume: false,
    token: options.token,
    teamId: options.teamId,
    projectId: options.projectId,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  // The request is reported on the session, which is where the API returns it.
  return sandbox.currentSession().managedCredentials as
    | SandboxCredentialSnapshot
    | undefined;
}
