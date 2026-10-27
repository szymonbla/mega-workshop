import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLessons} from './lessons.mjs';
import {article, identities} from './fixtures/synthetic.mjs';
test('parser preserves source text and numbers only topics',()=>{
 const sections=buildLessons(article,identities);
 assert.equal(sections.map(s=>s.markdown).join('\n'),article);
 assert.deepEqual(sections.map(s=>s.number),[null,1,2]);
});
test('linked exercises are extracted without embedding their contents',()=>{
 const source=article+'\nhttps://github.com/MEGA-DOT-DEV/examples/tree/main/examples/synthetic-example';
 assert.deepEqual(buildLessons(source,identities).at(-1).labs,['synthetic-example']);
});
