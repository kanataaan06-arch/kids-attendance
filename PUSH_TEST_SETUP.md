# Sparkのまま使う保護者限定プッシュ通知テスト

## 構成と制約

`compact_preview.html` → FirebaseログインのIDトークン → Cloudflare Worker `morning-grass-0a11` → FCM HTTP v1 → 夫のiPhone。
Firebase Cloud Functionsは使わない。Firebase Sparkを維持する。旧`functions/`は互換資料として残すがデプロイしない。以前のBlaze必須の手順は廃止。
Firestoreルール・本番`kids_attendance_v2.html`・別の比較版HTMLは変更しない。

通知先を選ぶUIはない。Workerの`TEST_PARENT_UID`と現在の`members/{UID}.role == parent`が一致したアカウントだけ登録できる。最後に登録した1台だけ保持する。他の保護者や講師は登録できない。UIDと保護者権限を送信時にも確認する。
予定の追加・編集・出欠回答から自動送信しない。20件まとめて変更しても、最後に「メンバーの管理」のボタンを1回押すことで1件だけ送る。

## 1. Firebase（無料プランのまま）

1. Firebase Consoleで`kids-attendance-b89d4`を開き、Sparkであることを確認する。アップグレード・請求先の登録は不要。
2. Authentication > Usersで夫のGoogleアカウントのUIDを確認する。Firestoreの`members/{そのUID}`のroleが`parent`であることも確認する（アプリのメンバー管理から保護者に変更できる）。UIDをメールアドレスで代用しない。
3. プロジェクト設定 > Cloud Messaging > Web Push証明書で鍵ペアを生成し、**公開鍵**だけを`push-test-config.js`の`PUSH_TEST_VAPID_KEY`に入れる。
4. Cloud Messaging API (V1)が有効か確認する。無効ならGoogle Cloud ConsoleでFirebase Cloud Messaging APIを有効にする。Cloud FunctionsやCloud Runを有効化・デプロイする必要はない。
5. Google Cloud Console > IAMと管理 > サービスアカウントで、このプロジェクト専用の送信用サービスアカウントを作成する。ロールは**Firebase Cloud Messaging API Admin (`roles/firebasecloudmessaging.admin`)**だけを付与する。Owner/EditorやFirestore管理者は不要。
6. このサービスアカウントの「キー」からJSON秘密鍵を作成する。JSONはリポジトリの外に保管する。`client_email`と`private_key`を次のCloudflare Secretsに使う。JSON本体・秘密鍵・IDトークン・FCMトークンをGitHubやチャットへ貼らない。

既存のAuthentication/Firestore設定をそのまま使い、Firestore RESTへの権限確認には呼出者のIDトークンを使う。サービスアカウントにFirestore権限は不要。

## 2. Cloudflare WorkerとD1

既存Workerのコードを置き換えるため、現在のコードが必要なら先にバックアップする。Cloudflareアカウントへのログインは手元のPCで行う。

```sh
cd worker
npm ci
npx wrangler login
npx wrangler d1 create kids-attendance-push-test
```

出力された`database_id`を`wrangler.jsonc`の`REPLACE_WITH_D1_DATABASE_ID`へ入れる。Worker名は既存の`morning-grass-0a11`のまま。

```sh
npx wrangler d1 execute kids-attendance-push-test --remote --file=schema.sql
npx wrangler secret put TEST_PARENT_UID
npx wrangler secret put FCM_CLIENT_EMAIL
npx wrangler secret put FCM_PRIVATE_KEY
```

各プロンプトに夫のUID、サービスアカウントの`client_email`、`private_key`を入力する。秘密鍵は`-----BEGIN PRIVATE KEY-----`から`-----END PRIVATE KEY-----`まで全体を入力する。実改行・文字列の`\n`のどちらも対応。公開リポジトリの設定ファイルへ値を書かない。
Cloudflare画面から入れる場合は Workers & Pages > morning-grass-0a11 > Settings > Variables and Secretsで3項目ともSecretとして登録する。

```sh
npm test
npm run check
npm run deploy
```

CloudflareのWorkersプランはFreeを選択する。D1も無料枠を使う。Workers Paidを選ばない。このテスト規模は小さいが、無料枠の上限ではエラーになり得るためダッシュボードで利用量を確認する。課金プランへの変更は不要。

デプロイで表示された`https://morning-grass-0a11.<実際のサブドメイン>.workers.dev`を`push-test-config.js`の`PUSH_TEST_WORKER_URL`に設定する。末尾の`/`は付けない。Worker名だけではURL全体は判別できない。`PUSH_TEST_VAPID_KEY`とこのURLは公開情報でありGitHub保存可。

GitHub Pagesへこの変更を反映する。PRブランチのままでは通常Pagesは更新されない。Pagesの公開元ブランチへマージし、Actionsの公開完了を待つ。Firebaseへのdeployは不要。特に`firebase deploy`や`--only functions`は実行しない。

## 3. 夫のiPhoneで確認

1. iOS 16.4以降のSafariで`https://kanataaan06-arch.github.io/kids-attendance/compact_preview.html?notification-test=1`を開く。
2. 共有 > ホーム画面に追加で「通知テスト」アイコンを作り、そのアイコンから起動する。本番アイコンとは別にする。
3. 夫の保護者アカウントでGoogleログインする。「このiPhoneで通知を受け取る」を押して許可する。指定外アカウントはWorker側で拒否される。
4. 管理者はテスト版にログインし、「メンバーの管理」>「保護者にテスト通知を送る」>確認で送信する。
5. iPhoneのホーム画面に戻った状態と、アプリを開いた状態の両方で確認する。通知タップでテスト版へ戻る。講師に通知許可を依頼しない。

通知許可はボタン操作から要求する。拒否済みならiPhoneの設定から通知を許可する。届かない場合は集中モード、通知設定、ネット接続、VAPID公開鍵、WorkerのSecrets、サービスアカウントのFCM権限を確認する。Workerは秘密値やFCMのレスポンス本文をログ出力しない。`sent:1`はFCM受付であり端末表示の保証ではない。

## 重複・再送の扱い

- FCMはdata-onlyで1回送信し、Service Worker（画面表示中はonMessage）が1件表示する。notificationペイロードとの二重表示を避ける。
- D1の原子的更新で同時送信・別タブを含め1分間に1回までに制限する。同じ送信IDは24時間記録し再送しない。
- ネットワークエラーで結果が不明な場合、同じページからの再試行は同じIDを使い重複を防ぐ。受付済みでも不達になる場合はある。iPhoneを確認してから再読み込みし、1分以上待って明示的に新しい送信を行う。
- 固定tagで通知センター内の同じテスト通知を置き換えるよう要求する。OSによる表示・音・配信順序までは保証できない。サイレント通知を要求する。
- 最後に登録した端末だけが対象。同じアカウントで別端末登録すると送信先が切り替わる。

## 将来の本番仕様

今回、本番への通知実装はしない。本番化するときは通知先選択UIを設けず、サーバー側で承認済み講師（`admin`と`member`）全員の登録端末を列挙する。1件のまとめ通知を各端末へ送る。テストWorkerのUID制限を外すだけでは本番化できない。講師の登録管理・送信処理・重複制御を別途実装して検証する。

## 終了・無効化

CloudflareでWorkerを無効化しD1データベースを削除する。不要になったサービスアカウント鍵をGoogle Cloud Consoleで削除する。過去に旧Cloud Functionsをデプロイ済みなら、Firebase Consoleで`registerParentPushTestToken`と`sendParentPushTestNotification`が残っていないか確認し削除する（今回の作業では既存デプロイの有無は未確認）。
