import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/app/utils/**", "src/lib/**", "src/app/hooks/**"],
      exclude: ["src/components/ui/**", "**/*.test.*"],
      thresholds: {
        "src/app/utils/**": { lines: 85, branches: 80 },
        "src/app/hooks/chat/**": { lines: 90, branches: 85 },
      },
    },
  },
});
