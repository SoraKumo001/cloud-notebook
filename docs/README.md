# Cloudflare版 open-notebook 設計・開発ドキュメント

本ディレクトリは、Google NotebookLM のオープンソース代替である `lfnovo/open-notebook` をベースに、**Cloudflareのサーバーレススタック**へ最適化した設計計画をまとめたドキュメント群です。

---

## 📖 ドキュメント構成

プロジェクトの各詳細設計は以下のドキュメントに分割して記載されています。

1. **[全体アーキテクチャ設計](file:///c:/prog/apps/cloud-notebook/docs/architecture.md)**
   - 全体構成図、コンポーネントマッピング、インジェストパイプライン、RAGチャットフロー、MCP（Model Context Protocol）サーバー仕様。
2. **[データベース・セキュリティ設計](file:///c:/prog/apps/cloud-notebook/docs/database.md)**
   - Cloudflare D1のSQLスキーマ定義、マルチユーザー（行レベル）認可、外部APIキーの暗号化保存（Web Crypto API）、D1容量最適化。
3. **[開発ロードマップ ＆ テスト計画](file:///c:/prog/apps/cloud-notebook/docs/development.md)**
   - pnpm workspaces モノレポ構造、短期・中期・長期の具体的実装タスク、Vitest / Playwright によるテスト自動化設計。

---

## 🛠️ 全体アーキテクチャ概要

```mermaid
graph TD
    Client[ブラウザ / TanStack Router (CSR)] <-->|1. HTTPS / JWT取得| CFAccess[Cloudflare Access / Zero Trust]
    CFAccess <-->|2. ID連携| IdP[Identity Provider <br> Google / GitHub / OIDC]
    CFAccess <-->|3. JWT検証 & ルーティング| Worker[Cloudflare Workers / Pages Functions]
    
    Client -->|PDF解析・画像抽出・チャンキング| Client
    Client -->|テキスト / 抽出画像| R2[(Cloudflare R2 Storage)]
    
    ExternalAI[外部AIクライアント <br> Claude Desktop / Cursor等] <-->|MCP Protocol / SSE <br> Cloudflare Accessバイパス| Worker
    
    Worker -->|メタデータ・チャット履歴| D1[(Cloudflare D1 Database)]
    Worker -->|ベクトルデータ検索| Vectorize[(Cloudflare Vectorize)]
    Worker -->|用途別モデルの振り分け| Worker
    Worker -->|内蔵AI推論| WorkersAI[Cloudflare Workers AI]
    Worker -->|外部AI推論 / OpenAI互換| OpenAI[OpenAI互換API <br> OpenAI/DeepSeek/Ollama/Gemini]
```
