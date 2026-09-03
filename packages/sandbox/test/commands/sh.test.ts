import { beforeEach, describe, expect, test, vi } from "vitest";

const { mockCreate, mockExec } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockExec: vi.fn(),
}));

vi.mock("../../src/commands/create", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/commands/create")>();
  return {
    ...original,
    create: { ...original.create, handler: mockCreate },
  };
});

vi.mock("../../src/commands/exec", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/commands/exec")>();
  return {
    ...original,
    exec: { ...original.exec, handler: mockExec },
  };
});

const args = {
  removeAfterUse: false,
  nonPersistent: false,
  scope: { token: "token", team: "team", project: "project" },
};

describe("sh command", () => {
  const remove = vi.fn();
  const sandbox = { name: "new-sandbox", delete: remove };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue(sandbox);
    mockExec.mockResolvedValue(undefined);
    remove.mockResolvedValue(undefined);
  });

  test("keeps the existing create-and-connect flow without --rm", async () => {
    const { sh } = await import("../../src/commands/sh");

    await sh.handler(args as Parameters<typeof sh.handler>[0]);

    expect(mockCreate).toHaveBeenCalledWith({
      nonPersistent: false,
      scope: args.scope,
      connect: true,
    });
    expect(mockExec).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  test("creates a non-persistent sandbox and removes it after the shell exits", async () => {
    const { sh } = await import("../../src/commands/sh");

    await sh.handler({
      ...args,
      removeAfterUse: true,
    } as Parameters<typeof sh.handler>[0]);

    expect(mockCreate).toHaveBeenCalledWith({
      nonPersistent: true,
      scope: args.scope,
      connect: false,
      __printConnectHint: false,
    });
    expect(mockExec).toHaveBeenCalledWith(
      expect.objectContaining({
        sandbox,
        command: "sh",
        interactive: true,
      }),
    );
    expect(remove).toHaveBeenCalledOnce();
    expect(mockExec.mock.invocationCallOrder[0]).toBeLessThan(
      remove.mock.invocationCallOrder[0],
    );
  });

  test("removes the sandbox when the shell disconnects with an error", async () => {
    const shellError = new Error("shell disconnected");
    mockExec.mockRejectedValue(shellError);
    const { sh } = await import("../../src/commands/sh");

    await expect(
      sh.handler({
        ...args,
        removeAfterUse: true,
      } as Parameters<typeof sh.handler>[0]),
    ).rejects.toBe(shellError);

    expect(remove).toHaveBeenCalledOnce();
  });
});
