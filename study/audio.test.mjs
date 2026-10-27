import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { serveAudio } from './audio.mjs';
import { buildLessons } from './lessons.mjs';

test('audio streaming supports seeking, HEAD and invalid ranges', async t => {
  const dir = mkdtempSync(join(tmpdir(),'study-audio-test-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'synthetic.mp3');
  writeFileSync(file,Buffer.alloc(2048,42));
  const size = statSync(file).size;
  const bytes = readFileSync(file);
  const server = createServer((req, res) => serveAudio(req, res, file));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const full = await fetch(url);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'audio/mpeg');
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
  for (const [range, start, end] of [['bytes=0-99',0,99], ['bytes=100-',100,size-1], ['bytes=-20',size-20,size-1], [`bytes=${size-10}-${size+100}`,size-10,size-1]]) {
    const res = await fetch(url, {headers:{Range:range}});
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), `bytes ${start}-${end}/${size}`);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes.subarray(start,end+1));
  }
  const head = await fetch(url, {method:'HEAD'});
  assert.equal(head.headers.get('content-length'), String(size));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  for (const range of [`bytes=${size}-`, 'bytes=20-10', 'bytes=-0', 'bytes=-', 'bytes=0-2,5-7', 'invalid']) {
    const res = await fetch(url, {headers:{Range:range}});
    assert.equal(res.status, 416, range);
    assert.equal(res.headers.get('content-range'), `bytes */${size}`);
    await res.arrayBuffer();
  }
});
