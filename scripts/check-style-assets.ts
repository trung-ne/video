/** Verify that one style tree mirrors every required production asset exactly. */
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

const styleIndex = process.argv.indexOf("--style");
const style = styleIndex >= 0 ? process.argv[styleIndex + 1] : process.argv.find((arg) => /^[cdf]$/i.test(arg)) ?? "";
if (!/^[cdf]$/.test(style)) throw new Error("Usage: npx ts-node scripts/check-style-assets.ts --style c|d|f");

const root = process.cwd();
const publicRoot = path.join(root, "public");
const sources = ["generated-assets", "generated-backgrounds"];
const expected = sources.flatMap((source) => {
  const base = path.join(publicRoot, source);
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
  return walk(base)
    .filter((file) => /\.(png|jpe?g|webp)$/i.test(file))
    .map((file) => path.relative(publicRoot, file).replace(/\\/g, "/"));
});
const targetRoot = path.join(publicRoot, "styles", style);
const missing = expected.filter((relative) => !fs.existsSync(path.join(targetRoot, relative)));
const extras: string[] = [];
const walkTarget = (dir: string): void => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTarget(full);
    else if (/\.(png|jpe?g|webp)$/i.test(entry.name)) {
      const relative = path.relative(targetRoot, full).replace(/\\/g, "/");
      if (!expected.includes(relative)) extras.push(relative);
    }
  }
};
walkTarget(targetRoot);
console.log(`Style ${style}: ${expected.length - missing.length}/${expected.length} required files present.`);
if (missing.length) console.log(`Missing (${missing.length}):\n${missing.join("\n")}`);
if (extras.length) console.log(`Unexpected (${extras.length}):\n${extras.join("\n")}`);
if (missing.length || extras.length) process.exitCode = 1;
if (!process.exitCode) {
  const checker = path.join(root, "scripts", "check-style-raster.py");
  try {
    execFileSync("python", [checker, style], { stdio: "inherit" });
  } catch {
    process.exitCode = 1;
  }
}
