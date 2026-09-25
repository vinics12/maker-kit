import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: [".claude/worktrees/**"],
    // Integration tests materialize the full engine and can exceed Vitest's
    // 5 s default when files run concurrently on shared CI runners.
    testTimeout: 15_000,
  },
});
