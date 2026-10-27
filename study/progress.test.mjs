import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyKey, progressKey, readProgress} from './public/progress.js';

const sections = [{id:'step-4'}, {id:'step-5'}];
function storage() {
  const values = new Map();
  return {getItem:key=>values.get(key)??null, setItem:(key,value)=>values.set(key,String(value))};
}

test('independent note, status and navigation writes preserve legacy and other-tab data', () => {
  const db = storage();
  db.setItem(legacyKey('s01e01'), JSON.stringify({notes:{'step-4':'Old note'},done:['step-4'],again:[],current:3}));
  const firstTab = readProgress(db,'s01e01',sections);
  assert.equal(firstTab.notes['step-4'],'Old note');
  db.setItem(progressKey('s01e01','note','step-5'),'Other tab note');
  db.setItem(progressKey('s01e01','status','step-5'),'done');
  db.setItem(progressKey('s01e01','current'),firstTab.current+1);
  const saved = readProgress(db,'s01e01',sections);
  assert.deepEqual(saved.notes,{'step-4':'Old note','step-5':'Other tab note'});
  assert.deepEqual(saved.done,['step-4','step-5']);
  assert.equal(saved.current,4);
  db.setItem(progressKey('s01e01','note','step-4'),'');
  db.setItem(progressKey('s01e01','status','step-4'),'again');
  const updated = readProgress(db,'s01e01',sections);
  assert.equal(updated.notes['step-4'],'');
  assert.deepEqual(updated.done,['step-5']);
  assert.deepEqual(updated.again,['step-4']);
  assert.deepEqual(readProgress(db,'s02e01',sections).notes,{});
});

test('invalid legacy JSON does not hide newer notes', () => {
  const db = storage();
  db.setItem(legacyKey('s01e01'),'{');
  db.setItem(progressKey('s01e01','note','step-4'),'New note');
  assert.equal(readProgress(db,'s01e01',sections).notes['step-4'],'New note');
});

test('legacy numeric resume follows original section identity after insertion and reordering', () => {
  const db = storage();
  const original = [{id:'intro',legacyIndex:0},{id:'tokenization',legacyIndex:1}];
  const reordered = [{id:'new'},{...original[1]},{...original[0]}];
  db.setItem(legacyKey('s01e01'), JSON.stringify({current:0}));
  assert.equal(readProgress(db,'s01e01',reordered).currentSectionId,'intro');
  db.setItem(progressKey('s01e01','current'),'1');
  assert.equal(readProgress(db,'s01e01',reordered).currentSectionId,'tokenization');
  db.setItem(progressKey('s01e01','current-section'),'intro');
  assert.equal(readProgress(db,'s01e01',reordered).currentSectionId,'intro');
  db.setItem(progressKey('s01e01','current-section'),'deleted');
  assert.equal(readProgress(db,'s01e01',reordered).currentSectionId,'new');
});

test('progress writes change one topic and preserve notes, another tab and other lessons', async () => {
  const {createProgressStore} = await import('./public/progress.js');
  const db = storage();
  const lesson = {id:'s01e01',sections:[{id:'intro',kind:'chapter'}, {id:'a',kind:'topic'}, {id:'b',kind:'topic'}]};
  const first = createProgressStore(db), second = createProgressStore(db);
  db.setItem(legacyKey(lesson.id),JSON.stringify({notes:{a:'Remember this'},done:['a']}));
  second.mark(lesson,'b','done');
  first.mark(lesson,'a','again');
  const saved = second.read(lesson);
  assert.deepEqual(saved.notes,{a:'Remember this'});
  assert.deepEqual(saved.done,['b']);
  assert.deepEqual(saved.again,['a']);
  assert.deepEqual(first.counts(lesson),{done:1,again:1,total:2,complete:false});
  first.mark(lesson,'a','done');
  assert.equal(first.counts(lesson).complete,true);
  assert.deepEqual(second.read({...lesson,id:'s02e01'}).done,[]);
  assert.throws(()=>first.mark(lesson,'intro','done'));
  assert.throws(()=>first.mark(lesson,'a','unknown'));
  assert.equal(first.counts({id:'empty',sections:[]}).complete,false);
});

test('resume writes stable IDs and storage failures preserve this session with a failure result', async () => {
  const {createProgressStore} = await import('./public/progress.js');
  const lesson = {id:'s01e01',available:true,sections:[{id:'a',kind:'topic',legacyIndex:0}, {id:'b',kind:'topic',legacyIndex:1}]};
  const db = storage();
  const saved = createProgressStore(db);
  assert.equal(saved.visit(lesson,lesson.sections[1]),true);
  assert.equal(db.getItem(progressKey(lesson.id,'current-section')),'b');
  assert.equal(saved.read({...lesson,sections:[...lesson.sections].reverse()}).currentSectionId,'b');
  assert.equal(saved.resumeLesson([{id:'pending',available:false},lesson]),lesson);
  const unavailable = createProgressStore({getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}});
  assert.equal(unavailable.visit(lesson,lesson.sections[1]),false);
  assert.equal(unavailable.read(lesson).currentSectionId,'b');
  const result = unavailable.mark(lesson,'b','again');
  assert.equal(result.saved,false);
  assert.deepEqual(result.state.again,['b']);
  assert.deepEqual(unavailable.read(lesson).again,['b']);
});

test('storage events match only the current lesson or all progress on the overview', async () => {
  const {createProgressStore} = await import('./public/progress.js');
  const store = createProgressStore(storage());
  assert.equal(store.affects(null,'s01e01'),true);
  assert.equal(store.affects(legacyKey('s01e01'),'s01e01'),true);
  assert.equal(store.affects(progressKey('s01e01','status','a'),'s01e01'),true);
  assert.equal(store.affects(progressKey('s02e01','status','a'),'s01e01'),false);
  assert.equal(store.affects('mega-study-last'),true);
  assert.equal(store.affects('mega-theme'),false);
});
