import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import xdgAppPaths from "xdg-app-paths";
import createDebugger from "debug";
import { version } from "../pkg";
import { detectAgentName } from "./agent";

const debug = createDebugger("sandbox:telemetry");

const BRIDGE_URL = "https://telemetry.vercel.com/api/sandbox-cli/v1/events";
const FLUSH_TIMEOUT_MS = 1_500;

interface Event {
  id: string;
  event_time: number;
  key: string;
  value: string;
}

function configFilePath(): string {
  return join(xdgAppPaths("sandbox-cli").config(), "telemetry.json");
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

export function readTelemetryConfig(): { enabled?: boolean } | undefined {
  return readJson(configFilePath());
}

export function writeTelemetryConfig(enabled: boolean): void {
  const dir = xdgAppPaths("sandbox-cli").config();
  mkdirSync(dir, { recursive: true });
  writeFileSync(configFilePath(), JSON.stringify({ enabled }, null, 2));
}

/**
 * Reads the Vercel CLI's global telemetry preference so that running as
 * `vercel sandbox` respects an existing `vercel telemetry disable`.
 */
function vercelCliTelemetryDisabled(): boolean {
  const config = readJson(join(xdgAppPaths("com.vercel.cli").config(), "config.json"));
  const telemetry = config?.telemetry as { enabled?: boolean } | undefined;
  return telemetry?.enabled === false;
}

// Keep in sync with the commands registered in app.ts (including aliases).
const SUBCOMMANDS = new Set([
  "list",
  "ls",
  "create",
  "sh",
  "fork",
  "config",
  "copy",
  "cp",
  "exec",
  "connect",
  "ssh",
  "shell",
  "stop",
  "remove",
  "rm",
  "run",
  "snapshot",
  "snapshots",
  "sessions",
  "login",
  "logout",
  "telemetry",
]);

export class Telemetry {
  private events: Event[] = [];
  private readonly sessionId = randomUUID();
  private teamId = "NO_TEAM_ID";
  private embedded = false;

  get enabled(): boolean {
    if (
      process.env.VERCEL_SANDBOX_TELEMETRY_DISABLED ||
      process.env.VERCEL_TELEMETRY_DISABLED
    ) {
      return false;
    }
    if (this.embedded && vercelCliTelemetryDisabled()) {
      return false;
    }
    return readTelemetryConfig()?.enabled ?? true;
  }

  get isDebug(): boolean {
    return Boolean(process.env.VERCEL_TELEMETRY_DEBUG);
  }

  track(key: string, value: string | undefined): void {
    if (!value) return;
    this.events.push({ id: randomUUID(), event_time: Date.now(), key, value });
  }

  updateTeamId(teamId: string | undefined): void {
    if (teamId) this.teamId = teamId;
  }

  async trackInvocation(opts: { appName: string; argv: string[] }): Promise<void> {
    this.embedded = opts.appName !== "sandbox";
    // Only ever record known subcommand names, so option values that happen
    // to precede the subcommand (tokens, paths) can never end up in an event.
    const subcommand = opts.argv.find((arg) => SUBCOMMANDS.has(arg));
    this.track("subcommand", subcommand);
    this.track("agent", await detectAgentName());
    this.track("version", version);
    this.track("platform", os.platform());
    this.track("arch", os.arch());
    this.track("ci", process.env.CI ? "TRUE" : undefined);
    this.track("embedded", this.embedded ? opts.appName : undefined);
  }

  /**
   * Sends buffered events to the telemetry bridge. Never throws and never
   * blocks the CLI for longer than FLUSH_TIMEOUT_MS. With
   * VERCEL_TELEMETRY_DEBUG set, events are printed to stderr and not sent.
   */
  async flush(): Promise<void> {
    if (this.events.length === 0) return;

    const events = this.events.map((event) => ({
      ...event,
      team_id: this.teamId,
      session_id: this.sessionId,
    }));
    this.events = [];

    if (this.isDebug) {
      for (const event of events) {
        process.stderr.write(`[telemetry] ${JSON.stringify(event)}\n`);
      }
      return;
    }

    if (!this.enabled) return;

    try {
      const response = await fetch(
        process.env.VERCEL_SANDBOX_TELEMETRY_BRIDGE_URL || BRIDGE_URL,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "client-id": "sandbox-cli",
            "x-sandbox-cli-topic-id": "generic",
            "x-sandbox-cli-session-id": this.sessionId,
          },
          body: JSON.stringify(events),
          signal: AbortSignal.timeout(FLUSH_TIMEOUT_MS),
        },
      );
      debug("telemetry bridge responded with %d", response.status);
    } catch (error) {
      debug("failed to send telemetry events: %o", error);
    }
  }
}

export const telemetry = new Telemetry();
