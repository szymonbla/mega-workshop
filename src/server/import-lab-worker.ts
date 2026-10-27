import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { startViewer } = await import(
  pathToFileURL(join(process.argv[2], "cli/src/viewer/server.ts")).href
);
const viewer = await startViewer({
  port: 0,
  tries: 0,
  handleRequest(req: IncomingMessage, res: ServerResponse) {
    if (req.headers["x-study-worker"] === process.env.STUDY_WORKER_TOKEN)
      return false;
    res.writeHead(403);
    res.end("Open exercises from MEGA Workshop.");
    return true;
  },
});
process.stdout.write(JSON.stringify({ port: viewer.port }) + "\n");
process.on("SIGTERM", () => viewer.close().then(() => process.exit()));
