import { randomUUID } from "node:crypto";
import { rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Sandbox as RealSandbox, Snapshot as RealSnapshot } from "@vercel/sandbox";
import { Sandbox as MockSandbox } from "../src/sandbox";
import { Snapshot as MockSnapshot } from "../src/snapshot";
import { expectForkToPreserveSnapshotFileSystem } from "../src/test-scenarios";

// Same opt-in as the vercel-sandbox package: [real] tests run only with
// RUN_INTEGRATION_TESTS=1 (credentials come from .env.test or the environment).
const RUN_INTEGRATION = process.env.RUN_INTEGRATION_TESTS === "1";

const REAL_TIMEOUT_MS = 10_000;
const STATIC_API_REAL_TIMEOUT_MS = 60_000;

type CompatSandbox = MockSandbox;
type CompatSandboxClass = typeof MockSandbox;
type CompatSnapshotClass = typeof MockSnapshot;

async function withSandbox<T>(
  SandboxClass: typeof MockSandbox | typeof RealSandbox,
  fn: (sandbox: CompatSandbox, Sandbox: CompatSandboxClass) => Promise<T>,
): Promise<T> {
  const sandbox = await SandboxClass.create();
  try {
    return await fn(
      sandbox as unknown as CompatSandbox,
      SandboxClass as unknown as CompatSandboxClass,
    );
  } finally {
    await sandbox.stop();
  }
}

function testBoth(
  name: string,
  fn: (sandbox: CompatSandbox, Sandbox: CompatSandboxClass) => Promise<void>,
) {
  test(`[mock] ${name}`, () => withSandbox(MockSandbox, fn));
  (RUN_INTEGRATION ? test : test.skip)(`[real] ${name}`, { timeout: REAL_TIMEOUT_MS }, () =>
    withSandbox(RealSandbox as unknown as typeof MockSandbox, fn),
  );
}

function testStaticBoth(
  name: string,
  fn: (Sandbox: CompatSandboxClass, Snapshot: CompatSnapshotClass) => Promise<void>,
) {
  test(`[mock] ${name}`, () => fn(MockSandbox, MockSnapshot));
  (RUN_INTEGRATION ? test : test.skip)(`[real] ${name}`, { timeout: STATIC_API_REAL_TIMEOUT_MS }, () =>
    fn(
      RealSandbox as unknown as CompatSandboxClass,
      RealSnapshot as unknown as CompatSnapshotClass,
    ),
  );
}

function describeBoth(
  name: string,
  fn: (ctx: { sandbox: () => CompatSandbox; Sandbox: CompatSandboxClass }) => void,
) {
  describe(`[mock] ${name}`, () => {
    let sandbox: CompatSandbox;
    beforeAll(async () => {
      sandbox = await MockSandbox.create();
    });
    afterAll(async () => {
      await sandbox?.stop();
    });
    fn({ sandbox: () => sandbox, Sandbox: MockSandbox });
  });

  const realDescribe = RUN_INTEGRATION ? describe : describe.skip;
  realDescribe(`[real] ${name}`, () => {
    let sandbox: CompatSandbox;
    beforeAll(async () => {
      sandbox = await (RealSandbox.create() as unknown as Promise<CompatSandbox>);
    }, REAL_TIMEOUT_MS);
    afterAll(async () => {
      await sandbox?.stop();
    }, REAL_TIMEOUT_MS);
    fn({ sandbox: () => sandbox, Sandbox: RealSandbox as unknown as CompatSandboxClass });
  });
}

describe("sandbox compat", () => {
  describeBoth("basic commands", ({ sandbox }) => {
    test("echo hello -> stdout contains hello, exitCode 0", async () => {
      const result = await sandbox().runCommand("echo", ["hello"]);
      expect(result.exitCode).toBe(0);
      expect(await result.stdout()).toContain("hello");
    });

    test("printf '%s' 'exact' -> stdout contains exact", async () => {
      const result = await sandbox().runCommand("printf", ["%s", "exact"]);
      expect(result.exitCode).toBe(0);
      expect(await result.stdout()).toContain("exact");
    });

    test("true -> exitCode 0", async () => {
      const result = await sandbox().runCommand("true", []);
      expect(result.exitCode).toBe(0);
    });

    test("false -> exitCode 1", async () => {
      const result = await sandbox().runCommand("false", []);
      expect(result.exitCode).toBe(1);
    });

    test("sh -c 'echo hello && echo world'", async () => {
      const result = await sandbox().runCommand("sh", ["-c", "echo hello && echo world"]);
      const stdout = await result.stdout();
      expect(result.exitCode).toBe(0);
      expect(stdout).toContain("hello");
      expect(stdout).toContain("world");
    });

    test("sh -c 'false || echo fallback'", async () => {
      const result = await sandbox().runCommand("sh", ["-c", "false || echo fallback"]);
      expect(result.exitCode).toBe(0);
      expect(await result.stdout()).toContain("fallback");
    });

    test("sh -c 'false; echo still'", async () => {
      const result = await sandbox().runCommand("sh", ["-c", "false; echo still"]);
      expect(result.exitCode).toBe(0);
      expect(await result.stdout()).toContain("still");
    });
  });

  describeBoth("edge cases", ({ sandbox }) => {
    test("empty echo", async () => {
      const result = await sandbox().runCommand("echo");
      expect(result.exitCode).toBe(0);
      expect(await result.stdout()).toContain("\n");
    });

    test("command with special characters in args", async () => {
      const result = await sandbox().runCommand("echo", ['hello "world"']);
      expect(result.exitCode).toBe(0);
      expect(await result.stdout()).toContain('hello "world"');
    });

    test("cat nonexistent file has non-zero exit", async () => {
      const result = await sandbox().runCommand("cat", ["/nonexistent/file.txt"]);
      expect(result.exitCode).not.toBe(0);
    });

    test("pwd returns a path", async () => {
      const result = await sandbox().runCommand("pwd");
      expect(result.exitCode).toBe(0);
      expect((await result.stdout()).trim()).toMatch(/^\//);
    });

    test("env var isolation between commands", async () => {
      await sandbox().runCommand("sh", ["-c", "export MY_VAR=hello"]);
      const result = await sandbox().runCommand("sh", ["-c", "echo ${MY_VAR:-unset}"]);
      expect(result.exitCode).toBe(0);
      expect((await result.stdout()).trim()).toBe("unset");
    });
  });

  describeBoth("file operations", ({ sandbox }) => {
    test("writeFiles + cat roundtrip", async () => {
      await sandbox().writeFiles([
        { path: "/tmp/compat-roundtrip.txt", content: Buffer.from("roundtrip") },
      ]);
      const result = await sandbox().runCommand("cat", ["/tmp/compat-roundtrip.txt"]);
      expect(result.exitCode).toBe(0);
      expect(await result.stdout()).toContain("roundtrip");
    });

    test("writeFiles multiple files, cat each", async () => {
      await sandbox().writeFiles([
        { path: "/tmp/compat-multi/a.txt", content: Buffer.from("A") },
        { path: "/tmp/compat-multi/b.txt", content: Buffer.from("B") },
      ]);
      const a = await sandbox().runCommand("cat", ["/tmp/compat-multi/a.txt"]);
      const b = await sandbox().runCommand("cat", ["/tmp/compat-multi/b.txt"]);
      expect(a.exitCode).toBe(0);
      expect(b.exitCode).toBe(0);
      expect(await a.stdout()).toContain("A");
      expect(await b.stdout()).toContain("B");
    });

    test("writeFiles preserves binary content", async () => {
      const content = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x41]);
      await sandbox().writeFiles([{ path: "/tmp/compat-binary.bin", content }]);

      expect(await sandbox().readFileToBuffer({ path: "/tmp/compat-binary.bin" })).toEqual(content);
    });

    test("touch empty file then cat", async () => {
      const result = await sandbox().runCommand("sh", [
        "-c",
        "touch /tmp/compat-empty && cat /tmp/compat-empty",
      ]);
      expect(result.exitCode).toBe(0);
      expect(await result.stdout()).toContain("");
    });

    test("mkdir -p deep path then ls parent", async () => {
      const result = await sandbox().runCommand("sh", [
        "-c",
        "mkdir -p /tmp/compat-deep/a/b && ls /tmp/compat-deep/a",
      ]);
      expect(result.exitCode).toBe(0);
      expect(await result.stdout()).toContain("b");
    });

    test("cp sequence creates destination", async () => {
      const result = await sandbox().runCommand("sh", [
        "-c",
        "printf '%s' 'payload' > /tmp/compat-cp-src && cp /tmp/compat-cp-src /tmp/compat-cp-dst",
      ]);
      expect(result.exitCode).toBe(0);
      const cat = await sandbox().runCommand("cat", ["/tmp/compat-cp-dst"]);
      expect(cat.exitCode).toBe(0);
      expect(await cat.stdout()).toContain("payload");
    });

    test("mv sequence renames file", async () => {
      const result = await sandbox().runCommand("sh", [
        "-c",
        "mv /tmp/compat-cp-dst /tmp/compat-moved && cat /tmp/compat-moved",
      ]);
      expect(result.exitCode).toBe(0);
      expect(await result.stdout()).toContain("payload");
    });

    test("rm sequence removes file", async () => {
      const rm = await sandbox().runCommand("rm", ["/tmp/compat-moved"]);
      expect(rm.exitCode).toBe(0);
      const missing = await sandbox().runCommand("ls", ["/tmp/compat-moved"]);
      expect(missing.exitCode).not.toBe(0);
    });

    test("ls -la /tmp -> non-empty output", async () => {
      const result = await sandbox().runCommand("ls", ["-la", "/tmp"]);
      expect(result.exitCode).toBe(0);
      expect((await result.stdout()).trim().length).toBeGreaterThan(0);
    });

    test("find /tmp/compat-deep -type d", async () => {
      const result = await sandbox().runCommand("find", ["/tmp/compat-deep", "-type", "d"]);
      expect(result.exitCode).toBe(0);
      expect(await result.stdout()).toContain("/tmp/compat-deep/a/b");
    });
  });

  describeBoth("text processing", ({ sandbox }) => {
    beforeAll(async () => {
      await sandbox().writeFiles([
        {
          path: "/tmp/compat-text.txt",
          content: Buffer.from("line_b\nline_a\nline_c\nline_a\n"),
        },
      ]);
    });

    test("cat file | sort -> first line contains line_a", async () => {
      const result = await sandbox().runCommand("sh", ["-c", "cat /tmp/compat-text.txt | sort"]);
      const firstLine = (await result.stdout()).split("\n")[0] ?? "";
      expect(result.exitCode).toBe(0);
      expect(firstLine).toContain("line_a");
    });

    test("cat file | wc -l -> 4", async () => {
      const result = await sandbox().runCommand("sh", ["-c", "cat /tmp/compat-text.txt | wc -l"]);
      expect(result.exitCode).toBe(0);
      expect((await result.stdout()).trim()).toContain("4");
    });

    test("cat file | sort | uniq -> 3 lines", async () => {
      const result = await sandbox().runCommand("sh", [
        "-c",
        "cat /tmp/compat-text.txt | sort | uniq",
      ]);
      const lines = (await result.stdout())
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      expect(result.exitCode).toBe(0);
      expect(lines.length).toBe(3);
    });

    test("echo hello | tr a-z A-Z", async () => {
      const result = await sandbox().runCommand("sh", ["-c", "echo hello | tr a-z A-Z"]);
      expect(result.exitCode).toBe(0);
      expect(await result.stdout()).toContain("HELLO");
    });

    test("echo hello | cut -c1-3", async () => {
      const result = await sandbox().runCommand("sh", ["-c", "echo hello | cut -c1-3"]);
      expect(result.exitCode).toBe(0);
      expect(await result.stdout()).toContain("hel");
    });

    test("printf lines | head -n 1", async () => {
      const result = await sandbox().runCommand("sh", ["-c", "printf 'a\\nb\\nc\\n' | head -n 1"]);
      expect(result.exitCode).toBe(0);
      expect((await result.stdout()).trim()).toContain("a");
    });

    test("printf lines | tail -n 1", async () => {
      const result = await sandbox().runCommand("sh", ["-c", "printf 'a\\nb\\nc\\n' | tail -n 1"]);
      expect(result.exitCode).toBe(0);
      expect((await result.stdout()).trim()).toContain("c");
    });

    test("echo hello | rev", async () => {
      const result = await sandbox().runCommand("sh", ["-c", "echo hello | rev"]);
      expect(result.exitCode).toBe(0);
      expect(await result.stdout()).toContain("olleh");
    });

    test("seq 1 5 | xargs echo", async () => {
      const result = await sandbox().runCommand("sh", ["-c", "seq 1 5 | xargs echo"]);
      expect(result.exitCode).toBe(0);
      expect((await result.stdout()).trim()).toContain("1 2 3 4 5");
    });

    test("echo hello | tee file && cat file", async () => {
      const result = await sandbox().runCommand("sh", [
        "-c",
        "echo hello | tee /tmp/compat-tee.txt && cat /tmp/compat-tee.txt",
      ]);
      const stdout = await result.stdout();
      expect(result.exitCode).toBe(0);
      expect(stdout).toContain("hello");
    });

    test("echo 'key=val' | awk -F= '{print $2}'", async () => {
      const result = await sandbox().runCommand("sh", [
        "-c",
        "printf 'key=val\\n' | awk -F= '{print $2}'",
      ]);
      expect(result.exitCode).toBe(0);
      expect((await result.stdout()).trim()).toContain("val");
    });

    test("echo hello | sed s/hello/world/", async () => {
      const result = await sandbox().runCommand("sh", ["-c", "echo hello | sed s/hello/world/"]);
      expect(result.exitCode).toBe(0);
      expect(await result.stdout()).toContain("world");
    });

    test("echo hello | grep -c hello", async () => {
      const result = await sandbox().runCommand("sh", ["-c", "echo hello | grep -c hello"]);
      expect(result.exitCode).toBe(0);
      expect((await result.stdout()).trim()).toContain("1");
    });
  });

  testBoth("runCommand with env", async (sandbox) => {
    const result = await sandbox.runCommand({
      cmd: "printenv",
      args: ["MY_VAR"],
      env: { MY_VAR: "compat-test" },
    });
    expect(result.exitCode).toBe(0);
    expect((await result.stdout()).trim()).toContain("compat-test");
  });

  testBoth("runCommand with cwd /tmp", async (sandbox) => {
    const result = await sandbox.runCommand({
      cmd: "pwd",
      args: [],
      cwd: "/tmp",
    });
    expect(result.exitCode).toBe(0);
    expect((await result.stdout()).trim()).toContain("/tmp");
  });

  testBoth("FileSystem facade preserves node-style behavior", async (sandbox) => {
    const root = `/tmp/compat-fs-${randomUUID().slice(0, 8)}`;
    await sandbox.fs.mkdir(`${root}/subdirectory`, { recursive: true });
    await sandbox.fs.writeFile(`${root}/data.bin`, Buffer.from([1, 2, 3, 4]));
    await sandbox.fs.symlink("data.bin", `${root}/link.bin`);

    const entries = await sandbox.fs.readdir(root, { withFileTypes: true });
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    expect(byName.get("subdirectory")?.isDirectory()).toBe(true);
    expect(byName.get("data.bin")?.isFile()).toBe(true);
    expect(byName.get("link.bin")?.isSymbolicLink()).toBe(true);
    expect((await sandbox.fs.stat(`${root}/link.bin`)).isFile()).toBe(true);
    expect((await sandbox.fs.lstat(`${root}/link.bin`)).isSymbolicLink()).toBe(true);
    expect(await sandbox.fs.realpath(`${root}/link.bin`)).toBe(`${root}/data.bin`);

    await sandbox.fs.chmod(`${root}/data.bin`, "640");
    expect((await sandbox.fs.stat(`${root}/data.bin`)).mode & 0o777).toBe(0o640);
    await sandbox.fs.truncate(`${root}/data.bin`, 2);
    expect(await sandbox.fs.readFile(`${root}/data.bin`)).toEqual(Buffer.from([1, 2]));
    await sandbox.fs.truncate(`${root}/data.bin`, 6);
    expect(await sandbox.fs.readFile(`${root}/data.bin`)).toEqual(Buffer.from([1, 2, 0, 0, 0, 0]));
    await sandbox.fs.copyFile(`${root}/data.bin`, `${root}/copy.bin`);
    await sandbox.fs.rename(`${root}/copy.bin`, `${root}/renamed.bin`);
    expect(await sandbox.fs.readFile(`${root}/renamed.bin`)).toEqual(
      Buffer.from([1, 2, 0, 0, 0, 0]),
    );
    const firstTemp = await sandbox.fs.mkdtemp(`${root}/work-`);
    const secondTemp = await sandbox.fs.mkdtemp(`${root}/work-`);
    expect(firstTemp).not.toBe(secondTemp);
    expect((await sandbox.fs.stat(firstTemp)).isDirectory()).toBe(true);
    expect((await sandbox.fs.stat(secondTemp)).isDirectory()).toBe(true);

    await sandbox.fs.rm(root, { recursive: true });
    expect(await sandbox.fs.exists(root)).toBe(false);
  });

  testStaticBoth("getOrCreate initializes a named sandbox once", async (Sandbox) => {
    const name = `compat-create-${randomUUID().slice(0, 8)}`;
    let createCount = 0;
    let created: CompatSandbox | undefined;
    try {
      created = await Sandbox.getOrCreate({
        name,
        onCreate: async (sandbox) => {
          createCount++;
          await sandbox.fs.writeFile("/tmp/initialized.txt", "ready");
        },
      });
      const retrieved = await Sandbox.getOrCreate({
        name,
        onCreate: async () => {
          createCount++;
        },
      });

      expect(retrieved.name).toBe(name);
      expect(createCount).toBe(1);
      expect(await created.fs.readFile("/tmp/initialized.txt", "utf8")).toBe("ready");
    } finally {
      await created?.delete();
    }
  });

  testStaticBoth(
    "snapshot lifecycle is coherent across instance and static APIs",
    async (Sandbox, Snapshot) => {
      const name = `compat-snapshot-${randomUUID().slice(0, 8)}`;
      const sandbox = await Sandbox.create({ name });
      let snapshot: MockSnapshot | undefined;
      try {
        await sandbox.fs.writeFile("/tmp/state.txt", "captured");
        snapshot = await sandbox.snapshot();

        expect((await sandbox.listSnapshots()).snapshots.map(({ id }) => id)).toContain(
          snapshot.snapshotId,
        );
        expect((await Snapshot.list({ name })).snapshots.map(({ id }) => id)).toContain(
          snapshot.snapshotId,
        );
        const retrieved = await Snapshot.get({ snapshotId: snapshot.snapshotId });
        expect(retrieved.sourceSessionId).toBe(snapshot.sourceSessionId);

        await retrieved.delete();
        snapshot = undefined;
        expect((await sandbox.listSnapshots()).snapshots).toContainEqual(
          expect.objectContaining({ id: retrieved.snapshotId, status: "deleted" }),
        );
      } finally {
        await snapshot?.delete().catch(() => undefined);
        await sandbox.delete();
      }
    },
  );

  testStaticBoth(
    "fork preserves snapshot bytes, modes, symlinks, and isolation",
    async (Sandbox) => {
      await expectForkToPreserveSnapshotFileSystem(Sandbox);
    },
  );

  testBoth("printenv -> exitCode 0 and non-empty", async (sandbox) => {
    const result = await sandbox.runCommand("printenv", []);
    expect(result.exitCode).toBe(0);
    expect((await result.stdout()).trim().length).toBeGreaterThan(0);
  });

  describeBoth("pipes and redirection", ({ sandbox }) => {
    test("echo hello > file && cat file", async () => {
      const result = await sandbox().runCommand("sh", [
        "-c",
        "echo hello > /tmp/compat-redir.txt && cat /tmp/compat-redir.txt",
      ]);
      expect(result.exitCode).toBe(0);
      expect(await result.stdout()).toContain("hello");
    });

    test("append with >> then cat", async () => {
      const result = await sandbox().runCommand("sh", [
        "-c",
        "echo line1 > /tmp/compat-app.txt && echo line2 >> /tmp/compat-app.txt && cat /tmp/compat-app.txt",
      ]);
      const stdout = await result.stdout();
      expect(result.exitCode).toBe(0);
      expect(stdout).toContain("line1");
      expect(stdout).toContain("line2");
    });

    test("ls /no/such/path 2>/dev/null; echo done", async () => {
      const result = await sandbox().runCommand("sh", [
        "-c",
        "ls /no/such/path 2>/dev/null; echo done",
      ]);
      expect(result.exitCode).toBe(0);
      expect(await result.stdout()).toContain("done");
    });

    test("printf c/a/b | sort | head -n 2 | tail -n 1", async () => {
      const result = await sandbox().runCommand("sh", [
        "-c",
        "printf 'c\\na\\nb\\n' | sort | head -n 2 | tail -n 1",
      ]);
      expect(result.exitCode).toBe(0);
      expect((await result.stdout()).trim()).toContain("b");
    });
  });

  describeBoth("error handling", ({ sandbox }) => {
    test("ls /nonexistent -> non-zero and stderr string", async () => {
      const result = await sandbox().runCommand("ls", ["/nonexistent"]);
      expect(result.exitCode).not.toBe(0);
      expect(typeof (await result.stderr())).toBe("string");
    });

    test("unknown command -> exitCode 127", async () => {
      const result = await sandbox().runCommand("sh", ["-c", "definitely-not-a-real-command"]);
      expect(result.exitCode).toBe(127);
    });
  });

  describeBoth("command metadata", ({ sandbox }) => {
    test("startedAt is number", async () => {
      const result = await sandbox().runCommand("echo", ["meta"]);
      expect(typeof result.startedAt).toBe("number");
    });

    test("exitCode is number", async () => {
      const result = await sandbox().runCommand("echo", ["meta"]);
      expect(typeof result.exitCode).toBe("number");
    });

    test("cmdId is string", async () => {
      const result = await sandbox().runCommand("echo", ["meta"]);
      expect(typeof result.cmdId).toBe("string");
      expect(result.cmdId.length).toBeGreaterThan(0);
    });
  });

  describeBoth("file utilities", ({ sandbox }) => {
    test("basename /tmp/foo/bar.txt", async () => {
      const result = await sandbox().runCommand("basename", ["/tmp/foo/bar.txt"]);
      expect(result.exitCode).toBe(0);
      expect((await result.stdout()).trim()).toContain("bar.txt");
    });

    test("dirname /tmp/foo/bar.txt", async () => {
      const result = await sandbox().runCommand("dirname", ["/tmp/foo/bar.txt"]);
      expect(result.exitCode).toBe(0);
      expect((await result.stdout()).trim()).toContain("/tmp/foo");
    });

    test("which echo", async () => {
      const result = await sandbox().runCommand("which", ["echo"]);
      expect(result.exitCode).toBe(0);
      expect((await result.stdout()).trim().length).toBeGreaterThan(0);
    });

    test("echo hello | base64", async () => {
      const result = await sandbox().runCommand("sh", ["-c", "echo hello | base64"]);
      expect(result.exitCode).toBe(0);
      expect((await result.stdout()).trim().length).toBeGreaterThan(0);
    });

    test("whoami", async () => {
      const result = await sandbox().runCommand("whoami", []);
      expect(result.exitCode).toBe(0);
      expect((await result.stdout()).trim().length).toBeGreaterThan(0);
    });

    test("pwd in file utilities group", async () => {
      const result = await sandbox().runCommand("pwd", []);
      expect(result.exitCode).toBe(0);
      expect((await result.stdout()).trim().length).toBeGreaterThan(0);
    });

    test("date", async () => {
      const result = await sandbox().runCommand("date", []);
      expect(result.exitCode).toBe(0);
      expect((await result.stdout()).trim().length).toBeGreaterThan(0);
    });
  });

  describeBoth("additional portability checks", ({ sandbox }) => {
    test("pwd default cwd returns absolute path", async () => {
      const result = await sandbox().runCommand("pwd", []);
      expect(result.exitCode).toBe(0);
      expect((await result.stdout()).trim()).toContain("/");
    });

    test("env command outputs variables", async () => {
      const result = await sandbox().runCommand("env", []);
      expect(result.exitCode).toBe(0);
      expect((await result.stdout()).trim().length).toBeGreaterThan(0);
    });

    test("ln -s and readlink", async () => {
      const setup = await sandbox().runCommand("sh", [
        "-c",
        "printf '%s' 'link-target' > /tmp/compat-link-target && ln -s /tmp/compat-link-target /tmp/compat-link",
      ]);
      expect(setup.exitCode).toBe(0);
      const link = await sandbox().runCommand("readlink", ["/tmp/compat-link"]);
      expect(link.exitCode).toBe(0);
      expect((await link.stdout()).trim()).toContain("/tmp/compat-link-target");
    });

    test("stat existing file", async () => {
      const result = await sandbox().runCommand("stat", ["/tmp/compat-link-target"]);
      expect(result.exitCode).toBe(0);
      expect(await result.stdout()).toContain("compat-link-target");
    });

    test("sleep 0 exits 0", async () => {
      const result = await sandbox().runCommand("sleep", ["0"]);
      expect(result.exitCode).toBe(0);
    });

    test("cat symlink target through link", async () => {
      const prep = await sandbox().runCommand("sh", ["-c", "cat /tmp/compat-link"]);
      expect(prep.exitCode).toBe(0);
      expect(await prep.stdout()).toContain("link-target");
    });
  });

  testBoth("multi-user: home dir scoping and file operations", async (sandbox) => {
    // Unique, spec-valid username (must start with a letter, lowercase).
    const username = `u${randomUUID().slice(0, 8).replace(/-/g, "")}`;
    const user = await sandbox.createUser(username);

    expect(user.username).toBe(username);
    expect(user.homeDir).toBe(`/home/${username}`);

    // Commands default to the user's home directory.
    const pwd = await user.runCommand("pwd");
    expect((await pwd.stdout()).trim()).toBe(`/home/${username}`);

    // Relative file operations resolve under the home directory and round-trip.
    await user.writeFiles([{ path: "note.txt", content: "compat" }]);
    const buf = await user.readFileToBuffer({ path: "note.txt" });
    expect(buf?.toString()).toBe("compat");
  });

  testBoth("multi-user: group creation and membership round-trip", async (sandbox) => {
    const username = `u${randomUUID().slice(0, 8).replace(/-/g, "")}`;
    const groupname = `g${randomUUID().slice(0, 8).replace(/-/g, "")}`;
    await sandbox.createUser(username);

    const group = await sandbox.createGroup(groupname);
    expect(group).toEqual({ groupname, sharedDir: `/shared/${groupname}` });

    // Add then remove — neither should throw.
    await sandbox.addUserToGroup(username, groupname);
    await sandbox.removeUserFromGroup(username, groupname);
  });

  testBoth("multi-user: invalid names are rejected", async (sandbox) => {
    await expect(sandbox.createUser("Invalid")).rejects.toThrow();
    await expect(sandbox.createGroup("bad name")).rejects.toThrow();
  });

  testBoth("extendTimeout extends the current session's timeout", async (sandbox) => {
    const before = sandbox.currentSession().timeout;
    await sandbox.extendTimeout(60_000);
    // A real sandbox caps the timeout at the plan maximum, so the increase is
    // not guaranteed to be exactly the requested delta.
    expect(sandbox.currentSession().timeout).toBeGreaterThan(before);
  });

  testBoth("updateNetworkPolicy round-trips a mode-based policy", async (sandbox) => {
    const policy = await sandbox.updateNetworkPolicy("deny-all");
    expect(policy).toBe("deny-all");
    expect(sandbox.currentSession().networkPolicy).toBe("deny-all");
  });

  testBoth("listSessions includes the current session", async (sandbox) => {
    const { sessions } = await sandbox.listSessions();
    const current = sessions.find((s) => s.id === sandbox.currentSession().sessionId);
    expect(current).toBeDefined();
    expect(current?.status).toBe("running");
  });

  testBoth("getCommand reattaches to a detached command by id", async (sandbox) => {
    const detached = await sandbox.runCommand({
      cmd: "echo",
      args: ["reattached"],
      detached: true,
    });
    const command = await sandbox.getCommand(detached.cmdId);
    expect(command.cmdId).toBe(detached.cmdId);

    const finished = await command.wait();
    expect(finished.exitCode).toBe(0);
    const logs: string[] = [];
    for await (const log of command.logs()) logs.push(log.data);
    expect(logs.join("")).toContain("reattached");
  });

  testBoth("openInteractive returns a websocket url and token", async (sandbox) => {
    const { url, token } = await sandbox.openInteractive();
    expect(url).toMatch(/^wss?:\/\//);
    expect(token.length).toBeGreaterThan(0);
  });

  testBoth("mkDir creates a directory under a world-writable parent", async (sandbox) => {
    // A single level directly under /tmp; nesting under a dir the mkdir
    // endpoint just created fails on a real sandbox, where that dir is owned
    // by root while the fs API runs as `vercel-sandbox`.
    const dir = `/tmp/compat-mkdir-${randomUUID().slice(0, 8)}`;
    await sandbox.mkDir(dir);
    expect((await sandbox.runCommand("test", ["-d", dir])).exitCode).toBe(0);
  });

  testBoth("sandbox-level file helpers round-trip", async (sandbox) => {
    const root = `/tmp/compat-files-${randomUUID().slice(0, 8)}`;
    // Build the tree with `mkdir -p` (fs.mkdir recursive) rather than the
    // mkdir endpoint, so the directories are owned by the fs user.
    await sandbox.fs.mkdir(`${root}/nested`, { recursive: true });
    await sandbox.writeFiles([{ path: `${root}/nested/data.txt`, content: "sandbox-level" }]);

    const buffer = await sandbox.readFileToBuffer({ path: `${root}/nested/data.txt` });
    expect(buffer?.toString()).toBe("sandbox-level");

    const stream = await sandbox.readFile({ path: `${root}/nested/data.txt` });
    expect(stream).not.toBeNull();
    let streamed = "";
    for await (const chunk of stream!) streamed += chunk.toString();
    expect(streamed).toBe("sandbox-level");

    // Missing files resolve to null rather than throwing.
    expect(await sandbox.readFile({ path: `${root}/missing.txt` })).toBeNull();
    expect(await sandbox.readFileToBuffer({ path: `${root}/missing.txt` })).toBeNull();

    const localDir = path.join(tmpdir(), `sandbox-mock-download-${randomUUID().slice(0, 8)}`);
    const localFile = path.join(localDir, "data.txt");
    try {
      const written = await sandbox.downloadFile(
        { path: `${root}/nested/data.txt` },
        { path: localFile },
        { mkdirRecursive: true },
      );
      expect(written).toBe(localFile);
      expect(await readFile(localFile, "utf8")).toBe("sandbox-level");
      expect(
        await sandbox.downloadFile({ path: `${root}/missing.txt` }, { path: localFile }),
      ).toBeNull();
    } finally {
      await rm(localDir, { recursive: true, force: true });
    }
  });

  testStaticBoth("list filters by tags", async (Sandbox) => {
    const value = randomUUID().slice(0, 8);
    const sandbox = await Sandbox.create({ name: `compat-tags-${value}`, tags: { suite: value } });
    try {
      const { sandboxes } = await Sandbox.list({ tags: { suite: value } });
      expect(sandboxes.map((s) => s.name)).toEqual([sandbox.name]);
      const { sandboxes: none } = await Sandbox.list({ tags: { suite: `${value}-miss` } });
      expect(none).toEqual([]);
    } finally {
      await sandbox.delete();
    }
  });

  test("[mock] mkDir is not recursive: a missing parent yields a 400", async () => {
    const sandbox = await MockSandbox.create();
    try {
      await expect(
        sandbox.mkDir(`/tmp/compat-missing-${randomUUID().slice(0, 8)}/child`),
      ).rejects.toMatchObject({ response: { status: 400 } });
    } finally {
      await sandbox.delete();
    }
  });

  test("[mock] Snapshot.get() with an unknown id throws a 404", async () => {
    await expect(MockSnapshot.get({ snapshotId: "snap_missing" })).rejects.toMatchObject({
      response: { status: 404 },
    });
  });

  test("[mock] creating a sandbox from a deleted snapshot throws snapshot_not_found", async () => {
    const sandbox = await MockSandbox.create();
    try {
      const snapshot = await sandbox.snapshot();
      await snapshot.delete();
      await expect(
        MockSandbox.create({ source: { type: "snapshot", snapshotId: snapshot.snapshotId } }),
      ).rejects.toMatchObject({
        response: { status: 410 },
        json: { error: { code: "snapshot_not_found" } },
      });
    } finally {
      await sandbox.delete();
    }
  });

  test("[mock] session-level commands on a stopped session throw a 410", async () => {
    const sandbox = await MockSandbox.create();
    const session = sandbox.currentSession();
    await session.stop();
    await expect(session.runCommand("echo", ["hi"])).rejects.toMatchObject({
      response: { status: 410 },
    });
    await sandbox.delete();
  });

  test("[mock] Sandbox.get() with unknown name throws", async () => {
    await expect(MockSandbox.get({ name: "nonexistent-name" })).rejects.toThrow();
  });

  (RUN_INTEGRATION ? test : test.skip)(
    "[real] Sandbox.get() with unknown name throws",
    { timeout: REAL_TIMEOUT_MS },
    async () => {
      await expect(RealSandbox.get({ name: "nonexistent-name" })).rejects.toThrow();
    },
  );

  // INCONSISTENCY: arithmetic uses 32-bit signed integers in just-bash (real bash uses 64-bit)
  test.skip("INCONSISTENCY: 32-bit arithmetic overflow semantics", () => {});

  // INCONSISTENCY: no job control in just-bash; '&' backgrounding is not supported
  test.skip("INCONSISTENCY: no job control (&) support", () => {});

  // INCONSISTENCY: logs() in mock is buffered and emitted after completion
  test.skip("INCONSISTENCY: logs() streaming is buffered in mock", () => {});

  // INCONSISTENCY: just-bash uses exit code 126 for execution limits, not permission denied
  test.skip("INCONSISTENCY: exit code 126 meaning differs", () => {});

  // INCONSISTENCY: jq exists in just-bash but is not guaranteed in real sandbox image
  test.skip("INCONSISTENCY: jq availability differs", () => {});

  // INCONSISTENCY: runCommand("shell string") works in mock, 400 in real sandbox
  test.skip("INCONSISTENCY: string-form runCommand dispatch differs", () => {});

  // INCONSISTENCY: sudo is a no-op in just-bash while real sandbox executes with privileges
  test.skip("INCONSISTENCY: sudo behavior differs", () => {});

  // INCONSISTENCY: the mock reports custom network policies as a bare { mode: "custom" },
  // dropping allowedDomains, so updateNetworkPolicy({ allow: [...] }) reads back as {}
  test.skip("INCONSISTENCY: custom network policies lose their domain list", () => {});

  // INCONSISTENCY: hostname command is unavailable in real sandbox runtime for this suite
  test.skip("INCONSISTENCY: hostname availability differs", () => {});

  // INCONSISTENCY: diff command is unavailable in real sandbox runtime for this suite
  test.skip("INCONSISTENCY: diff availability differs", () => {});
});
