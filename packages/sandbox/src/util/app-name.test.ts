import { describe, expect, it } from "vitest";
import { getAppName, withAppName } from "./app-name";

describe("app name", () => {
  it("defaults to the standalone CLI name", () => {
    expect(getAppName()).toBe("sandbox");
  });

  it("scopes the app name to an async invocation", async () => {
    await withAppName("vercel sandbox", async () => {
      await Promise.resolve();
      expect(getAppName()).toBe("vercel sandbox");
    });
    expect(getAppName()).toBe("sandbox");
  });

  it("isolates overlapping invocations", async () => {
    await Promise.all(
      ["vercel sandbox", "sandbox"].map((name) =>
        withAppName(name, async () => {
          await Promise.resolve();
          expect(getAppName()).toBe(name);
        }),
      ),
    );
    expect(getAppName()).toBe("sandbox");
  });

  it("restores the app name after a failed invocation", async () => {
    await expect(
      withAppName("vercel sandbox", async () => {
        await Promise.resolve();
        throw new Error("command failed");
      }),
    ).rejects.toThrow("command failed");
    expect(getAppName()).toBe("sandbox");
  });
});
