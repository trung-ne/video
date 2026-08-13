import * as fs from "fs";
import * as path from "path";

/**
 * Load the repository's local .env for command-line entry points.
 * Values explicitly supplied by the invoking shell always take precedence.
 */
export function loadLocalEnvironment(envFile = path.join(process.cwd(), ".env")): void {
  if (!fs.existsSync(envFile)) return;

  for (const rawLine of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    const value = rawValue.trim();
    process.env[key] =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
        ? value.slice(1, -1)
        : value;
  }
}
