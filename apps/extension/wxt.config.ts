import { defineConfig } from "wxt";

export default defineConfig({
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
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
    optional_host_permissions: ["http://*/*", "https://*/*"],
    permissions: ["storage", "sidePanel", "alarms", "notifications", "activeTab", "scripting"],
    version: "0.0.1",
  },
});
