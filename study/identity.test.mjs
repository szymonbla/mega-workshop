import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLessons} from './lessons.mjs';
import {buildMarkedSections} from './curriculum.mjs';
import {article, identities} from './fixtures/synthetic.mjs';
test('new lesson markers preserve identity across heading edits, insertion and reordering', () => {
  const first = '<!-- section: durable-id slug: public-url -->\n## Original title\nText.\n';
  const second = '<!-- section: another-id -->\n## Original title\nMore text.\n';
  const before = buildMarkedSections(first + second, 'Lesson');
  const after = buildMarkedSections(second + first.replace('Original title', 'New title'), 'Lesson');
  assert.deepEqual(before.map(section => section.id), ['durable-id', 'another-id']);
  assert.deepEqual(after.map(section => section.id), ['another-id', 'durable-id']);
  assert.equal(after[1].slug, 'public-url');
  assert.equal(after[1].title, 'New title');
  assert.equal(after[1].number, 2);
});

test('new lessons reject ambiguous identity while allowing empty pending materials', () => {
  assert.deepEqual(buildMarkedSections(' \n', 'Lesson'), []);
  for (const source of [
    '## Untagged heading\nText.',
    '<!-- section: ../unsafe -->\n## Heading',
    '<!-- section: same -->\n## First\n<!-- section: same -->\n## Second',
    '<!-- section: first slug: duplicate -->\n## First\n<!-- section: second slug: duplicate -->\n## Second',
    '<!-- section: first -->\n## First\n<!-- section:broken-->\n## Second',
  ]) assert.throws(() => buildMarkedSections(source, 'Lesson'), /section|Section/);
});



test('insertion and reordering preserve durable identities and resume indexes',()=>{
 const before=buildLessons(article,identities);
 const extra={id:'extra',slug:'extra',sourceHeading:'Extra',title:'Extra',group:'Test',kind:'topic'};
 const after=buildLessons(article.replace('## First','## Extra\nSynthetic added section.\n## First'),[...identities,extra]);
 for(const original of before){const section=after.find(s=>s.id===original.id);assert.equal(section.slug,original.slug);assert.equal(section.legacyIndex,original.legacyIndex);assert.equal(section.markdown,original.markdown);}
 const reordered=buildLessons([before[0],before[2],before[1]].map(s=>s.markdown).join('\n'),identities);
 assert.deepEqual(reordered.map(s=>s.id),['intro','second','first']);
});
test('ambiguous, missing and unsafe legacy identities are rejected',()=>{
 assert.throws(()=>buildLessons(article,[...identities,identities[0]]),/unique/);
 assert.throws(()=>buildLessons(article,identities.slice(1)),/Register section/);
 assert.throws(()=>buildLessons(article,identities.map((s,i)=>i?s:{...s,id:'../bad'})),/URL-safe/);
 assert.throws(()=>buildLessons(article,identities.map((s,i)=>i===1?{...s,slug:'intro'}:s)),/unique/);
 assert.throws(()=>buildLessons(article,identities.map((s,i)=>i===1?{...s,legacyIndex:0}:s)),/Legacy section indexes/);
});
