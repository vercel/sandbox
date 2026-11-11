import { expect, test, vi } from "vitest";
const { create, retryAuth } = vi.hoisted(() => ({
  create: vi.fn(),
  retryAuth: vi.fn((factory: () => Promise<unknown>) => factory()),
}));
vi.mock("@vercel/sandbox", async (original) => ({
  ...(await original<typeof import("@vercel/sandbox")>()),
  Sandbox: { create },
}));
vi.mock("../src/util/fresh-auth-retry", () => ({
  withFreshAuthRetry: retryAuth,
}));
import { sandboxClient } from "../src/client";
test("creation never enters the automatic auth-retry wrapper", async () => {
  create.mockRejectedValue(new Error("uncertain network outcome"));
  await expect(
    sandboxClient.create({ token: "t", teamId: "team", projectId: "project" }),
  ).rejects.toThrow("uncertain network outcome");
  expect(create).toHaveBeenCalledOnce();
  expect(retryAuth).not.toHaveBeenCalled();
});
