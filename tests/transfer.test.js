import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {validateBackup, BACKUP_LIMIT} from '../core.js';
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const flow = app.slice(app.indexOf("$('#transfer-guide').onclick"), app.indexOf('\nlet installPrompt;'));
const log = {id:'a', date:'2026-10-12T01:00:00.000Z', energy:0, tags:['회의'], context:'', raw:'관찰', trigger:'', hypothesis:'', audio:null};
function harness(current = []) {
  const elements = new Map(); let writes = 0;
  const $ = key => { if (!elements.has(key)) elements.set(key, {hidden:true, disabled:false, value:'', textContent:'', focus(){}}); return elements.get(key); };
  const context = vm.createContext({$, db:{}, pendingImport:null, importBusy:false, validateBackup, BACKUP_LIMIT,
    readAll:async()=>({logs:current}), mergeLogs:async(_, records)=>{writes++;return records.filter(r=>!current.some(c=>c.id===r.id)).length;},
    refresh:async()=>{}, renderTags(){}, broadcast(){}, toast(){}, view(){}});
  vm.runInContext(flow, context);
  return {$, writes:()=>writes, select: data => $('#import').onchange({target:{files:[{name:'backup.json',size:100,text:async()=>JSON.stringify(data)}]}})};
}
test('파일 선택은 미리보기만 표시하고 확인 후 중복을 유지하며 가져온다',async()=>{
  const h=harness([log]);
  await h.select({format:'bug-book',version:1,logs:[log,{...log,id:'b',audio:'data:audio/mp4;base64,AAAA'}]});
  assert.equal(h.writes(),0);assert.equal(h.$('#import-preview').hidden,false);
  assert.match(h.$('#import-summary').textContent,/음성 포함 1개 · 새로 추가할 기록 1개 · 중복 1개/);
  await h.$('#confirm-import').onclick();assert.equal(h.writes(),1);
  assert.match(h.$('#transfer-result').textContent,/1개 추가 · 1개 중복 유지/);
  assert.equal(h.$('#import-preview').hidden,true);
});
test('취소와 잘못된 파일은 저장하지 않고 이전 미리보기를 지운다',async()=>{
  const h=harness();await h.select({format:'bug-book',version:1,logs:[log]});
  h.$('#cancel-import').onclick();await h.$('#confirm-import').onclick();assert.equal(h.writes(),0);
  await h.select({format:'bug-book',version:1,logs:[log]});await h.select({format:'wrong'});
  assert.equal(h.$('#import-preview').hidden,true);await h.$('#confirm-import').onclick();assert.equal(h.writes(),0);
  assert.match(h.$('#transfer-result').textContent,/백업 형식/);
});
test('빈 백업은 가져오기 버튼을 비활성화한다',async()=>{
  const h=harness();await h.select({format:'bug-book',version:1,logs:[]});assert.equal(h.$('#confirm-import').disabled,true);assert.equal(h.writes(),0);
});
