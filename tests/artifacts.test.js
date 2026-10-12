import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const html=await readFile(new URL('index.html',root),'utf8');
const app=await readFile(new URL('app.js',root),'utf8');
const sw=await readFile(new URL('sw.js',root),'utf8');

test('페이지 참조와 설치용 아이콘이 실제 파일에 연결된다',async()=>{
 const paths=[...html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g)].map(m=>m[1]);
 const manifest=JSON.parse(await readFile(new URL('manifest.webmanifest',root),'utf8'));
 for(const path of [...paths,...manifest.icons.map(icon=>icon.src)])await access(new URL(path,root));
 assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');
});
test('HTML ID가 중복되지 않고 앱의 고정 선택자가 연결된다',()=>{
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
 for(const [,id]of app.matchAll(/\$\('#([a-z-]+)'\)/g))assert.ok(ids.includes(id),id);
 assert.match(html,/id="quick-save" type="submit"/);
});
test('모듈 의존 파일이 오프라인과 Pages 배포에 모두 포함된다',async()=>{
 const workflow=await readFile(new URL('.github/workflows/pages.yml',root),'utf8');
 const modules=[...app.matchAll(/from '\.\/([^']+)'/g)].map(m=>m[1]);
 for(const module of modules){assert.ok(sw.includes('./'+module));assert.ok(workflow.includes(module));await access(new URL(module,root))}
 assert.ok(workflow.indexOf('npm ci')<workflow.indexOf('npm run check'));
});
