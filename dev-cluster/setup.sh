#!/usr/bin/env sh
# Brings up the throwaway cluster and pins each node's API key to a known
# value so clusterfuck can talk to them. Idempotent — safe to re-run.
#
# The keys below are deliberately public dev fixtures (the nodes only listen
# on 127.0.0.1 and hold throwaway data) — never reuse this pattern for a
# real node.
set -eu
cd "$(dirname "$0")"

docker compose up -d

echo 'waiting for the nodes to generate their configs…'
for n in st1 st2 st3; do
  i=0
  while [ ! -f "data/$n/config/config.xml" ]; do
    i=$((i + 1))
    [ "$i" -gt 60 ] && echo "ERROR: $n produced no config.xml after 60s" && exit 1
    sleep 1
  done
done

for n in st1 st2 st3; do
  sed -i.bak "s|<apikey>[^<]*</apikey>|<apikey>clusterfuck-dev-$n</apikey>|" \
    "data/$n/config/config.xml" ||
    {
      echo "ERROR: could not edit data/$n/config/config.xml — if it's owned by"
      echo "another uid, re-run with sudo or set PUID/PGID in the compose file."
      exit 1
    }
done

docker compose restart

cat <<'EOF'

Ready. Point clusterfuck at the nodes with this packages/proxy/cluster.json
(or register them one by one via the app's "Register node" dialog):

{
  "nodes": [
    { "id": "st1", "url": "http://127.0.0.1:18384", "apiKey": "clusterfuck-dev-st1" },
    { "id": "st2", "url": "http://127.0.0.1:28384", "apiKey": "clusterfuck-dev-st2" },
    { "id": "st3", "url": "http://127.0.0.1:38384", "apiKey": "clusterfuck-dev-st3" }
  ]
}

Tear down with:  docker compose down && rm -rf data
EOF
