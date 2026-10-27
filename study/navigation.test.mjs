import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveRoute, selectSection} from './public/navigation.js';

const lesson = {id:'s01e01',available:true,sections:[
  {id:'step-1',slug:'intro'}, {id:'step-4',slug:'tokenization'},
]};
const pending = {id:'s02e01',available:false,sections:[]};
const lessons = [lesson,pending];
const read = () => ({currentSectionId:'step-4'});

test('old links, section IDs and course URLs resolve to the same section', () => {
  for (const hash of ['#tokenization','#/lesson/s01e01/tokenization','#/lesson/s01e01/step-4']) {
    assert.deepEqual(resolveRoute(hash,lessons,read),{kind:'reader',lesson,section:lesson.sections[1]});
  }
  assert.equal(resolveRoute('#/lesson/s01e01/intro',lessons,read).section.id,'step-1');
});

test('missing section resumes by identity and unavailable courses remain distinct from unknown courses', () => {
  assert.equal(resolveRoute('#/lesson/s01e01',lessons,read).section.id,'step-4');
  assert.equal(resolveRoute('#/lesson/s01e01/unknown',lessons,read).section.id,'step-4');
  assert.deepEqual(resolveRoute('#/lesson/s02e01',lessons,read),{kind:'pending',lesson:pending});
  for (const hash of ['', '#/course', '#/lesson/unknown']) {
    assert.deepEqual(resolveRoute(hash,lessons,read),{kind:'overview'});
  }
  assert.equal(selectSection(lesson,undefined,{currentSectionId:'deleted'}).section.id,'step-1');
});

test('section selection uses the current lesson instead of shared selection state', () => {
  const another = {id:'s02e02',available:true,sections:[{id:'step-4',slug:'other'}]};
  assert.equal(selectSection(another,'step-4').section.slug,'other');
  assert.deepEqual(selectSection(pending),{kind:'pending',lesson:pending});
});
