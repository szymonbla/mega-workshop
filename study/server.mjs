import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { loadRuntime } from './runtime.mjs';
import { codeRoot, materialRoot, defaultStateDirectory, privateDataPath } from './paths.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { loadCurriculum } from './curriculum.mjs';
import { loadStudyCatalog } from './catalog.mjs';
import { createStudyHandler } from './http.mjs';
import { MegaSource } from './mega-source.mjs';
import { LessonImporter } from './importer.mjs';
import { ImportedLabs } from './import-labs.mjs';

const defaultRoot = materialRoot;

export async function startStudy({port = Number(process.env.PORT || 4830), root = defaultRoot, source, stateDirectory = defaultStateDirectory, labsDirectory = defaultStateDirectory} = {}) {
  privateDataPath(root); privateDataPath(stateDirectory);
  await mkdir(root, {recursive:true, mode:0o700});
  if (!existsSync(join(root,'curriculum.json'))) await writeFile(join(root,'curriculum.json'),JSON.stringify({weeks:loadCurriculum(root)}),{mode:0o600});
  const {startViewer, writeEnvFile, ENV_FILE, refreshEnv} = await loadRuntime();
  let catalog = loadStudyCatalog(root);
  source ||= new MegaSource(stateDirectory);
  const importedLabs = new ImportedLabs(codeRoot,ENV_FILE,labsDirectory);
  const importer = new LessonImporter({root,source,directory:stateDirectory,onPublish:()=>{catalog=loadStudyCatalog(root);}});
  await importer.initialize();
  const handleRequest = createStudyHandler({
    catalog, importer, importedLabs, getCatalog:()=>catalog,
    publicRoot: join(codeRoot, 'public'),
    saveSettings(keyName, key) {
      writeEnvFile(ENV_FILE, {[keyName]: key});
      process.env[keyName] = key;
      refreshEnv();
    },
  });
  const viewer = await startViewer({port, tries: 0, handleRequest});
  const close = viewer.close.bind(viewer);
  viewer.close = async () => { await importer.close(); await importedLabs.close(); await source.close(); await close(); };
  return viewer;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const viewer = await startStudy();
  console.log(`MEGA Study → ${viewer.url}`);
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => viewer.close().then(() => process.exit(0)));
  }
}
