import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export const identities = [
  {id:'intro',slug:'intro',sourceHeading:'Getting Started',title:'Introduction',group:'Test',kind:'introduction',legacyIndex:0},
  {id:'first',slug:'first',sourceHeading:'First',title:'First',group:'Test',kind:'topic',legacyIndex:1},
  {id:'second',slug:'second',sourceHeading:'Second',title:'Second',group:'Test',kind:'topic',legacyIndex:2},
];
export const article = '# Test document\nSynthetic introduction.\n## First\nSynthetic first section.\n## Second\nSynthetic second section.';
export const manifest = {weeks:Array.from({length:4},(_,w)=>({title:`Week ${w+1}`,lessons:Array.from({length:5},(_,i)=>({id:`s0${w+1}e0${i+1}`,title:`Lesson ${w*5+i+1}`}))}))};
export function writeFixture(root) {
  mkdirSync(root,{recursive:true});
  for (const [name,value] of Object.entries({'curriculum.json':manifest,'section-identities.json':identities}))writeFileSync(join(root,name),JSON.stringify(value));
  writeFileSync(join(root,'article.md'),article);
}
export const digest = value => createHash('sha256').update(value).digest('hex');
