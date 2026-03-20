import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@vercel/sandbox"],
};

export default withWorkflow(nextConfig);
