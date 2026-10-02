// Starts the API server (tsx watch) and the Vite dev server together.
import { spawn } from "node:child_process";
const procs = [
  spawn("pnpm", ["dev:server"], { stdio: "inherit", shell: true }),
  spawn("pnpm", ["dev:web"], { stdio: "inherit", shell: true }),
];
const stop = () => { for (const p of procs) p.kill("SIGINT"); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
