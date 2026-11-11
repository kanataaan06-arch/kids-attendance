# 保護者向けプッシュ通知テスト：設定手順

これはコンパクト比較版だけのテストです。本番 HTML は変更しません。

## 必要なもの
- Firebase プロジェクト kids-attendance-b89d4 への管理権限
- Firebase Cloud Messaging の Web Push 証明書（公開 VAPID キー）
- Cloud Functions のデプロイ権限と Firebase Blaze プラン（利用量に応じて課金される場合あり）
- 旦那さんの iPhone（iOS 16.4 以降）

## 設定
1. Firebase Console > プロジェクト設定 > Cloud Messaging > Web Push 証明書で公開 VAPID キーを取得する。秘密鍵は絶対に GitHub に書かない。
2. `push-test-config.js` の `PUSH_TEST_VAPID_KEY` に公開キーを設定する。
3. リポジトリから Firebase CLI で `firebase login` し、`firebase use kids-attendance-b89d4` する（必要なら `firebase use --add`）。
4. `npm --prefix functions install` を実行し、`firebase deploy --only functions:registerParentPushTestToken,functions:sendParentPushTestNotification --project kids-attendance-b89d4` で**テスト用関数だけ**デプロイする。
5. iPhone の Safari で `https://kanataaan06-arch.github.io/kids-attendance/compact_preview.html?notification-test=1` を開き、共有 > ホーム画面に追加で**「通知テスト」**を新しく作る。既存の本番用ホーム画面アイコンとは別。
6. 旦那さんが「通知テスト」のアイコンから保護者アカウントでログインし、「このiPhoneで通知を受け取る」を押して許可する。
7. 管理者はコンパクト比較版の「メンバーの管理」から「保護者にテスト通知を送る」を押す。
8. iPhone のホーム画面に戻って受信を確認する。

## 注意
- 現在の本番 HTML とメンバー向け通知は変更しません。
- テスト用関数をデプロイするまでは実際の通知は届きません。
- 通知音・数字バッジの動作は iOS の設定・実装状況に依存します。サイレント通知をリクエストしていますが、完全無音は保証できません。
- Firestore の `pushTestTokens` はサーバー側のみアクセス。クライアントの既存 Firestore ルールでは読めません。
- テスト終了後は Cloud Functions と `pushTestTokens` を削除して構いません。
