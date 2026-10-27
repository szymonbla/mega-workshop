import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildLessons } from './lessons.mjs';

// IDs are permanent storage keys; titles and placement can change safely.
export function loadCurriculum(root, render = text => text) {
  const manifest = existsSync(join(root, 'curriculum.json'))
    ? JSON.parse(readFileSync(join(root, 'curriculum.json'), 'utf8'))
    : {weeks: Array.from({length: 4}, (_, w) => ({title: `Week ${w + 1}`, lessons: Array.from({length: 5}, (_, i) => ({id: `s0${w + 1}e0${i + 1}`, title: `Lesson ${w * 5 + i + 1}`, sourceUrl: `https://hq.mega.dev/lessons/s0${w + 1}e0${i + 1}/`}))}))};
  const ids = new Set();
  if (manifest.weeks.length !== 4) throw Error('The curriculum must contain four weeks.');
  return manifest.weeks.map((week, weekIndex) => {
    if (week.lessons.length !== 5) throw Error('Each week must contain five lessons.');
    return {...week, number: weekIndex + 1, lessons: week.lessons.map((lesson, index) => {
      if (!/^[a-z0-9-]+$/.test(lesson.id) || ids.has(lesson.id)) throw Error('Lesson IDs must be unique and URL-safe.');
      ids.add(lesson.id);
      const articlePath = lesson.id === 's01e01' && existsSync(join(root, 'article.md')) ? join(root, 'article.md') : join(root, 'content', lesson.id, 'article.md');
      let sections = [];
      if (existsSync(articlePath)) {
        const article = readFileSync(articlePath, 'utf8');
        if (lesson.id === 's01e01' && articlePath === join(root, 'article.md')) sections = buildLessons(article,
          JSON.parse(readFileSync(join(root, 'section-identities.json'), 'utf8')),
          existsSync(join(root, 'guides.json')) ? JSON.parse(readFileSync(join(root, 'guides.json'), 'utf8')) : {});
        else sections = buildMarkedSections(article, lesson.title);
      }
      return {...lesson, week:weekIndex+1, number:weekIndex*5+index+1, available:sections.length>0,
        sections:sections.map(s=>({...s,html:render(s.markdown)}))};
    })};
  });
}

export function buildMarkedSections(article, lessonTitle) {
  if (!article.trim()) return [];
  const markers = [...article.matchAll(/^<!-- section: (.*?) -->[ \t]*$/gm)];
  if (!markers.length || article.slice(0, markers[0].index).trim()) {
    throw Error('Each lesson section must start with <!-- section: stable-id -->.');
  }
  const ids = new Set(), slugs = new Set();
  return markers.map((marker, index) => {
    const identity = /^([a-z0-9]+(?:-[a-z0-9]+)*)(?: slug: ([a-z0-9]+(?:-[a-z0-9]+)*))?$/.exec(marker[1]);
    if (!identity) throw Error(`Invalid section marker: ${marker[0]}`);
    const id = identity[1], slug = identity[2] || id;
    if (ids.has(id) || slugs.has(slug) || ids.has(slug) || slugs.has(id)) throw Error('Section IDs and slugs must be unique within a lesson.');
    ids.add(id);
    slugs.add(slug);
    const markdown = article.slice(marker.index, markers[index + 1]?.index ?? article.length);
    if (/^<!-- section:/m.test(markdown.slice(marker[0].length))) {
      throw Error('Invalid section marker. Use <!-- section: stable-id -->.');
    }
    if (!markdown.slice(marker[0].length).trim()) throw Error(`Section ${id} has no content.`);
    const title = /^#{1,2} (.+)$/m.exec(markdown)?.[1] || lessonTitle;
    return {
      id, slug, title, group: lessonTitle, kind: 'topic', number: index + 1, markdown,
      labs: [...new Set([...markdown.matchAll(/https:\/\/github.com\/MEGA-DOT-DEV\/examples\/tree\/main\/(?:examples|tools)\/([a-z0-9-]+)/g)].map(match => match[1]))],
      task: 'Apply one idea from this section to your own example.',
      question: 'How would you explain this idea in your own words?',
      answer: 'Compare your explanation with the source and identify anything you still want to test.',
    };
  });
}
