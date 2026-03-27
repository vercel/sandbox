import { describe, expect, beforeAll, afterAll, afterEach, it } from "vitest";
import { Sandbox } from "@vercel/sandbox";
import { createWsProxy, type WsProxy } from "../src/index";

const WS_PORT = 5000;

describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "1")(
  "WsProxy integration",
  () => {
    let sandbox: Sandbox;
    let proxy: WsProxy;

    beforeAll(async () => {
      sandbox = await Sandbox.create({ ports: [WS_PORT] });
    }, 30_000);

    afterAll(async () => {
      await sandbox?.stop().catch(() => {});
    });

    afterEach(async () => {
      await proxy?.close().catch(() => {});
    });

    it(
      "full proxy flow: attach, handle, runCommand with HTTP_PROXY, intercept request",
      async () => {
        proxy = createWsProxy();
        await proxy.attach(sandbox, { wsPort: WS_PORT });

        const httpProxy = await proxy.handle(
          (req) => new Response(`intercepted: ${req.url}`),
        );

        const result = await sandbox.runCommand({
          cmd: "curl",
          args: ["-s", "--max-time", "10", "http://example.com/test"],
          env: httpProxy.env,
        });

        const stdout = await result.stdout();
        expect(stdout).toContain("intercepted: http://example.com/test");
      },
      60_000,
    );

    it(
      "multiple sessions with different callbacks",
      async () => {
        proxy = createWsProxy();
        await proxy.attach(sandbox, { wsPort: WS_PORT });

        const proxyA = await proxy.handle(() => new Response("response-a"));
        const proxyB = await proxy.handle(() => new Response("response-b"));

        const [resultA, resultB] = await Promise.all([
          sandbox.runCommand({
            cmd: "curl",
            args: ["-s", "--max-time", "10", "http://example.com/a"],
            env: proxyA.env,
          }),
          sandbox.runCommand({
            cmd: "curl",
            args: ["-s", "--max-time", "10", "http://example.com/b"],
            env: proxyB.env,
          }),
        ]);

        expect(await resultA.stdout()).toBe("response-a");
        expect(await resultB.stdout()).toBe("response-b");
      },
      60_000,
    );

    it(
      "CONNECT deny blocks HTTPS",
      async () => {
        proxy = createWsProxy();
        await proxy.attach(sandbox, { wsPort: WS_PORT });

        const httpProxy = await proxy.handle(
          () => new Response("ok"),
          () => false, // deny all CONNECT
        );

        const result = await sandbox.runCommand({
          cmd: "curl",
          args: [
            "-s",
            "--max-time",
            "10",
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
            "https://example.com",
          ],
          env: httpProxy.env,
        });

        const output = await result.output();
        expect(output).not.toBe("200");
      },
      60_000,
    );

    it(
      "removeHandle cleans up session",
      async () => {
        proxy = createWsProxy();
        await proxy.attach(sandbox, { wsPort: WS_PORT });

        const httpProxy = await proxy.handle(() => new Response("ok"));
        proxy.removeHandle(httpProxy);

        const result = await sandbox.runCommand({
          cmd: "curl",
          args: [
            "-s",
            "--max-time",
            "10",
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
            "http://example.com",
          ],
          env: httpProxy.env,
        });

        const stdout = await result.stdout();
        expect(stdout).not.toBe("200");
      },
      60_000,
    );

    it(
      "re-attach after close",
      async () => {
        proxy = createWsProxy();
        await proxy.attach(sandbox, { wsPort: WS_PORT });
        await proxy.close();

        // Re-attach
        proxy = createWsProxy();
        await proxy.attach(sandbox, { wsPort: WS_PORT });

        const httpProxy = await proxy.handle(() => new Response("re-attached"));
        const result = await sandbox.runCommand({
          cmd: "curl",
          args: ["-s", "--max-time", "10", "http://example.com"],
          env: httpProxy.env,
        });

        expect(await result.stdout()).toBe("re-attached");
      },
      60_000,
    );

    it(
      "two independent proxy clients on the same sandbox",
      async () => {
        const proxyA = createWsProxy();
        await proxyA.attach(sandbox, { wsPort: WS_PORT });

        const proxyB = createWsProxy();
        await proxyB.attach(sandbox, { wsPort: WS_PORT });

        const handleA = await proxyA.handle(() => new Response("from-A"));
        const handleB = await proxyB.handle(() => new Response("from-B"));

        const [resultA, resultB] = await Promise.all([
          sandbox.runCommand({
            cmd: "curl",
            args: ["-s", "--max-time", "10", "http://example.com/a"],
            env: handleA.env,
          }),
          sandbox.runCommand({
            cmd: "curl",
            args: ["-s", "--max-time", "10", "http://example.com/b"],
            env: handleB.env,
          }),
        ]);

        expect(await resultA.stdout()).toBe("from-A");
        expect(await resultB.stdout()).toBe("from-B");

        await proxyA.close();
        await proxyB.close();
      },
      60_000,
    );
  },
);

describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "1")(
  "WsProxy with deny-all network policy",
  () => {
    let sandbox: Sandbox;
    let proxy: WsProxy;

    beforeAll(async () => {
      sandbox = await Sandbox.create({
        ports: [WS_PORT],
        networkPolicy: "deny-all",
      });
    }, 30_000);

    afterAll(async () => {
      await proxy?.close().catch(() => {});
      await sandbox?.stop().catch(() => {});
    });

    it(
      "proxy intercepts requests even with no internet access",
      async () => {
        // First verify that direct internet access is blocked
        const directResult = await sandbox.runCommand({
          cmd: "curl",
          args: ["-s", "--max-time", "5", "-o", "/dev/null", "-w", "%{http_code}", "http://example.com"],
        });
        const directOutput = await directResult.stdout();
        // curl should fail (exit code != 0) or return 000 (connection failed)
        expect(
          directResult.exitCode !== 0 || directOutput === "000",
          `Expected direct request to fail, but got exit=${directResult.exitCode} output=${directOutput}`,
        ).toBe(true);

        // Now use the proxy — requests should succeed via the WS tunnel
        proxy = createWsProxy();
        await proxy.attach(sandbox, { wsPort: WS_PORT });

        const httpProxy = await proxy.handle(
          (req) => new Response(`proxied: ${new URL(req.url).hostname}`),
        );

        const result = await sandbox.runCommand({
          cmd: "curl",
          args: ["-s", "--max-time", "10", "http://example.com/test"],
          env: httpProxy.env,
        });

        expect(await result.stdout()).toBe("proxied: example.com");
      },
      60_000,
    );

    it(
      "proxy handler can fetch real HTTPS URLs on behalf of the sandbox",
      async () => {
        if (!proxy) {
          proxy = createWsProxy();
          await proxy.attach(sandbox, { wsPort: WS_PORT });
        }

        const httpProxy = await proxy.handle(async (req) => {
          // The sandbox has no internet, but the handler runs outside
          // the sandbox and CAN fetch. The MITM proxy decrypts the
          // HTTPS request so we see the full URL here.
          return fetch(req.url);
        });

        const result = await sandbox.runCommand({
          cmd: "curl",
          args: ["-s", "--max-time", "10", "https://vercel.com/robots.txt"],
          env: httpProxy.env,
        });

        const stdout = await result.stdout();
        expect(stdout).toContain("User-Agent");
        expect(stdout).toContain("Sitemap");
      },
      60_000,
    );
  },
);
