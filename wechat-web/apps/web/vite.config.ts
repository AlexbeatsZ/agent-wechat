import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    server: {
      port: Number(env.WEB_PORT || 5173),
      proxy: {
        "/api": {
          target: env.BFF_URL || "http://127.0.0.1:8787",
          changeOrigin: true
        }
      }
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./test/setup.ts"]
    }
  };
});
