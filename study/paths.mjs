import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync, existsSync } from 'node:fs';

export const codeRoot = fileURLToPath(new URL('./', import.meta.url));
export const projectRoot = resolve(codeRoot, '..');
export function privateDataPath(value) {
  let ancestor = resolve(value);
  while (!existsSync(ancestor)) ancestor = resolve(ancestor, '..');
  const canonical = resolve(realpathSync(ancestor), relative(ancestor, resolve(value)));
  const rel = relative(realpathSync(projectRoot), canonical);
  const localData = rel === '.study-data' || rel.startsWith('.study-data' + sep);
  if (!localData && (!rel || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel)))) {
    throw Error('Store learning materials in .study-data/ or outside the project directory.');
  }
  return resolve(value);
}
export const dataHome = privateDataPath(process.env.STUDY_DATA_HOME || join(projectRoot, '.study-data'));
export const materialRoot = join(dataHome, 'study');
export const examplesRoot = join(dataHome, 'course-examples');
export const defaultStateDirectory = join(dataHome, '.mega-study');
