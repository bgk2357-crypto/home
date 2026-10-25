#!/bin/sh
# Run on the NAS: sudo sh scripts/synology-install.sh website.example.com
set -eu
cd "$(dirname "$0")/.."
domain=${1:-}
if [ -z "$domain" ]; then
  echo 'Usage: sudo sh scripts/synology-install.sh website.example.com' >&2
  exit 1
fi
case "$domain" in
  *[!a-zA-Z0-9.-]*|.*|*..*|*.-*|*-.*|*-|-*|*.)
    echo 'Enter a DNS hostname only, without https://, port or path.' >&2; exit 1 ;;
esac
case "$domain" in
  *.*) ;;
  *) echo 'Enter your public DNS hostname.' >&2; exit 1 ;;
esac
command -v docker >/dev/null 2>&1 || { echo 'Install the DSM Docker package first.' >&2; exit 1; }
if docker container inspect argo-homepage >/dev/null 2>&1; then
  echo 'argo-homepage already exists. No existing container or data has been changed.' >&2
  echo 'See SYNOLOGY-EXTERNAL-ACCESS.txt for updating the existing installation.' >&2
  exit 1
fi
echo 'Checking Node.js and SQLite compatibility on this NAS...'
docker run --rm node:22-bookworm-slim node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(":memory:");if(d.prepare("SELECT 1 AS ok").get().ok!==1)process.exit(1);d.close();console.log("Runtime check passed")'
if [ ! -e .env ]; then
  echo 'Creating private .env configuration...'
  umask 077
  docker run --rm -e "NAS_WEBSITE_DOMAIN=$domain" node:22-bookworm-slim node -e 'const d=process.env.NAS_WEBSITE_DOMAIN; console.log(["APP_ORIGIN=https://"+d,"VINEXT_TRUSTED_HOSTS="+d,"AUTH_SECRET="+require("node:crypto").randomBytes(32).toString("hex"),"GOOGLE_CLIENT_ID=","GOOGLE_CLIENT_SECRET=","NAVER_MAP_CLIENT_ID="].join("\n"))' > .env
fi
# Validate existing settings without evaluating .env as shell code or logging secrets.
docker run --rm --env-file .env -e "NAS_WEBSITE_DOMAIN=$domain" node:22-bookworm-slim node -e 'const d=process.env.NAS_WEBSITE_DOMAIN;if(process.env.APP_ORIGIN!=="https://"+d||process.env.VINEXT_TRUSTED_HOSTS!==d||(process.env.AUTH_SECRET||"").length<32){console.error("Set APP_ORIGIN=https://"+d+", VINEXT_TRUSTED_HOSTS="+d+" and AUTH_SECRET (at least 32 characters) in .env, then rerun.");process.exit(1)}'
echo 'Building the application. This can take several minutes...'
docker build -t argo-homepage:local .
docker volume create argo-homepage-data >/dev/null
docker run -d --name argo-homepage --restart unless-stopped \
  --env-file .env -p 127.0.0.1:8080:3000 \
  -v argo-homepage-data:/var/data \
  --log-opt max-size=10m --log-opt max-file=3 argo-homepage:local
echo 'Waiting for the application and database...'
attempt=0
while [ "$attempt" -lt 30 ]; do
  if docker exec argo-homepage node -e 'fetch("http://127.0.0.1:3000/api/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then
    echo "Application is ready on NAS loopback port 8080."
    echo "Next: configure DSM HTTPS reverse proxy for https://$domain (see SYNOLOGY-EXTERNAL-ACCESS.txt)."
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 2
done
echo 'Health check did not pass. Inspect: sudo docker logs --tail 100 argo-homepage' >&2
exit 1
