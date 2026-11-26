#!/usr/bin/env bash
# Разовая настройка домашнего сервера под игру. Запускать на сервере через sudo:
#   ssh -t user@host 'sudo bash -s' < scripts/server-setup.sh
# Повторный запуск безопасен: папку и блок Caddy не дублирует.
#
# Что делает: заводит /srv/star_elite (владелец — тот, кто выкладывает, чтобы
# `npm run deploy` шёл без sudo) и добавляет в Caddyfile раздачу `/star_elite/`.
set -euo pipefail

owner=${SUDO_USER:?run through sudo}
root=/srv/star_elite
caddyfile=/etc/caddy/Caddyfile
marker='# star_elite'

install -d -o "$owner" -g "$owner" -m 755 "$root" "$root/releases"

if ! grep -qF "$marker" "$caddyfile"; then
  cp "$caddyfile" "$caddyfile.bak-star-elite-$(date +%Y%m%d%H%M%S)"
  block=$(cat <<'EOF'
	# star_elite — статика клиента, выкладка: npm run deploy в репозитории игры.
	redir /star_elite /star_elite/ 308
	handle_path /star_elite/* {
		root * /srv/star_elite/current
		encode zstd gzip
		# Бандлы с хешем в имени не меняются никогда; index.html — каждая выкладка.
		header /assets/* Cache-Control "public, max-age=31536000, immutable"
		@page path / /index.html
		header @page Cache-Control "no-cache"
		try_files {path} /index.html
		file_server
	}
EOF
)
  # Перед общим `handle {` в конце: Caddy сортирует handle по специфичности, но
  # держим порядок, как у соседних игр, чтобы файл читался сверху вниз.
  awk -v block="$block" '
    !done && /^\thandle \{/ { print block; done = 1 }
    { print }
    END { if (!done) exit 1 }
  ' "$caddyfile" > "$caddyfile.new" || { echo 'no catch-all "handle {" found in Caddyfile' >&2; rm -f "$caddyfile.new"; exit 1; }
  caddy validate --adapter caddyfile --config "$caddyfile.new"
  chmod 644 "$caddyfile.new"
  mv "$caddyfile.new" "$caddyfile"
fi

systemctl reload caddy
echo "ready: $root owned by $owner, Caddy serves /star_elite/"
