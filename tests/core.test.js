import test from 'node:test';import assert from 'node:assert/strict';import {inPeriod,rankings,validateBackup,emotional,summarize} from '../core.js';
const log={id:'a',date:'2026-10-12T01:00:00.000Z',energy:-1,tags:['회의'],context:'팀 회의',raw:'어깨가 굳었다. 집중이 떨어졌다.',trigger:'',hypothesis:'',audio:null};
test('기간과 미래 기록 제외',()=>assert.equal(inPeriod([log,{...log,date:'2026-09-01T00:00:00Z'},{...log,date:'2026-10-13T00:00:00Z'}],7,new Date('2026-10-12T12:00:00Z')).length,1));
test('충전과 방전 별도 집계',()=>assert.deepEqual(rankings([log,{...log,energy:1,tags:['집중 작업']},{...log,id:'b'}],-1),[['회의',2]]));
test('백업 검증과 잘못된 음성 거부',()=>{assert.deepEqual(validateBackup({format:'bug-book',version:1,logs:[log]}),[log]);for(const bad of [{...log,energy:9},{...log,audio:'data:text/html;base64,AAAA'},{...log,tags:['x'.repeat(31)]}])assert.throws(()=>validateBackup({format:'bug-book',version:1,logs:[bad]}));assert.throws(()=>validateBackup({format:'bug-book',version:1,logs:[log,log]}))});
test('관찰자 규칙과 첫 문장 요약',()=>{assert.equal(emotional('너무 짜증 난다'),true);assert.equal(emotional('회의 40분 후 집중이 끊겼다'),false);assert.equal(summarize(log.raw),'어깨가 굳었다.')});

import {hasDraft, filterLogs, daySummary} from '../core.js';
test('중복 태그는 한 관찰당 한 번만 집계',()=>assert.deepEqual(rankings([{...log,tags:['회의','회의']}],-1),[['회의',1]]));
test('태그와 가설 검색, 에너지 필터 조합',()=>{assert.equal(filterLogs([log],' 회의 ',-1).length,1);assert.equal(filterLogs([log],'회의',1).length,0);assert.equal(filterLogs([{...log,hypothesis:'시간 제한 실험'}],'실험').length,1)});
test('기록 없는 날과 서로 상쇄된 날 구분',()=>{assert.deepEqual(daySummary([],new Date(log.date)),{count:0,average:null});assert.deepEqual(daySummary([log,{...log,energy:1}],new Date(log.date)),{count:2,average:0})});
test('평온 선택과 음성만 있는 초안도 복구 대상',()=>{const d={energy:null,tags:[],context:'',raw:'',trigger:'',hypothesis:'',audio:null};assert.equal(Boolean(hasDraft(d)),false);assert.equal(Boolean(hasDraft({...d,energy:0})),true);assert.equal(Boolean(hasDraft({...d,audio:'data:audio/mp4;base64,AAAA'})),true)});
test('백업 날짜, 빈 태그, 잘못된 base64 검증',()=>{for(const bad of [{...log,date:123},{...log,date:'2026-02-30T01:00:00.000Z'},{...log,tags:['  ']},{...log,tags:[]},{...log,audio:'data:audio/mp4;base64,A'}])assert.throws(()=>validateBackup({format:'bug-book',version:1,logs:[bad]}));assert.equal(validateBackup({format:'bug-book',version:1,logs:[{...log,audio:'data:audio/webm;codecs=opus;base64,AAAA'}]})[0].audio,'data:audio/webm;codecs=opus;base64,AAAA')});

test('7일 범위는 현지 자정부터 6일 전까지 포함한다',()=>{const now=new Date(2026,9,12,15,0);const start=new Date(2026,9,6,0,0);const list=[{...log,id:'start',date:start.toISOString()},{...log,id:'outside',date:new Date(start.getTime()-1).toISOString()},{...log,id:'now',date:now.toISOString()}];assert.deepEqual(inPeriod(list,7,now).map(l=>l.id),['start','now'])});
