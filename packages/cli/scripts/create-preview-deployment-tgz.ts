import { execSync } from "node:child_process";
import fs from "node:fs/promises";

async function main() {
  const pkgJsonPath = new URL("../package.json", import.meta.url);
  const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, "utf8"));
  pkgJson.devDependencies["@vercel/sandbox"] =
    pkgJson.dependencies["@vercel/sandbox"];
  delete pkgJson.dependencies["@vercel/sandbox"];
  await fs.writeFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2));
  execSync("pnpm turbo run build", {
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  execSync("pnpm pack --out public/index.tgz", {
    stdio: ["ignore", "inherit", "inherit"],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
