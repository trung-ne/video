import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { loadTimeline } from "../src/engine/loadTimeline";

const args = process.argv.slice(2);
const index = args.indexOf("--project");
const projectArg = index >= 0 ? args[index + 1] : undefined;
if (!projectArg) throw new Error("Usage: npx ts-node scripts/preview-project.ts --project <id-or-path>");
const projectPath = fs.existsSync(projectArg) || projectArg.includes("/") || projectArg.includes("\\")
  ? projectArg
  : path.join("projects", projectArg);
const timelinePath = path.join(projectPath, "timeline.json");
if (!fs.existsSync(timelinePath)) throw new Error(`Timeline not found: ${timelinePath}`);

const authored = JSON.parse(fs.readFileSync(timelinePath, "utf8"));
const timeline = loadTimeline(authored).timeline;
const propsPath = path.join(os.tmpdir(), `cat-preview-${process.pid}.json`);
fs.writeFileSync(propsPath, JSON.stringify({ timeline }), "utf8");
try {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(command, [
    "remotion", "studio", "src/index.ts", `--props=${propsPath}`,
  ], { stdio: "inherit", cwd: process.cwd() });
  process.exitCode = result.status ?? 1;
} finally {
  if (fs.existsSync(propsPath)) fs.unlinkSync(propsPath);
}
