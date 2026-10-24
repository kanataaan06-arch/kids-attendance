import fs from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,getDocs,collection,writeBatch,Timestamp} from 'firebase/firestore';
// Extract the actual browser helpers so these tests cannot drift into a second implementation.
const html=fs.readFileSync('kids_attendance_v2.html','utf8');
const helpers=html.slice(html.indexOf('// Public schedules expire'),html.indexOf('function watchParentSchedules()'))+html.slice(html.indexOf('async function loadAccessRole(){'),html.indexOf('function renderFuture'));
const generated=new URL('./.client-helpers.generated.mjs',import.meta.url);
fs.writeFileSync(generated,"import {doc,getDoc,setDoc,writeBatch,runTransaction,Timestamp,serverTimestamp,arrayUnion,arrayRemove} from 'firebase/firestore';\nlet db,profile,me; export function configure(client,who){db=client;profile=who;me={uid:who.id}}\n"+helpers+"\nexport {scheduleData,publishOwnAttendance,updateEventWithSchedule,syncPublicSchedule,syncPublicInstructor,loadAccessRole};\n");
const {configure,scheduleData,publishOwnAttendance,updateEventWithSchedule,syncPublicSchedule,syncPublicInstructor,loadAccessRole}=await import(generated.href);
const env=await initializeTestEnvironment({projectId:'demo-kids-attendance',firestore:{host:'127.0.0.1',port:8080,rules:fs.readFileSync('firestore.rules','utf8')}});await env.clearFirestore();
const admin=env.authenticatedContext('admin').firestore(),member=env.authenticatedContext('member').firestore(),parent=env.authenticatedContext('parent').firestore(),pending=env.authenticatedContext('pending').firestore();
const e={date:'2030-10-24',start:'12:00',end:'18:00',place:'Test venue',kind:'Test activity',allDay:false};let passed=0,failed=0;
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name)}catch(err){failed++;console.error('FAIL '+name,err.message)}}
function equal(a,b){if(a!==b)throw Error(JSON.stringify({a,b}))}
await env.withSecurityRulesDisabled(async ctx=>{const db=ctx.firestore();await Promise.all([setDoc(doc(db,'members/admin'),{role:'admin',name:'Admin'}),setDoc(doc(db,'members/member'),{role:'member',name:'Member'}),setDoc(doc(db,'members/parent'),{role:'parent',name:'Parent'}),setDoc(doc(db,'events/legacy'),e)])});
await test('admin bootstraps role metadata',async()=>{configure(admin,{id:'admin',name:'Admin',role:'admin'});equal(await loadAccessRole(),'admin')});
await test('parent bootstraps role without reading members',async()=>{configure(parent,{id:'parent',role:'parent'});equal(await loadAccessRole(),'parent')});
await test('unapproved person cannot bootstrap role',async()=>{configure(pending,{id:'pending'});equal(await loadAccessRole(),null)});
await test('admin migrates legacy schedule without changing event',async()=>{configure(admin,{id:'admin',name:'Admin',role:'admin'});await syncPublicSchedule({...e,id:'legacy'});const snap=await getDoc(doc(admin,'parentSchedules/legacy'));equal(snap.data().dateAt.toMillis(),new Date('2030-10-24T18:00:00+09:00').getTime())});
await test('member confirms atomically using actual client helper',async()=>{configure(member,{id:'member',name:'Member',role:'member'});await publishOwnAttendance('legacy','○');const p=await getDoc(doc(member,'parentSchedules/legacy'));equal(p.data().instructorIds.join(','),'member')});
await test('parent sees only published name and icon',async()=>{const snap=await getDoc(doc(parent,'parentSchedules/legacy/instructors/member'));equal(Object.keys(snap.data()).sort().join(','),'name,photoURL')});
await test('member cancels atomically using actual client helper',async()=>{configure(member,{id:'member',name:'Member',role:'member'});await publishOwnAttendance('legacy','×');const p=await getDoc(doc(member,'parentSchedules/legacy'));equal(p.data().instructorIds.length,0);equal((await getDoc(doc(member,'parentSchedules/legacy/instructors/member'))).exists(),false)});
await test('admin edits schedule and projection atomically',async()=>{configure(admin,{id:'admin',name:'Admin',role:'admin'});await updateEventWithSchedule('legacy',{end:'17:00',place:'Changed'});const p=await getDoc(doc(admin,'parentSchedules/legacy'));equal(p.data().place,'Changed');equal(p.data().dateAt.toMillis(),new Date('2030-10-24T17:00:00+09:00').getTime())});
await test('admin can edit all-day with next midnight expiry',async()=>{await updateEventWithSchedule('legacy',{allDay:true,start:'',end:''});const p=await getDoc(doc(admin,'parentSchedules/legacy'));equal(p.data().dateAt.toMillis(),new Date('2030-10-25T00:00:00+09:00').getTime())});
await test('admin synchronizes confirmed instructor manifest',async()=>{const b=writeBatch(admin);b.set(doc(admin,'events/legacy/answers/admin'),{value:'○',updatedAt:Timestamp.now()});await b.commit();await syncPublicInstructor({id:'legacy',answers:{admin:'○'}},{id:'admin',role:'admin',name:'Admin'});const p=await getDoc(doc(admin,'parentSchedules/legacy'));equal(p.data().instructorIds.join(','),'admin')});
await test('admin synchronization is safe to repeat',async()=>{await syncPublicInstructor({id:'legacy',answers:{admin:'○'}},{id:'admin',role:'admin',name:'Admin'});await syncPublicSchedule({...e,id:'legacy'})});
await test('parent cannot get all instructor documents as collection',()=>assertFails(getDocs(collection(parent,'parentSchedules/legacy/instructors'))));
await test('admin changes role and metadata atomically',async()=>{const b=writeBatch(admin);b.update(doc(admin,'members/member'),{role:'parent'});b.set(doc(admin,'accessStatus/member'),{role:'parent'});await b.commit();configure(member,{id:'member'});equal(await loadAccessRole(),'parent')});
await test('admin removes approval and status atomically',async()=>{const b=writeBatch(admin);b.delete(doc(admin,'members/member'));b.delete(doc(admin,'accessStatus/member'));await b.commit();equal(await loadAccessRole(),null)});
console.log(JSON.stringify({passed,failed}));await env.cleanup();process.exitCode=failed?1:0;
