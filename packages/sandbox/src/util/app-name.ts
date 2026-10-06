import { AsyncLocalStorage } from "node:async_hooks";

const appName = new AsyncLocalStorage<string>();

/** Keep embedded command output scoped to its invocation, not the process. */
export function withAppName<T>(name: string, callback: () => T): T {
  return appName.run(name, callback);
}

export function getAppName(): string {
  return appName.getStore() ?? "sandbox";
}
