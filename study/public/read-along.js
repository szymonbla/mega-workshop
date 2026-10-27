export function cueAt(cues, time) {
  let low = 0, high = cues.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (cues[middle].start <= time) low = middle + 1;
    else high = middle;
  }
  const cue = cues[low - 1];
  return cue && time < cue.end ? cue : null;
}

export function createReadAlong({audio, article, reader, controls, highlight, follow, status, player}) {
  let data = null, spans = [], sentences = [], sentenceByWord = [], seekable = [];
  let activeWord = null, activeSentence = null, activeFigure = null, frame = 0;
  let enabled = true, following = true, programmaticScroll = null;
  try { enabled = localStorage.getItem('mega-read-along') !== 'off'; } catch {}

  function clearMarks() {
    activeWord?.classList.remove('spoken-word');
    activeSentence?.forEach(span => span.classList.remove('spoken-sentence'));
    activeFigure?.classList.remove('spoken-figure');
    activeWord = activeSentence = activeFigure = null;
  }

  function updateControls() {
    highlight.setAttribute('aria-pressed', String(enabled));
    follow.setAttribute('aria-pressed', String(following));
    follow.disabled = !enabled;
    follow.textContent = following ? 'Following text' : 'Back to audio';
  }

  function suspendFollowing() {
    if (!data || reader.hidden) return;
    following = false;
    programmaticScroll = null;
    updateControls();
  }

  function scrollToCurrent(force = false) {
    if (!following || !enabled || reader.hidden || (!force && audio.paused)) return;
    const target = activeWord || activeFigure;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const pane = reader.getBoundingClientRect();
    const internal = getComputedStyle(reader).overflowY === 'auto';
    const top = Math.max(0, pane.top, player.getBoundingClientRect().bottom) + 16;
    const bottom = Math.min(innerHeight - 16, internal ? pane.bottom : innerHeight - 16);
    // An illustration can be taller than the viewport: align its top only once.
    if (rect.top >= top && (rect.bottom <= bottom || (target === activeFigure && rect.top < top + 50))) return;
    const delta = rect.top - top - Math.max(0, (bottom - top) * .2);
    if (internal) {
      programmaticScroll = {target: reader, position: Math.max(0, Math.min(reader.scrollHeight - reader.clientHeight, reader.scrollTop + delta))};
      reader.scrollTo({top: programmaticScroll.position, behavior: 'instant'});
    } else {
      programmaticScroll = {target: window, position: Math.max(0, Math.min(document.documentElement.scrollHeight - innerHeight, scrollY + delta))};
      window.scrollTo({top: programmaticScroll.position, behavior: 'instant'});
    }
  }

  function render(forceScroll = false) {
    if (!data || !enabled || audio.ended || audio.error) {
      clearMarks();
      status.textContent = '';
      return;
    }
    const cue = cueAt(data.cues, audio.currentTime);
    const passage = cue ? null : cueAt(data.passages, audio.currentTime);
    const word = cue ? spans[cue.word] : null;
    const sentence = cue ? sentences[sentenceByWord[cue.word]] : null;
    const figure = passage?.kind === 'figure' ? article.querySelectorAll('img')[passage.figure] : null;
    const changed = word !== activeWord || figure !== activeFigure;
    if (word !== activeWord) {
      activeWord?.classList.remove('spoken-word');
      word?.classList.add('spoken-word');
      activeWord = word;
    }
    if (sentence !== activeSentence) {
      activeSentence?.forEach(span => span.classList.remove('spoken-sentence'));
      sentence?.forEach(span => span.classList.add('spoken-sentence'));
      activeSentence = sentence;
    }
    if (figure !== activeFigure) {
      activeFigure?.classList.remove('spoken-figure');
      figure?.classList.add('spoken-figure');
      activeFigure = figure;
    }
    const message = passage ? (figure ? 'Describing this illustration' : 'Listening…') : '';
    if (status.textContent !== message) status.textContent = message;
    if (changed || forceScroll) scrollToCurrent(forceScroll);
  }

  function tick() {
    frame = 0;
    if (!reader.hidden) render();
    if (data && enabled && !audio.paused && !audio.ended && !document.hidden) frame = requestAnimationFrame(tick);
  }

  function refresh(event) {
    cancelAnimationFrame(frame);
    frame = 0;
    render(event?.type === 'play' || event?.type === 'playing');
    if (data && enabled && !audio.paused && !audio.ended && !document.hidden) frame = requestAnimationFrame(tick);
  }

  function load(alignment) {
    cancelAnimationFrame(frame);
    frame = 0;
    clearMarks();
    data = null;
    spans = []; sentences = []; sentenceByWord = []; seekable = [];
    following = true;
    programmaticScroll = null;
    controls.hidden = true;
    status.textContent = '';
    if (!alignment) return;
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const words = nodes.flatMap(node => node.data.match(/\S+/gu) || []);
    // Changed rendering must never highlight the wrong word with an old map.
    if (words.length !== alignment.words.length || words.some((word, i) => word !== alignment.words[i])) return;
    data = alignment;
    const times = new Map(data.cues.map(c => [c.word, c.start]));
    for (const node of nodes) {
      const fragment = document.createDocumentFragment();
      for (const part of node.data.split(/(\s+)/u)) {
        if (!part || /^\s+$/u.test(part)) {
          fragment.append(document.createTextNode(part));
          continue;
        }
        const span = document.createElement('span');
        const index = spans.length;
        span.textContent = part;
        span.dataset.word = index;
        if (times.has(index) && !node.parentElement.closest('a,button,pre')) {
          span.dataset.audioTime = times.get(index);
          span.setAttribute('role', 'button');
          span.tabIndex = seekable.length ? -1 : 0;
          span.title = 'Listen from this word · arrow keys move between words';
          seekable.push(span);
        }
        spans.push(span);
        fragment.append(span);
      }
      node.replaceWith(fragment);
    }
    const blocks = new Map();
    for (const span of spans) {
      const block = span.closest('p,li,h1,h2,h3,h4,pre,blockquote') || article;
      if (!blocks.has(block)) blocks.set(block, []);
      blocks.get(block).push(span);
    }
    const segmenter = new Intl.Segmenter('en', {granularity: 'sentence'});
    for (const block of blocks.values()) {
      const text = block.map(span => span.textContent).join(' ');
      let index = 0, offset = 0;
      for (const segment of segmenter.segment(text)) {
        const sentence = [];
        while (index < block.length && offset < segment.index + segment.segment.length) {
          const span = block[index++];
          sentenceByWord[Number(span.dataset.word)] = sentences.length;
          sentence.push(span);
          offset += span.textContent.length + 1;
        }
        sentences.push(sentence);
      }
    }
    controls.hidden = false;
    updateControls();
    refresh();
  }

  async function seek(span) {
    if (!data || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Number(span.dataset.audioTime);
    refresh();
    try { await audio.play(); } catch (error) {
      if (error.name !== 'AbortError') status.textContent = 'Press Play to listen from this word.';
    }
  }
  article.addEventListener('click', event => {
    if (!getSelection()?.isCollapsed || event.target.closest('a,button')) return;
    const span = event.target.closest('[data-audio-time]');
    if (span) seek(span);
  });
  article.addEventListener('keydown', event => {
    const span = event.target.closest('[data-audio-time]');
    if (!span) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      seek(span);
    } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const i = seekable.indexOf(span);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? seekable.length - 1 : Math.max(0, Math.min(seekable.length - 1, i + (event.key === 'ArrowRight' ? 1 : -1)));
      seekable.forEach(word => word.tabIndex = -1);
      seekable[next].tabIndex = 0;
      seekable[next].focus();
    }
  });
  highlight.onclick = () => {
    enabled = !enabled;
    try { localStorage.setItem('mega-read-along', enabled ? 'on' : 'off'); } catch {}
    updateControls();
    refresh();
  };
  follow.onclick = () => {
    following = !following;
    updateControls();
    if (following) render(true);
  };
  for (const name of ['wheel', 'touchmove']) reader.addEventListener(name, suspendFollowing, {passive: true});
  reader.addEventListener('keydown', event => {
    if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '].includes(event.key) && !event.target.closest('button,input,select,[data-audio-time]')) suspendFollowing();
  });
  function onScroll(target, position) {
    if (programmaticScroll?.target === target && Math.abs(position - programmaticScroll.position) < 2) {
      programmaticScroll = null;
      return;
    }
    if (!audio.paused) suspendFollowing();
  }
  reader.addEventListener('scroll', () => onScroll(reader, reader.scrollTop), {passive: true});
  window.addEventListener('scroll', () => {
    if (getComputedStyle(reader).overflowY !== 'auto') onScroll(window, scrollY);
  }, {passive: true});
  for (const name of ['play', 'playing', 'pause', 'seeking', 'seeked', 'timeupdate', 'ended', 'emptied', 'error']) audio.addEventListener(name, refresh);
  document.addEventListener('visibilitychange', refresh);
  return {load, refresh};
}
