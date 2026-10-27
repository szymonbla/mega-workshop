import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {projectRoot} from './paths.mjs';

test('Git excludes private data; audit rejects it even when force-added',t=>{
 const root=mkdtempSync(join(tmpdir(),'study-ignore-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 execFileSync('git',['init','-q',root]);
 copyFileSync(join(projectRoot,'.gitignore'),join(root,'.gitignore'));
 const paths=['.study-data/study/article.md','.study-data/audio.mp3','.study-data/browser/session.json','.study-data/.audit/screenshot.png','.study-data/course-examples/example.mjs','.env','study/content/s01e01/article.md'];
 for(const name of paths){mkdirSync(join(root,name,'..'),{recursive:true});writeFileSync(join(root,name),'Synthetic test data.');}
 writeFileSync(join(root,'app.mjs'),'export const platform = true;');
 execFileSync('git',['-C',root,'add','.']);
 const tracked=execFileSync('git',['-C',root,'ls-files'],{encoding:'utf8'}).trim().split('\n');
 assert.deepEqual(tracked,['.gitignore','app.mjs']);
 const audit=()=>spawnSync(process.execPath,[join(projectRoot,'scripts/audit-content.mjs'),root],{encoding:'utf8'});
 assert.equal(audit().status,0);
 execFileSync('git',['-C',root,'add','--force',paths[0]]);
 const failure=audit();assert.equal(failure.status,1);assert.match(failure.stderr,/private data included in Git/);
});
