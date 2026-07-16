import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
    settings: {
      next: {
        rootDir: "apps/web",
      },
    },
  },
  globalIgnores([
    "**/.next/**",
    "**/.output/**",
    "**/.wxt/**",
    "**/coverage/**",
    "**/dist/**",
    "node_modules/**",
    "**/out/**",
    "**/playwright-report/**",
    "**/test-results/**",
  ]),
]);
