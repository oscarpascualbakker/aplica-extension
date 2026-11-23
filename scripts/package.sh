#!/bin/sh
# Empaqueta cada destino de dist/ en un zip con la versión de package.json (CV-503).
# La subida a las tiendas es manual: store/README.md (CV-509).
set -eu
version=$(node -p "require('./package.json').version")
mkdir -p dist/zip
for target in chrome edge firefox; do
  out="$PWD/dist/zip/aplica-extension-$target-$version.zip"
  rm -f "$out"
  (cd "dist/$target" && zip -qr -X "$out" .)
  echo "$out"
done
