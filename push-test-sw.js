/* Dedicated test push worker. Register ONLY from compact_preview.html, with a preview-only scope. */
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
const messaging=firebase.messaging();
messaging.onBackgroundMessage(payload=>{
  const title=payload.data?.title||'キッズ出欠・通知テスト';
  const body=payload.data?.body||'活動予定が追加・変更されました。';
  // iOS Home Screen web apps need an explicit Badging API update.
  // Keep the notification visible even when the badge API is unsupported.
  const badgePromise=typeof self.navigator.setAppBadge==='function'
    ? self.navigator.setAppBadge(1).catch(error=>console.warn('App badge unavailable',error))
    : Promise.resolve();
  const notificationPromise=self.registration.showNotification(title,{
    body,
    icon:'./icon-192.png',
    badge:'./icon-192.png',
    tag:'kids-parent-push-test',
    renotify:false,
    silent:true,
    data:{url:'./compact_preview.html?notification-test=1'}
  });
  return Promise.all([badgePromise,notificationPromise]);
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=new URL('./compact_preview.html?notification-test=1',self.location.href).href;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{
    const match=clients.find(client=>client.url.startsWith(url.split('?')[0]));
    if(match)return match.focus();
    return self.clients.openWindow(url);
  }));
});
