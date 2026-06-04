import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

execFileSync("tsc", {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

const files = [
  ["src/styles.css", "styles.css"],
  ["src/index.html", "index.html"],
];

for (const [from, to] of files) {
  const source = resolve(root, from);
  if (!existsSync(source)) {
    throw new Error(`Missing required frontend asset: ${from}`);
  }
  copyFileSync(source, resolve(dist, to));
}
