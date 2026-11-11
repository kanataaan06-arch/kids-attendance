'use strict';
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const {getMessaging}=require('firebase-admin/messaging');
initializeApp();
const db=getFirestore();
async function requireRole(request,expected){
  const uid=request.auth?.uid;
  if(!uid)throw new HttpsError('unauthenticated','ログインが必要です。');
  const snap=await db.doc('members/'+uid).get();
  if(!snap.exists||snap.data().role!==expected)throw new HttpsError('permission-denied','この操作の権限がありません。');
  return uid;
}
// Parent-only test registration. Never expose tokens through Firestore client rules.
exports.registerParentPushTestToken=onCall({region:'us-central1',maxInstances:2},async request=>{
  const uid=await requireRole(request,'parent');
  const token=request.data?.token;
  if(typeof token!=='string'||token.length<20||token.length>4096)throw new HttpsError('invalid-argument','通知トークンが不正です。');
  await db.doc('pushTestTokens/'+uid).set({token,updatedAt:FieldValue.serverTimestamp()});
  return {registered:true};
});
exports.sendParentPushTestNotification=onCall({region:'us-central1',maxInstances:2},async request=>{
  await requireRole(request,'admin');
  const parents=await db.collection('members').where('role','==','parent').get();
  const recipients=await Promise.all(parents.docs.map(async parent=>{
    const record=await db.doc('pushTestTokens/'+parent.id).get();
    return record.exists?{uid:parent.id,token:record.data().token}:null;
  }));
  const valid=recipients.filter(x=>x&&typeof x.token==='string'&&x.token.length>=20);
  if(!valid.length)return {sent:0,failed:0,registered:0,message:'通知を許可した保護者がまだいません。'};
  const message={
    tokens:valid.map(x=>x.token),
    data:{title:'キッズ出欠・通知テスト',body:'活動予定が追加・変更されました。出欠管理アプリをご確認ください。'},
    webpush:{headers:{Urgency:'normal'},fcmOptions:{link:'https://kanataaan06-arch.github.io/kids-attendance/compact_preview.html?notification-test=1'}}
  };
  const response=await getMessaging().sendEachForMulticast(message);
  await Promise.all(response.responses.map(async(r,i)=>{
    if(!r.success&&['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(r.error?.code)){
      await db.doc('pushTestTokens/'+valid[i].uid).delete();
    }
  }));
  return {sent:response.successCount,failed:response.failureCount,registered:valid.length};
});
