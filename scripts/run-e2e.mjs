import { spawnSync } from "node:child_process";

const run = (command, args) => {
  const result = spawnSync(command, args, {
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

run("pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)]);
run("pnpm", ["--filter", "@submittedit/extension", "test:browser"]);
run("pnpm", ["test:browser-parity"]);
run("pnpm", ["--filter", "@submittedit/web", "typegen"]);
