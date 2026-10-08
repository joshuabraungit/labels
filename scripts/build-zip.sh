#!/usr/bin/env bash
# Packages the extension (no build step needed) into release/labels-extension-<version>.zip
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
out="release/labels-extension-${version}.zip"
mkdir -p release
rm -f "$out"
zip -qr -X "$out" manifest.json background.js content.js library.html library.css library.js lib icons
echo "Wrote $out"
unzip -l "$out"
