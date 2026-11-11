import {createRemoteJWKSet, jwtVerify, SignJWT, importPKCS8} from 'jose';
const keys=createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
export async function identity(token,project){
  try {
    const {payload}=await jwtVerify(token,keys,{algorithms:['RS256'],issuer:`https://securetoken.google.com/${project}`,audience:project});
    if(!payload.sub || payload.sub.length>128)fail(401,'ログインを確認してください。');
    return payload.sub;
  } catch {fail(401,'ログインし直してください。')}
}
// Use the caller's ID token: existing Firestore rules remain authoritative.
export async function role(uid,token,env){
  const r=await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/members/${encodeURIComponent(uid)}`,{headers:{Authorization:`Bearer ${token}`}});
  if(!r.ok)fail(r.status===404||r.status===403?403:502,'メンバーの権限を確認できません。');
  return (await r.json()).fields?.role?.stringValue;
}
let cached;
async function accessToken(env){
  if(cached?.email===env.FCM_CLIENT_EMAIL && cached.expires>Date.now()+60000)return cached.token;
  const key=await importPKCS8(env.FCM_PRIVATE_KEY.replace(/\\n/g,'\n'),'RS256');
  const assertion=await new SignJWT({scope:'https://www.googleapis.com/auth/firebase.messaging'})
    .setProtectedHeader({alg:'RS256'}).setIssuer(env.FCM_CLIENT_EMAIL)
    .setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('1h').sign(key);
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
  const d=await r.json();if(!r.ok||!d.access_token)fail(502,'FCMの認証設定を確認してください。');
  cached={email:env.FCM_CLIENT_EMAIL,token:d.access_token,expires:Date.now()+d.expires_in*1000};return cached.token;
}
export function message(token){return {message:{token,data:{title:'キッズ出欠・通知テスト',body:'活動予定が追加・変更されました。出欠管理アプリをご確認ください。'},webpush:{headers:{Urgency:'normal',TTL:'300'},fcm_options:{link:'https://kanataaan06-arch.github.io/kids-attendance/compact_preview.html?notification-test=1'}}}}}
export async function handle(request,env,deps={identity,role,accessToken,fetch}){
  if(!env.TEST_PARENT_UID||!env.DB)fail(503,'Workerの保護者UID・D1設定が必要です。');
  const token=request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
  if(!token)fail(401,'ログインが必要です。');
  const uid=await deps.identity(token,env.FIREBASE_PROJECT_ID);
  const currentRole=await deps.role(uid,token,env);
  if(Number(request.headers.get('Content-Length'))>8192)fail(413,'データが大きすぎます。');
  const raw=await request.text();if(raw.length>8192)fail(413,'データが大きすぎます。');
  let body;try{body=JSON.parse(raw)}catch{fail(400,'リクエストが不正です。')}
  const path=new URL(request.url).pathname;
  if(path==='/register'){
    if(uid!==env.TEST_PARENT_UID||currentRole!=='parent')fail(403,'指定された保護者アカウントだけが登録できます。');
    if(typeof body.token!=='string'||body.token.length<20||body.token.length>4096)fail(400,'通知トークンが不正です。');
    // Keep each distinct device token; re-registering the same token is idempotent.
    await env.DB.prepare('INSERT INTO recipients(token,uid) VALUES(?,?) ON CONFLICT(token) DO UPDATE SET uid=excluded.uid').bind(body.token,uid).run();
    return {registered:true};
  }
  if(path!=='/send')fail(404,'見つかりません。');
  if(currentRole!=='admin')fail(403,'管理者だけが送信できます。');
  if(Object.keys(body).some(k=>k!=='requestId')||!/^[-a-zA-Z0-9]{16,80}$/.test(body.requestId||''))fail(400,'送信IDが不正です。');
  const {results:recipients}=await env.DB.prepare('SELECT token FROM recipients WHERE uid=?').bind(env.TEST_PARENT_UID).all();
  if(!recipients.length)fail(409,'夫のiPhone・Androidで通知を登録してください。');
  if(await deps.role(env.TEST_PARENT_UID,token,env)!=='parent')fail(403,'通知先が保護者ではないため送信を中止しました。');
  // Obtain credentials before reserving a send attempt. Never retry an ambiguous FCM result.
  const oauth=await deps.accessToken(env),now=Date.now();
  await env.DB.prepare('DELETE FROM deliveries WHERE created_at < ?').bind(now-86400000).run();
  const inserted=await env.DB.prepare('INSERT OR IGNORE INTO deliveries(id,created_at) VALUES(?,?)').bind(body.requestId,now).run();
  if(!inserted.meta.changes)return {sent:0,message:'この操作は受付済みです。再送しません。'};
  await env.DB.prepare('INSERT OR IGNORE INTO send_state(uid,last_attempt) VALUES(?,0)').bind(env.TEST_PARENT_UID).run();
  const locked=await env.DB.prepare('UPDATE send_state SET last_attempt=? WHERE uid=? AND last_attempt < ?').bind(now,env.TEST_PARENT_UID,now-60000).run();
  if(!locked.meta.changes)fail(429,'連続送信を防ぐため、1分待ってから操作してください。');
  let sent=0,failed=0;const diagnostics=[];
  // Sequential fan-out stays within Worker connection limits and isolates device failures.
  for(const recipient of recipients){
    try{
      const r=await deps.fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`,{method:'POST',headers:{Authorization:`Bearer ${oauth}`,'Content-Type':'application/json'},body:JSON.stringify(message(recipient.token))});
      if(r.ok){await r.text();sent++;continue}
      failed++;
      const error=await r.json().catch(()=>({}));
      const code=error.error?.details?.map(d=>d.errorCode).find(Boolean)||error.error?.status||'UNKNOWN';
      diagnostics.push(String(r.status)+'/'+String(code).slice(0,60));
      if(error.error?.details?.some(d=>d.errorCode==='UNREGISTERED'))await env.DB.prepare('DELETE FROM recipients WHERE uid=? AND token=?').bind(env.TEST_PARENT_UID,recipient.token).run();
    }catch(e){failed++;const reason=String(e?.message||e?.name||'unknown').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,120);diagnostics.push('NETWORK_ERROR/'+reason)} // Ambiguous delivery is never automatically retried.
  }
  return {sent,failed,registered:recipients.length,message:sent?'':'FCM送信に失敗しました。診断コード：'+[...new Set(diagnostics)].join(', ')};
}
export default {async fetch(request,env){
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
  if(request.headers.get('Origin')!==env.ALLOWED_ORIGIN)return new Response(JSON.stringify({message:'許可されていないアクセスです。'}),{status:403,headers});
  Object.assign(headers,{'Access-Control-Allow-Origin':env.ALLOWED_ORIGIN,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return new Response(JSON.stringify({message:'POSTが必要です。'}),{status:405,headers});
  try{return new Response(JSON.stringify(await handle(request,env)),{headers})}
  catch(e){return new Response(JSON.stringify({message:e.status?e.message:'処理結果を確認できません。各端末の受信状況を確認してください。'}),{status:e.status||502,headers})}
}};
