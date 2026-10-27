import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadStudyCatalog } from "./catalog.ts";
import { loadCurriculum } from "./curriculum.ts";
import { createStudyHandler } from "./http.ts";
import { ImportedLabs } from "./import-labs.ts";
import { LessonImporter } from "./importer.ts";
import { MegaSource } from "./mega-source.ts";
import {
  codeRoot,
  defaultStateDirectory,
  materialRoot,
  privateDataPath,
  publicRoot,
} from "./paths.ts";
import { loadRuntime } from "./runtime.ts";
import type { LessonSource } from "./types.ts";

const defaultRoot = materialRoot;

export async function startStudy({
  port = Number(process.env.PORT || 4830),
  root = defaultRoot,
  source,
  providerFetch,
  stateDirectory = defaultStateDirectory,
  labsDirectory = defaultStateDirectory,
}: {
  port?: number;
  root?: string;
  source?: LessonSource;
  providerFetch?: typeof fetch;
  stateDirectory?: string;
  labsDirectory?: string;
} = {}) {
  privateDataPath(root);
  privateDataPath(stateDirectory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (!existsSync(join(root, "curriculum.json")))
    await writeFile(
      join(root, "curriculum.json"),
      JSON.stringify({ weeks: loadCurriculum(root) }),
      { mode: 0o600 },
    );
  const { startViewer, writeEnvFile, ENV_FILE, refreshEnv } =
    await loadRuntime();
  let catalog = loadStudyCatalog(root);
  source ||= new MegaSource(stateDirectory);
  const importedLabs = new ImportedLabs(codeRoot, ENV_FILE, labsDirectory);
  const importer = new LessonImporter({
    root,
    source,
    directory: stateDirectory,
    onPublish: () => {
      catalog = loadStudyCatalog(root);
    },
  });
  await importer.initialize();
  const handleRequest = createStudyHandler({
    catalog,
    providerFetch,
    importer,
    importedLabs,
    getCatalog: () => catalog,
    publicRoot,
    saveSettings(keyName, key) {
      writeEnvFile(ENV_FILE, { [keyName]: key });
      process.env[keyName] = key;
      refreshEnv();
    },
  });
  const viewer = await startViewer({ port, tries: 0, handleRequest });
  const close = viewer.close.bind(viewer);
  viewer.close = async () => {
    await importer.close();
    await importedLabs.close();
    await source!.close();
    await close();
  };
  return viewer;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const viewer = await startStudy();
  console.log(`MEGA Workshop → ${viewer.url}`);
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => viewer.close().then(() => process.exit(0)));
  }
}
