import {digest} from './fixtures/synthetic.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLessons } from './lessons.mjs';
import { loadReadAlong } from './read-along.mjs';
import { cueAt } from './public/read-along.js';

test('the audio clock selects words after forwards/backwards seeking and clears during gaps', () => {
  const cues = [{word: 0, start: 1, end: 1.3}, {word: 1, start: 1.3, end: 1.8}, {word: 4, start: 3, end: 3.5}];
  assert.equal(cueAt(cues, 0), null);
  assert.equal(cueAt(cues, 1), cues[0]);
  assert.equal(cueAt(cues, 1.3), cues[1]);
  assert.equal(cueAt(cues, 1.8), null);
  assert.equal(cueAt(cues, 3.2), cues[2]);
  assert.equal(cueAt(cues, 1.1), cues[0]);
  assert.equal(cueAt(cues, 3.5), null);
  assert.equal(cueAt([], 1), null);
});

test('changed text or audio disables stale timing',t=>{
 const root=mkdtempSync(join(tmpdir(),'study-alignment-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'alignment'));mkdirSync(join(root,'public/audio'),{recursive:true});
 const section={slug:'synthetic',markdown:'Synthetic test text.'};const audio=Buffer.from('synthetic audio bytes');
 const map={version:1,markdownSha256:digest(section.markdown),audioSha256:digest(audio),words:['Synthetic'],cues:[{word:0,start:0,end:1}],passages:[]};
 writeFileSync(join(root,'public/audio/synthetic.mp3'),audio);writeFileSync(join(root,'alignment/synthetic.json'),JSON.stringify(map));
 assert.deepEqual(loadReadAlong(root,section),map);
 assert.equal(loadReadAlong(root,{...section,markdown:'Changed'}),null);
 writeFileSync(join(root,'public/audio/synthetic.mp3'),'changed bytes');assert.equal(loadReadAlong(root,section),null);
 assert.equal(loadReadAlong(root,{...section,slug:'missing'}),null);
});
