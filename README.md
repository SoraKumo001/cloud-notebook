# Cloud Notebook

Google NotebookLM のオープンソース代替 `lfnovo/open-notebook` を Cloudflare サーバーレススタックへ最適化した RAG チャットアプリケーションです。

## 概要

PDF をアップロードすると、ブラウザ側でテキストと画像を抽出します。チャンク化されたテキストは Workers AI でベクトル化され、Cloudflare Vectorize に保存されます。チャットで質問すると、関連チャンクを検索して LLM が引用付きで回答をストリーミング生成します。

- **マルチテナント**: Email + Password 認証 + HMAC 署名付き Cookie セッション。最初の 1 人が自動的に管理者、以降は管理者からの招待制
- **クライアントサイド前処理**: pdfjs-dist で Workers のメモリ制限を回避
- **R2 / S3 直アップロード**: 署名付き URL でクライアントから直接オブジェクトストレージに PUT。R2 ネイティブ binding と任意の S3 互換エンドポイントを管理画面から切替可能
- **ハルシネーションガード**: 引用番号の検証 + 類似度しきい値 + リスク評価

## 技術スタック

| レイヤー | 技術 |
|---|---|
| フロントエンド | TanStack Router (CSR) + React 19 + Tailwind CSS + Vite (Workers Static Assets 配信) |
| PDF 解析 | pdfjs-dist(ブラウザ、dynamic import) |
| チャンキング | js-tiktoken(cl100k_base) |
| バックエンド | Cloudflare Workers + Hono |
| データベース | Cloudflare D1(SQLite) |
| オブジェクトストレージ | Cloudflare R2(ネイティブ binding) または任意の S3 互換ストレージ(aws4fetch) |
| ベクトルデータベース | Cloudflare Vectorize(1024-dim cosine, `notebook_id` / `source_id` metadata index) |
| LLM / Embedding | Workers AI 既定 + OpenAI / Anthropic / Google(プロバイダー切替可) |
| 認証 | Email + Password (PBKDF2-SHA256 100k) + HttpOnly Cookie セッション (HMAC-SHA256, SameSite=Strict) + 招待制 |
| テスト | Vitest + @cloudflare/vitest-pool-workers + Playwright |

## ディレクトリ構造

```
.
├── docs/                          # 設計ドキュメント
│   ├── README.md                  # ドキュメント一覧
│   ├── architecture.md            # 全体アーキテクチャ
│   ├── database.md                # D1 スキーマ・セキュリティ
│   └── development.md             # 開発ロードマップ・テスト計画
├── packages/
│   ├── frontend/                  # TanStack Router (CSR)
│   │   ├── src/
│   │   │   ├── routes/            # ファイルベースルーティング
│   │   │   │   ├── index.tsx      # ランディング
│   │   │   │   ├── login.tsx      # ログイン / 登録
│   │   │   │   └── notebooks/
│   │   │   │       ├── index.tsx  # ノートブック一覧
│   │   │   │       └── $notebookId.tsx  # ノートブック詳細
│   │   │   ├── components/        # UI コンポーネント (StorageSettingsModal, GlobalSettingsModal 等)
│   │   │   ├── hooks/             # useIngestPipeline, useChatStream
│   │   │   ├── contexts/          # AuthContext
│   │   │   ├── lib/               # pdfParser, tokenizer, sourceParser
│   │   │   └── e2e/               # Playwright E2E
│   │   └── playwright.config.ts
│   └── backend/                   # Cloudflare Workers
│       ├── src/
│       │   ├── index.ts           # Hono アプリ・全エンドポイント
│       │   ├── auth.ts            # Email+Password 認証・authMiddleware
│       │   ├── session.ts         # HMAC 署名付きセッション Cookie
│       │   ├── chat.ts            # ストリーミング SSE チャット
│       │   ├── embeddings.ts      # Workers AI embedding + Promise プール
│       │   ├── prompts.ts         # RAG プロンプト + ハルシネーションガード
│       │   ├── crypto.ts          # AES-256-GCM 暗号化(API keys / S3 認証情報)
│       │   ├── providers.ts       # AI provider abstraction
│       │   ├── mcp.ts             # MCP Streamable HTTP transport
│       │   ├── mcp-auth.ts        # MCP Bearer-token auth
│       │   ├── mcp-tools.ts       # MCP tool registrations
│       │   ├── storage/           # オブジェクトストレージ抽象化
│       │   │   ├── interface.ts       # ObjectStorage interface
│       │   │   ├── r2-binding-adapter.ts   # R2 ネイティブ binding
│       │   │   ├── s3-compatible-adapter.ts # aws4fetch による S3 互換
│       │   │   ├── factory.ts          # per-request adapter 解決
│       │   │   └── schema.ts           # global_settings.storageConfig
│       │   ├── db/                # Drizzle ORM (schema, client, settings)
│       │   └── middleware/        # storageMiddleware 等
│       ├── scripts/
│       │   ├── setup-production.mjs   # ワンショット setup (infra + config + migrate + secrets)
│       │   ├── setup-secrets.mjs      # standalone secrets setter (CI / rotation 用)
│       │   └── sync-d1-migrations.mjs
│       ├── drizzle/               # drizzle-kit migrations
│       ├── docs/                  # デプロイ手順・設計ガイド
│       ├── vitest.config.ts
│       └── wrangler.jsonc
├── .github/workflows/             # CI/CD
│   ├── ci.yml                     # push to master: lint + test + build
│   ├── deploy.yml                 # push to master: Workers デプロイ
│   └── pr.yml                     # PR: 軽量チェック
└── package.json                   # ルート scripts(dev, build, test, deploy:full)
```

## ローカル開発

### 前提条件

- Node.js 20+
- pnpm 10+
- Cloudflare アカウント(Wrangler CLI で `wrangler login` 済み)

### セットアップ

```bash
pnpm install

# ローカル開発用 env ファイル
cp packages/backend/.dev.vars.example packages/backend/.dev.vars
```

`.dev.vars` には `NODE_ENV=development` とダミーの `SESSION_SECRET` / `API_KEY_ENCRYPTION_MASTER` が含まれています。開発モードでは `authMiddleware` がダミーユーザー(`dev-user@example.com`)を返すため、認証なしで全機能が試せます。

### ローカル D1 マイグレーション(初回のみ)

```bash
pnpm --filter backend run db:migrate:local
```

### 開発サーバー起動

```bash
# ルートから両方同時起動(推奨)
pnpm dev

# 個別
pnpm --filter frontend dev       # Vite, http://localhost:5173
pnpm --filter backend dev        # wrangler dev, http://localhost:8787
```

フロントエンドの Vite は `/api/*` を wrangler dev (`http://127.0.0.1:8787`) へプロキシする設定が `vite.config.ts` に組み込まれているため、ブラウザからは `http://localhost:5173/api/...` の同一オリジンで backend に届きます。`pnpm dev` で両方起動すれば、プロキシ経由でそのまま動きます。

ポートを変更する場合:
```bash
pnpm --filter backend dev -- --port 8788         # wrangler
pnpm --filter frontend dev -- --port 5174 --strictPort  # vite + proxy 設定も要更新
```

> **課金注意**: `wrangler dev` でも `AI`(Workers AI)と `VECTORIZE` はリモートリソースにアクセスします。`vectorize` は `wrangler.jsonc` で `remote: true` が明示されています。大量データの upsert や LLM 呼び出しを繰り返すと Cloudflare の無料枠を超えて課金が発生します。詳細は [`packages/backend/docs/deployment.md`](packages/backend/docs/deployment.md) の「ローカル開発の課金リスク」を参照。

### ビルド・テスト

```bash
# ビルド
pnpm build                       # 両方
pnpm --filter backend build      # tsc --noEmit
pnpm --filter frontend build     # vite build

# テスト
pnpm test                        # 両方 (vitest)
pnpm --filter backend test       # 254 tests
pnpm --filter frontend test      # 118 tests
pnpm --filter frontend e2e       # Playwright(ブラウザ要インストール)
```

### リント・フォーマット

```bash
pnpm lint:fix                    # Biome (format + lint 自動修正)
```

## デプロイ

### デプロイ(最短手順)

`pnpm run deploy:full` を 1 回実行すれば、Cloudflare インフラ(D1 / R2 / Vectorize)の作成から Worker secrets の自動生成、Workers のデプロイまで全自動で完了します。再実行は冪等(2 回目以降は setup が no-op になり実質 deploy のみ)なので、CI / 本番反映どちらでも同じコマンドで扱えます。

```bash
pnpm run deploy:full
```

`deploy:full` = `setup:production && deploy` のエイリアス(`package.json:7`)で、実行内容は次のとおりです。

| Step | 内容 | 冪等性 |
|---|---|---|
| 1. D1 | `cloud-notebook-db` がなければ作成 | `wrangler d1 list --json` で存在確認 |
| 2. R2 | `cloud-notebook-bucket` がなければ作成 | bucket info で存在確認 |
| 3. Vectorize | `cloud-notebook-vector-bge` (1024-dim cosine) がなければ作成 + `notebook_id` / `source_id` metadata index を保証 | get で存在確認、metadata index は両パスで保証 |
| 4. Config | `wrangler.production.jsonc` に実 `database_id` を書き込み | ファイル存在時は skip |
| 5. Migrations | `wrangler d1 migrations apply DB --remote` (3×2s retry) | `d1_migrations` テーブルで追跡、再実行は no-op |
| 6. Secrets | `SESSION_SECRET` + `API_KEY_ENCRYPTION_MASTER` を自動生成して `wrangler secret put` | `wrangler secret list` で既存検出 → skip |
| 7. Deploy | `wrangler deploy`(`wrangler.production.jsonc` を自動選択) | 通常の Workers デプロイ |

`setup:production` がマイグレーションまで実行するため、別途 `db:migrate:remote:prod` を呼ぶ必要はありません。

### 関連コマンド(個別実行)

通常は `deploy:full` だけで十分ですが、ステップを分けたい / 一部だけ再実行したいケース向けに個別コマンドも公開しています。

```bash
# 初回セットアップのみ再実行(インフラ再作成や設定変更時)
pnpm run setup:production

# デプロイのみ再実行(コード変更だけ反映したいとき)
pnpm run deploy
```

`setup:production` は **D1 / R2 / Vectorize インフラ作成 → 設定ファイル書き込み → D1 マイグレーション → Worker secrets 自動生成** までを冪等に実行するワンショットコマンドです。`wrangler` が認証済みであれば、これ 1 つで deploy に必要なすべてが揃います。

### 自動デプロイ(CI/CD)

`master` ブランチへの push で GitHub Actions が自動デプロイします:

- `pr.yml` (PR): backend/frontend テスト + ビルド
- `ci.yml` (push to master): lint + format + テスト + ビルド
- `deploy.yml` (push to master): D1 migration + Workers デプロイ + Worker secrets 設定

CI 用の GitHub Secrets は [`packages/backend/docs/deployment.md`](packages/backend/docs/deployment.md) §4 を参照。

### 初回デプロイ後の設定

1. **管理者登録**: `POST /api/auth/register` で最初のユーザーを作成すると、自動的に `is_admin = true` になります(招待不要)。
2. **オブジェクトストレージ設定**: 管理者でログイン後、ノートブック一覧の上部にあるデータベースアイコンから **Storage Settings** を開き、プロバイダーを選択:
   - **`r2-binding`**(既定) — Cloudflare R2 ネイティブ binding。認証情報不要、Cloudflare 間 egress 無料。
   - **`s3-compatible`** — AWS S3 / MinIO / Backblaze B2 / R2(S3 API) 等。endpoint / bucket / region / access key / secret key を入力。保存前に `put + delete` プローブで認証情報を検証。
3. **AI プロバイダー設定**(任意): **Global Settings** から OpenAI / Anthropic / Google の API key を設定すると、チャット・embedding で各プロバイダーを使用できます(未設定時は Workers AI)。

> 認証情報はすべて `API_KEY_ENCRYPTION_MASTER` で AES-256-GCM 暗号化され、D1 `global_settings` / `user_settings` テーブルに保存されます。Worker secret には保存されません。

### Secrets のローテーション(任意)

`setup:secrets` は `setup:production` に統合されましたが、CI で外部 secrets manager から注入する場合や手動ローテーション用に残されています:

```bash
pnpm run setup:secrets
```

## Editor 統合

### VSCode

1. [Biome 拡張](https://marketplace.visualstudio.com/items?itemName=biomejs.biome) をインストール
2. `.vscode/settings.json` がリポジトリに含まれているため、自動で format on save が有効化されます

### 他のエディタ

Biome は大多数のエディタに対応しています(IntelliJ / WebStorm / Vim / Neovim / Emacs 等)。詳細は [Biome 公式ドキュメント](https://biomejs.dev/guides/editors/) を参照してください。

## アーキテクチャ

### インジェストパイプライン

```
1. ブラウザで PDF 解析(pdfjs-dist)
2. チャンク分割(js-tiktoken, 500 tokens / overlap 50)
3. 画像抽出(各ページを JPEG レンダリング)
4. presigned URL でオブジェクトストレージ直アップロード(R2 binding または S3 互換)
5. /api/sources/finalize で D1 登録 + embed → Vectorize 挿入
```

### RAG チャット

```
1. 質問を Workers AI でベクトル化
2. Vectorize でコサイン類似度検索(top 8, notebook_id でフィルタ)
3. チャンクを RAG プロンプトに結合
4. LLM でストリーミング生成(Workers AI / OpenAI / Anthropic / Google)
5. 引用番号とリスク評価を SSE で送出
6. ハルシネーションガード(3 層防御):
   - 予防: システムプロンプトで拘束
   - 検出: 引用番号の存在検証 + 類似度しきい値
   - 修復: 不正引用の置換(将来実装)
```

### 認証フロー

```
ブラウザ → POST /api/auth/register または /api/auth/login
       → PBKDF2-SHA256 (100k iterations) でパスワード検証
       → ランダム sessionId を生成し D1 sessions テーブルに保存
       → HMAC-SHA256(sessionId, SESSION_SECRET) を署名として Cookie に付与
       → Cookie: HttpOnly, Secure, SameSite=Strict, 7 日 TTL
       → 以降の /api/* リクエストで authMiddleware が署名検証 + D1 で session 有効性確認
       → c.var.user = { id, email, isAdmin } を設定
       → 全 D1 クエリで user_id で行レベル認可
```

初回登録ユーザーは自動的に `is_admin = true`。以降の登録は管理者からの招待トークンが必須。

## ドキュメント

- [`docs/architecture.md`](docs/architecture.md) — 全体アーキテクチャ設計
- [`docs/database.md`](docs/database.md) — D1 スキーマ・セキュリティ
- [`docs/development.md`](docs/development.md) — 開発ロードマップ・テスト計画
- [`packages/backend/docs/deployment.md`](packages/backend/docs/deployment.md) — デプロイ手順(詳細)
- [`packages/backend/src/auth.design.md`](packages/backend/src/auth.design.md) — 認証設計
- [`packages/backend/src/prompts.design.md`](packages/backend/src/prompts.design.md) — RAG プロンプト設計
- [`codemap.md`](codemap.md) — リポジトリ全体コードマップ

## 機能一覧

| 機能 | 状態 |
|---|---|
| ノートブック CRUD | ✅ |
| PDF アップロード(ブラウザ解析 + オブジェクトストレージ直 PUT) | ✅ |
| 自動ベクトル化(Workers AI + Vectorize) | ✅ |
| RAG チャット(ストリーミング SSE + 引用番号) | ✅ |
| マルチユーザー分離(Email+Password + user_id 認可) | ✅ |
| ハルシネーションガード(3 層防御) | ✅ |
| CI/CD(GitHub Actions) | ✅ |
| E2E テスト(Playwright) | ✅ |
| MCP サーバー(Streamable HTTP) | ✅ |
| AI プロバイダー切替 | ✅ Workers AI / OpenAI / Anthropic / Google |
| オブジェクトストレージ切替(R2 / S3 互換) | ✅ 管理画面から実行時切替 |
| 招待制ユーザー管理 | ✅ |

## 開発ロードマップ

- **M18–M24**: 認可ハードニング、CI/CD 修復、zod 入力検証、Vectorize 次元ガード、MCP 修復、Observability、dead code 削除 (完了)
- **M25+**: クローラー対策、Web / YouTube インジェスト、コスト最適化、D1 → R2 全文退避

## ライセンス

TBD