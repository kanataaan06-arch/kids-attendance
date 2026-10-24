import fs from 'node:fs';
import {initializeTestEnvironment, assertSucceeds, assertFails} from '@firebase/rules-unit-testing';
import {doc,collection,getDoc,getDocs,setDoc,updateDoc,deleteDoc,writeBatch,query,where,Timestamp} from 'firebase/firestore';
const env=await initializeTestEnvironment({projectId:'demo-kids-attendance',firestore:{host:'127.0.0.1',port:8080,rules:fs.readFileSync('firestore.rules','utf8')}});
let passed=0,failed=0;
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name)}catch(e){failed++;console.error('FAIL '+name, e.message)}}
const dbs=Object.fromEntries(['admin','member','other','parent','pending'].map(uid=>[uid,env.authenticatedContext(uid).firestore()]));
dbs.anon=env.unauthenticatedContext().firestore();
const event={date:'2030-10-24',start:'12:00',end:'18:00',place:'Test venue',kind:'Test activity',allDay:false};
const future={...event,dateAt:Timestamp.fromDate(new Date('2030-10-24T18:00:00+09:00')),instructorIds:['member']};
const past={...event,date:'2020-01-01',dateAt:Timestamp.fromDate(new Date('2020-01-01T18:00:00+09:00')),instructorIds:['member']};
await env.withSecurityRulesDisabled(async ctx=>{let db=ctx.firestore(); const data={
'members/admin':{role:'admin',name:'Admin'},'members/member':{role:'member',name:'Member'},'members/other':{role:'member',name:'Other'},'members/parent':{role:'parent',name:'Parent',private:'private member field'},
'userProfiles/parent':{name:'Private profile'},
'events/future':event,'events/past':{...event,date:'2020-01-01'},'parentSchedules/future':future,'parentSchedules/past':past,
'events/future/answers/member':{value:'○',updatedAt:Timestamp.now()},'events/past/answers/member':{value:'○',updatedAt:Timestamp.now()},
'parentSchedules/future/instructors/member':{name:'Member',photoURL:''},'parentSchedules/past/instructors/member':{name:'Member',photoURL:''},
'accessStatus/parent':{role:'parent'}
};await Promise.all(Object.entries(data).map(([p,d])=>setDoc(doc(db,p),d)))});
for(const who of ['anon','pending','parent']){
 for(const path of ['events/future','events/past','events/future/answers/member','members/member','members/parent'])await test(who+' cannot get '+path,()=>assertFails(getDoc(doc(dbs[who],path))));
 await test(who+' cannot list events',()=>assertFails(getDocs(collection(dbs[who],'events'))));
 await test(who+' cannot write answer',()=>assertFails(setDoc(doc(dbs[who],'events/future/answers/'+who),{value:'○',updatedAt:Timestamp.now()})));
}
for(const who of ['anon','pending'])await test(who+' cannot read public schedule',()=>assertFails(getDoc(doc(dbs[who],'parentSchedules/future'))));
await test('parent cannot get own profile',()=>assertFails(getDoc(doc(dbs.parent,'userProfiles/parent'))));
await test('parent can get own role only',()=>assertSucceeds(getDoc(doc(dbs.parent,'accessStatus/parent'))));
await test('parent cannot list roles',()=>assertFails(getDocs(collection(dbs.parent,'accessStatus'))));
await test('parent cannot promote own role',()=>assertFails(setDoc(doc(dbs.parent,'accessStatus/parent'),{role:'admin'})));
await test('member can bootstrap true role',()=>assertSucceeds(setDoc(doc(dbs.member,'accessStatus/member'),{role:'member'})));
await test('parent can read future schedule',()=>assertSucceeds(getDoc(doc(dbs.parent,'parentSchedules/future'))));
await test('parent cannot read past schedule',()=>assertFails(getDoc(doc(dbs.parent,'parentSchedules/past'))));
await test('parent can query future schedules',()=>assertSucceeds(getDocs(query(collection(dbs.parent,'parentSchedules'),where('dateAt','>=',Timestamp.fromMillis(Date.now()+60000))))));
await test('parent cannot query unbounded schedules',()=>assertFails(getDocs(collection(dbs.parent,'parentSchedules'))));
await test('parent can get confirmed name/icon',()=>assertSucceeds(getDoc(doc(dbs.parent,'parentSchedules/future/instructors/member'))));
await test('parent cannot list instructor directory',()=>assertFails(getDocs(collection(dbs.parent,'parentSchedules/future/instructors'))));
await test('parent cannot get past instructor',()=>assertFails(getDoc(doc(dbs.parent,'parentSchedules/past/instructors/member'))));
for(const who of ['admin','member']){
 await test(who+' can get private event',()=>assertSucceeds(getDoc(doc(dbs[who],'events/future'))));
 await test(who+' can list members',()=>assertSucceeds(getDocs(collection(dbs[who],'members'))));
 if(who==='admin')await test('admin cannot update another answer',()=>assertFails(updateDoc(doc(dbs.admin,'events/future/answers/member'),{value:'×'})));
}
// Admin above intentionally targets member, member own answer is tested separately below.
await test('member cannot change other answer',()=>assertFails(setDoc(doc(dbs.member,'events/future/answers/other'),{value:'○',updatedAt:Timestamp.now()})));
await test('member cannot self-promote',()=>assertFails(updateDoc(doc(dbs.member,'members/member'),{role:'admin'})));
await test('member cannot add member',()=>assertFails(setDoc(doc(dbs.member,'members/new'),{role:'member',name:'New'})));
await test('member can change own answer',()=>assertSucceeds(updateDoc(doc(dbs.member,'events/future/answers/member'),{value:'×'})));
await test('parent cannot read stale confirmed snapshot',()=>assertFails(getDoc(doc(dbs.parent,'parentSchedules/future/instructors/member'))));
await test('member cannot publish unconfirmed name/icon',()=>assertFails(setDoc(doc(dbs.member,'parentSchedules/future/instructors/member'),{name:'Member',photoURL:''})));
await test('atomic confirm and publication works',async()=>{const b=writeBatch(dbs.member);b.set(doc(dbs.member,'events/future/answers/member'),{value:'○',updatedAt:Timestamp.now()});b.set(doc(dbs.member,'parentSchedules/future/instructors/member'),{name:'Member',photoURL:''});await assertSucceeds(b.commit())});
await test('cannot publish tracking URL',()=>assertFails(setDoc(doc(dbs.member,'parentSchedules/future/instructors/member'),{name:'Member',photoURL:'https://example.com/tracker'})));
await test('cannot publish extra private field',()=>assertFails(setDoc(doc(dbs.member,'parentSchedules/future/instructors/member'),{name:'Member',photoURL:'',email:'private'})));
await test('cannot publish fake name',()=>assertFails(setDoc(doc(dbs.member,'parentSchedules/future/instructors/member'),{name:'Other',photoURL:''})));
await test('cannot edit schedule without matching projection',()=>assertFails(updateDoc(doc(dbs.admin,'events/future'),{date:'2020-01-01'})));
await test('cannot delete event leaving projection',()=>assertFails(deleteDoc(doc(dbs.admin,'events/future'))));
await test('cannot extend public date arbitrarily',()=>assertFails(updateDoc(doc(dbs.admin,'parentSchedules/future'),{dateAt:Timestamp.fromDate(new Date('2031-01-01'))})));
await test('member cannot change event',()=>assertFails(updateDoc(doc(dbs.member,'events/future'),{kind:'Changed'})));
await test('member can create matching event and projection',async()=>{const b=writeBatch(dbs.member);b.set(doc(dbs.member,'events/new'),event);b.set(doc(dbs.member,'parentSchedules/new'),{...future,instructorIds:[]});await assertSucceeds(b.commit())});
await test('member cannot create private event alone',()=>assertFails(setDoc(doc(dbs.member,'events/noProjection'),event)));
await test('member cannot add someone else to manifest',()=>assertFails(updateDoc(doc(dbs.member,'parentSchedules/future'),{instructorIds:['member','other']})));
await test('member can update own manifest',()=>assertSucceeds(updateDoc(doc(dbs.member,'parentSchedules/future'),{instructorIds:['member']})));
await test('admin can update event and projection atomically',async()=>{const b=writeBatch(dbs.admin);b.update(doc(dbs.admin,'events/future'),{kind:'Changed'});b.update(doc(dbs.admin,'parentSchedules/future'),{kind:'Changed'});await assertSucceeds(b.commit())});
await test('admin can revoke instructor',()=>assertSucceeds(updateDoc(doc(dbs.admin,'members/member'),{role:'parent'})));
await test('parent cannot read revoked instructor snapshot',()=>assertFails(getDoc(doc(dbs.parent,'parentSchedules/future/instructors/member'))));
await test('stale status fails closed after role change',()=>assertFails(getDoc(doc(dbs.member,'accessStatus/member'))));
await test('revoked instructor can refresh only true role',()=>assertSucceeds(setDoc(doc(dbs.member,'accessStatus/member'),{role:'parent'})));
await test('all-day expires at next JST midnight',async()=>{const b=writeBatch(dbs.admin);const e={...event,allDay:true,start:'',end:''};b.set(doc(dbs.admin,'events/allDay'),e);b.set(doc(dbs.admin,'parentSchedules/allDay'),{...e,dateAt:Timestamp.fromDate(new Date('2030-10-25T00:00:00+09:00')),instructorIds:[]});await assertSucceeds(b.commit())});
await test('atomic event and projection deletion works',async()=>{const b=writeBatch(dbs.admin);b.delete(doc(dbs.admin,'events/new'));b.delete(doc(dbs.admin,'parentSchedules/new'));await assertSucceeds(b.commit())});
console.log(JSON.stringify({passed,failed}));await env.cleanup();process.exitCode=failed?1:0;
