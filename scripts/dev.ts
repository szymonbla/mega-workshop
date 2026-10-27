import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildClient } from "./build.ts";

const stopBuild = await buildClient(true);
const server = spawn(process.execPath, ["--watch", "src/server/server.ts"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  stdio: "inherit",
});
let stopping = false;
async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  server.kill("SIGTERM");
  await stopBuild();
  process.exitCode = code;
}
server.once("error", (error) => {
  console.error(error);
  void stop(1);
});
server.once("exit", (code) => void stop(code ?? 0));
process.once("SIGINT", () => void stop(0));
process.once("SIGTERM", () => void stop(0));
