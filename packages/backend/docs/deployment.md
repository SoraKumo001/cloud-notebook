# packages/backend — Production Deployment Guide

## Prerequisites

1. **Cloudflare account** with Workers Paid plan (for D1, R2, Vectorize, AI).
2. **Wrangler CLI** authenticated against your account.
3. The app uses **email + password** authentication (no Cloudflare Access / Zero Trust required).
   Users are stored in a `users` D1 table; sessions in a `sessions` table, and the session
   cookie is HMAC-signed with `SESSION_SECRET`.

---

## ローカル開発の課金リスク

`wrangler dev` でローカル開発を行う際、以下の binding は**常にリモートリソース**にアクセスし、Cloudflare の無料枠を超えると課金が発生します:

| Binding | 理由 | 課金の対象 |
|---------|------|------------|
| `AI` (Workers AI) | `remote: true` 設定で Llama 3 / BGE Embeddings を呼び出す | 推論リクエスト数 |
| `VECTORIZE` (Vectorize) | `remote: true` 設定でリモート Vectorize インデックスにアクセス | インデックス操作とストレージ |

開発中の課金を最小限に抑えるには:

- 大量データを Vectorize に upsert しない（テスト用に小さなデータセットで検証する）
- LLM 呼び出しを最小限に抑える（同じクエリの繰り返しを避ける）
- 課金額の上限を [Cloudflare ダッシュボード](https://dash.cloudflare.com/) で設定する

> **Note**: 本番デプロイ後は本番環境のリソースに対する課金となるため、開発時と同等の注意が必要です。

---

## 1. Wrangler Secrets (required in production)

These values **must** be set via `wrangler secret put` **before** the first deploy.
They are NOT stored in `wrangler.jsonc` — doing so would leak credentials.

The D1 `database_id` is also sensitive / account-specific: do **not** commit it directly.
The repository ships `wrangler.jsonc` as a local-dev template with a placeholder.
For production CI, `deploy.yml` generates `packages/backend/wrangler.production.jsonc`
from the `CF_D1_DATABASE_ID` GitHub secret and deploys with `--config`.
For manual production deploys, copy `wrangler.jsonc` to `wrangler.production.jsonc`,
replace `YOUR_D1_DATABASE_ID_HERE` with the real ID, and run:

```bash
pnpm --filter backend exec wrangler deploy --config wrangler.production.jsonc
```

`wrangler.production.jsonc` is listed in `.gitignore`; never commit it.

| Secret name | Description | How to generate |
|---|---|---|
| `SESSION_SECRET` | 32-byte base64 secret used to HMAC-sign session cookies | `openssl rand -base64 32` |
| `API_KEY_ENCRYPTION_MASTER` | 32-byte AES-GCM master key (base64) for encrypting stored API keys AND S3-compatible storage credentials | `openssl rand -base64 32` |

> **Storage credentials (R2 / S3) are NOT Worker secrets anymore.** They are configured at runtime through the admin UI (Storage Settings) or `PUT /api/admin/storage` and stored encrypted in the `global_settings` D1 table. After the first deployment, sign in as the bootstrap admin and open the Storage Settings dialog to choose the provider:
>
> - **`r2-binding`** — uses the Cloudflare R2 native binding (`BUCKET` in `wrangler.jsonc`). Zero credentials. Egress between Cloudflare services is free.
> - **`s3-compatible`** — any S3-compatible endpoint (AWS S3, MinIO, Backblaze B2, R2 via S3). Requires bucket, region, endpoint, and access/secret keys. The PUT endpoint validates the credentials with a real `put + delete` probe before saving.


### Setting secrets

Run `pnpm setup:secrets` for an interactive prompt that sets all required
Worker secrets via `wrangler secret put`. Values can also be passed via
environment variables (see script source for names) for non-interactive
use, e.g.:

```bash
SESSION_SECRET=$(openssl rand -base64 32) \
ACCOUNT_ID=your-cloudflare-account-id \
R2_ACCESS_KEY_ID=... \
R2_SECRET_ACCESS_KEY=... \
pnpm run setup:secrets
```

Or set them manually:

```bash
# From packages/backend/
echo "$(openssl rand -base64 32)" | wrangler secret put SESSION_SECRET --config wrangler.production.jsonc
echo "$(openssl rand -base64 32)" | wrangler secret put API_KEY_ENCRYPTION_MASTER --config wrangler.production.jsonc
```

---

## 2. Local dev auth bypass

`authMiddleware` returns a dummy `dev-user` when any of these env vars is set
in `.dev.vars`:

- `NODE_ENV=development`
- `CF_ENV=development`
- `CF_DEV_BYPASS_AUTH=1`

Production should leave all three unset and rely on the session cookie.

---

## 3. Automated local setup (one-shot)

If `wrangler` is authenticated locally, `setup:production` is a true one-shot
command that creates all infrastructure, writes the production config, applies
migrations, and sets Worker secrets:

```bash
pnpm setup:production
```

This script (`packages/backend/scripts/setup-production.mjs`) is idempotent and
safe to re-run. It performs, in order:

1. **D1** — create database `cloud-notebook-db` if missing (detected via
   `wrangler d1 list --json`).
2. **R2** — create bucket `cloud-notebook-bucket` if missing.
3. **Vectorize** — create index `cloud-notebook-vector-bge` (1024-dim cosine)
   if missing, then ensure the `notebook_id` and `source_id` metadata indexes
   exist (created on both fresh and existing indexes).
4. **Config** — write `packages/backend/wrangler.production.jsonc` with the
   real `database_id` (skipped if the file already exists).
5. **Migrations** — `wrangler d1 migrations apply DB --remote --config
   wrangler.production.jsonc` with a 3×2s retry loop to absorb D1 propagation
   delay after a fresh `d1 create`.
6. **Secrets** — auto-generate `SESSION_SECRET` and
   `API_KEY_ENCRYPTION_MASTER` (32-byte base64 via `crypto.randomBytes`) and
   `wrangler secret put` them. Already-set secrets are detected via
   `wrangler secret list` and skipped.

After it completes, the only remaining step is:

```bash
pnpm run deploy
```

> **Note**: `setup:secrets` is retained as a standalone tool for CI workflows
> that inject secrets from an external secrets manager, or for manual rotation.
> For the common first-deploy path, `setup:production` already covers secrets.

---

## 4. GitHub Actions Secret Configuration (CI/CD)

If deploying via GitHub Actions, configure the following repository secrets:

| GitHub Secret | Maps to Wrangler Secret | How to obtain |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token (needs Workers + D1 + R2 write permissions) | Dashboard → My Profile → API Tokens |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID used by wrangler | Dashboard → any Worker → right sidebar |
| `CF_D1_DATABASE_ID` | D1 database ID for `wrangler.production.jsonc` | `wrangler d1 list` or dashboard |
| `SESSION_SECRET` | → `wrangler secret put SESSION_SECRET` | `openssl rand -base64 32` |
| `API_KEY_ENCRYPTION_MASTER` | → `wrangler secret put API_KEY_ENCRYPTION_MASTER` | `openssl rand -base64 32` |

The deploy workflow (`.github/workflows/deploy.yml`) generates
`wrangler.production.jsonc` from the template and the `CF_D1_DATABASE_ID`
secret, then deploys using `--config` so the real database ID is never committed.

---

## 5. Deploy Commands

```bash
# One-shot: create infra + config + migrations + secrets, then deploy
pnpm run setup:production
pnpm run deploy

# Or the combined alias (setup:production already runs migrations,
# so no separate db:migrate step is needed)
pnpm run deploy:full
```

---

## 6. Post-Deploy Verification

```bash
# Health check (SPA root — returns the React index.html via static assets)
curl -i https://backend.example.com/

# Auth check (no cookie — should 401)
curl -i https://backend.example.com/api/me
# Expected: 401 { "error": "Missing authentication token" }

# The first registration creates the bootstrap admin (no invite needed).
# All subsequent registrations require a valid invite token issued by the admin.
curl -i -X POST https://backend.example.com/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"correct-horse-battery-staple"}'
# Expected: 201 with Set-Cookie: session=... and {"isAdmin": true} in the body

# Sign in / sign out use the same cookie (HttpOnly, SameSite=Strict, Secure).
```

The MCP endpoint (`/mcp`) keeps its own Bearer-token authentication and is not
affected by the email + password migration.

---

## 6.1. Configuring object storage

The deployment ships with `provider: 'r2-binding'` and the bound R2 bucket
`cloud-notebook-bucket`. To switch providers, sign in as the admin and open
**Storage Settings** (Database icon in the top bar of the notebook list), then:

- **`r2-binding`** — no fields to fill. The Worker uses the bound R2 bucket
  directly. No credentials, no egress fee within Cloudflare, no CORS
  preflight issues (presigned URLs target `*.r2.dev`).
- **`s3-compatible`** — fill in:
  - `endpoint` — e.g. `https://account.r2.cloudflarestorage.com` (R2-via-S3),
    `https://s3.us-east-1.amazonaws.com` (AWS), `http://localhost:9000` (MinIO).
  - `bucket`, `region` (use `auto` for R2).
  - `force_path_style` — keep `true` for R2/MinIO/B2; switch to `false` for
    AWS S3 (virtual-hosted style).
  - `access_key_id`, `secret_access_key` — these are encrypted with
    `API_KEY_ENCRYPTION_MASTER` and stored in the `global_settings` table.
    They are never returned by the GET endpoint.
  - The PUT endpoint validates the credentials with a real `put + delete`
    probe before saving. If validation fails, the settings are NOT saved
    and a clear error is shown.

CORS routing: when the endpoint is `*.r2.cloudflarestorage.com`, browser
uploads are routed through the Worker proxy (`/api/uploads/direct`) because
R2's S3 endpoint fails CORS preflight on signed PUTs. All other endpoints
receive a presigned PUT URL for direct browser uploads.

To rotate or change credentials, open Storage Settings again and submit new
values. To revert to the R2 binding, select `r2-binding` and click Save.

---

## 7. Inviting additional users

After the first user (the bootstrap admin) is registered, every new account
must be created through an invite issued by an admin. This prevents open
self-registration on a public deployment.

1. Sign in as the admin and open the **Invite users** dialog (the
   `UserPlus` icon in the top bar of the notebook list).
2. Enter the invitee's email and click **Send invite**. The dialog
   shows a one-time link like
   `https://<your-domain>/login?invite=<token>` — copy and send it to
   the invitee out of band (email, chat, etc.). Tokens are valid for
   **7 days** and can be revoked at any time.
3. The invitee opens the link. The login page auto-switches to
   **Create your account**, sends the `inviteToken` along with
   `email`/`password` to `POST /api/auth/register`, and signs them in.

Server-side endpoints (admin only, require `requireAdmin` middleware):

- `GET    /api/auth/invitations`           list invitations
- `POST   /api/auth/invitations`           issue a new invite `{ email }`
- `DELETE /api/auth/invitations/:id`       revoke an unused invite

The `users.is_admin` flag is the source of truth. The bootstrap admin
is set during the first registration. To promote an existing user
afterwards, run a manual `UPDATE users SET is_admin = 1 WHERE id = ?`
against the D1 database (for example via `pnpm --filter backend exec
wrangler d1 execute DB --remote --command "UPDATE users SET is_admin = 1
WHERE email = 'alice@example.com'"`).
