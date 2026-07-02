# データベース・セキュリティ設計

本ドキュメントは、Cloudflare D1のデータベース設計、マルチユーザー分離、APIキーの暗号化セキュリティ、および容量制約（500MB〜）に対する最適化アプローチについて記述します。

---

## 1. データベース設計 (D1 Schema)

D1はSQLiteベースのサーバーレスRDBです。以下のテーブルでノート、ドキュメント、画像、会話、および用途別AI設定を管理します。

```sql
-- ノートブック（プロジェクト）単位の管理と用途別AIモデル設定
CREATE TABLE notebooks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL, -- 所有ユーザーID (Cloudflare Access JWTの sub または email)
    title TEXT NOT NULL,
    description TEXT,
    
    -- AI接続プロバイダー設定
    ai_provider TEXT DEFAULT 'workers-ai', -- 'workers-ai' or 'openai-compatible'
    ai_api_key TEXT, -- 外部APIを使用する場合のキー（AES-GCM暗号化保存）
    ai_base_url TEXT, -- 外部APIのベースURL
    ai_embedding_model TEXT DEFAULT '@cf/baai/bge-large-en-v1.5', -- 埋め込みモデル
    
    -- 用途別のLLMモデル設定
    model_chat TEXT DEFAULT '@cf/meta/llama-3-8b-instruct', -- 通常RAGチャット用
    model_summarization TEXT DEFAULT '@cf/meta/llama-3-8b-instruct', -- 要約・ドキュメント解析用
    
    -- MCP連携用設定
    mcp_token TEXT, -- MCPサーバー接続認証用トークン (ハッシュ化保存推奨)
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- アップロードされたソースドキュメント
CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL,
    user_id TEXT NOT NULL, -- 認可高速化用
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'pdf', 'webpage', 'youtube', 'text'
    r2_key TEXT, -- R2に保存された原本のパス
    text_content TEXT, -- 抽出されたプレーンテキスト（D1肥大化防止のためR2退避推奨）
    status TEXT NOT NULL, -- 'processing', 'completed', 'failed'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
);

-- ソースのテキストチャンク（VectorizeのベクトルIDとのマッピング用）
CREATE TABLE source_chunks (
    id TEXT PRIMARY KEY, -- Vectorize of Vector ID
    source_id TEXT NOT NULL,
    notebook_id TEXT NOT NULL,
    content TEXT NOT NULL,
    page_number INTEGER, -- PDFの場合のページ番号
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
);

-- PDFから抽出された画像メタデータ
CREATE TABLE source_images (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    notebook_id TEXT NOT NULL,
    r2_key TEXT NOT NULL, -- R2にアップロードされた抽出画像のパス
    page_number INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
);

-- ノートブック内での会話（チャット履歴）
CREATE TABLE chat_sessions (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
);

CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL, -- 'user', 'assistant'
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

-- ユーザーが作成したメモ（Studio Notes）
CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
);
```

---

## 2. セキュリティ ＆ 認証設計

### 2.1 Cloudflare Accessによるフロント認証
- **認証保護**: 通常のブラウザ経由のアクセス（フロントエンドおよび内部API）は Cloudflare Access の認証ポリシーを適用し、ログイン必須とします。ログイン成功時に発行される JWT（クッキーまたはヘッダー）を Workers 側で JWKS 公開鍵（CloudflareのAccess用エンドポイント）を用いて署名検証します。
- **マルチユーザー分離**: JWT の `sub`（被認証者ID）または `email` を Workers 側で抽出し、D1 へのクエリ実行時に `WHERE user_id = ?` による行レベルのアクセス制限を行い、他人のノートブックが閲覧されることを確実に防ぎます。

### 2.2 MCP API のバイパスと独自認可
- **懸念**: Cloudflare Accessでアプリケーション全体を保護すると、Webログインが必要になるため、ブラウザを使用しない外部のAIエージェント（Claude DesktopやCursor等）がMCP API（`/api/mcp`）に接続できなくなります。
- **対策**: Cloudflare Access 側のポリシー設定で、`/api/mcp/*` に対するアクセスルールを「**Bypass（バイパス）**」に設定し、認証の壁をパスさせます。その代わり、Workers内部のアプリケーションレイヤーにおいて、リクエストヘッダーの `Authorization: Bearer <mcp_token>` を検出し、D1データベースの `notebooks.mcp_token` と比較して独自に認可を行います。

### 2.3 外部APIキーの暗号化 (D1保護)
- **懸念**: D1に平文で `ai_api_key` (OpenAI等のキー) を格納すると、データベース流出時に悪用されるリスクがあります。
- **対策**:
  - Workersの環境変数にマスター暗号化キーを安全に保持（Wrangler Secretsを使用）。
  - APIキー保存時、Workers内の `Web Crypto API` を用いて、AES-GCMなどの共通鍵方式で暗号化したデータをD1の `ai_api_key` に格納。
  - APIコール直前にエッジで復号して使用し、APIキーがメモリ上に平文で長く残らないように設計します。

---

## 3. インフラ制約に対する最適化

### 3.1 D1 データベース容量の最適化（容量制限への配慮）
- **懸念**: D1は無料プランで500MB、有料プランで最大10GB（ソフトリミット）の容量制限があります。大量のドキュメントの「抽出された生の長文テキスト全文」をすべて D1 に格納すると、早々に容量が逼迫する可能性があります。
- **対策**:
  - ドキュメント原本のPDFや画像だけでなく、抽出したプレーンテキストの全文は **R2 オブジェクトストレージ** に別ファイルとして保存します。
  - D1の `sources` / `source_chunks` テーブルには、テキストのメタデータ、文字数、チャンクインデックス（位置）、およびベクトル検索用の最小限のキーワードのみを保存し、データベースの肥大化を防ぎます。

### 3.2 Vectorize の次元数制限への対策
- **懸念**: 
  - `Vectorize` インデックスは作成時にベクトル次元数（Dimensions）を決定する必要があり、後から変更できません。
  - `Workers AI`（bge-large-en: 1024次元）と外部 `OpenAI`（text-embedding-3-small: 1536次元）では次元数が異なります。
- **対策**:
  - ノートブック作成時に、使用するEmbeddingプロバイダーを選択させます。
  - バックエンドでは、プロバイダーごとに異なる Vectorize インデックス（例: `vector-index-workers-ai` と `vector-index-openai`）にルーティングするか、またはノートブックごとに対応する次元数を固定した個別のネームスペースを利用します。
