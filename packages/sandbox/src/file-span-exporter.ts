import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import { JsonTraceSerializer } from "@opentelemetry/otlp-transformer";
import type {
  ReadableSpan,
  SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { appendFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * Appends spans as OTLP/JSON `ExportTraceServiceRequest` lines (JSONL) to a
 * file under the given directory, one file per process invocation.
 *
 * Writes are synchronous so every ended span is on disk immediately, which
 * keeps traces intact through `process.exit()` and signals. Each line is a
 * self-contained OTLP payload that can be replayed into Jaeger or Tempo via
 * their OTLP HTTP endpoints.
 */
export class FileSpanExporter implements SpanExporter {
  private filePath: string | undefined;
  private disabled = false;

  constructor(private readonly directory: string) {}

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    if (this.disabled) {
      resultCallback({ code: ExportResultCode.FAILED });
      return;
    }

    try {
      const serialized = JsonTraceSerializer.serializeRequest(spans);
      if (!serialized) {
        resultCallback({ code: ExportResultCode.FAILED });
        return;
      }

      const line = Buffer.concat([Buffer.from(serialized), NEWLINE]);
      appendFileSync(this.getFilePath(), line);
      resultCallback({ code: ExportResultCode.SUCCESS });
    } catch (error) {
      // If we can't write (read-only cwd, etc), give up quietly. Tracing
      // must never take the CLI down with it.
      this.disabled = true;
      resultCallback({
        code: ExportResultCode.FAILED,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  private getFilePath(): string {
    if (!this.filePath) {
      mkdirSync(this.directory, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      this.filePath = join(this.directory, `${timestamp}-${process.pid}.jsonl`);
      pruneTraceFiles(this.directory, MAX_TRACE_FILES - 1);
    }
    return this.filePath;
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

function pruneTraceFiles(directory: string, keep: number): void {
  const traceFiles = readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".jsonl"))
    .sort()
    .reverse();

  for (const fileName of traceFiles.slice(keep)) {
    rmSync(join(directory, fileName), { force: true });
  }
}

const MAX_TRACE_FILES = 10;
const NEWLINE = Buffer.from("\n");
