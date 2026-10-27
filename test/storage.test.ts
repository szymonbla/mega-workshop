import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { privateDataPath, projectRoot } from "../src/server/paths.ts";

test("material storage allows ignored local data but rejects source paths and aliases", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "study-path-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  symlinkSync(projectRoot, join(dir, "alias"), "dir");
  for (const path of [
    projectRoot,
    join(projectRoot, "new/content"),
    join(dir, "alias/new/content"),
  ])
    assert.throws(() => privateDataPath(path), /outside/);
  assert.equal(privateDataPath(join(dir, "materials")), join(dir, "materials"));
  assert.equal(
    privateDataPath(join(projectRoot, ".study-data", "study")),
    join(projectRoot, ".study-data", "study"),
  );
});

test("fresh install serves an empty platform without any course checkout", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "study-empty-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = `
 import assert from 'node:assert/strict';
 import {startStudy} from './src/server/server.ts';
 const source={check:async()=>({}),close:async()=>{}};
 const viewer=await startStudy({port:0,source});
 try {
  const base=viewer.url;
  assert.equal((await fetch(base)).status,200);
  assert.equal((await fetch(base+'study-api/curriculum')).status,401);
  const login=await fetch(base+'study-api/auth/complete',{method:'POST',headers:{Origin:base.slice(0,-1),'Content-Type':'application/json'},body:'{}'});
  assert.equal(login.status,200);
  const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};
  const catalog=await fetch(base+'study-api/curriculum',{headers}).then(r=>r.json());
  const lessons=catalog.weeks.flatMap(w=>w.lessons);
  assert.equal(lessons.length,20);assert.ok(lessons.every(l=>!l.available && l.sections.length===0));
  assert.deepEqual(await fetch(base+'api/items',{headers}).then(r=>r.json()),[]);
  assert.equal((await fetch(base+'study/style.css')).status,200);
  assert.equal((await fetch(base+'study/audio/missing.mp3',{headers})).status,404);
 } finally {await viewer.close();}
 `;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    STUDY_DATA_HOME: dir,
    MEX_ENV_FILE: join(dir, ".env"),
  };
  delete env.OPENAI_API_KEY;
  delete env.OPENROUTER_API_KEY;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { cwd: projectRoot, env, encoding: "utf8", timeout: 15000 },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
