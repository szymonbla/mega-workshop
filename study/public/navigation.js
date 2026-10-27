export function selectSection(lesson, target, progress = {}) {
  const section = lesson.sections.find(item => item.id === target || item.slug === target)
    || lesson.sections.find(item => item.id === progress.currentSectionId)
    || lesson.sections[0];
  return section ? {kind: 'reader', lesson, section} : {kind: 'pending', lesson};
}

export function resolveRoute(hash, lessons, readProgress) {
  const path = hash.replace(/^#/, '');
  if (!path || path === '/course') return {kind: 'overview'};
  const match = /^\/lesson\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?$/.exec(path);
  const id = match ? match[1] : 's01e01';
  const target = match ? match[2] : path;
  const lesson = lessons.find(item => item.id === id);
  if (!lesson) return {kind: 'overview'};
  if (!lesson.available) return {kind: 'pending', lesson};
  return selectSection(lesson, target, readProgress(lesson));
}
