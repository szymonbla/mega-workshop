import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { dataHome, examplesRoot } from "./paths.ts";
import type { Runtime } from "./types.ts";

export async function loadRuntime(): Promise<Runtime> {
  if (existsSync(join(examplesRoot, "cli/src/viewer/server.ts"))) {
    const load = (name: string) =>
      import(pathToFileURL(join(examplesRoot, name)).href);
    const [viewer, envFile, env] = await Promise.all([
      load("cli/src/viewer/server.ts"),
      load("cli/src/env-file.ts"),
      load("shared/env.ts"),
    ]);
    return { ...viewer, ...envFile, ...env };
  }
  const ENV_FILE = process.env.MEX_ENV_FILE || join(dataHome, ".env");
  return {
    ENV_FILE,
    refreshEnv() {},
    writeEnvFile(file, values) {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      let text = existsSync(file) ? readFileSync(file, "utf8") : "";
      for (const [key, value] of Object.entries(values)) {
        text = text.replace(new RegExp(`^${key}=.*$`, "gm"), "");
        text += `\n${key}=${value}\n`;
      }
      writeFileSync(file, text, { mode: 0o600 });
    },
    async startViewer({ port, handleRequest }) {
      const server = createServer(async (req, res) => {
        try {
          if (
            await handleRequest(req, res, {
              port: (server.address() as AddressInfo).port,
            })
          )
            return;
          const path = new URL(req.url || "/", "http://localhost").pathname;
          if (
            req.method === "GET" &&
            ["/api/items", "/api/status"].includes(path)
          ) {
            res.writeHead(200, {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            });
            res.end(
              JSON.stringify(
                path === "/api/items"
                  ? []
                  : {
                      providers: ["OPENAI_API_KEY", "OPENROUTER_API_KEY"].map(
                        (envKey) => ({
                          envKey,
                          name:
                            envKey === "OPENAI_API_KEY"
                              ? "OpenAI"
                              : "OpenRouter",
                          set: !!process.env[envKey],
                        }),
                      ),
                    },
              ),
            );
          } else {
            res.writeHead(404);
            res.end("Not found.");
          }
        } catch {
          res.writeHead(500);
          res.end("Could not handle request.");
        }
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
      });
      const actualPort = (server.address() as AddressInfo).port;
      return {
        port: actualPort,
        url: `http://localhost:${actualPort}/`,
        close: () =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      };
    },
  };
}
