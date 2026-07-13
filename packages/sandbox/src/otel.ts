import {
  SpanStatusCode,
  trace as otelTrace,
  type Span,
} from "@opentelemetry/api";
import path from "node:path";
import XDGAppPaths from "xdg-app-paths";

let provider:
  | import("@opentelemetry/sdk-trace-node").NodeTracerProvider
  | undefined;
let shutdownRegistered = false;
let fetchInstrumentation:
  | import("@opentelemetry/instrumentation-fetch").FetchInstrumentation
  | undefined;

export function traced<Args extends unknown[], T>(
  ...bag:
    | [{ name: string }, (...args: Args) => Promise<T>]
    | [(...args: Args) => Promise<T>]
): (...args: Args) => Promise<T> {
  const fn = bag.length === 1 ? bag[0] : bag[1];
  const opts = bag.length === 2 ? bag[0] : { name: fn.name };

  return async (...args) => {
    return trace(opts.name || "ANONYMOUS SPAN", () => {
      return fn(...args);
    });
  };
}

export function getCurrentSpan() {
  return otelTrace.getActiveSpan();
}

export async function trace<T>(
  name: string,
  callback: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = otelTrace.getTracer("sandbox-cli");

  return tracer.startActiveSpan(name, async (span) => {
    let setStatus: undefined | (typeof span)["setStatus"] =
      span.setStatus.bind(span);
    span.setStatus = (status) => {
      setStatus?.(status);
      setStatus = undefined;
      return span;
    };

    try {
      const result = await callback(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      recordException(span, error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: getErrorMessage(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function getTracesPath() {
  return path.join(XDGAppPaths("com.vercel.sandbox").cache(), "traces");
}

export async function setupOtel(): Promise<typeof provider> {
  try {
    const [fileExporter, fetch, resources, traceBase, traceNode, conventions] =
      await Promise.all([
        import("./file-span-exporter"),
        import("@opentelemetry/instrumentation-fetch"),
        import("@opentelemetry/resources"),
        import("@opentelemetry/sdk-trace-base"),
        import("@opentelemetry/sdk-trace-node"),
        import("@opentelemetry/semantic-conventions"),
      ]);

    // Always write traces to disk as OTLP/JSON lines so they can be loaded
    // into Jaeger/Tempo later, even without an OTLP endpoint configured.
    const spanProcessors = [
      new traceBase.SimpleSpanProcessor(
        new fileExporter.FileSpanExporter(getTracesPath()),
      ),
    ];

    if (hasOtelExporterConfig()) {
      const exporter = await import("@opentelemetry/exporter-trace-otlp-http");
      spanProcessors.push(
        new traceBase.SimpleSpanProcessor(new exporter.OTLPTraceExporter({})),
      );
    }

    provider = new traceNode.NodeTracerProvider({
      resource: new resources.Resource({
        [conventions.ATTR_SERVICE_NAME]:
          process.env.OTEL_SERVICE_NAME ?? "sandbox-cli",
      }),
      spanProcessors,
    });
    provider.register();
    fetchInstrumentation = new fetch.FetchInstrumentation({
      propagateTraceHeaderCorsUrls: [/.*/],
      applyCustomAttributesOnSpan(span, req, res) {
        let urlString = "url" in res ? res.url : "url" in req ? req.url : "";
        if (urlString) {
          try {
            const url = new URL(urlString);
            url.search = "";
            urlString = url.toString();
          } catch {}
        }

        span.updateName(`${req.method || "GET"} ${urlString}`);
      },
    });
    fetchInstrumentation.enable();
    registerShutdown();
  } catch {
    provider = undefined;
    fetchInstrumentation = undefined;
  }

  return provider;
}

function hasOtelExporterConfig(): boolean {
  return Boolean(
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  );
}

function registerShutdown() {
  if (shutdownRegistered) {
    return;
  }
  shutdownRegistered = true;

  process.once("beforeExit", () => {
    fetchInstrumentation?.disable();
    void provider?.shutdown().catch(() => undefined);
  });
}

function recordException(span: Span, error: unknown) {
  if (error instanceof Error) {
    span.recordException(error);
  } else {
    span.recordException(String(error));
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
