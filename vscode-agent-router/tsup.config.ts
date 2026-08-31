import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    mcp: "src/mcp/server.ts",
    extension: "src/extension.ts",
  },
  format: ["esm", "cjs"],
  dts: { entry: { index: "src/index.ts" } },
  sourcemap: true,
  clean: true,
  target: "node20",
  external: ["vscode"],
});
