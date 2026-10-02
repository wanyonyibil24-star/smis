#!/bin/sh
# Needs: tsx, react, react-dom, playwright (+ chromium), pdf-lib. Output PDFs/HTML in $OUT (default /tmp/rc-audit).
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"; T="$(mktemp -d)"
mkdir -p "$T/server" "$T/shared" "$T/tests" "$T/client"
cp "$HERE/server/reportCardService.ts" "$T/server/"; cp "$HERE/shared/reportCard.ts" "$T/shared/"; cp "$HERE/client/ReportCardSheet.tsx" "$HERE/client/reportCard.css" "$T/client/"
cp "$HERE/tests/fakeNexus.ts" "$T/server/nexusAdapter.ts"; cp "$HERE/tests/fixtures.ts" "$HERE/tests/render-audit.tsx" "$T/tests/"
echo '{"compilerOptions":{"jsx":"react-jsx","module":"esnext","moduleResolution":"bundler","target":"es2022","allowImportingTsExtensions":true},"type":"module"}' > "$T/tsconfig.json"; echo '{"type":"module"}' > "$T/package.json"
mkdir -p "$T/node_modules"; DEPS=${NODE_MODULES_DIR:-$(npm root -g)}; for p in react react-dom playwright playwright-core pdf-lib; do ln -s "$DEPS/$p" "$T/node_modules/$p" 2>/dev/null || true; done
cd "$T" && ${TSX:-tsx} tests/render-audit.tsx
