export function legacyKey(id) {
  return id === 's01e01' ? 'mega-study-v1' : `mega-study-v1:${id}`;
}

export function progressKey(id, field, section = '') {
  return `mega-study-v2:${id}:${field}:${section}`;
}

export function readProgress(storage, id, sections) {
  const state = {notes: {}, done: [], again: [], current: 0};
  const get = key => { try { return storage.getItem(key); } catch { return null; } };
  try {
    const old = JSON.parse(get(legacyKey(id)));
    if (old?.notes && typeof old.notes === 'object' && !Array.isArray(old.notes)) state.notes = {...old.notes};
    if (Array.isArray(old?.done)) state.done = old.done;
    if (Array.isArray(old?.again)) state.again = old.again;
    if (Number.isInteger(old?.current)) state.current = old.current;
  } catch {}
  for (const section of sections) {
    const note = get(progressKey(id, 'note', section.id));
    if (note !== null) state.notes[section.id] = note;
    const status = get(progressKey(id, 'status', section.id));
    if (status === 'done' || status === 'again') {
      state.done = state.done.filter(value => value !== section.id);
      state.again = state.again.filter(value => value !== section.id);
      state[status].push(section.id);
    }
  }
  const current = get(progressKey(id, 'current'));
  if (current !== null && Number.isInteger(Number(current))) state.current = Number(current);
  const savedId = get(progressKey(id, 'current-section'));
  const hasLegacyOrder = sections.some(section => Number.isInteger(section.legacyIndex));
  const resumed = savedId !== null
    ? sections.find(section => section.id === savedId)
    : hasLegacyOrder
      ? sections.find(section => section.legacyIndex === state.current)
      : sections[Math.max(0, Math.min(state.current, sections.length - 1))];
  state.currentSectionId = (resumed || sections[0])?.id ?? null;
  return state;
}

export function completion(sections, progress) {
  const topics = sections.filter(section => section.kind === 'topic');
  const done = topics.filter(section => progress.done.includes(section.id)).length;
  const again = topics.filter(section => progress.again.includes(section.id)).length;
  return {done, again, total: topics.length, complete: topics.length > 0 && done === topics.length};
}

export function createProgressStore(storage) {
  const unsaved = new Map();
  const getItem = key => {
    if (unsaved.has(key)) return unsaved.get(key);
    try { return storage?.getItem(key) ?? null; } catch { return null; }
  };
  function write(key, value) {
    try {
      if (!storage) throw Error('Storage unavailable');
      storage.setItem(key, value);
      unsaved.delete(key);
      return true;
    } catch {
      unsaved.set(key, String(value));
      return false;
    }
  }
  const read = lesson => readProgress({getItem}, lesson.id, lesson.sections);
  return {
    read,
    counts: lesson => completion(lesson.sections, read(lesson)),
    visit(lesson, section) {
      const saved = write(progressKey(lesson.id, 'current-section'), section.id);
      const savedLast = write('mega-study-last', lesson.id);
      return saved && savedLast;
    },
    mark(lesson, sectionId, status) {
      if (!['done', 'again'].includes(status) || !lesson.sections.some(section => section.id === sectionId && section.kind === 'topic')) {
        throw Error('Only a learning topic can be marked done or again.');
      }
      const saved = write(progressKey(lesson.id, 'status', sectionId), status);
      return {saved, state: read(lesson)};
    },
    affects(key, lessonId) {
      if (key === null) return true;
      if (lessonId) return key === legacyKey(lessonId) || key.startsWith(`mega-study-v2:${lessonId}:`);
      return key.startsWith('mega-study-');
    },
    resumeLesson(lessons) {
      const id = getItem('mega-study-last');
      return lessons.find(lesson => lesson.id === id && lesson.available) || lessons.find(lesson => lesson.available);
    },
  };
}
