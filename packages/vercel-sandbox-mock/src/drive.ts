import { Drive as RealDrive } from "@vercel/sandbox";
import { withMockDefaults } from "./setup.js";

type GetOrCreateParams = Parameters<typeof RealDrive.getOrCreate>[0];
type ListParams = Parameters<typeof RealDrive.list>[0];

/** Drop-in replacement for `@vercel/sandbox`'s {@link RealDrive}. */
export class Drive extends RealDrive {
  static override getOrCreate(
    params: GetOrCreateParams,
  ): ReturnType<typeof RealDrive.getOrCreate> {
    return RealDrive.getOrCreate(withMockDefaults(params));
  }

  static override list(params?: ListParams): ReturnType<typeof RealDrive.list> {
    return RealDrive.list(withMockDefaults(params) as ListParams);
  }
}
