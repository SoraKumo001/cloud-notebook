# Auth Module 設計ガイドライン

> **ファイル**: `packages/backend/src/auth.ts` (L1 実装済み)  
> **ステータス**: 設計レビュー — 本ドキュメントは L1 実装に対する補完的な設計ガイドライン  
> **対象読者**: L1 fixer および将来の M6 (MCP サーバー) 実装者

---

## 1. 責務範囲

`auth.ts` は以下の責務を担う単一モジュールである:

| 責務 | 実装状況 | 担当関数 |
|:---|:---|:---|
| RS256 JWT 署名検証 | ✅ 実装済み | `verifyCloudflareAccessJWT()` |
| 有効期限 (`exp`) / 未来発行 (`iat`) チェック | ✅ 実装済み | 同上 |
| `alg` ヘッダー固定 (RS256 以外拒否) | ✅ 実装済み | 同上 |
| JWKS 公開鍵フェッチ + キャッシュ | ✅ 実装済み | `fetchPublicKey()` |

| Hono ミドルウェア | ✅ 実装済み | `authMiddleware()` |
| **aud (audience) 検証** | ❌ 未実装 | **追加推奨** |
| **iss (issuer) 検証** | ❌ 未実装 | **追加推奨** |
| MCP トークン認可 | ❌ 未実装 | M6 で追加 |
| API キー認証 | ❌ 未実装 | 将来検討 |

### 1.1 責務に含めないもの

- **認可（Authorization）**: ユーザーが特定のノートブックにアクセスできるかの判定は、各ハンドラーが `c.get('user')` の `id` を使って D1 の `user_id` と照合する責務。`auth.ts` は認証（Authentication）に専念する。
- **ロールベースアクセス制御 (RBAC)**: MVP では全ユーザー平等。v2 でオーナー/編集者/閲覧者のロール追加時に別モジュール化する。
- **セッション管理**: Cloudflare Access が Cookie を管理するため、`auth.ts` はステートレス。

---

## 2. エラーレスポンスの統一フォーマット

### 2.1 現状の実装

```typescript
// authMiddleware のエラーハンドリング
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : 'Authentication failed'
  return c.json({ error: message }, 401)
}
```

### 2.2 推奨: 構造化エラーレスポンス

現在の実装で十分だが、デバッグ容易性のため以下の拡張を提案（任意）:

```typescript
return c.json({
  error: 'authentication_failed',
  message: err instanceof Error ? err.message : 'Authentication failed',
  code: 401,
}, 401)
```

### 2.3 エラーコード一覧 (提案)

| エラーコード | HTTP ステータス | 意味 |
|:---|:---|:---|
| `authentication_failed` | 401 | 一般的な認証失敗 |
| `token_expired` | 401 | JWT の `exp` 切れ |
| `token_invalid` | 401 | 署名検証失敗またはフォーマット不正 |
| `missing_token` | 401 | `CF-Access-Jwt-Assertion` ヘッダーなし |
| `unauthorized` | 403 | 認証は成功したがアクセス権なし (将来の RBAC 用) |
| `mcp_unauthorized` | 401 | MCP トークン不一致 |

クライアント側でエラーコードに応じた振る舞い（リダイレクト、リトライ等）が可能になる。

---

## 3. 今後の拡張余地

### 3.1 MCP 認可 (M6 予定)

MCP エンドポイント (`/api/mcp/*`) は Access をバイパスするため、`auth.ts` に MCP トークン検証機能を追加する:

```typescript
// 推奨インターフェース
export async function verifyMcpToken(
  token: string,
  db: D1Database,
): Promise<{ notebookId: string } | null>

export async function mcpAuthMiddleware(c: Context, next: Next): Promise<void>
```

**設計上の注意**:
- ハッシュ化: `crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))` を使用
- DB ルックアップ: `SELECT id FROM notebooks WHERE mcp_token = ?`
- タイミング攻撃対策: 定数時間比較を検討 (MVP ではスキップ可、機密性はハッシュで担保)
- `mcpAuthMiddleware` は `/api/mcp/*` 専用。通常の `authMiddleware` と排他的に適用

### 3.2 API キー認証 (将来)

外部サービスとの連携用に API キー認証を追加する場合のインターフェース案:

```typescript
export async function verifyApiKey(
  apiKey: string,
  db: D1Database,
): Promise<{ userId: string } | null>
```

### 3.3 監査ログ (将来)

認証イベントのログ出力:

```typescript
function logAuthEvent(event: {
  type: 'login' | 'mcp_access' | 'token_expired' | 'verification_failed'
  userId?: string
  ip?: string
  timestamp: number
}): void {
  console.log(JSON.stringify(event)) // または Workers Analytics Engine
}
```

---

## 4. JWKS キャッシュ戦略の考慮点

### 4.1 現状の実装

- TTL: 1 時間 (`JWKS_CACHE_TTL_MS = 3_600_000`)
- キャッシュスコープ: モジュールレベル（同一 Isolate 内の全リクエストで共有）
- フェッチ失敗時: 例外をスロー（リトライなし）

### 4.2 推奨改善

| 項目 | 現状 | 推奨 |
|:---|:---|:---|
| TTL | 1 時間 | **15 分** (900,000ms) — Cloudflare のキーローテーション頻度は不明だが、短い方が安全 |
| 検証失敗時の再フェッチ | なし | 署名検証失敗時にキャッシュをクリアし、1 回だけ再フェッチしてリトライ |
| フェッチエラー時のフォールバック | 例外 | 前回成功したキャッシュを stale として使用（最大 2h） |

### 4.3 並行フェッチの防止

同一 `kid` に対する複数の同時リクエストがすべて JWKS をフェッチするのを防ぐため、`Promise` キャッシュパターンを推奨:

```typescript
const pendingFetches = new Map<string, Promise<CryptoKey>>()

async function fetchPublicKey(kid: string, teamDomain: string): Promise<CryptoKey> {
  // ... cache check ...
  if (pendingFetches.has(kid)) {
    return pendingFetches.get(kid)!
  }
  const promise = doFetchAndCache(kid, teamDomain)
  pendingFetches.set(kid, promise)
  try {
    return await promise
  } finally {
    pendingFetches.delete(kid)
  }
}
```

---

## 5. テスト戦略

`auth.test.ts` でカバーすべきテストケース:

### 5.1 `verifyCloudflareAccessJWT`

- 有効な JWT → ユーザー情報を返す
- 無効な署名 → エラー
- `exp` 切れ → エラー
- `iat` が未来 → エラー
- `alg` が RS256 以外 → エラー
- `kid` 不一致 → エラー
- JWKS エンドポイントエラー → エラー
- 不正な JWT フォーマット（ドット 2 つ以外） → エラー
- **aud 不一致** → エラー (aud 検証実装後)

### 5.2 `getAuthContext`

- 本番モード: `CF-Access-Jwt-Assertion` あり + 有効 JWT → ユーザー返却
- 本番モード: ヘッダーなし → エラー
- 本番モード: `CF_TEAM_DOMAIN` 未設定 → エラー


### 5.3 `authMiddleware`

- 認証成功 → `c.get('user')` にユーザーがセットされる
- 認証失敗 → 401 JSON レスポンス
- Dev モード → 200 で通過

---

## 6. セキュリティ境界図

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│   Browser    │────▶│ Cloudflare       │────▶│  Workers (Hono)  │
│  (Frontend)  │     │  Access          │     │                  │
│              │     │  - Login (IdP)   │     │  authMiddleware  │
│              │     │  - JWT 発行       │     │  ↓               │
│              │     │  - ポリシー評価    │     │  c.set('user')   │
└──────────────┘     └─────────────────┘     │  ↓               │
                                              │  Route Handler   │
┌──────────────┐                              │  ↓               │
│  AI Agent    │────▶  /api/mcp/*             │  mcpAuth         │
│  (Claude,    │      (Access Bypass)         │  (Bearer token)  │
│   Cursor)    │                              └──────────────────┘
└──────────────┘
```

**認証境界**:
1. **Browser → Access**: OIDC/OAuth ログイン → JWT Cookie 発行
2. **Access → Workers**: `CF-Access-Jwt-Assertion` ヘッダー付与 (内部通信、改ざん不能)
3. **AI Agent → Workers**: Access バイパス → `Authorization: Bearer <mcp_token>` ヘッダー
4. **Workers → D1**: `user_id` による行レベルアクセス制御 (認可)

---

## 7. 実装優先順位

| 優先度 | 項目 | マイルストーン | 依存 |
|:---|:---|:---|:---|
| **P0 (必須)** | `aud` 検証の追加 | M3 (L1 レビュー後) | `CF_APP_AUD` 環境変数 |
| **P0 (必須)** | `iss` 検証の追加 | M3 (L1 レビュー後) | `CF_TEAM_DOMAIN` (既存) |
| **P1 (強く推奨)** | JWKS キャッシュ TTL 短縮 + stale 許容 | M3 | なし |
| **P1 (強く推奨)** | エラーレスポンスの構造化 (エラーコード) | M3 | フロントエンド側の対応 |
| **P2 (推奨)** | MCP トークン認可 (`verifyMcpToken`) | M6 | M6 MCP サーバー実装 |
| **P2 (推奨)** | MCP レート制限 | M6 | 同上 |
| **P3 (将来)** | RBAC (オーナー/編集者/閲覧者) | v2 | D1 スキーマ拡張 |
| **P3 (将来)** | 監査ログ構造化出力 | v2 | Workers Analytics Engine |

---

## 8. 他モジュールとのインターフェース

### 8.1 ハンドラー側の使用例

```typescript
// 認証必須のハンドラー
app.get('/api/notebooks', authMiddleware, async (c) => {
  const user = c.get('user')  // AuthUser 型
  // user.id で D1 に WHERE user_id = ? で問い合わせ
})

// MCP エンドポイント (Access バイパス + 独自認可)
app.use('/api/mcp/*', mcpAuthMiddleware)  // M6 で実装
```

### 8.2 フロントエンドとの連携

フロントエンドは認証状態を意識する必要がない（Access が透過的に処理）。ただし、401 エラー受信時は Access ログインページにリダイレクトする（または Access が自動でリダイレクトする）。

---

## 参考リンク

- [Cloudflare Access: Validate JWTs (公式)](https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/)
- [Cloudflare Access: Application paths (公式)](https://developers.cloudflare.com/cloudflare-one/policies/access/app-paths/)

