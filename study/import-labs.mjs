import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

export class ImportedLabs {
  constructor(root, envFile, directory = join(root,'..','.mega-study')) {this.directory=directory;this.root=root;this.envFile=envFile;this.workers=new Map();}
  async worker(id) {
    if(this.workers.has(id))return this.workers.get(id);
    const promise=new Promise((resolve,reject)=>{
      const token=randomBytes(32).toString('hex');
      const repository=join(this.directory,'jobs',id,'repository');
      const child=spawn(process.execPath,[join(this.root,'import-lab-worker.mjs'),repository],{cwd:repository,env:{...process.env,MEX_ENV_FILE:this.envFile,STUDY_WORKER_TOKEN:token},stdio:['ignore','pipe','pipe']});
      let output='';
      const timer=setTimeout(()=>{child.kill();reject(Error('The exercise server did not start. Retry the import.'));},20000);
      child.stdout.on('data',data=>{
        output+=data;
        const match=/\{"port":(\d+)\}/.exec(output);
        if(match){clearTimeout(timer);resolve({port:Number(match[1]),token,child});}
      });
      child.stderr.on('data',()=>{});
      child.once('error',()=>{clearTimeout(timer);this.workers.delete(id);reject(Error('Could not open the imported exercises.'));});
      child.once('exit',()=>{clearTimeout(timer);this.workers.delete(id);reject(Error('The exercise server stopped.'));});
    });
    this.workers.set(id,promise);return promise;
  }
  async items(id) {
    const worker=await this.worker(id);
    const response=await fetch(`http://localhost:${worker.port}/api/items`,{headers:{'x-study-worker':worker.token}});
    if(!response.ok)throw Error('Could not load imported exercises.');
    return (await response.json()).map(item=>({...item,base:`/study-labs/${id}`}));
  }
  async proxy(id, path, req, res) {
    const worker=await this.worker(id);
    const headers={...req.headers,host:`localhost:${worker.port}`,'x-study-worker':worker.token};
    if(headers.origin)headers.origin=`http://localhost:${worker.port}`;
    delete headers.cookie;
    const upstream=request({hostname:'127.0.0.1',port:worker.port,path,method:req.method,headers},response=>{
      const responseHeaders={...response.headers,'cache-control':'no-store'};
      delete responseHeaders['set-cookie'];
      res.writeHead(response.statusCode,responseHeaders);response.pipe(res);
    });
    upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Could not reach the exercise server.');});
    res.on('close',()=>upstream.destroy());
    req.pipe(upstream);
  }
  async close() { for(const promise of this.workers.values()){try{(await promise).child.kill();}catch{}} }
}
