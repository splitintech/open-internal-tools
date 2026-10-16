import { defineConfig } from "vite";
export default defineConfig({
  root: "examples/demo",
  server: {
    host: "127.0.0.1",
    port: 4320,
    strictPort: true,
    proxy: {
      "/v1": "http://127.0.0.1:4319",
      "/synthetic": "http://127.0.0.1:4319",
    },
  },
});
