# AirReach × Gemma（試作）

サイトの本文から日本語の FAQ の下書きを作る試作。モデル本体（Gemma 4 E2B・LiteRT-LM・CPU）を自分のプロセスで動かす。
調査の結果・実測・選択肢は `docs/airreach-gemma-feasibility.md`。本番・Vercel・Supabase・既存の AI 計測と月次集計にはつないでいない。

## 手元で試す（費用なし）

```bash
python3 -m venv .venv && .venv/bin/pip install litert-lm-api==0.17.1
# モデル（Apache-2.0・約2.6GB）。リポジトリには入れない
curl -L -o /tmp/gemma-4-E2B-it.litertlm https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm
.venv/bin/python tools/airreach-gemma/bench.py --model /tmp/gemma-4-E2B-it.litertlm --threads 4 --repeat 2 --out /tmp/gemma.json
python3 tools/airreach-gemma/test_gemma_faq.py   # 確かめの部分のテスト（モデル不要）
```

## ファイル

- `gemma_faq.py`：本文の前処理（AI への指示らしき文を外す）・プロンプト・LiteRT-LM の実行・**答えの確かめ**（根拠を本文の文に当て、対象・数字と並び・項目と数字の組・無料/有料・必要/不要・肯定/否定・言い換え・条件の省略を照合。外れたら「要確認」）・**月次の要約の定型文**（数字は Gemma に書かせない）
- `bench.py`：読み込み・最初の文字まで・全体の時間・ピークメモリ
- `samples/`：架空の本文3つ（美容室・食堂・歯科）と、自社の公開ページ（https://trillion-bank.jp/airreach/）の本文
- `fixtures/`：保存した実際のモデル出力（回帰テスト用）
- `test_gemma_faq.py`：回帰テスト（モデル不要）
- `vercel-draft/`：Vercel の Python Function にするときの下書き（配置していない・既定で無効・社内だけ・同時に1件）
- `ci/`・`ci_run.sh`・`ci_summary.py`：Linux x86_64 で Vercel の大きさ（2GB/1vCPU・4GB/2vCPU）に合わせて測る GitHub Actions（`.github/workflows/` に移すと動く。Vercel での実動確認ではない）
