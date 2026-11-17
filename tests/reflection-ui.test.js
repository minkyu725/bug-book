import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {initReflections} from '../reflection-ui.js';
import {openDatabase, transaction, readAll, readReflectionDrafts} from '../storage.js';

// Exercise the actual controller and IndexedDB with a controlled clock and a small DOM adapter.
test('미리 답하기, 05:30 경계, 재실행 초안 복구와 이전 초안 이어쓰기를 보장한다', async () => {
  const OriginalDate = Date, originalInterval = setInterval;
  let now = '2026-11-18T01:00:00Z';
  globalThis.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : [now])); } static now(){return OriginalDate.parse(now);} };
  globalThis.setInterval = () => 0;
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  const db = await openDatabase(new IDBFactory());
  function screen() {
    const nodes = new Map(), events = new Map();
    const $ = key => { if (!nodes.has(key)) nodes.set(key,{value:'',hidden:true,textContent:'',innerHTML:'',focus(){},reset(){}}); return nodes.get(key); };
    const buttons = ['morning','evening'].map(slot=>({dataset:{slot},classList:{toggle(){}},setAttribute(){}}));
    globalThis.document = {querySelector:$,querySelectorAll:selector=>selector==='[data-slot]'?buttons:[],activeElement:null,visibilityState:'visible',addEventListener:(name,fn)=>events.set(name,fn)};
    globalThis.window = {addEventListener:(name,fn)=>events.set(name,fn)};
    const controller = initReflections({getDB:()=>db,onChange(){},onOpen(){},toast(){}});
    return {$,buttons,controller,events};
  }
  const type = (h,text) => { h.$('#reflection-answer').value=text; h.$('#reflection-answer').oninput(); };
  const flush = async h => { h.events.get('pagehide')(); await new Promise(resolve=>setTimeout(resolve,20)); };
  try {
    // Recover legacy string drafts from previous releases as well as new object drafts.
    await transaction(db,['meta'],'readwrite',tx=>tx.objectStore('meta').put('이전 버전의 초안','reflection-draft:2026-11-16:morning'));
    let h=screen(); await h.controller.start();
    assert.equal(h.$('#reflection-answer').value,'이전 버전의 초안');
    await h.$('#reflection-show-current').onclick();
    assert.match(h.$('#reflection-date').textContent,/2026-11-18/);
    await h.buttons[1].onclick();
    assert.equal(h.$('#reflection-form').hidden,false,'오전에도 오후 답변을 미리 작성 가능');
    type(h,'미리 쓴 오후 답변');
    await h.$('#reflection-form').onsubmit({preventDefault(){}});
    assert.equal((await readAll(db)).logs[0].reflection.slot,'evening');
    assert.ok(!(await readReflectionDrafts(db)).some(d=>d.day==='2026-11-18'&&d.slot==='evening'));
    await h.buttons[0].onclick();
    type(h,'저장하지 않은 오전 답변'); await flush(h);
    const originalQuestion=h.$('#reflection-question').textContent;
    now='2026-11-18T09:00:00Z'; await h.controller.refresh();
    assert.equal(h.$('#reflection-answer').value,'저장하지 않은 오전 답변');
    h=screen(); await h.controller.start();
    assert.equal(h.$('#reflection-answer').value,'저장하지 않은 오전 답변','다른 시간대에 다시 열어도 초안 복구');
    now='2026-11-18T20:30:00Z'; await h.controller.refresh();
    assert.equal(h.$('#reflection-answer').value,'저장하지 않은 오전 답변');
    assert.equal(h.$('#reflection-new-day').hidden,false);
    h=screen(); await h.controller.start();
    assert.equal(h.$('#reflection-answer').value,'저장하지 않은 오전 답변','다음 날에도 초안 복구');
    assert.equal(h.$('#reflection-question').textContent,originalQuestion);
    assert.match(h.$('#reflection-drafts').innerHTML,/2026-11-16/,'이전 버전 초안도 목록에 보임');
    await h.$('#reflection-show-current').onclick();
    assert.match(h.$('#reflection-date').textContent,/2026-11-19/);
    assert.equal(h.$('#reflection-answer').value,'');
    await h.$('#reflection-drafts').onclick({target:{closest:()=>({dataset:{resumeDraft:'2026-11-18:morning'}})}});
    assert.equal(h.$('#reflection-answer').value,'저장하지 않은 오전 답변');
    await h.$('#reflection-form').onsubmit({preventDefault(){}});
    assert.equal((await readAll(db)).logs.find(log=>log.reflection.slot==='morning').reflection.day,'2026-11-18');
    assert.ok(!(await readReflectionDrafts(db)).some(d=>d.day==='2026-11-18'));
    await h.buttons[1].onclick();
    now='2026-11-19T20:30:00Z'; await h.controller.refresh();
    assert.match(h.$('#reflection-date').textContent,/2026-11-20/,'미리보기로 수동 선택했어도 다음 05:30에는 갱신');
    assert.equal(h.$('#reflection-answer').value,'');
  } finally {
    db.close(); globalThis.Date=OriginalDate; globalThis.setInterval=originalInterval;
    globalThis.document=previousDocument;globalThis.window=previousWindow;
  }
});
