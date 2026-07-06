import { ArgParser } from "cmd-ts/dist/esm/argparser";
import { trace } from "../otel";
import { SpanStatusCode } from "@opentelemetry/api";

export function traceParser<T extends ArgParser<any>>(
  name: string,
  parser: T,
): T {
  return {
    ...parser,
    async parse(ctx) {
      return await trace(name, async (span) => {
        const value = await parser.parse(ctx);
        if (value._tag === "error") {
          span.setStatus({ code: SpanStatusCode.ERROR });
          span.recordException(JSON.stringify(value.error, null, 2));
        }
        return value;
      });
    },
  };
}
