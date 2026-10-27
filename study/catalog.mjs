import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import { loadCurriculum } from './curriculum.mjs';
import { loadReadAlong } from './read-along.mjs';
import { renderImported, digest } from './import-content.mjs';

export function loadStudyCatalog(root) {
  const manifestPath = join(root, 'audio-chapters.json');
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {chapters: []};
  const audioBySlug = new Map(manifest.chapters.map(chapter => [chapter.slug, chapter]));
  const files = {'/': 'index.html'};
  for (const file of ['app.js', 'progress.js', 'read-along.js', 'audio-player.js', 'labs.js', 'navigation.js', 'import-ui.js', 'style.css']) {
    files[`/study/${file}`] = file;
  }
  const weeks = loadCurriculum(root, markdown => marked.parse(markdown.replace(
    /^\[Open figure\]\(https:\/\/hq\.mega\.dev\/figures\/[^\s)]+\)\s*$/gm, ''
  )).replace(
    /https:\/\/hq\.mega\.dev\/figures\/s01e01\/artifacts\/lesson\/(figure-\d+)\/frame\.png/g,
    (_, name) => {
      const path = `/study/figures/${name}.png`;
      files[path] = `figures/${name}.png`;
      return path;
    }
  ));
  const legacySections = weeks.flatMap(week => week.lessons).find(lesson => lesson.id === 's01e01')?.sections ?? [];
  for (const section of legacySections) {
    const chapter = audioBySlug.get(section.slug);
    section.audio = chapter ? {
      ...chapter,
      src: `/study/audio/${section.slug}.mp3`,
      alignment: loadReadAlong(root, section),
    } : null;
  }
  const assets = new Map();
  for (const lesson of weeks.flatMap(week=>week.lessons)) {
    const directory=join(root,'content',lesson.id);
    const file=join(directory,'import.json');
    if (!existsSync(file)) continue;
    const imported=JSON.parse(readFileSync(file,'utf8'));
    for (const section of lesson.sections) {
      section.html=renderImported(section.markdown);
      section.labBase=`/study-labs/${lesson.id}`;
      const chapter=imported.chapters.find(chapter=>chapter.slug===section.slug);
      if (!chapter) continue;
      const audioFile=join(directory,'audio',`${section.slug}.mp3`);
      const alignment=JSON.parse(readFileSync(join(directory,'alignment',`${section.slug}.json`),'utf8'));
      const src=`/study/materials/${lesson.id}/audio/${section.slug}.mp3`;
      assets.set(src,{file:audioFile,type:'audio/mpeg',id:lesson.id});
      section.audio={...chapter,src,alignment:alignment.markdownSha256===digest(section.markdown) && alignment.audioSha256===digest(readFileSync(audioFile)) ? alignment : null};
    }
    for (const image of imported.images) assets.set(`/study/materials/${lesson.id}/images/${image.file}`,{file:join(directory,'images',image.file),type:image.file.endsWith('.png')?'image/png':image.file.endsWith('.webp')?'image/webp':'image/jpeg',id:lesson.id});
    lesson.transcriptUrl=`/study/materials/${lesson.id}/transcript.md`;
    assets.set(lesson.transcriptUrl,{file:join(directory,'transcript.md'),type:'text/plain; charset=utf-8',id:lesson.id});
  }
  return {weeks, legacySections, audioBySlug, files, assets, materialPublicRoot: join(root, 'public')};
}
