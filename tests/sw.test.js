import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../sw.js',import.meta.url),'utf8');
function harness(scope='https://example.github.io/bug-book/') {
  const handlers={},deleted=[],matches=[],network=[],assets=[];
  const current=`bug-book-shell:${scope}:v3`;
  const cache={addAll:async requests=>assets.push(...requests),match:async url=>{matches.push(String(url));return {cached:String(url)}}};
  const caches={open:async()=>cache,keys:async()=>[current,`bug-book-shell:${scope}:v1`,'bug-book-shell:https://example.github.io/other/:v1','unrelated'],delete:async name=>deleted.push(name)};
  const self={registration:{scope},location:{origin:'https://example.github.io'},clients:{claim:async()=>{}},addEventListener:(name,handler)=>{handlers[name]=handler}};
  vm.runInNewContext(source,{self,caches,URL,Request,fetch:async req=>{network.push(req);return {network:true}}});
  return {handlers,deleted,matches,network,assets};
}
async function lifecycle(handler){let pending;handler({waitUntil:promise=>{pending=promise}});await pending;}
async function request(h,url,mode='navigate',method='GET'){let result;h.handlers.fetch({request:{url,mode,method},respondWith:promise=>{result=promise}});return result;}

test('모든 앱 파일을 캐시에 저장하고 HTTP 캐시를 우회한다',async()=>{const h=harness();await lifecycle(h.handlers.install);assert.equal(h.assets.length,8);assert.ok(h.assets.some(r=>r.url.endsWith('/storage.js')));assert.ok(h.assets.every(r=>r.cache==='reload'))});
test('업데이트 시 다른 Pages 프로젝트 캐시를 삭제하지 않는다',async()=>{const h=harness();await lifecycle(h.handlers.activate);assert.deepEqual(h.deleted,['bug-book-shell:https://example.github.io/bug-book/:v1'])});
test('온라인과 오프라인 모두 같은 캐시의 HTML과 스크립트를 제공한다',async()=>{const h=harness();assert.deepEqual(await request(h,'https://example.github.io/bug-book/?launch=home'),{cached:'https://example.github.io/bug-book/index.html'});assert.deepEqual(await request(h,'https://example.github.io/bug-book/app.js?v=2','cors'),{cached:'https://example.github.io/bug-book/app.js'});assert.equal(h.network.length,0)});
test('다른 사이트와 미등록 파일 및 POST를 가로채지 않는다',async()=>{const h=harness();for(const [url,mode,method] of [['https://example.github.io/other/','navigate','GET'],['https://example.github.io/bug-book/README.md','navigate','GET'],['https://other.example/bug-book/','navigate','GET'],['https://example.github.io/bug-book/','navigate','POST']])assert.equal(await request(h,url,mode,method),undefined);assert.equal(h.matches.length,0)});
