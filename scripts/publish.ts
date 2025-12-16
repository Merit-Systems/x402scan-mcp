#!/usr/bin/env npx tsx
/**
 * Publish x402scan-mcp to npm if version is bumped.
 * Also builds the .mcpb bundle for Claude Desktop.
 * Usage: bun run publish
 */

import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const PACKAGE_NAME = "x402scan-mcp";
const ROOT = process.cwd();

function checkNpmAuth(): void {
  try {
    const user = execSync("npm whoami", { encoding: "utf-8", stdio: "pipe" }).trim();
    console.log(`✓ Logged in to npm as: ${user}`);
  } catch {
    console.error("❌ Not logged in to npm. Run `npm login` first.");
    process.exit(1);
  }
}

function getLocalVersion(): string {
  const pkgPath = join(ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  return pkg.version;
}

function getNpmVersion(): string | null {
  try {
    const result = execSync(`npm view ${PACKAGE_NAME} version 2>/dev/null`, {
      encoding: "utf-8",
    }).trim();
    return result || null;
  } catch {
    return null; // Package not published yet
  }
}

function compareVersions(local: string, remote: string | null): boolean {
  if (!remote) return true; // Not published, should publish

  const localParts = local.split(".").map(Number);
  const remoteParts = remote.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    if (localParts[i]! > remoteParts[i]!) return true;
    if (localParts[i]! < remoteParts[i]!) return false;
  }
  return false; // Same version
}

function publish(): void {
  console.log("\n📦 Building...");
  execSync("bun run build", { cwd: ROOT, stdio: "inherit" });

  console.log("\n📤 Publishing to npm...");
  execSync("npm publish --access public", { cwd: ROOT, stdio: "inherit" });

  console.log("\n✅ Published to npm");
}

function buildMcpb(): void {
  console.log("\n📦 Building .mcpb bundle for Claude Desktop...");
  execSync("bun run build:mcpb", { cwd: ROOT, stdio: "inherit" });

  const mcpbPath = join(ROOT, "x402scan.mcpb");
  if (existsSync(mcpbPath)) {
    console.log("✅ Created x402scan.mcpb");
    console.log("\n⚠️  Remember to:");
    console.log("   1. Commit and push x402scan.mcpb to GitHub");
    console.log("   2. Create a GitHub release with the .mcpb attached");
    console.log("\n   Users can then download from:");
    console.log("   https://github.com/merit-systems/x402scan-mcp/releases/latest");
  }
}

async function main() {
  console.log("🔍 Checking package version...\n");

  checkNpmAuth();

  const local = getLocalVersion();
  const remote = getNpmVersion();

  const status = remote ? `${remote} → ${local}` : `(new) ${local}`;
  const needsPublish = compareVersions(local, remote);

  console.log(`\n${PACKAGE_NAME}: ${status}`);

  if (!needsPublish) {
    console.log("\n✅ Package is up to date. Bump version in package.json to publish.");
    console.log("   e.g., npm version patch|minor|major");
    return;
  }

  console.log("\n⬆️  Version bump detected, publishing...");
  publish();
  buildMcpb();

  console.log("\n🎉 Done!");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
