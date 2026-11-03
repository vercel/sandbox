import * as cmd from "cmd-ts";
import { beforeEach, expect, test, vi } from "vitest";
import { createContext } from "../../src/args/create-context";

const { authentication, payload } = vi.hoisted(() => ({
  authentication: vi.fn(() => {
    throw new Error("Authentication must not start for conflicting flags");
  }),
  payload: vi.fn(() => {
    throw new Error("Payload input must not be read for conflicting flags");
  }),
}));
vi.mock("../../src/args/auth", async (original) => ({
  ...(await original<typeof import("../../src/args/auth")>()),
  createTokenOption: authentication,
}));
vi.mock("../../src/util/managed-credentials-payload", () => ({
  readJsonPayload: payload,
}));
const parser = cmd.command({
  name: "create",
  args: { context: createContext() },
  handler: (args) => args.context,
});
beforeEach(() => vi.clearAllMocks());

test("a preset without a value cannot start authentication", async () => {
  await expect(
    cmd.run(parser, ["--github-access", "--json"]),
  ).rejects.toMatchObject({
    message: expect.stringContaining("--github-access"),
    options: { json: true },
  });
  expect(authentication).not.toHaveBeenCalled();
  expect(payload).not.toHaveBeenCalled();
});

test.each([
  "--credentials-github-action=issues:read",
  "--credentials-github-from-config-file=-",
  "--credentials-github-from-sandbox=sbx_existing",
  "--credentials-github-no-write",
])(
  "rejects a preset conflict with %s before authentication or payload input",
  async (conflict) => {
    await expect(
      cmd.run(parser, ["--github-access=read", conflict, "--json"]),
    ).rejects.toThrow(/--github-access/);
    expect(authentication).not.toHaveBeenCalled();
    expect(payload).not.toHaveBeenCalled();
  },
);
