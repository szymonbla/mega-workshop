import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { ImportedLabs } from './import-labs.mjs';

test('imported exercise server rejects direct access and works only through the authenticated proxy',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'mega-worker-'));const root=join(directory,'study');await mkdir(root);
  await copyFile(fileURLToPath(new URL('./import-lab-worker.mjs',import.meta.url)),join(root,'import-lab-worker.mjs'));
  const repo=join(directory,'.mega-study/jobs/s01e02/repository');await mkdir(join(repo,'cli/src/viewer'),{recursive:true});
  await writeFile(join(repo,'package.json'),JSON.stringify({type:'module'}));
  await writeFile(join(repo,'cli/src/viewer/server.ts'),`import {createServer} from 'node:http';
export async function startViewer({handleRequest}){
 const server=createServer((req,res)=>{if(handleRequest(req,res))return;if(req.url==='/api/items'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify([{name:'context',ui:true}]));}else{res.setHeader('Content-Type','text/plain');res.end('Exercise page');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {port:server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};
}`);
  const labs=new ImportedLabs(root,join(directory,'.env'));t.after(async()=>{await labs.close();await rm(directory,{recursive:true,force:true});});
  const worker=await labs.worker('s01e02');
  assert.equal((await fetch(`http://localhost:${worker.port}/api/items`)).status,403);
  const items=await labs.items('s01e02');assert.equal(items[0].base,'/study-labs/s01e02');
  const server=createServer((req,res)=>labs.proxy('s01e02','/ui/context/',req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch(`http://localhost:${server.address().port}/`);assert.equal(await response.text(),'Exercise page');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-study-worker'),null);
});
