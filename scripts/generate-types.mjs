#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const rustPkg = join(rootDir, "packages", "agent-server-rust");
const generatedDir = join(rootDir, "packages", "shared", "src", "types", "generated");

console.log("Generating TypeScript types from Rust...");

rmSync(generatedDir, { recursive: true, force: true });
mkdirSync(generatedDir, { recursive: true });

const result = spawnSync("cargo", ["test", "--quiet"], {
  cwd: rustPkg,
  env: {
    ...process.env,
    TS_RS_EXPORT_DIR: generatedDir,
  },
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (!existsSync(generatedDir)) {
  throw new Error(`Generated directory was not created: ${generatedDir}`);
}

const generatedFiles = readdirSync(generatedDir)
  .filter((name) => name.endsWith(".ts"))
  .sort();

for (const fileName of generatedFiles) {
  const filePath = join(generatedDir, fileName);
  const updated = readFileSync(filePath, "utf8").replaceAll(
    /from "(\.\/[^"]*)"/g,
    'from "$1.js"',
  );
  writeFileSync(filePath, updated);
}

const barrel = join(generatedDir, "index.ts");
const barrelLines = [
  "// Auto-generated barrel file - do not edit manually",
  "// Generated from packages/agent-server-rust/src/ia/types.rs via ts-rs",
  "",
];

for (const fileName of generatedFiles) {
  const base = basename(fileName, ".ts");
  if (base !== "index") {
    barrelLines.push(`export type { ${base} } from "./${base}.js";`);
  }
}

writeFileSync(barrel, `${barrelLines.join("\n")}\n`);

console.log("");
console.log(`Generated types in ${generatedDir}:`);
for (const fileName of readdirSync(generatedDir).sort()) {
  console.log(fileName);
}
console.log("");
console.log("Done.");
