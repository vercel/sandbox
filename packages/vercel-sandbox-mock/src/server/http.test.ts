import { describe, expect, test } from "vitest";
import { apiError, empty, json } from "./http";

describe("http response helpers", () => {
  test("json serializes the body with a JSON content-type", async () => {
    const response = json({ ok: true });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ ok: true });
  });

  test("json accepts a custom status", () => {
    expect(json({}, 201).status).toBe(201);
  });

  test("empty returns a 200 with an `{}` body", async () => {
    const response = empty();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });

  test("apiError produces the `{ error: { code, message } }` shape the SDK reads", async () => {
    const response = apiError(404, "sandbox_not_found", "no such sandbox");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "sandbox_not_found", message: "no such sandbox" },
    });
  });
});
