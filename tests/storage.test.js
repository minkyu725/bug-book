import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {openDatabase, readAll, writeDraft, saveLog, removeLog, undoDelete, mergeLogs} from '../storage.js';
const log = {id:'a',date:'2026-10-12T01:00:00.000Z',energy:-1,tags:['회의'],context:'팀 회의',raw:'긴장',trigger:'',hypothesis:'',audio:'data:audio/mp4;base64,AAAA'};

test('버전 1 기록과 음성을 유지하며 DB를 업그레이드한다', async () => {
  const factory = new IDBFactory();
  const old = await new Promise((resolve,reject) => {
    const request = factory.open('bug-book',1);
    request.onupgradeneeded = () => request.result.createObjectStore('logs',{keyPath:'id'});
    request.onsuccess = () => resolve(request.result); request.onerror = reject;
  });
  await new Promise(resolve => {const tx = old.transaction('logs','readwrite');tx.objectStore('logs').add(log);tx.oncomplete=resolve;});
  old.close();
  const db = await openDatabase(factory);
  assert.equal(db.version,2);assert.deepEqual((await readAll(db)).logs,[log]);
  await writeDraft(db,{raw:'복원할 초안'});assert.deepEqual((await readAll(db)).draft,{raw:'복원할 초안'});db.close();
});

test('성공한 저장은 초안을 지우고, 실패한 저장은 초안과 원본을 유지한다', async () => {
  const db = await openDatabase(new IDBFactory());
  await writeDraft(db,{raw:'처음 초안'});await saveLog(db,log);
  assert.equal((await readAll(db)).draft,undefined);
  const draft={raw:'다음 초안',audio:log.audio};await writeDraft(db,draft);
  await assert.rejects(saveLog(db,{...log,raw:'중복 ID'}));
  const state = await readAll(db);assert.deepEqual(state.draft,draft);assert.deepEqual(state.logs,[log]);db.close();
});

test('수정 시 일시를 유지하며 원본이 없으면 초안을 보존한다',async()=>{
  const db=await openDatabase(new IDBFactory());await saveLog(db,log);await saveLog(db,{...log,hypothesis:'25분 회의'},true);
  assert.equal((await readAll(db)).logs[0].date,log.date);
  await removeLog(db,log.id);await writeDraft(db,{raw:'수정하던 관찰'});
  await assert.rejects(saveLog(db,log,true),/원본 기록/);
  assert.equal((await readAll(db)).draft.raw,'수정하던 관찰');db.close();
});

test('삭제 취소용 음성 기록은 재접속 후에도 복원된다',async()=>{
  const factory=new IDBFactory();let db=await openDatabase(factory);await saveLog(db,log);await removeLog(db,log.id);
  assert.equal((await readAll(db)).logs.length,0);db.close();db=await openDatabase(factory);
  assert.deepEqual((await readAll(db)).trash,log);await undoDelete(db);
  const state=await readAll(db);assert.deepEqual(state.logs,[log]);assert.equal(state.trash,undefined);db.close();
});

test('동시 백업 병합은 중복 ID를 덮어쓰지 않는다',async()=>{
  const db=await openDatabase(new IDBFactory());await saveLog(db,log);
  const b={...log,id:'b'},c={...log,id:'c'};
  const counts=await Promise.all([mergeLogs(db,[{...log,raw:'덮어쓰기 금지'},b]),mergeLogs(db,[b,c])]);
  assert.equal(counts.reduce((a,b)=>a+b,0),2);const state=await readAll(db);
  assert.equal(state.logs.length,3);assert.equal(state.logs.find(l=>l.id==='a').raw,log.raw);db.close();
});

test('중간 요청 실패 시 백업 병합 전체를 롤백한다',async()=>{
  const db=await openDatabase(new IDBFactory());await saveLog(db,log);
  await assert.rejects(mergeLogs(db,[{...log,id:'b'},{...log,id:'b'}]));
  assert.deepEqual((await readAll(db)).logs,[log]);db.close();
});
