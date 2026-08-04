import { Snapshot as RealSnapshot } from "@vercel/sandbox";
import { withMockDefaults } from "./setup.js";

type ListParams = Parameters<typeof RealSnapshot.list>[0];
type GetParams = Parameters<typeof RealSnapshot.get>[0];
type TreeParams = Parameters<typeof RealSnapshot.tree>[0];

/**
 * Drop-in replacement for `@vercel/sandbox`'s {@link RealSnapshot}. Static
 * lookups inject the mocked `fetch` and credentials so they resolve against the
 * in-memory {@link MockServer}.
 */
export class Snapshot extends RealSnapshot {
  static override list(params?: ListParams): ReturnType<typeof RealSnapshot.list> {
    return RealSnapshot.list(withMockDefaults(params) as ListParams);
  }

  static override get(params: GetParams): ReturnType<typeof RealSnapshot.get> {
    return RealSnapshot.get(withMockDefaults(params) as GetParams);
  }

  static override tree(params: TreeParams): ReturnType<typeof RealSnapshot.tree> {
    return RealSnapshot.tree(withMockDefaults(params) as TreeParams);
  }
}
