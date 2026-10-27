import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { errorMessage, errorStatus } from "../shared/errors.ts";
import { serveAudio } from "./audio.ts";
import type { ImportedLabs } from "./import-labs.ts";
import type { LessonImporter } from "./importer.ts";
import { AccessError } from "./mega-source.ts";
import type { Catalog, RequestHandler } from "./types.ts";

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
  return true;
}

export function createStudyHandler({
  catalog,
  publicRoot,
  saveSettings,
  importer,
  importedLabs,
  getCatalog = () => catalog,
}: {
  catalog: Catalog;
  publicRoot: string;
  saveSettings?: (name: string, key: string) => void | Promise<void>;
  importer?: LessonImporter;
  importedLabs?: ImportedLabs;
  getCatalog?: () => Catalog;
}): RequestHandler {
  return async (req, res, { port }) => {
    const host = req.headers.host;
    if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(host || "")) {
      return json(res, 403, { error: "Invalid host." });
    }
    let path;
    try {
      path = new URL(req.url || "/", `http://${host}`).pathname;
    } catch {
      return json(res, 400, { error: "Invalid URL." });
    }
    try {
      const catalog = getCatalog();
      if (importer) {
        const mutation = !["GET", "HEAD"].includes(req.method || "");
        if (
          mutation &&
          (req.headers.origin !== `http://${host}` ||
            !req.headers["content-type"]?.startsWith("application/json"))
        )
          return json(res, 403, { error: "Use the local MEGA Workshop app." });
        if (path === "/study-api/auth/status" && req.method === "GET") {
          try {
            await importer.authorize(req);
            return json(res, 200, { authenticated: true });
          } catch (error) {
            if (!(error instanceof AccessError)) throw error;
            return json(res, 200, { authenticated: false });
          }
        }
        if (path === "/study-api/auth/restore" && req.method === "POST") {
          if (!importer.session)
            return json(res, 200, { authenticated: false });
          await importer.connect(res);
          return json(res, 200, { authenticated: true });
        }
        if (path === "/study-api/auth/login" && req.method === "POST") {
          await importer.source.login();
          return json(res, 200, { ok: true });
        }
        if (path === "/study-api/auth/complete" && req.method === "POST") {
          await importer.connect(res);
          return json(res, 200, { ok: true });
        }
        const shell =
          path === "/" ||
          /^\/study\/[a-z-]+\.(js|css)$/.test(path) ||
          path.startsWith("/kit/");
        if (!shell) {
          const id =
            /^\/(?:study\/materials|study-labs)\/(s0[1-4]e0[1-5])(?:\/|$)/.exec(
              path,
            )?.[1] || "s01e01";
          await importer.authorize(req, id);
        }
        if (path === "/study-api/auth/logout" && req.method === "POST") {
          await importer.logout(res);
          return json(res, 200, { ok: true });
        }
        if (path === "/study-api/imports" && req.method === "GET")
          return json(res, 200, { jobs: importer.list(), sync: importer.sync });
        if (path === "/study-api/imports/sync" && req.method === "POST")
          return json(res, 202, { sync: await importer.synchronize(req) });
        if (path === "/study-api/imports" && req.method === "POST") {
          let body = "";
          for await (const chunk of req) {
            body += chunk;
            if (body.length > 2048)
              return json(res, 413, { error: "The link is too long." });
          }
          let input;
          try {
            input = JSON.parse(body);
          } catch {
            return json(res, 400, { error: "Invalid request." });
          }
          try {
            return json(res, 202, {
              job: await importer.start(input.url, req),
            });
          } catch (error) {
            return json(res, errorStatus(error) || 400, {
              error: errorMessage(error),
            });
          }
        }
        if (path === "/study-api/import-labs" && req.method === "GET") {
          const items = [];
          for (const lesson of catalog.weeks.flatMap((week) => week.lessons))
            if (lesson.transcriptUrl) {
              await importer.authorize(req, lesson.id);
              items.push(...(await importedLabs!.items(lesson.id)));
            }
          return json(res, 200, items);
        }
        const lab = /^\/study-labs\/(s0[1-4]e0[1-5])(\/.*)$/.exec(path);
        if (lab) {
          if (
            !catalog.weeks
              .flatMap((week) => week.lessons)
              .some((lesson) => lesson.id === lab[1] && lesson.transcriptUrl)
          )
            return json(res, 404, { error: "Import this lesson first." });
          await importedLabs!.proxy(
            lab[1],
            req.url!.slice(`/study-labs/${lab[1]}`.length),
            req,
            res,
          );
          return true;
        }
        if (path === "/study-api/curriculum")
          for (const lesson of catalog.weeks.flatMap((week) => week.lessons))
            if (lesson.available && lesson.id !== "s01e01")
              await importer.authorize(req, lesson.id);
      }
      if (
        path !== "/" &&
        !path.startsWith("/study/") &&
        !path.startsWith("/study-api/")
      )
        return false;
      if (path.startsWith("/study-api/")) {
        if (path === "/study-api/curriculum" && req.method === "GET")
          return json(res, 200, { weeks: catalog.weeks });
        if (path === "/study-api/lessons" && req.method === "GET")
          return json(res, 200, catalog.legacySections);
        if (path === "/study-api/settings" && req.method === "POST") {
          if (
            req.headers.origin !== `http://${host}` ||
            !req.headers["content-type"]?.startsWith("application/json")
          ) {
            return json(res, 403, {
              error: "Change settings in the local app.",
            });
          }
          let body = "";
          for await (const chunk of req) {
            body += chunk;
            if (body.length > 8192)
              return json(res, 413, { error: "Request body is too large." });
          }
          const input = JSON.parse(body);
          if (
            !["openai", "openrouter"].includes(input.provider) ||
            typeof input.key !== "string" ||
            !/^[A-Za-z0-9_.-]{15,512}$/.test(input.key)
          ) {
            return json(res, 400, {
              error: "Select a provider and enter a valid API key.",
            });
          }
          const keyName =
            input.provider === "openai"
              ? "OPENAI_API_KEY"
              : "OPENROUTER_API_KEY";
          if (!saveSettings) throw Error("Settings are unavailable.");
          await saveSettings(keyName, input.key);
          return json(res, 200, { ok: true });
        }
        return json(res, 404, { error: "Not found." });
      }
      if (req.method !== "GET" && req.method !== "HEAD")
        return json(res, 405, { error: "Method not allowed." });
      const audioSlug = /^\/study\/audio\/([a-z0-9-]+)\.mp3$/.exec(path)?.[1];
      if (audioSlug && catalog.audioBySlug.has(audioSlug)) {
        serveAudio(
          req,
          res,
          join(
            catalog.materialPublicRoot || publicRoot,
            "audio",
            `${audioSlug}.mp3`,
          ),
        );
        return true;
      }
      const asset = catalog.assets?.get(path);
      if (asset) {
        if (asset.type === "audio/mpeg") serveAudio(req, res, asset.file);
        else {
          const data = readFileSync(asset.file);
          res.writeHead(200, {
            "Content-Type": asset.type,
            "Content-Length": data.length,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          });
          res.end(req.method === "HEAD" ? undefined : data);
        }
        return true;
      }
      const file = catalog.files[path];
      if (!file) return json(res, 404, { error: "Not found." });
      if (file.endsWith(".png")) {
        const data = readFileSync(
          join(catalog.materialPublicRoot || publicRoot, file),
        );
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Content-Length": data.length,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(req.method === "HEAD" ? undefined : data);
        return true;
      }
      const type = file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html";
      res.writeHead(200, {
        "Content-Type": type + "; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
      });
      res.end(readFileSync(join(publicRoot, file)));
      return true;
    } catch (error) {
      if (errorStatus(error) === 401)
        return json(res, 401, { error: errorMessage(error) });
      if (importer && path.startsWith("/study-api/auth/"))
        return json(res, 400, {
          error: connectionError(error),
        });
      return json(res, 500, {
        error: "Could not save or read data. Check file permissions.",
      });
    }
  };
}

function connectionError(error: unknown) {
  const detail = errorMessage(error);
  if (/SingletonLock|ProcessSingleton|profile.*in use/i.test(detail))
    return "The saved MEGA browser profile is already in use. Close the other MEGA Workshop instance and retry.";
  if (
    /Executable doesn.t exist|executable.*not found|distribution.*not found/i.test(
      detail,
    )
  )
    return "The login browser is missing. Run npm run setup:import, then retry.";
  if (/EACCES|EPERM/.test(detail))
    return "Cannot read or save the local MEGA session. Check permissions on your study data directory.";
  if (/Timeout|net::|ENOTFOUND|ECONN|fetch failed/i.test(detail))
    return "MEGA could not be reached. Check your connection and retry. Your saved login has been kept.";
  return "Could not open or restore the MEGA session. Retry the connection or restart MEGA Workshop.";
}
