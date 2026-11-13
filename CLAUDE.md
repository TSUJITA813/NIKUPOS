# NIKUPOS 開発メモ（作業のきまり）

## apk のビルド
- Flutter版（`flutter_app/`）で apk をビルドしたら、**毎回その apk をユーザーとの会話画面に送る**（ファイル送信の機能で添付する）。
  - ファイル名は `nikupos-flutter-test-<versionName>.apk` のように、版がわかる名前にする。
  - 送る前に、パッケージ名・versionCode／versionName・minSdk・アプリ名・**インターネットの許可（android.permission.INTERNET）**を確認する（`aapt2 dump badging`）。Flutter のひな形は開発用の版にしか INTERNET を入れないので、本番の版で同期できなくなる。
  - 前の版に上書きで入れられるよう、ビルドの前に `pubspec.yaml` の `version` の後ろの番号（versionCode）を上げる。
- apk はリポジトリには入れない（`build/` は .gitignore 済み）。

## 言葉づかい
- 画面の文言・説明・README は、日本語で、専門用語を避けたわかりやすい言葉にする。
