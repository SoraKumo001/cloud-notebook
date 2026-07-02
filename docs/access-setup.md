# Cloudflare Access 設定手順書

> **対象アプリ**: Cloud-Notebook (Workers + Hono)  
> **保護対象**: フロントエンド + バックエンド全 API（一部 `/api/mcp/*` を除く）  
> **前提**: ドメインが Cloudflare に登録済み (DNS 管理が Cloudflare 上にあること)

---

## 目次

1. [事前準備](#1-事前準備)
2. [Cloudflare Access アプリケーション作成](#2-cloudflare-access-アプリケーション作成)
3. [Identity Provider (IdP) 連携](#3-identity-provider-idp-連携)
4. [Access ポリシー設定](#4-access-ポリシー設定)
5. [MCP エンドポイントのバイパス設定](#5-mcp-エンドポイントのバイパス設定)
6. [JWT 検証の設定 (Workers 側)](#6-jwt-検証の設定-workers-側)
7. [開発環境の設定](#7-開発環境の設定)
8. [デプロイ時チェックリスト](#8-デプロイ時チェックリスト)
9. [セキュリティ懸念点](#9-セキュリティ懸念点)

---

## 1. 事前準備

| 項目 | 説明 |
|:---|:---|
| Cloudflare アカウント | Free プラン以上（Zero Trust は Free で 50 ユーザーまで無料） |
| ドメイン | Cloudflare の DNS 管理下にあるドメイン（例: `notebook.example.com`） |
| Workers デプロイ済み | `wrangler deploy` で Workers が動作していること |
| Zero Trust 有効化 | Cloudflare ダッシュボード → Zero Trust を初回開くとセットアップウィザードが走る |

---

## 2. Cloudflare Access アプリケーション作成

### 2.1 セルフホストアプリケーションの登録

1. Cloudflare ダッシュボード → **Zero Trust** → **Access** → **Applications**
2. **Add an application** → **Self-hosted** を選択
3. 以下の設定を入力:

| 設定項目 | 値 | 説明 |
|:---|:---|:---|
| **Application name** | `Cloud-Notebook` | 任意の識別名 |
| **Session Duration** | `24 hours` | セッション有効期間（推奨: 8〜24h） |
| **Application domain** | `notebook.example.com` | Workers にルーティングされているドメイン |
| **Subdomain** | `notebook` | 上と一致 |
| **Domain** | `example.com` | 上と一致 |
| **Identity providers** | (後述) | 次のステップで設定 |

4. **Next** をクリックしてポリシー設定画面へ

### 2.2 アプリケーションランチャーの表示設定 (任意)

Access のアプリケーションランチャー（`<team>.cloudflareaccess.com`）にアプリを表示する場合は、**Application Appearance** セクションでロゴや背景色を設定する。MCP 利用者向けには不要だが、ブラウザユーザーの UX 向上に有効。

---

## 3. Identity Provider (IdP) 連携

### 3.1 対応 IdP 一覧

Cloudflare Access は以下の IdP とネイティブ連携可能:

| IdP | プロトコル | ユースケース |
|:---|:---|:---|
| **Google Workspace** | OIDC | 組織内 Gmail アカウント |
| **GitHub** | OAuth | 開発チーム |
| **Microsoft Entra ID (Azure AD)** | SAML / OIDC | 企業 Azure AD |
| **Okta** | SAML / OIDC | 企業 IdP |
| **Generic OIDC** | OIDC | 任意の OIDC プロバイダー |
| **One-time PIN** | Email OTP | 簡易認証（最大 50 ユーザー） |

### 3.2 Google Workspace 設定例 (推奨)

1. Zero Trust → **Settings** → **Authentication**
2. **Login methods** → **Add new** → **Google Workspace**
3. Google Admin コンソールで OAuth 同意画面とクレデンシャルを作成
4. Client ID / Client Secret を Access に登録
5. **Test** ボタンで疎通確認

### 3.3 GitHub Organization 設定例

1. Zero Trust → **Settings** → **Authentication** → **Add new** → **GitHub**
2. GitHub で OAuth App を作成（`Settings → Developer settings → OAuth Apps`）
3. Authorization callback URL: `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`
4. Client ID / Client Secret を登録
5. ポリシー作成時に GitHub Organization 名を指定

### 3.4 複数 IdP の併用

同一アプリケーションに複数の IdP を許可できる。ユーザーはログイン画面で IdP を選択可能。

---

## 4. Access ポリシー設定

### 4.1 デフォルト Allow ポリシー

アプリケーション作成後のポリシー設定画面で:

1. **Policy name**: `Allow Team Members`
2. **Action**: `Allow`
3. **Configure rules**:
   - **Include** → **Emails** → 許可するメールアドレス（例: `*@example.com`）
   - または **Include** → **GitHub Organization** → `my-org`
4. **Additional settings** (任意):
   - **Purpose justification**: アクセス理由の入力を強制
   - **Temporary authentication**: 一時認証の有効期限

### 4.2 Application Audience (AUD) の確認

ポリシー保存後、Access はアプリケーションに一意の **Application Audience (AUD)** タグを発行する。この値は JWT の `aud` クレームに設定され、Workers 側で検証可能。

AUD の確認方法:
1. Access → Applications → [アプリ名] を開く
2. URL の最後のパスセグメントが AUD（例: `.../applications/abc123-def456-...`）

### 4.3 セッションと認証 Cookie

- Access は認証成功時にドメインスコープの Cookie を発行:
  - **`CF_Authorization`**: セッション Cookie（JWT を含む）
  - **`CF_AppSession`**: アプリケーションセッション追跡用
- Workers 側では `CF-Access-Jwt-Assertion` リクエストヘッダーで JWT を受け取る（Access がリクエスト転送時に付与）

---

## 5. MCP エンドポイントのバイパス設定

### 5.1 課題

`/api/mcp/*` はブラウザを使わない AI エージェント（Claude Desktop, Cursor 等）からアクセスされる。Cloudflare Access のブラウザベースの認証フローを通過できないため、これらのパスだけ認証をバイパスする必要がある。

### 5.2 Bypass ポリシーの作成

1. Access → Applications → [Cloud-Notebook] → **Policies**
2. **Add a policy** をクリック
3. 以下の設定:

| 設定項目 | 値 |
|:---|:---|
| **Policy name** | `MCP Bypass` |
| **Action** | `Bypass` |
| **Application Path** | `/api/mcp/*` |
| **Rules** | （空 — Bypass は条件指定不要で即座に通過） |

4. **Save policy**

### 5.3 動作確認

- `GET https://notebook.example.com/api/` → Access ログイン画面にリダイレクト
- `POST https://notebook.example.com/api/mcp/tools/list` → Access を通過し Workers に到達
- Workers 側のアプリケーションロジックで独自認可を実施（後述 §5.5）

### 5.4 ポリシーの評価順序

Access はポリシーを上から順に評価し、最初にマッチしたポリシーを適用する。Bypass ポリシーは Allow ポリシーより**上**に配置する必要がある。

推奨ポリシー順:
```
1. MCP Bypass       (Action: Bypass, Path: /api/mcp/*)
2. Allow Team Members (Action: Allow,  Include: email domain)
```

### 5.5 Workers 内部での独自認可 (MCP Token)

MCP エンドポイントが Access で保護されない代わりに、Workers のアプリケーションレベルで認可する:

1. **トークンの生成**:
   ```bash
   # 32 バイトのランダムトークンを生成
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   # 出力例: a1b2c3d4... (64 hex chars)
   ```

2. **トークンの保存**:
   - D1 の `notebooks.mcp_token` カラムにハッシュ化して保存
   - ハッシュ化には `SHA-256` を使用（`crypto.subtle.digest`）
   - **平文保存禁止** — D1 が漏洩した場合に全 MCP アクセスが危殆化する

3. **認可フロー**:
   ```
   Client → POST /api/mcp (Authorization: Bearer <mcp_token>)
         → Workers: header の token を取得
         → SHA-256 ハッシュ化
         → D1 で notebooks.mcp_token と一致するノートブックを検索
         → 一致 → 処理続行 / 不一致 → 401
   ```

4. **推奨実装パターン** (`packages/backend/src/auth.ts` に追加予定):
   ```typescript
   async function verifyMcpToken(token: string, db: D1Database): Promise<string | null> {
     const hash = await sha256(token);
     const row = await db.prepare(
       'SELECT id FROM notebooks WHERE mcp_token = ?'
     ).bind(hash).first();
     return row ? (row as { id: string }).id : null;
   }
   ```

### 5.6 MCP レート制限の必要性 (推奨)

Bypass により `/api/mcp/*` は Access のレート制限保護を受けないため、Workers 側で独自にレート制限を実装する:

- **短期**: IP アドレスベースで 1 分あたり 60 リクエスト上限
- **実装**: Hono のカスタムミドルウェア + D1 カウンター または Workers KV
- **未実装時のリスク**: ブルートフォースによる MCP token 推測、リソース枯渇
- **優先度**: M6 (MCP サーバー本実装) までに実装必須

---

## 6. JWT 検証の設定 (Workers 側)

### 6.1 必要な環境変数

| 変数名 | 設定方法 | 説明 |
|:---|:---|:---|
| `CF_TEAM_DOMAIN` | `wrangler secret put` | Cloudflare Access のチームドメイン（例: `myteam.cloudflareaccess.com`） |

### 6.2 CF_TEAM_DOMAIN の設定

```bash
# 本番環境
wrangler secret put CF_TEAM_DOMAIN
# → 入力: myteam.cloudflareaccess.com

# 確認
wrangler secret list
```

### 6.3 JWKS エンドポイントの仕組み

Cloudflare Access は公開鍵を以下のエンドポイントで配信:

```
https://{CF_TEAM_DOMAIN}/cdn-cgi/access/certs
```

レスポンス例:
```json
{
  "keys": [
    {
      "kid": "abc123...",
      "kty": "RSA",
      "alg": "RS256",
      "use": "sig",
      "n": "...",
      "e": "AQAB"
    }
  ]
}
```

- **アルゴリズム**: RS256 (RSA PKCS#1 v1.5 + SHA-256)
- **キーローテーション**: Cloudflare が自動で行う（`kid` で識別）
- **キャッシュ戦略**: 現在の実装 (`auth.ts`) では 1 時間のモジュールレベルキャッシュ

### 6.4 JWT の構造

Cloudflare Access が発行する JWT の主なクレーム:

| クレーム | 型 | 説明 |
|:---|:---|:---|
| `sub` | string | ユーザー識別子（IdP 依存） |
| `email` | string | ユーザーのメールアドレス |
| `name` | string | ユーザー表示名（IdP が提供する場合） |
| `aud` | string[] | Application Audience (AUD) タグの配列 |
| `exp` | number | 有効期限 (UNIX timestamp) |
| `iat` | number | 発行時刻 (UNIX timestamp) |
| `iss` | string | 発行者 (`https://{team}.cloudflareaccess.com`) |

### 6.5 aud (audience) 検証の重要性

**`aud` 検証は必須**（現在の `auth.ts` では未実装）。検証しない場合、別の Access アプリケーション用に発行された JWT がこのアプリでも有効になってしまう。

推奨実装:
```typescript
// auth.ts の verifyCloudflareAccessJWT に追加
const expectedAud = 'abc123-def456-...'; // アプリケーションの AUD タグ
const audList = Array.isArray(payload.aud)
  ? payload.aud
  : [payload.aud];
if (!audList.includes(expectedAud)) {
  throw new Error('JWT audience mismatch');
}
```

**実装タイミング**: L1 完了後のレビューで追加推奨（`CF_APP_AUD` 環境変数で設定可能に）。

## 7. 開発環境の設定

### 7.1 `.dev.vars` の設定

```bash
# packages/backend/.dev.vars
NODE_ENV=development
CF_ENV=development
CF_TEAM_DOMAIN=dummy-team.cloudflareaccess.com
```

### 7.2 開発時の認証バイパス

`auth.ts` の `getAuthContext()` は `NODE_ENV === 'development'` または `CF_ENV === 'development'` の場合、JWT 検証をスキップしダミーユーザーを返す:

```typescript
// auth.ts の既存ロジック
if (isDev) {
  return {
    id: 'dev-user',
    email: 'dev@example.com',
    name: 'Dev User',
  }
}
```

### 7.3 wrangler dev での動作

```bash
# 開発サーバー起動（Access 認証なしで動作）
pnpm --filter backend dev

# → http://localhost:8787 でダミーユーザー認証済み状態
```

### 7.4 本番環境との切り替え

| 環境 | `NODE_ENV` | `CF_ENV` | JWT 検証 | ユーザー |
|:---|:---|:---|:---|:---|
| **開発** (`wrangler dev`) | `development` | — | スキップ | `dev-user` |
| **プレビュー** (`wrangler dev --remote`) | — | `development` | スキップ (`.dev.vars` 設定時) | `dev-user` |
| **本番** (`wrangler deploy`) | — | — | **有効** | JWT から抽出 |

---

## 8. デプロイ時チェックリスト

### 8.1 初回デプロイ前

- [ ] ドメインが Cloudflare DNS に登録され、Workers にルーティングされている
- [ ] Cloudflare Zero Trust が有効化されている
- [ ] Access アプリケーションが作成され、AUD タグが確認されている
- [ ] IdP が設定され、テストログインが成功している
- [ ] Allow ポリシーが適切なユーザー/グループに制限されている
- [ ] MCP Bypass ポリシーが Allow ポリシー**より上**に配置されている
- [ ] `CF_TEAM_DOMAIN` が Wrangler Secret に設定されている
- [ ] `CF_APP_AUD` が設定されている（aud 検証が実装されている場合）
- [ ] `.dev.vars` が `.gitignore` に含まれている

### 8.2 デプロイコマンド

```bash
# 環境変数の設定
wrangler secret put CF_TEAM_DOMAIN
# → myteam.cloudflareaccess.com

# デプロイ
pnpm --filter backend deploy
```

### 8.3 デプロイ後確認

- [ ] `https://notebook.example.com/` にブラウザでアクセス → Access ログイン画面にリダイレクト
- [ ] ログイン成功後、Workers のレスポンスが返る
- [ ] `POST https://notebook.example.com/api/mcp/` が認証なしで到達する
- [ ] 存在しないパスでも Access ログイン画面が出る（全パス保護の確認）
- [ ] Zero Trust ダッシュボードの Logs → Access で認証ログが確認できる

---

## 9. セキュリティ懸念点

### 9.1 JWT 検証の懸念点

| # | 懸念 | 深刻度 | 対策 / ステータス |
|:---|:---|:---|:---|
| 1 | **alg ヘッダーインジェクション** | 高 | `auth.ts` で `header.alg !== 'RS256'` をチェック済み ✅ |
| 2 | **aud 検証未実装** | 高 | 別アプリの JWT が有効になるリスク。`CF_APP_AUD` での検証を M3 中に追加推奨 ⚠️ |
| 3 | **JWKS キャッシュの stale** | 中 | キーローテーション時、最大 1 時間は旧鍵でキャッシュ。TTL を 15 分に短縮し、検証失敗時に再フェッチする戦略を推奨 |
| 4 | **iss 検証未実装** | 中 | 別チームの JWKS を使った偽装のリスク。`iss` が期待するチームドメインか検証を追加推奨 |
| 5 | **JWT の転送経路** | 低 | `CF_Authorization` Cookie は HTTPS 経由。`CF-Access-Jwt-Assertion` ヘッダーは Access → Workers 間の内部通信で付与されるため傍受リスクは低い |

### 9.2 MCP バイパスの懸念点

| # | 懸念 | 深刻度 | 対策 / ステータス |
|:---|:---|:---|:---|
| 1 | **認証なしのエンドポイント公開** | 高 | `/api/mcp/*` はインターネットから認証なしで到達可能。MCP token 認可が**唯一の防御線**であることを認識すること |
| 2 | **MCP token の弱い鍵** | 高 | 最低 32 バイト（256-bit）の暗号学的乱数を使用。推測不可能な強度を確保。生成方法: `crypto.getRandomValues(new Uint8Array(32))` |
| 3 | **MCP token の平文保存** | 高 | D1 の `notebooks.mcp_token` は SHA-256 ハッシュ化保存が必須。平文保存は DB 漏洩時に全 MCP アクセスが危殆化する |
| 4 | **レート制限未実装** | 中 | ブルートフォース攻撃のリスク。M6 までに実装必須（§5.6 参照） |
| 5 | **Bypass ポリシーのスコープ過大** | 中 | `/api/mcp/*` が広すぎないか定期的に見直し。必要最小限のパスに制限する |
| 6 | **MCP token のローテーション** | 低 | v1 では手動ローテーション。v2 で自動ローテーション（古いトークンの猶予期間付き）を検討 |

### 9.3 運用上の懸念点

| # | 懸念 | 深刻度 | 対策 |
|:---|:---|:---|:---|
| 1 | **Access 停止時の影響** | 中 | Cloudflare 本体の障害は稀だが、Access が停止すると全ユーザーがログイン不可。MCP エンドポイントは Bypass により影響を受けない |
| 2 | **IdP 停止時の影響** | 中 | Google Workspace 等の IdP が停止するとログイン不可。緊急用の One-time PIN 認証を予備で設定しておくことを推奨 |
| 3 | **セッションタイムアウト** | 低 | デフォルト 24h。長時間の SSE 接続に影響する場合は延長を検討 |
| 4 | **監査ログ** | 低 | Access の認証ログはダッシュボードで確認可能。MCP アクセスは Workers 側で自前ログが必要 |
