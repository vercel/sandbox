import type { Sandbox as RealSandbox, Snapshot as RealSnapshot } from "@vercel/sandbox";
import { Sandbox } from "./sandbox";
import { Snapshot } from "./stubs";
import type { AssertExtends, PublicModuleShape, PublicStaticShape } from "./type-utils";

// Note: the Public* shape helpers map over `keyof T as K & string`, so symbol
// keys (e.g. the real SDK's WORKFLOW_SERIALIZE/WORKFLOW_DESERIALIZE statics)
// are dropped from both sides. The mock deliberately omits workflow serde.

/** Ensures the mock implements every public static Sandbox API. */
export type SandboxStaticContract = AssertExtends<
  PublicStaticShape<typeof Sandbox>,
  PublicStaticShape<typeof RealSandbox>
>;

/** Ensures the mock implements every public static Snapshot API. */
export type SnapshotStaticContract = AssertExtends<
  PublicStaticShape<typeof Snapshot>,
  PublicStaticShape<typeof RealSnapshot>
>;

/** Ensures the package exposes the complete runtime surface of @vercel/sandbox. */
export type ModuleContract = AssertExtends<
  PublicModuleShape<typeof import("./index")>,
  PublicModuleShape<typeof import("@vercel/sandbox")>
>;
