import { createReadAlong } from './read-along.js';

export function createAudioPlayer({root, storage}) {
  const $ = selector => root.querySelector(selector);
  const audio = $('#topic-audio');
  const readAlong = createReadAlong({audio, article:$('#article'), reader:$('.reader'),
   controls:$('#read-along-controls'), highlight:$('#read-highlight'), follow:$('#read-follow'),
   status:$('#read-along-status'), player:$('.topic-audio')});
  let audioSpeed = 1;
  try { const saved = Number(storage?.getItem('mega-audio-speed')); if ([0.75,1,1.25,1.5,1.75,2].includes(saved)) audioSpeed = saved; } catch {}
  $('#audio-speed').value = String(audioSpeed);
  const audioTime = seconds => { const n = Math.max(0, Math.floor(Number(seconds) || 0)); return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`; };
  let expectedDuration = 0;
  function syncAudio() {
   const duration = Number.isFinite(audio.duration) ? audio.duration : expectedDuration;
   const time = audio.currentTime || 0;
   const playing = !audio.paused && !audio.ended;
   $('.topic-audio').toggleAttribute('data-playing', playing);
   $('#audio-play-label').textContent = playing ? 'Pause' : audio.ended ? 'Replay' : 'Play';
   $('#audio-mini-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
   $('#audio-now').textContent = audioTime(time);
   $('#audio-end').textContent = audioTime(duration);
   $('#audio-mini-time').textContent = `${audioTime(time)} / ${audioTime(duration)}`;
   $('#audio-seek').max = String(duration || 1);
   $('#audio-seek').value = String(time);
   $('#audio-seek').disabled = !Number.isFinite(audio.duration) || !!audio.error;
   $('#audio-seek').setAttribute('aria-valuetext', `${audioTime(time)} of ${audioTime(duration)}`);
   const progress = duration ? Math.min(100, time / duration * 100) : 0;
   $('#audio-seek').style.setProperty('--fill', `${progress}%`);
   $('#audio-mini-progress').style.width = `${progress}%`;
  }
  function selectAudio(lesson) {
   audio.pause();
   $('.topic-audio').hidden = !lesson.audio;
   $('#audio-status').textContent = '';
   expectedDuration = lesson.audio ? lesson.audio.end - lesson.audio.start : 0;
   if (!lesson.audio) { audio.removeAttribute('src'); audio.load(); syncAudio(); readAlong.load(null); return; }
   $('#audio-title').textContent = lesson.title;
   $('#audio-length').textContent = audioTime(expectedDuration);
   audio.setAttribute('aria-label', `Listen: ${lesson.title}`);
   audio.src = lesson.audio.src;
   audio.defaultPlaybackRate = audioSpeed;
   audio.playbackRate = audioSpeed;
   audio.load();
   syncAudio();
   readAlong.load(lesson.audio.alignment);
  }
  async function playAudio() {
   $('#audio-status').textContent = '';
   try { await audio.play(); } catch(error) {
     if (error.name !== 'AbortError') $('#audio-status').textContent = 'Could not play this recording. Try Play again or reload the page.';
   }
  }
  function toggleAudio() { if (audio.paused) playAudio(); else audio.pause(); }
  $('#audio-play').onclick = toggleAudio;
  $('#audio-mini-play').onclick = toggleAudio;
  $('#audio-seek').oninput = () => { if (Number.isFinite(audio.duration)) audio.currentTime = Number($('#audio-seek').value); syncAudio(); };
  $('#audio-speed').onchange = () => {
   audioSpeed = Number($('#audio-speed').value);
   audio.defaultPlaybackRate = audioSpeed;
   audio.playbackRate = audioSpeed;
   try { storage?.setItem('mega-audio-speed', String(audioSpeed)); } catch {}
  };
  $('#audio-collapse').onclick = () => {
   const expanded = $('#audio-body').hidden;
   $('#audio-body').hidden = !expanded;
   $('.audio-mini').hidden = expanded;
   $('#audio-collapse').setAttribute('aria-expanded', String(expanded));
   $('#audio-collapse').setAttribute('aria-label', expanded ? 'Collapse player' : 'Expand player');
  };
  for (const name of ['timeupdate','play','pause','ended','durationchange','emptied']) audio.addEventListener(name, syncAudio);
  audio.addEventListener('loadedmetadata', () => { audio.playbackRate = audioSpeed; $('#audio-status').textContent = ''; syncAudio(); });
  audio.addEventListener('waiting', () => { $('#audio-status').textContent = 'Loading audio…'; });
  audio.addEventListener('playing', () => { $('#audio-status').textContent = ''; });
  audio.addEventListener('error', () => { $('#audio-status').textContent = 'Could not load this recording. Reload the page to try again.'; syncAudio(); });
  return {select: selectAudio, pause: () => audio.pause(), refresh: readAlong.refresh};
}
