/* Staff notification preview service worker. */
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey:'AIzaSyCbE1BqIxMGke2vT4FcyZKWLqQX6YmzEsU',
  authDomain:'kids-attendance-b89d4.firebaseapp.com',
  projectId:'kids-attendance-b89d4',
  storageBucket:'kids-attendance-b89d4.firebasestorage.app',
  messagingSenderId:'408668881637',
  appId:'1:408668881637:web:63464582c7bd720949ca0c'
});
self.addEventListener('install',()=>self.skipWaiting());
// Keep the badge operation alive for the full push event (iOS Home Screen apps).
self.addEventListener('push',event=>{
  if(typeof self.navigator.setAppBadge==='function'){
    event.waitUntil(self.navigator.setAppBadge(1).catch(error=>console.warn('App badge unavailable',error)));
  }
});
const messaging=firebase.messaging();
messaging.onBackgroundMessage(payload=>{
  const title=payload.data?.title||'キッズ出欠';
  const body=payload.data?.body||'活動予定を追加しました。';
  // Set the badge in the same background handler as the notification.
  // Some iOS WebKit versions do not reliably run a separate push listener.
  const badge=typeof self.navigator.setAppBadge==='function'
    ? self.navigator.setAppBadge(1).catch(error=>console.warn('App badge unavailable',error))
    : Promise.resolve();
  const notification=self.registration.showNotification(title,{
    body,
    icon:'./icon-192.png',
    badge:'./icon-192.png',
    tag:'kids-staff-push-'+Date.now(),
    renotify:false,
    silent:false,
    data:{url:'./staff_integrated_preview'}
  });
  return Promise.all([badge,notification]);
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=new URL('./staff_integrated_preview',self.location.href).href;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{
    const match=clients.find(client=>client.url.startsWith(url.split('?')[0]));
    if(match)return match.focus();
    return self.clients.openWindow(url);
  }));
});
