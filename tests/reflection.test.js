import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {QUESTIONS, seoulDay, currentSlot, questionFor, reflectionGroups, validateReflection, dueReflection} from '../reflection-core.js';
import {validateBackup} from '../core.js';
import {openDatabase, transaction, readAll, mergeLogs, writeDraft} from '../storage.js';

const answer = (i = 0) => ({id:`answer-${i}`, date:new Date(Date.UTC(2026,10,1,i)).toISOString(), energy:0,tags:['고유한 방식'],context:'구체적인 장면은?',raw:`답변 ${i}`,trigger:'',hypothesis:'',audio:null,
  reflection:{type:'answer',day:'2026-11-01',slot:i % 2 ? 'evening':'morning',questionId:2,question:'구체적인 장면은?'}});
test('한국 시간의 자정과 저녁 19:30 경계에서 날짜와 질문을 고른다', () => {
  assert.equal(seoulDay(new Date('2026-11-12T15:00:00Z')), '2026-11-13');
  assert.equal(currentSlot(new Date('2026-11-13T10:29:59Z')), 'morning');
  assert.equal(currentSlot(new Date('2026-11-13T10:30:00Z')), 'evening');
});
test('23개 질문을 순환하며 하루 두 질문이 다르고 같은 날짜의 질문은 안정적이다', () => {
  assert.equal(QUESTIONS.length, 23);
  const ids = new Set();
  for (let i=0;i<23;i++) {
    const day = new Date(Date.UTC(2026,9,1+i)).toISOString().slice(0,10);
    const am = questionFor(day, 'morning'), pm = questionFor(day, 'evening');
    assert.notEqual(am.questionId, pm.questionId);
    assert.deepEqual(am, questionFor(day,'morning'));
    ids.add(am.questionId); ids.add(pm.questionId);
  }
  assert.equal(ids.size,23);
});
test('11월 17일부터 선정한 원문 질문을 오전·오후 5일 주기로 순환한다', () => {
  const morning = [2,4,13,16,17], evening = [3,5,7,11,20];
  for (let i=0;i<15;i++) {
    const day = new Date(Date.UTC(2026,10,17+i)).toISOString().slice(0,10);
    assert.equal(questionFor(day,'morning').questionId,morning[i%5]);
    assert.equal(questionFor(day,'evening').questionId,evening[i%5]);
  }
  assert.equal(questionFor('2026-11-17','morning').question, '당신 안에는 어떤 인코딩(내면의 작동 방식)이 숨어 있는가? 당신을 잘 아는 사람들은 무엇을 당신의 인코딩이라고 생각하는가?');
  assert.match(questionFor('2026-11-18','evening').context,/막혀 있던 일을/);
  assert.match(questionFor('2026-11-19','evening').context,/다시 하고 싶었던/);
  assert.equal(dueReflection([],new Date('2026-11-17T00:30:00Z')).questionId,2);
  assert.equal(dueReflection([],new Date('2026-11-17T10:30:00Z')).questionId,3);
});
test('회고는 저장된 답변만 날짜순으로 7개씩 묶고 피드백·회고는 세지 않는다', () => {
  const records = Array.from({length:15},(_,i)=>answer(i)).reverse();
  records.push({...answer(20),reflection:{type:'feedback', person:'동료',question:'언제?'}});
  const groups = reflectionGroups(records);
  assert.equal(groups.length,2);
  assert.deepEqual(groups[0].map(a=>a.id),Array.from({length:7},(_,i)=>`answer-${i}`));
});
test('자기이해 답변·타인 관찰·회고를 기존 관찰과 같은 백업으로 손실 없이 복원한다', () => {
  const records = [answer(), {...answer(1),reflection:{type:'feedback',person:'동료',question:'잘하는 일은?'}},
    {...answer(2),reflection:{type:'review',answerIds:Array.from({length:7},(_,i)=>`answer-${i}`)}}];
  assert.deepEqual(validateBackup({format:'bug-book',version:1,logs:records}),records);
  const old = {...answer()}; delete old.reflection;
  assert.deepEqual(validateBackup({format:'bug-book',version:1,logs:[old]}),[old]);
  for (const reflection of [{type:'answer'}, {...answer().reflection,questionId:24}, {...answer().reflection,day:'2026-99-01'},
    {type:'review',answerIds:Array(7).fill('same')}, {type:'feedback',person:'',question:'test'}]) {
    assert.equal(validateReflection(reflection),false);
    assert.throws(()=>validateBackup({format:'bug-book',version:1,logs:[{...answer(),reflection}]}));
  }
});
test('자기이해 저장은 기존 관찰 초안을 유지하고 백업 병합은 답변 메타데이터를 보존한다', async () => {
  const db = await openDatabase(new IDBFactory());
  await writeDraft(db,{raw:'작성 중인 관찰'});
  await transaction(db,['logs'],'readwrite',tx=>tx.objectStore('logs').put(answer()));
  assert.deepEqual((await readAll(db)).draft,{raw:'작성 중인 관찰'});
  const imported = validateBackup({format:'bug-book',version:1,logs:[answer(),answer(1)]});
  assert.equal(await mergeLogs(db,imported),1);
  const state = await readAll(db);
  assert.equal(state.logs.length,2);assert.equal(state.logs[1].reflection.type,'answer');
  db.close();
});
test('오전 9:30 이전에는 질문을 안내하지 않고 경계 시각부터 안내한다', () => {
  assert.equal(currentSlot(new Date('2026-11-13T00:29:59Z')), null);
  assert.equal(dueReflection([], new Date('2026-11-13T00:29:59Z')), null);
  assert.equal(dueReflection([], new Date('2026-11-13T00:30:00Z')).slot, 'morning');
  assert.equal(dueReflection([], new Date('2026-11-13T10:30:00Z')).slot, 'evening');
});
test('답한 질문은 다시 안내하지 않으며 저녁에는 최신 질문만 보여준다', () => {
  const morning = {...answer(), reflection:{...answer().reflection, day:'2026-11-13',slot:'morning'}};
  const evening = {...answer(1), reflection:{...answer(1).reflection, day:'2026-11-13',slot:'evening'}};
  assert.equal(dueReflection([morning], new Date('2026-11-13T01:00:00Z')), null);
  assert.equal(dueReflection([morning], new Date('2026-11-13T11:00:00Z')).slot, 'evening');
  assert.equal(dueReflection([evening], new Date('2026-11-13T11:00:00Z')), null);
  assert.equal(dueReflection([morning,evening], new Date('2026-11-14T01:00:00Z')).day, '2026-11-14');
  assert.equal(dueReflection([], new Date('2026-11-14T00:00:00Z')), null);
});
