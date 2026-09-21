# Google Search Console — インデックス不達の検収と対策

Date: 2026-09-21
Status: ACTIVE

## 監査で見つかった主因（本番）

| 現象 | 原因 | 対応 |
|---|---|---|
| 「送信された URL に noindex タグ」が大量 | `sitemap.xml` が **全 tbnews（92）** を列挙。うち約33本はデフォルト `noindex` | 記事は `insight:true` のみ `sitemap-insights.xml` へ。コーポレート sitemap から記事ループ削除 |
| News sitemap 関連の警告 | Insights を Google News スキーマで送信 | News 名前空間を廃止。通常の urlset に変更 |
| 重複サイトマップ登録 | robots が index / xml / news の3本を列挙 | robots は **sitemap-index.xml のみ** |
| 柱ページが未送信 | `/airreach/` `/trillionbank/ai-search/` `/case-studies/` 等が欠落 | コーポレート sitemap に追加 |
| 薄い SAMPLE 事例のクロール浪费 | 事例子ページが index | SAMPLE は `noindex`（ハブのみ index） |
| ツール面のクロール | 未デプロイ時は robots に airreach ツール Disallow が無い | robots に result/sales/studio/platform を Disallow |

## デプロイ後に GSC でやること（人）

1. **サイトマップ**
   - 旧 `sitemap.xml` / `sitemap-news.xml` の個別登録があれば削除または放置してよい
   - `https://trillion-bank.jp/sitemap-index.xml` を再送信
2. **ページのインデックス登録**
   - 「noindex による除外」が、意図どおりツール・SAMPLE・未承認記事だけか確認
   - 意図せず除外されている柱（AirReach / AI検索対策 / 会社 / CEO）があれば URL 検査 → インデックス登録をリクエスト
3. **カバレッジの見方**
   - 除外が増えても、**送信 URL の品質が上がれば正常**（noindex を sitemap から外した結果）
   - 「クロール済み - インデックス未登録」は薄いページ・重複が主因。SAMPLE とツールは意図的除外

## スコアを上げる優先順位

1. インデックス可能な URL だけを送る（本PR）
2. 柱ページの充実（page_summary / FAQ / E-E-A-T）— 既存P0〜P3
3. カニバリは GSC クエリ確認後に 301（`docs/seo-301-enable-runbook.md`）
4. 業種ページは固有化完了まで noindex 維持
5. 承認済み事例だけ index

## 自動検収

```bash
bundle exec jekyll build
python3 scripts/sitemap_indexability_check.py
python3 scripts/content_guard.py
```

CI: `.github/workflows/seo-integrity.yml`
