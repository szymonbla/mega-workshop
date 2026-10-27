import { materialRoot } from './paths.mjs';
import { pathToFileURL } from 'node:url';
// Rebuild local section clips from the downloaded source and checked timestamps.
// Usage: node study/split-audio.mjs
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const manifest = JSON.parse(readFileSync(pathToFileURL(materialRoot + '/audio-chapters.json')));
const root = pathToFileURL(materialRoot + '/public/audio/');
mkdirSync(root, {recursive:true});
for (const chapter of manifest.chapters) {
  if (!/^[a-z0-9-]+$/.test(chapter.slug) || !(chapter.end > chapter.start)) throw Error('Invalid audio chapter');
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(chapter.start), '-i', fileURLToPath(new URL('s01e01.mp3', root)),
    '-t', String(chapter.end - chapter.start), '-map_metadata', '-1',
    '-c:a', 'libmp3lame', '-q:a', '2', '-metadata', `title=${chapter.title}`,
    fileURLToPath(new URL(`${chapter.slug}.mp3`, root))], {stdio:'inherit'});
  if (result.error || result.status !== 0) throw result.error || Error(`Could not split ${chapter.slug}`);
  console.log(chapter.slug);
}
