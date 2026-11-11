import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{handle,message,identity} from './index.js';
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 const DB={prepare(query){let args=[];return {bind(...values){args=values;return this},async run(){return {meta:sql.prepare(query).run(...args)}},async first(){return sql.prepare(query).get(...args)},async all(){return {results:sql.prepare(query).all(...args)}}}}};
 const env={DB,TEST_PARENT_UID:'husband',FIREBASE_PROJECT_ID:'demo',ALLOWED_ORIGIN:'https://example.com'};
 let calls=[];const roles={admin:'admin',husband:'parent',teacher:'member',other:'parent'};
 const deps={identity:async token=>token,role:async uid=>roles[uid],accessToken:async()=> 'oauth',fetch:async(url,init)=>{calls.push(JSON.parse(init.body));return Response.json({name:'ok'})}};
 const run=(uid,path,body)=>handle(new Request('https://worker.test'+path,{method:'POST',headers:{Authorization:'Bearer '+uid},body:JSON.stringify(body)}),env,deps);
 return {env,deps,run,calls,roles,sql};
}
test('registration is restricted to the designated parent and keeps distinct phones without duplicating re-registration',async()=>{
 const x=setup();for(const uid of ['teacher','other','admin'])await assert.rejects(x.run(uid,'/register',{token:'x'.repeat(30)}),e=>e.status===403);
 await x.run('husband','/register',{token:'x'.repeat(30)});await x.run('husband','/register',{token:'y'.repeat(30)});
 await x.run('husband','/register',{token:'y'.repeat(30)});
 assert.equal(x.sql.prepare('SELECT count(*) n FROM recipients').get().n,2);
});
test('20 simultaneous requests send once per registered device, excluding other accounts',async()=>{
 const x=setup();await x.run('husband','/register',{token:'x'.repeat(30)});
 await x.run('husband','/register',{token:'y'.repeat(30)});
 x.sql.prepare('INSERT INTO recipients(token,uid) VALUES(?,?)').run('teacher-token','teacher');
 x.sql.prepare('INSERT INTO recipients(token,uid) VALUES(?,?)').run('other-token','other');
 const results=await Promise.allSettled(Array.from({length:20},(_,i)=>x.run('admin','/send',{requestId:'request-identifier-'+i})));
 assert.equal(x.calls.length,2);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.deepEqual(x.calls.map(m=>m.message.token).sort(),['x'.repeat(30),'y'.repeat(30)]);
 assert.deepEqual(x.calls[0],message('x'.repeat(30)));assert.equal(x.calls[0].message.notification,undefined);
});
test('same ID cannot send again, even after cooldown',async()=>{
 const x=setup();await x.run('husband','/register',{token:'x'.repeat(30)});const body={requestId:'same-request-identifier'};
 await x.run('admin','/send',body);x.sql.exec('UPDATE send_state SET last_attempt=0');assert.equal((await x.run('admin','/send',body)).sent,0);assert.equal(x.calls.length,1);
});
test('role revocation and caller supplied targets fail closed',async()=>{
 const x=setup();await x.run('husband','/register',{token:'x'.repeat(30)});
 await assert.rejects(x.run('teacher','/send',{requestId:'request-identifier'}),e=>e.status===403);
 await assert.rejects(x.run('admin','/send',{requestId:'request-identifier',target:'teacher'}),e=>e.status===400);
 x.roles.husband='member';await assert.rejects(x.run('admin','/send',{requestId:'request-identifier'}),e=>e.status===403);assert.equal(x.calls.length,0);
});
test('ambiguous network failure is not retried',async()=>{
 const x=setup();await x.run('husband','/register',{token:'x'.repeat(30)});x.deps.fetch=async()=>{throw new Error('timeout')};const body={requestId:'request-identifier'};
 assert.equal((await x.run('admin','/send',body)).failed,1);x.sql.exec('UPDATE send_state SET last_attempt=0');assert.equal((await x.run('admin','/send',body)).sent,0);
});
test('invalid JWT, origin, method and missing credentials are rejected',async()=>{
 await assert.rejects(identity('invalid','demo'),e=>e.status===401);
 const x=setup();assert.equal((await worker.fetch(new Request('https://worker.test/send'),x.env)).status,403);
 assert.equal((await worker.fetch(new Request('https://worker.test/send',{headers:{Origin:x.env.ALLOWED_ORIGIN}}),x.env)).status,405);
 await assert.rejects(handle(new Request('https://worker.test/send'),x.env,x.deps),e=>e.status===401);
});

test('one failed or expired device does not prevent delivery to the other phone',async()=>{
 const x=setup();for(const c of ['x','y'])await x.run('husband','/register',{token:c.repeat(30)});
 x.deps.fetch=async(url,init)=>{
  const token=JSON.parse(init.body).message.token;x.calls.push(token);
  return token.startsWith('x')?Response.json({error:{details:[{errorCode:'UNREGISTERED'}]}},{status:404}):Response.json({name:'ok'});
 };
 const result=await x.run('admin','/send',{requestId:'request-identifier'});
 assert.equal(result.sent,1);assert.equal(result.failed,1);assert.equal(x.calls.length,2);
 assert.deepEqual(x.sql.prepare('SELECT token FROM recipients').all().map(r=>r.token),['y'.repeat(30)]);
});
test('schema upgrade preserves legacy registration and cooldown and is repeatable',()=>{
 const sql=new DatabaseSync(':memory:');sql.exec("CREATE TABLE recipient(id INTEGER PRIMARY KEY,uid TEXT,token TEXT,last_attempt INTEGER); INSERT INTO recipient VALUES(1,'husband','legacy-token',12345)");
 const schema=readFileSync(new URL('../schema.sql',import.meta.url),'utf8');sql.exec(schema);sql.exec(schema);
 assert.equal(sql.prepare('SELECT count(*) n FROM recipients').get().n,1);
 assert.equal(sql.prepare('SELECT token FROM recipients').get().token,'legacy-token');
 assert.equal(sql.prepare('SELECT last_attempt FROM send_state').get().last_attempt,12345);
 assert.equal(sql.prepare('SELECT count(*) n FROM recipient').get().n,0);
});
