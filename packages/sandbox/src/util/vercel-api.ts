import { z } from "zod";

export const projectId = z
  .string()
  .regex(/^(?:prj_[a-zA-Z0-9]+|Qm[1-9A-HJ-NP-Za-km-z]{44})$/);
const teamId = z.string().regex(/^team_[a-zA-Z0-9]+$/);
export const selector = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      value.trim() === value &&
      value !== "." &&
      value !== ".." &&
      !/[\u0000-\u001f\u007f]/.test(value),
  );
const projectSchema = z.object({
  id: projectId,
  accountId: teamId,
  name: selector,
});
const teamSchema = z.object({ id: teamId, slug: selector });

interface VercelApi {
  get(path: string, query?: Record<string, string>): Promise<unknown>;
  team(id: string): Promise<z.infer<typeof teamSchema>>;
  project(
    team: string,
    project: string,
  ): Promise<z.infer<typeof projectSchema>>;
}

/** One invocation, one token. Cache successful metadata only, never Bounds. */
export function createVercelApi(options: {
  token: string;
  fetch?: typeof globalThis.fetch;
}) {
  const fetch = options.fetch ?? globalThis.fetch;
  const metadata = new Map<string, unknown>();
  return {
    async run<T>(
      timeout: number,
      operation: (api: VercelApi) => Promise<T>,
      callerSignal?: AbortSignal,
    ): Promise<T> {
      const controller = new AbortController();
      const signal = callerSignal
        ? AbortSignal.any([callerSignal, controller.signal])
        : controller.signal;
      const deadline = Date.now() + timeout;
      const timer = setTimeout(() => controller.abort(), timeout);
      let onAbort!: () => void;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("Vercel API lookup aborted."));
        signal.addEventListener("abort", onAbort, { once: true });
      });
      const check = () => {
        if (Date.now() >= deadline) controller.abort();
        signal.throwIfAborted();
      };
      const api: VercelApi = {
        async get(path, query) {
          const url = new URL(`https://vercel.com/api${path}`);
          url.search = new URLSearchParams(query).toString();
          check();
          if (metadata.has(url.href)) return metadata.get(url.href);
          const response = await fetch(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${options.token}` },
            credentials: "omit",
            redirect: "error",
            signal,
          });
          check();
          if (response.status !== 200 || response.redirected)
            throw new Error("Vercel API lookup failed.");
          const body: unknown = await response.json();
          check();
          if (path.startsWith("/v9/projects/") || path.startsWith("/v2/teams/"))
            metadata.set(url.href, body);
          return body;
        },
        async team(id) {
          const team = teamSchema.parse(
            await api.get(`/v2/teams/${encodeURIComponent(id)}`),
          );
          if (team.id !== id) throw new Error("Team lookup did not match.");
          return team;
        },
        async project(team, requestedProject) {
          selector.parse(team);
          selector.parse(requestedProject);
          const isId = team.startsWith("team_");
          const project = projectSchema.parse(
            await api.get(
              `/v9/projects/${encodeURIComponent(requestedProject)}`,
              { [isId ? "teamId" : "slug"]: team },
            ),
          );
          if (
            (project.id !== requestedProject &&
              project.name !== requestedProject) ||
            (isId && project.accountId !== team)
          )
            throw new Error("Project lookup did not match.");
          // A username slug can select the default team. Verify the actual owner.
          if (!isId && (await api.team(project.accountId)).slug !== team)
            throw new Error("Project owner did not match.");
          return project;
        },
      };
      try {
        selector.parse(options.token);
        check();
        return await Promise.race([operation(api), aborted]);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      }
    },
  };
}
export type VercelApiClient = ReturnType<typeof createVercelApi>;
