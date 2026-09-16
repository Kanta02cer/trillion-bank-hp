# AirReach fetch proxy

Trillion Bank 自前の公開ページ取得プロキシです。AirReach（準備度診断）が見込み客サイトの HTML / `llms.txt` / `robots.txt` を取得するために使います。

実AI回答の引用率・出現率は測定しません（HackⅡの領域）。

## エンドポイント

デプロイ後（workers.dev）:

```
GET https://trillion-bank-airreach-fetch.trillion-bank.workers.dev/?url=<encoded-url>
```

- CORS: `https://trillion-bank.jp` のみ（ローカル開発用オリジンも許可）
- 認証情報・トークン系クエリは除去
- プライベートIP / localhost は拒否
- 本文は約 900KB 上限、リダイレクトは最大3回

## デプロイ

```bash
npm install
npm run check
npm run deploy
```

初回デプロイ後、workers.dev URL を `assets/js/airreach-diagnose.js` の `FIRST_PARTY_PROXY` に反映してください。

`trillion-bank.jp` を Cloudflare プロキシ配下にしたら、同一 Worker を `trillion-bank.jp/api/airreach-fetch*` へ Route 追加できます。

## 公式資料

- [CORS header proxy](https://developers.cloudflare.com/workers/examples/cors-header-proxy/)

## 本番URL（2026-09-16）

`https://trillion-bank-airreach-fetch.trillion-bank.workers.dev/`

`src/index.ts` が詳細実装、`deploy/index.js` がデプロイ済みバンドルです。
