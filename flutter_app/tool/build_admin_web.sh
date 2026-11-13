#!/bin/bash
# 管理画面（Web）をビルドして、リポジトリの kanri/ に置く（GitHub Pages で …/NIKUPOS/kanri/ になる）
#   bash tool/build_admin_web.sh
set -euo pipefail
cd "$(dirname "$0")/.."
flutter build web --release --base-href /NIKUPOS/kanri/ --no-web-resources-cdn
OUT=../kanri
rm -rf "$OUT"
cp -r build/web "$OUT"
# 使わないファイルを除く（デバッグ用の記号表、WebAssembly 版だけで使う描画エンジン）
find "$OUT/canvaskit" -name '*.symbols' -delete
rm -rf "$OUT/canvaskit/skwasm"* "$OUT/canvaskit/wimp"* "$OUT/canvaskit/webparagraph"
echo "kanri/ に置きました：$(du -sh "$OUT" | cut -f1)"
