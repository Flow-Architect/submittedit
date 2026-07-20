import { defineConfig } from "wxt";

const configuredHostPermissions = (): string[] => {
  const hosts = new Set<string>();
  for (const name of ["WXT_SUBMITTEDIT_RELAY_URL", "WXT_SUBMITTEDIT_RPC_URL"] as const) {
    const raw = process.env[name];
    if (!raw) continue;
    const url = new URL(raw);
    const loopback =
      url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))
    ) {
      throw new Error(`${name} must be credential-free, query-free HTTPS or loopback HTTP.`);
    }
    hosts.add(`${url.origin}/*`);
  }
  return [...hosts].sort();
};

export default defineConfig({
  outDir: process.env.SUBMITTEDIT_EXTENSION_OUT_DIR ?? ".output",
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    build: {
      rolldownOptions: {
        preserveEntrySignatures: "strict",
      },
    },
  }),
  manifest: {
    action: {
      default_icon: {
        "16": "icon-16.png",
        "32": "icon-32.png",
        "48": "icon-48.png",
        "128": "icon-128.png",
      },
      default_title: "Open SubmittedIt",
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
    description:
      "Privacy-first local Attempted receipts for explicitly enabled standard form sites.",
    icons: {
      "16": "icon-16.png",
      "32": "icon-32.png",
      "48": "icon-48.png",
      "128": "icon-128.png",
    },
    minimum_chrome_version: "116",
    name: "SubmittedIt",
    host_permissions: configuredHostPermissions(),
    optional_host_permissions: ["http://*/*", "https://*/*"],
    permissions: ["storage", "sidePanel", "alarms", "notifications", "activeTab", "scripting"],
    version: "0.0.1",
  },
});
