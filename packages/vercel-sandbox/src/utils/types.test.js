import { expect, it } from "vitest";
import { getPrivateParams, getSpanLinkPrivateParams } from "./types";

it("getPrivateParams filters unknown params", async () => {
  const result = getPrivateParams({ foo: 123, __someParam: "abc" });
  expect(result).toEqual({ __someParam: "abc" });
});

it("getSpanLinkPrivateParams keeps only span-link keys", async () => {
  const result = getSpanLinkPrivateParams({
    __spanId: "span-1",
    __traceId: "trace-1",
    __ddParent: "dd-1",
    __interactive: true,
    foo: 123,
  });
  expect(result).toEqual({
    __spanId: "span-1",
    __traceId: "trace-1",
    __ddParent: "dd-1",
  });
});
