import { describe, it, expect, vi } from "vitest";
import {
  WORKFLOW_SERIALIZE,
  WORKFLOW_DESERIALIZE,
} from "@workflow/serde";
import {
  Command,
  CommandFinished,
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
      sandboxId,
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

      expect(serialized.output.stdout).toBe("Custom stdout\n");
      expect(serialized.output.stderr).toBe("Custom stderr\n");
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

      const commandFinished = CommandFinished[WORKFLOW_DESERIALIZE](serializedData);

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

      const commandFinished = CommandFinished[WORKFLOW_DESERIALIZE](serializedData);

      expect(commandFinished.exitCode).toBe(127);
    });

    it("preserves command properties after deserialization", () => {
      const serializedData: SerializedCommandFinished = {
        sandboxId: mockSandboxId,
        cmd: mockCommandData,
        exitCode: 0,
        output: mockOutput,
      };

      const commandFinished = CommandFinished[WORKFLOW_DESERIALIZE](serializedData);

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

      const commandFinished = CommandFinished[WORKFLOW_DESERIALIZE](serializedData);

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

      const commandFinished = CommandFinished[WORKFLOW_DESERIALIZE](serializedData);

      // Client is lazily created - internal _client should be null initially
      // (accessing .client would create one using OIDC by default)
      expect((commandFinished as unknown as { _client: unknown })._client).toBeNull();
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

      expect(serialized.output.stdout.length).toBe(10000);
      expect(serialized.output.stderr.length).toBe(10000);
    });

    it("handles output with special characters", async () => {
      const specialOutput: CommandOutput = {
        stdout: "Hello\nWorld\t\"quoted\"\n",
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

      const commandFinished = CommandFinished[WORKFLOW_DESERIALIZE](serializedData);
      const waited = await commandFinished.wait();

      expect(waited).toBe(commandFinished);
    });
  });
});
