#!/usr/bin/env node

process.stderr.write(
  "The one-time Goal 11 Monad Testnet smoke transaction is complete. " +
    "This command is permanently disabled; use pnpm reconcile:relay-monad-smoke for read-only evidence.\n",
);
process.exitCode = 1;
