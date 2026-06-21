# payslip-ocr Edge Function

スキャン給与明細（テキスト層なしPDFを画像化したもの）を **Azure Document
Intelligence** の `prebuilt-layout` で解析し、`analyzeResult`（本文＋表）を返す。
Azure のキーはこの関数（サーバー側）だけが保持し、クライアントには出さない。

## 必要なシークレット

Supabase の Edge Functions のシークレットに登録する（**キーはコード／リポジトリに置かない**）。

| 名前 | 必須 | 例 / 既定 |
|---|---|---|
| `AZURE_DI_ENDPOINT` | ✅ | `https://<resource-name>.cognitiveservices.azure.com` |
| `AZURE_DI_KEY` | ✅ | Document Intelligence のキー |
| `AZURE_DI_MODEL` | 任意 | 既定 `prebuilt-layout` |
| `AZURE_DI_API_VERSION` | 任意 | 既定 `2024-11-30` |

### CLI でシークレットを設定する場合
```bash
supabase secrets set AZURE_DI_ENDPOINT="https://<name>.cognitiveservices.azure.com"
supabase secrets set AZURE_DI_KEY="<key>"
```
ダッシュボードからでも設定可（Project → Edge Functions → Secrets）。

## デプロイ

### Supabase CLI
```bash
supabase functions deploy payslip-ocr
```
（JWT 検証は既定で有効＝ログイン済みユーザーのみ呼べる。`--no-verify-jwt` は付けない）

### ダッシュボード（iPhone でも可）
Project → Edge Functions → Create a function → `payslip-ocr` を作成し、
`index.ts` の内容を貼り付けてデプロイ。Secrets を上記のとおり登録。

## 動作
1. クライアントがスキャンPDFの1ページ目を画像化して、この関数に画像バイト列を POST
2. 関数が Azure に `:analyze` を投げ、`Operation-Location` をポーリング
3. 完了したら `{ analyzeResult }` を返す（フィールドの対応付けはクライアント側 `parseAzure.ts` で実施）

> メモ: 給与明細は機微情報のため、画像は保存せず関数内で処理して破棄している。
> Azure 側もリソースの設定で保持・学習を無効化しておくこと。
