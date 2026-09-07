import { readFileSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "./scaffold.js";

export function makerVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(packageRoot(), "package.json"), "utf-8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
