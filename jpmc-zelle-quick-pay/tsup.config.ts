import { defineConfig } from "tsup";
export default defineConfig({
  entry: [
    "src/index.ts",
    "src/server/index.ts",
    "src/react/index.tsx",
    "src/providers/jpmc.ts",
    "src/testing/index.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["react", "react-dom", "pg"],
  splitting: false,
});
