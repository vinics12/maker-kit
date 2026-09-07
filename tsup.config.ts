import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  sourcemap: true,
  // Keep deps external; they ship via node_modules of the published package.
  dts: false,
  banner: { js: "#!/usr/bin/env node" },
});
