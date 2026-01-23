import { expect, it } from "vitest";
import { getPrivateParams } from "./types";

it("getPrivateParams filters unknown params", async () => {
  const result = getPrivateParams({ foo: 123, __someParam: "abc" });
  expect(result).toEqual({ __someParam: "abc" });
});
