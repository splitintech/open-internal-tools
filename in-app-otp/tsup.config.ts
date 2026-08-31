import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    server: "src/server.ts",
    "react/index": "src/react/index.tsx",
    "adapters/supabase": "src/adapters/supabase.ts",
    "adapters/rest": "src/adapters/rest.ts",
    "adapters/express": "src/adapters/express.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["react", "react-dom"],
});
