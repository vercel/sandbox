import { Sandbox as RealSandbox } from "@vercel/sandbox";
import { withMockDefaults } from "./setup.js";

type CreateParams = Parameters<typeof RealSandbox.create>[0];
type GetParams = Parameters<typeof RealSandbox.get>[0];
type GetOrCreateParams = Parameters<typeof RealSandbox.getOrCreate>[0];
type ForkParams = Parameters<typeof RealSandbox.fork>[0];
type ListParams = Parameters<typeof RealSandbox.list>[0];

/**
 * Drop-in replacement for `@vercel/sandbox`'s {@link RealSandbox}. Behaviour is
 * the real SDK's — the only difference is that every static entry point injects
 * the mocked `fetch` and credentials, so operations run against the in-memory
 * {@link MockServer} instead of the Vercel API. Change the import path and
 * existing `Sandbox` code works unchanged.
 */
export class Sandbox extends RealSandbox {
  static override create(params?: CreateParams): ReturnType<typeof RealSandbox.create> {
    return RealSandbox.create(withMockDefaults(params) as CreateParams);
  }

  static override get(params: GetParams): ReturnType<typeof RealSandbox.get> {
    return RealSandbox.get(withMockDefaults(params) as GetParams);
  }

  static override getOrCreate(
    params?: GetOrCreateParams,
  ): ReturnType<typeof RealSandbox.getOrCreate> {
    return RealSandbox.getOrCreate(withMockDefaults(params) as GetOrCreateParams);
  }

  static override fork(params: ForkParams): ReturnType<typeof RealSandbox.fork> {
    return RealSandbox.fork(withMockDefaults(params) as ForkParams);
  }

  static override list(params?: ListParams): ReturnType<typeof RealSandbox.list> {
    return RealSandbox.list(withMockDefaults(params) as ListParams);
  }
}
