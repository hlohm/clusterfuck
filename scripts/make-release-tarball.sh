#!/usr/bin/env sh
# Builds the no-Docker release artifact: web pre-built, proxy + shared as
# plain .ts sources (Node 24 strips types natively), one node_modules
# symlink instead of a package manager. Requires: pnpm install already run.
# Output: dist-release/clusterfuck-<version>.tar.gz
set -eu
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
OUT="dist-release/clusterfuck-$VERSION"

pnpm --filter @clusterfuck/web build

rm -rf dist-release
mkdir -p "$OUT/packages/shared" "$OUT/packages/proxy" "$OUT/packages/web" \
  "$OUT/node_modules/@clusterfuck"

cp package.json README.md LICENSE* "$OUT/" 2>/dev/null || cp package.json README.md "$OUT/"
cp -r packages/shared/package.json packages/shared/src "$OUT/packages/shared/"
cp -r packages/proxy/package.json packages/proxy/src "$OUT/packages/proxy/"
cp -r packages/web/dist "$OUT/packages/web/dist"
cp deploy/clusterfuck.service "$OUT/"
find "$OUT" -name '*.test.ts' -delete
ln -s ../../packages/shared "$OUT/node_modules/@clusterfuck/shared"

cat > "$OUT/start.sh" <<'EOF'
#!/usr/bin/env sh
# Starts the proxy (which also serves the web app). Node.js 24+ required.
# State: ./cluster.json + ./auth.json by default; override with
# CLUSTERFUCK_CONFIG / CLUSTERFUCK_AUTH_CONFIG (see clusterfuck.service for
# a systemd setup).
cd "$(dirname "$0")"
exec node packages/proxy/src/index.ts
EOF
chmod +x "$OUT/start.sh"

tar -C dist-release -czf "dist-release/clusterfuck-$VERSION.tar.gz" "clusterfuck-$VERSION"
echo "built dist-release/clusterfuck-$VERSION.tar.gz"
