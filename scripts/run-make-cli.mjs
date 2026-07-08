import { spawnSync } from "node:child_process";
import "./load-env.mjs";

const args = process.argv.slice(2);

const result = spawnSync("make-cli", args, {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

process.exit(result.status ?? 1);
