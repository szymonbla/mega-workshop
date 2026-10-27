import { materialRoot } from '../paths.mjs';
// A test-only MEGA boundary; production always uses MegaSource.
import { mkdtemp, rm, mkdir, readdir, copyFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudy } from '../server.mjs';
const directory=await mkdtemp(join(tmpdir(),'mega-test-session-'));
const original=materialRoot;
const root=join(directory,'study');await mkdir(root);
for(const entry of await readdir(original,{withFileTypes:true}))if(entry.isFile() && /\.(json|md)$/.test(entry.name))await copyFile(join(original,entry.name),join(root,entry.name));
for(const name of ['public','alignment'])await symlink(join(original,name),join(root,name),'dir');
const source={availableLessons:async()=>[],check:async()=>({}),login:async()=>{},logout:async()=>{},close:async()=>{}};
const viewer=await startStudy({root,source,stateDirectory:directory});
console.log(`MEGA Workshop → ${viewer.url}`);
process.on('SIGTERM',async()=>{await viewer.close();await rm(directory,{recursive:true,force:true});process.exit(0);});
