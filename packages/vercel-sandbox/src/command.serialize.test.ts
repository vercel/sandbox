import { describe, it, expect, vi, afterEach } from "vitest";
import { WORKFLOW_SERIALIZE, WORKFLOW_DESERIALIZE } from "@workflow/serde";
import { registerSerializationClass } from "@workflow/core/class-serialization";
import {
  dehydrateStepReturnValue,
  hydrateStepReturnValue,
} from "@workflow/core/serialization";
import {
  Command,
  CommandFinished,
  SerializedCommand,
  SerializedCommandFinished,
  CommandOutput,
} from "./command";
import type { CommandData } from "./api-client";
import { APIClient } from "./api-client";

describe("CommandFinished serialization", () => {
  const mockCommandData: CommandData = {
    id: "cmd_test123",
    name: "echo",
    args: ["hello", "world"],
    cwd: "/vercel/sandbox",
    sandboxId: "sbx_test456",
    exitCode: 0,
    startedAt: 1700000000000,
  };

  const mockSandboxId = "sbx_test456";

  const mockOutput: CommandOutput = {
    stdout: "Hello, world!\n",
    stderr: "",
  };

  const createMockCommandFinished = (
    cmd: CommandData = mockCommandData,
    sandboxId: string = mockSandboxId,
    exitCode: number = 0,
    output?: CommandOutput,
  ): CommandFinished => {
    const client = new APIClient({
      teamId: "team_test",
      token: "test_token",
    });

    return new CommandFinished({
      client,
      sessionId: sandboxId,
      cmd,
      exitCode,
      output,
    });
  };

  describe("WORKFLOW_SERIALIZE", () => {
    it("serializes a CommandFinished instance with output", () => {
      const commandFinished = createMockCommandFinished(
        mockCommandData,
        mockSandboxId,
        0,
        mockOutput,
      );

      const serialized = CommandFinished[WORKFLOW_SERIALIZE](commandFinished);

      expect(serialized).toEqual({
        sandboxId: mockSandboxId,
        cmd: mockCommandData,
        exitCode: 0,
        output: mockOutput,
      });
    });

    it("serializes without output if not fetched", () => {
      const commandFinished = createMockCommandFinished();

      const serialized = CommandFinished[WORKFLOW_SERIALIZE](commandFinished);

      expect(serialized.sandboxId).toBe(mockSandboxId);
      expect(serialized.cmd).toEqual(mockCommandData);
      expect(serialized.exitCode).toBe(0);
      expect(serialized.output).toBeUndefined();
    });

    it("preserves the exit code", () => {
      const commandFinished = createMockCommandFinished(
        { ...mockCommandData, exitCode: 42 },
        mockSandboxId,
        42,
        mockOutput,
      );

      const serialized = CommandFinished[WORKFLOW_SERIALIZE](commandFinished);

      expect(serialized.exitCode).toBe(42);
    });

    it("preserves stdout in output", () => {
      const customOutput: CommandOutput = {
        stdout: "Custom stdout\n",
        stderr: "Custom stderr\n",
      };
      const commandFinished = createMockCommandFinished(
        mockCommandData,
        mockSandboxId,
        0,
        customOutput,
      );

      const serialized = CommandFinished[WORKFLOW_SERIALIZE](commandFinished);

      expect(serialized.output?.stdout).toBe("Custom stdout\n");
      expect(serialized.output?.stderr).toBe("Custom stderr\n");
    });

    it("returns a plain object that can be JSON serialized", () => {
      const commandFinished = createMockCommandFinished(
        mockCommandData,
        mockSandboxId,
        0,
        mockOutput,
      );

      const serialized = CommandFinished[WORKFLOW_SERIALIZE](commandFinished);
      const jsonString = JSON.stringify(serialized);
      const parsed = JSON.parse(jsonString);

      expect(parsed.exitCode).toBe(0);
      expect(parsed.sandboxId).toBe(mockSandboxId);
      expect(parsed.output).toEqual(mockOutput);
    });

    it("does not include the API client", () => {
      const commandFinished = createMockCommandFinished(
        mockCommandData,
        mockSandboxId,
        0,
        mockOutput,
      );

      const serialized = CommandFinished[WORKFLOW_SERIALIZE](commandFinished);

      expect(serialized).not.toHaveProperty("client");
      expect(JSON.stringify(serialized)).not.toContain("token");
    });
  });

  describe("WORKFLOW_DESERIALIZE", () => {
    it("creates a CommandFinished instance from serialized data", () => {
      const serializedData: SerializedCommandFinished = {
        sandboxId: mockSandboxId,
        cmd: mockCommandData,
        exitCode: 0,
        output: mockOutput,
      };

      const commandFinished =
        CommandFinished[WORKFLOW_DESERIALIZE](serializedData);

      expect(commandFinished).toBeInstanceOf(CommandFinished);
      expect(commandFinished.exitCode).toBe(0);
    });

    it("returns synchronously (not a promise)", () => {
      const serializedData: SerializedCommandFinished = {
        sandboxId: mockSandboxId,
        cmd: mockCommandData,
        exitCode: 0,
        output: mockOutput,
      };

      const result = CommandFinished[WORKFLOW_DESERIALIZE](serializedData);

      // Should not be a promise
      expect(result).toBeInstanceOf(CommandFinished);
      expect(result).not.toBeInstanceOf(Promise);
    });

    it("preserves exit code after deserialization", () => {
      const serializedData: SerializedCommandFinished = {
        sandboxId: mockSandboxId,
        cmd: { ...mockCommandData, exitCode: 127 },
        exitCode: 127,
        output: mockOutput,
      };

      const commandFinished =
        CommandFinished[WORKFLOW_DESERIALIZE](serializedData);

      expect(commandFinished.exitCode).toBe(127);
    });

    it("preserves command properties after deserialization", () => {
      const serializedData: SerializedCommandFinished = {
        sandboxId: mockSandboxId,
        cmd: mockCommandData,
        exitCode: 0,
        output: mockOutput,
      };

      const commandFinished =
        CommandFinished[WORKFLOW_DESERIALIZE](serializedData);

      expect(commandFinished.cmdId).toBe(mockCommandData.id);
      expect(commandFinished.cwd).toBe(mockCommandData.cwd);
      expect(commandFinished.startedAt).toBe(mockCommandData.startedAt);
    });

    it("restores output for stdout() and stderr() methods", async () => {
      const serializedData: SerializedCommandFinished = {
        sandboxId: mockSandboxId,
        cmd: mockCommandData,
        exitCode: 0,
        output: mockOutput,
      };

      const commandFinished =
        CommandFinished[WORKFLOW_DESERIALIZE](serializedData);

      expect(await commandFinished.stdout()).toBe(mockOutput.stdout);
      expect(await commandFinished.stderr()).toBe(mockOutput.stderr);
    });

    it("deserialized instance has no client until accessed", () => {
      const serializedData: SerializedCommandFinished = {
        sandboxId: mockSandboxId,
        cmd: mockCommandData,
        exitCode: 0,
        output: mockOutput,
      };

      const commandFinished =
        CommandFinished[WORKFLOW_DESERIALIZE](serializedData);

      // Client is lazily created - internal _client should be null initially
      // (accessing .client would create one using OIDC by default)
      expect(Reflect.get(commandFinished, "_client")).toBeNull();
    });
  });

  describe("roundtrip serialization", () => {
    it("serializes and deserializes a CommandFinished", async () => {
      const originalCommand = createMockCommandFinished(
        mockCommandData,
        mockSandboxId,
        42,
        mockOutput,
      );

      // Serialize
      const serialized = CommandFinished[WORKFLOW_SERIALIZE](originalCommand);

      // Deserialize
      const deserialized = CommandFinished[WORKFLOW_DESERIALIZE](serialized);

      expect(deserialized.cmdId).toBe(originalCommand.cmdId);
      expect(deserialized.exitCode).toBe(42);
      expect(await deserialized.stdout()).toBe(mockOutput.stdout);
      expect(await deserialized.stderr()).toBe(mockOutput.stderr);
    });

    it("serialized data can be stored and retrieved via JSON", async () => {
      const originalCommand = createMockCommandFinished(
        { ...mockCommandData, exitCode: 42 },
        mockSandboxId,
        42,
        mockOutput,
      );

      // Serialize to JSON (simulating storage)
      const serialized = CommandFinished[WORKFLOW_SERIALIZE](originalCommand);
      const storedJson = JSON.stringify(serialized);

      // Retrieve from storage and deserialize
      const retrievedData: SerializedCommandFinished = JSON.parse(storedJson);
      const deserialized = CommandFinished[WORKFLOW_DESERIALIZE](retrievedData);

      expect(deserialized.cmdId).toBe(originalCommand.cmdId);
      expect(deserialized.exitCode).toBe(42);
      expect(await deserialized.stdout()).toBe(mockOutput.stdout);
    });
  });

  describe("SerializedCommandFinished type", () => {
    it("contains all required fields", () => {
      const serializedData: SerializedCommandFinished = {
        sandboxId: "sbx_test",
        cmd: mockCommandData,
        exitCode: 0,
        output: mockOutput,
      };

      expect(serializedData).toHaveProperty("sandboxId");
      expect(serializedData).toHaveProperty("cmd");
      expect(serializedData).toHaveProperty("exitCode");
      expect(serializedData).toHaveProperty("output");
    });

    it("output contains stdout and stderr", () => {
      const commandFinished = createMockCommandFinished(
        mockCommandData,
        mockSandboxId,
        0,
        mockOutput,
      );
      const serialized = CommandFinished[WORKFLOW_SERIALIZE](commandFinished);

      expect(serialized.output).toHaveProperty("stdout");
      expect(serialized.output).toHaveProperty("stderr");
    });
  });

  describe("edge cases", () => {
    it("handles empty output", async () => {
      const emptyOutput: CommandOutput = { stdout: "", stderr: "" };
      const commandFinished = createMockCommandFinished(
        mockCommandData,
        mockSandboxId,
        0,
        emptyOutput,
      );

      const serialized = CommandFinished[WORKFLOW_SERIALIZE](commandFinished);
      expect(serialized.output).toEqual(emptyOutput);

      const deserialized = CommandFinished[WORKFLOW_DESERIALIZE](serialized);
      expect(await deserialized.stdout()).toBe("");
      expect(await deserialized.stderr()).toBe("");
    });

    it("handles large output", () => {
      const largeOutput: CommandOutput = {
        stdout: "x".repeat(10000),
        stderr: "y".repeat(10000),
      };
      const commandFinished = createMockCommandFinished(
        mockCommandData,
        mockSandboxId,
        0,
        largeOutput,
      );

      const serialized = CommandFinished[WORKFLOW_SERIALIZE](commandFinished);

      expect(serialized.output?.stdout.length).toBe(10000);
      expect(serialized.output?.stderr.length).toBe(10000);
    });

    it("handles output with special characters", async () => {
      const specialOutput: CommandOutput = {
        stdout: 'Hello\nWorld\t"quoted"\n',
        stderr: "Error: 日本語\n",
      };
      const commandFinished = createMockCommandFinished(
        mockCommandData,
        mockSandboxId,
        0,
        specialOutput,
      );

      const serialized = CommandFinished[WORKFLOW_SERIALIZE](commandFinished);
      expect(serialized.output).toEqual(specialOutput);

      const deserialized = CommandFinished[WORKFLOW_DESERIALIZE](serialized);
      expect(await deserialized.stdout()).toBe(specialOutput.stdout);
      expect(await deserialized.stderr()).toBe(specialOutput.stderr);
    });

    it("handles exit code 0", () => {
      const commandFinished = createMockCommandFinished(
        { ...mockCommandData, exitCode: 0 },
        mockSandboxId,
        0,
        mockOutput,
      );
      const serialized = CommandFinished[WORKFLOW_SERIALIZE](commandFinished);

      expect(serialized.exitCode).toBe(0);
    });

    it("handles high exit code (255)", () => {
      const commandFinished = createMockCommandFinished(
        { ...mockCommandData, exitCode: 255 },
        mockSandboxId,
        255,
        mockOutput,
      );
      const serialized = CommandFinished[WORKFLOW_SERIALIZE](commandFinished);

      expect(serialized.exitCode).toBe(255);
    });

    it("handles command with special characters in args", () => {
      const cmdWithSpecialArgs: CommandData = {
        ...mockCommandData,
        args: ["--flag=value", "-x", "hello world", "path/to/file"],
      };
      const commandFinished = createMockCommandFinished(
        cmdWithSpecialArgs,
        mockSandboxId,
        0,
        mockOutput,
      );

      const serialized = CommandFinished[WORKFLOW_SERIALIZE](commandFinished);

      expect(serialized.cmd.args).toEqual([
        "--flag=value",
        "-x",
        "hello world",
        "path/to/file",
      ]);
    });

    it("wait() returns this for deserialized instances", async () => {
      const serializedData: SerializedCommandFinished = {
        sandboxId: mockSandboxId,
        cmd: mockCommandData,
        exitCode: 0,
        output: mockOutput,
      };

      const commandFinished =
        CommandFinished[WORKFLOW_DESERIALIZE](serializedData);
      const waited = await commandFinished.wait();

      expect(waited).toBe(commandFinished);
    });
  });

  describe("deserialized without cached output", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("stdout() and stderr() work after deserialization without output", async () => {
      vi.mock("./utils/get-credentials.js", () => ({
        getCredentials: vi.fn().mockResolvedValue({
          token: "test_token",
          teamId: "team_test",
          projectId: "proj_test",
        }),
      }));

      const serializedData: SerializedCommandFinished = {
        sandboxId: mockSandboxId,
        cmd: mockCommandData,
        exitCode: 0,
        // No output — simulates a deserialized instance that never fetched logs
      };

      const commandFinished =
        CommandFinished[WORKFLOW_DESERIALIZE](serializedData);

      // _client should be null before any async method is called
      expect(Reflect.get(commandFinished, "_client")).toBeNull();

      // Mock getLogs on the APIClient prototype to return fake log entries
      const getLogsSpy = vi
        .spyOn(APIClient.prototype, "getLogs")
        .mockReturnValue(
          (async function* () {
            yield { stream: "stdout" as const, data: "hello\n" };
            yield { stream: "stderr" as const, data: "warn\n" };
          })() as any,
        );

      const stdout = await commandFinished.stdout();
      const stderr = await commandFinished.stderr();

      expect(stdout).toBe("hello\n");
      expect(stderr).toBe("warn\n");
      expect(getLogsSpy).toHaveBeenCalledOnce();
    });
  });

  describe("workflow runtime integration", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("CommandFinished survives a step boundary roundtrip", async () => {
      registerSerializationClass("CommandFinished", CommandFinished);

      const commandFinished = createMockCommandFinished(
        mockCommandData,
        mockSandboxId,
        0,
        mockOutput,
      );

      // Simulate step returning a CommandFinished
      const dehydrated = await dehydrateStepReturnValue(
        commandFinished,
        "run_123",
        undefined,
      );
      expect(dehydrated).toBeInstanceOf(Uint8Array);

      // Simulate workflow receiving the step result
      const rehydrated = await hydrateStepReturnValue(
        dehydrated,
        "run_123",
        undefined,
      );

      expect(rehydrated).toBeInstanceOf(CommandFinished);
      expect(rehydrated.exitCode).toBe(0);
      expect(rehydrated.cmdId).toBe(mockCommandData.id);
    });

    it("preserves output through the runtime pipeline", async () => {
      registerSerializationClass("CommandFinished", CommandFinished);

      const commandFinished = createMockCommandFinished(
        mockCommandData,
        mockSandboxId,
        42,
        mockOutput,
      );

      const dehydrated = await dehydrateStepReturnValue(
        commandFinished,
        "run_456",
        undefined,
      );
      const rehydrated = await hydrateStepReturnValue(
        dehydrated,
        "run_456",
        undefined,
      );

      expect(rehydrated.exitCode).toBe(42);
      expect(await rehydrated.stdout()).toBe(mockOutput.stdout);
      expect(await rehydrated.stderr()).toBe(mockOutput.stderr);
    });
  });
});

describe("Command serialization", () => {
  const mockCommandData: CommandData = {
    id: "cmd_detached123",
    name: "sleep",
    args: ["60"],
    cwd: "/vercel/sandbox",
    sandboxId: "sbx_detached456",
    exitCode: null,
    startedAt: 1700000000000,
  };

  const mockSandboxId = "sbx_detached456";

  const mockOutput: CommandOutput = {
    stdout: "running...\n",
    stderr: "",
  };

  const createMockCommand = (
    cmd: CommandData = mockCommandData,
    sandboxId: string = mockSandboxId,
    output?: CommandOutput,
  ): Command => {
    const client = new APIClient({
      teamId: "team_test",
      token: "test_token",
    });

    return new Command({
      client,
      sessionId: sandboxId,
      cmd,
      output,
    });
  };

  describe("WORKFLOW_SERIALIZE", () => {
    it("serializes a Command instance with output", () => {
      const command = createMockCommand(
        mockCommandData,
        mockSandboxId,
        mockOutput,
      );

      const serialized = Command[WORKFLOW_SERIALIZE](command);

      expect(serialized).toEqual({
        sandboxId: mockSandboxId,
        cmd: mockCommandData,
        output: mockOutput,
      });
    });

    it("serializes without output if not fetched", () => {
      const command = createMockCommand();

      const serialized = Command[WORKFLOW_SERIALIZE](command);

      expect(serialized.sandboxId).toBe(mockSandboxId);
      expect(serialized.cmd).toEqual(mockCommandData);
      expect(serialized.output).toBeUndefined();
    });

    it("does not include the API client", () => {
      const command = createMockCommand(
        mockCommandData,
        mockSandboxId,
        mockOutput,
      );

      const serialized = Command[WORKFLOW_SERIALIZE](command);

      expect(serialized).not.toHaveProperty("client");
      expect(JSON.stringify(serialized)).not.toContain("test_token");
    });

    it("returns JSON-serializable data", () => {
      const command = createMockCommand(
        mockCommandData,
        mockSandboxId,
        mockOutput,
      );

      const serialized = Command[WORKFLOW_SERIALIZE](command);
      const jsonString = JSON.stringify(serialized);
      const parsed = JSON.parse(jsonString);

      expect(parsed.sandboxId).toBe(mockSandboxId);
      expect(parsed.output).toEqual(mockOutput);
    });
  });

  describe("WORKFLOW_DESERIALIZE", () => {
    it("creates a Command instance from serialized data", () => {
      const serializedData: SerializedCommand = {
        sandboxId: mockSandboxId,
        cmd: mockCommandData,
        output: mockOutput,
      };

      const command = Command[WORKFLOW_DESERIALIZE](serializedData);

      expect(command).toBeInstanceOf(Command);
      expect(command.cmdId).toBe(mockCommandData.id);
    });

    it("returns synchronously (not a promise)", () => {
      const serializedData: SerializedCommand = {
        sandboxId: mockSandboxId,
        cmd: mockCommandData,
      };

      const result = Command[WORKFLOW_DESERIALIZE](serializedData);

      expect(result).toBeInstanceOf(Command);
      expect(result).not.toBeInstanceOf(Promise);
    });

    it("restores output for stdout() and stderr() methods", async () => {
      const serializedData: SerializedCommand = {
        sandboxId: mockSandboxId,
        cmd: mockCommandData,
        output: mockOutput,
      };

      const command = Command[WORKFLOW_DESERIALIZE](serializedData);

      expect(await command.stdout()).toBe(mockOutput.stdout);
      expect(await command.stderr()).toBe(mockOutput.stderr);
    });

    it("deserialized instance has no client until accessed", () => {
      const serializedData: SerializedCommand = {
        sandboxId: mockSandboxId,
        cmd: mockCommandData,
      };

      const command = Command[WORKFLOW_DESERIALIZE](serializedData);

      expect(Reflect.get(command, "_client")).toBeNull();
    });
  });

  describe("roundtrip serialization", () => {
    it("serializes and deserializes a Command", async () => {
      const originalCommand = createMockCommand(
        mockCommandData,
        mockSandboxId,
        mockOutput,
      );

      const serialized = Command[WORKFLOW_SERIALIZE](originalCommand);
      const deserialized = Command[WORKFLOW_DESERIALIZE](serialized);

      expect(deserialized.cmdId).toBe(originalCommand.cmdId);
      expect(await deserialized.stdout()).toBe(mockOutput.stdout);
      expect(await deserialized.stderr()).toBe(mockOutput.stderr);
    });
  });

  describe("workflow runtime integration", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("Command survives a step boundary roundtrip", async () => {
      registerSerializationClass("Command", Command);

      const command = createMockCommand(
        mockCommandData,
        mockSandboxId,
        mockOutput,
      );

      const dehydrated = await dehydrateStepReturnValue(
        command,
        "run_cmd_123",
        undefined,
      );
      expect(dehydrated).toBeInstanceOf(Uint8Array);

      const rehydrated = await hydrateStepReturnValue(
        dehydrated,
        "run_cmd_123",
        undefined,
      );

      expect(rehydrated).toBeInstanceOf(Command);
      expect(rehydrated.cmdId).toBe(mockCommandData.id);
      expect(await rehydrated.stdout()).toBe(mockOutput.stdout);
    });
  });
});
