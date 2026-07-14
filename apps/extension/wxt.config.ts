import { defineConfig } from "wxt";

export default defineConfig({
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
  manifest: {
    description: "SubmittedIt browser extension engineering foundation.",
    name: "SubmittedIt",
    version: "0.0.1",
  },
});
