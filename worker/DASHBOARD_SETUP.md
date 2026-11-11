# Cloudflare管理画面での設定（PR #1）

Firebase Spark・Cloudflare Workers Freeのまま実施する。本番HTMLは変更しない。
D1: `kids-attendance-push-test` / ID: `9a0ff5bf-8bfb-47df-9d75-1d1b904fde82`
Worker: `morning-grass-0a11` / URL: `https://morning-grass-0a11.kanataaan06.workers.dev`

## 1. D1を初期化

Cloudflare > Storage & Databases（またはWorkers & Pages配下）> D1 SQL Database > `kids-attendance-push-test` > Console。
このブランチの`worker/schema.sql`の全文を貼り付け、Execute/実行する。複数文を受け付けない画面ではセミコロンごとに上から順に実行する。SQLに秘密情報はない。

確認用SQL:

```sql
SELECT name FROM sqlite_master WHERE type='table' AND name IN ('recipient','recipients','send_state','deliveries');
```

4テーブルが表示されれば初期化済み。`recipient`は旧版移行用で空のまま保持する。

## 2. Workerに接続

Workers & Pages > `morning-grass-0a11` > Bindings > Add binding > D1 database。

- Variable name / Binding name: **DB**（大文字）
- D1 database: **kids-attendance-push-test**

保存し、画面から求められた場合はDeployする。`wrangler.jsonc`には設定済みだが、管理画面へコードだけ貼る場合はこの操作で接続する必要がある。

## 3. 環境変数

Worker > Settings > Variables and Secretsに以下を追加する。各画面のSave/Deployで保存する。

| 名前 | 種類 | 値 |
| --- | --- | --- |
| FIREBASE_PROJECT_ID | Text | kids-attendance-b89d4 |
| ALLOWED_ORIGIN | Text | https://kanataaan06-arch.github.io |
| TEST_PARENT_UID | Secret | Firebase Authenticationで確認した夫のUID |
| FCM_CLIENT_EMAIL | Secret | FCM送信用サービスアカウントJSONのclient_email |
| FCM_PRIVATE_KEY | Secret | 同じJSONのprivate_key |

UIDを夫のメールアドレスで代用しない。Firestoreの`members/{夫のUID}.role`が`parent`であることも確認する。
FCM用サービスアカウントの作成・権限はルートの`PUSH_TEST_SETUP.md`の「1. Firebase」を参照。Firebase Cloud Messaging API Adminだけを付与し、Firestoreの権限は付与不要。Blazeへ変更しない。秘密鍵はチャットやGitHubへ送らず、CloudflareのSecret入力欄だけに入れる。
`private_key`はBEGIN/END行を含めた文字列全体。実改行またはリテラルの`\n`に対応する。JSONファイル全体を入力しない。

まだSecretを用意していない場合は、ここで止めて設定を先に完了する。

## 4. Workerコードをデプロイ

WorkerのEdit codeを開く。入口のJavaScriptファイル（通常`worker.js`）を、このブランチの**`worker/dashboard-worker.mjs`の全文**に置き換えてDeployする。ファイル全体を置き換え、冒頭のコメントや末尾のexportも含める。
このファイルはjoseを同梱したES Moduleで、管理画面では追加npmインストール不要。
**`worker/src/index.js`をそのまま貼らない**（外部パッケージのimportがあるため）。
Workerの互換日付はSettings > Runtimeで`2026-11-01`にする。

元のHello Worldを置き換える。既存Workerに別用途のコードがある場合はバックアップする。
Worker URLをブラウザで直接開くと、OriginとPOST認証がないため403になるのは正常。ここから通知は送信しない。正常な認証付き操作はテスト版HTMLから実施する。

生成コードの更新: `src/index.js`を変えたら`npm ci`、`wrangler deploy --dry-run --outdir dashboard`で再ビルドし、joseのLICENSEを残して`dashboard-worker.mjs`も更新する。CLIでデプロイするときは`npm run deploy`がsrcをビルドするためこの生成ファイルは使用しない。

## 5. GitHub Pagesと2台での確認

PR #1をmainへマージし、Pagesの公開完了を待つ。`push-test-config.js`のVAPID公開鍵・Worker URLは設定済み。本番HTMLはこのPRに差分がない。

1. iPhone: Safariで`https://kanataaan06-arch.github.io/kids-attendance/compact_preview.html?notification-test=1`を開き、ホーム画面に追加した「通知テスト」から起動する。
2. Redmi: Chromeで同じテスト版URLを開く。
3. それぞれ夫の同じGoogleアカウントにログインし、「この端末で通知を受け取る」を押して許可する。
4. 管理者がテスト版の「メンバーの管理」から送信ボタンを1回押す。指定アカウント以外や講師へ送信する選択肢はない。
5. 2台のみの登録なら送信成功数「2台」を確認し、実際の通知も両方で確認する。FCM受付数だけではOS表示は保証されない。再テストは1分以上空ける。

D1で登録数を確認する場合は`SELECT COUNT(*) AS registered_devices FROM recipients;`を使う。トークンや秘密値をチャットへ貼らない。
