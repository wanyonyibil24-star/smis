#!/bin/sh
# Runs the REAL server/reportCardService.ts against tests/fakeNexus.ts (in-memory NEXUS stand-in).
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"; T="$(mktemp -d)"
mkdir -p "$T/server" "$T/shared" "$T/tests"
cp "$HERE/server/reportCardService.ts" "$T/server/"; cp "$HERE/shared/reportCard.ts" "$T/shared/"
cp "$HERE/tests/fakeNexus.ts" "$T/server/nexusAdapter.ts"; cp "$HERE/tests/service.test.ts" "$HERE/tests/fixtures.ts" "$T/tests/"
cd "$T" && ${TSX:-tsx} --test tests/service.test.ts
