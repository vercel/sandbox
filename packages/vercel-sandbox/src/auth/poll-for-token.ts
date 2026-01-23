import { setTimeout } from "node:timers/promises";
import { updateAuthConfig } from "./file";
import { DeviceAuthorizationRequest, isOAuthError, OAuth } from "./oauth";

export type PollTokenItem =
  | { _tag: "Timeout"; newInterval: number }
  | { _tag: "SlowDown"; newInterval: number }
  | { _tag: "Error"; error: Error }
  | {
      _tag: "Response";
      response: { text(): Promise<string> };
    };

export async function* pollForToken({
  request,
  oauth,
}: {
  request: DeviceAuthorizationRequest;
  oauth: OAuth;
}): AsyncGenerator<PollTokenItem, void, void> {
  const controller = new AbortController();
  try {
    let intervalMs = request.interval * 1000;
    while (Date.now() < request.expiresAt) {
      const [tokenResponseError, tokenResponse] =
        await oauth.deviceAccessTokenRequest(request.device_code);

      if (tokenResponseError) {
        // 2x backoff on connection timeouts per spec https://datatracker.ietf.org/doc/html/rfc8628#section-3.5
        if (tokenResponseError.message.includes("timeout")) {
          intervalMs *= 2;
          yield { _tag: "Timeout" as const, newInterval: intervalMs };
          await setTimeout(intervalMs, { signal: controller.signal });
          continue;
        }
        yield { _tag: "Error" as const, error: tokenResponseError };
        return;
      }

      yield {
        _tag: "Response" as const,
        response: tokenResponse.clone() as { text(): Promise<string> },
      };

      const [tokensError, tokens] =
        await oauth.processTokenResponse(tokenResponse);

      if (isOAuthError(tokensError)) {
        const { code } = tokensError;
        switch (code) {
          case "authorization_pending":
            await setTimeout(intervalMs, { signal: controller.signal });
            continue;
          case "slow_down":
            intervalMs += 5 * 1000;
            yield { _tag: "SlowDown" as const, newInterval: intervalMs };
            await setTimeout(intervalMs, { signal: controller.signal });
            continue;
          default:
            yield { _tag: "Error", error: tokensError.cause };
            return;
        }
      }

      if (tokensError) {
        yield { _tag: "Error", error: tokensError };
        return;
      }

      updateAuthConfig({
        token: tokens.access_token,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        refreshToken: tokens.refresh_token,
      });

      return;
    }

    yield {
      _tag: "Error" as const,
      error: new Error(
        "Timed out waiting for authentication. Please try again.",
      ),
    };
    return;
  } finally {
    controller.abort();
  }
}
