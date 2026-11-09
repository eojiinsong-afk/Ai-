#!/usr/bin/env bash
# 오픈하우스 사진함 — Oracle Cloud (Ubuntu 22.04/24.04) 서버 설치·업데이트 스크립트
#
# 처음 설치와 업데이트 모두 같은 명령입니다. 서버에 SSH로 접속한 뒤:
#
#   curl -fsSLO https://raw.githubusercontent.com/eojiinsong-afk/Ai-/claude/awesome-keller-fe63tm/openhouse-photos/deploy/oracle-setup.sh
#   sudo bash oracle-setup.sh
#
# 하는 일: Node.js 22 설치 → 코드 내려받기 → 앱을 시스템 서비스로 등록(재부팅해도 자동 실행)
#         → Caddy 로 HTTPS 인증서 자동 발급 → 서버 방화벽(80/443) 열기
set -euo pipefail

REPO="${REPO:-https://github.com/eojiinsong-afk/Ai-.git}"
BRANCH="${BRANCH:-claude/awesome-keller-fe63tm}"
APP_USER=ohs
SRC_DIR=/opt/openhouse-photos
APP_DIR="$SRC_DIR/openhouse-photos"
DATA_DIR=/var/lib/openhouse-photos
ENV_FILE=/etc/openhouse-photos.env
NODE_MAJOR=22

say()  { printf '\n\033[1;31m●\033[0m \033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✕ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "sudo bash oracle-setup.sh 로 실행해주세요."
. /etc/os-release
[ "${ID:-}" = ubuntu ] || fail "Ubuntu 서버에서 실행해주세요. (지금: ${PRETTY_NAME:-알 수 없음})"

# ───────── 1. 처음이면 설정값 묻기 ─────────
if [ ! -f "$ENV_FILE" ]; then
  say "처음 설치합니다. 세 가지만 입력해주세요."
  ask() { local v; read -r -p "$1" v < /dev/tty; printf '%s' "$v"; }
  while :; do
    DOMAIN=$(ask "1) 사이트 주소 (예: ohs-photos.duckdns.org): ")
    [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] && break
    echo "   주소 형식이 아닙니다. http:// 없이 입력해주세요."
  done
  while :; do
    read -r -s -p "2) 관리자 비밀번호 (8자 이상): " ADMIN_PW < /dev/tty; echo
    [ "${#ADMIN_PW}" -ge 8 ] && break
    echo "   8자 이상으로 정해주세요."
  done
  JOIN=$(ask "3) 참가 코드 (참가자 가입용, 비우면 누구나 가입): ")
  q() { printf '"%s"' "$(printf '%s' "$1" | sed 's/[\\"]/\\&/g')"; }   # systemd 용 따옴표 처리
  umask 077
  {
    echo "# 오픈하우스 사진함 설정. 고친 뒤: sudo systemctl restart openhouse-photos"
    echo "DOMAIN=$(q "$DOMAIN")"
    echo "ADMIN_PASSWORD=$(q "$ADMIN_PW")"
    echo "JOIN_CODE=$(q "$JOIN")"
    echo "MAX_PHOTOS_PER_USER=5"
    echo "MAX_UPLOAD_MB=40"
    echo "DATA_DIR=$DATA_DIR"
    echo "PORT=3000"
    echo "COOKIE_SECURE=1"
  } > "$ENV_FILE"
  umask 022
else
  say "기존 설정($ENV_FILE)으로 업데이트합니다."
fi
DOMAIN=$(sed -n 's/^DOMAIN="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$ENV_FILE")
[ -n "$DOMAIN" ] || fail "$ENV_FILE 에 DOMAIN 이 없습니다."

# ───────── 2. 패키지 ─────────
say "필요한 프로그램을 설치합니다 (1~3분)"
export DEBIAN_FRONTEND=noninteractive
echo iptables-persistent iptables-persistent/autosave_v4 boolean true | debconf-set-selections
echo iptables-persistent iptables-persistent/autosave_v6 boolean true | debconf-set-selections
apt-get update -qq
apt-get install -y -qq git curl ca-certificates xz-utils caddy iptables-persistent >/dev/null

# ───────── 3. Node.js 22 ─────────
need_node=1
if command -v node >/dev/null; then
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' && need_node=0
fi
if [ "$need_node" = 1 ]; then
  say "Node.js $NODE_MAJOR 를 설치합니다"
  case "$(uname -m)" in
    x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) fail "지원하지 않는 CPU: $(uname -m)" ;;
  esac
  base="https://nodejs.org/dist/latest-v$NODE_MAJOR.x"
  tmp=$(mktemp -d)
  curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  file=$(grep -oE "node-v[0-9.]+-linux-$arch\.tar\.xz" "$tmp/SHASUMS256.txt" | head -1)
  curl -fsSL "$base/$file" -o "$tmp/$file"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c - >/dev/null) || fail "Node.js 파일 검증 실패"
  tar -xJf "$tmp/$file" -C /usr/local --strip-components=1 --exclude='*.md' --exclude=LICENSE
  rm -rf "$tmp"
fi
echo "   node $(node -v)"

# ───────── 4. 코드 ─────────
say "코드를 내려받습니다 ($BRANCH)"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
if [ -d "$SRC_DIR/.git" ]; then
  git -C "$SRC_DIR" fetch -q --depth 1 origin "$BRANCH"
  git -C "$SRC_DIR" reset -q --hard FETCH_HEAD
else
  rm -rf "$SRC_DIR"
  git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$SRC_DIR"
fi
echo "   $(git -C "$SRC_DIR" log -1 --format='%h %s')"
mkdir -p "$DATA_DIR"
chown -R "$APP_USER:$APP_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"

# ───────── 5. 서비스 등록 ─────────
say "앱을 서비스로 등록합니다"
cat > /etc/systemd/system/openhouse-photos.service <<EOF
[Unit]
Description=Openhouse photo sharing
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/local/bin/node --disable-warning=ExperimentalWarning server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/caddy/Caddyfile <<EOF
# 오픈하우스 사진함 — HTTPS 인증서는 Caddy 가 자동으로 발급·갱신
$DOMAIN {
	request_body {
		max_size 60MB
	}
	reverse_proxy 127.0.0.1:3000
}
EOF

# ───────── 6. 서버 안 방화벽 (Oracle Ubuntu 이미지는 80/443 이 기본으로 막혀 있음) ─────────
say "서버 방화벽에서 80·443 포트를 엽니다"
for port in 80 443; do
  iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 1 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
done
netfilter-persistent save >/dev/null 2>&1 || true

systemctl daemon-reload
systemctl enable -q openhouse-photos
systemctl restart openhouse-photos
systemctl enable -q caddy
systemctl restart caddy

# ───────── 7. 확인 ─────────
say "동작을 확인합니다"
ok=0
for _ in $(seq 1 15); do
  if curl -fsS -o /dev/null http://127.0.0.1:3000/api/me 2>/dev/null; then ok=1; break; fi
  sleep 1
done
[ "$ok" = 1 ] || { journalctl -u openhouse-photos -n 30 --no-pager; fail "앱이 시작되지 않았습니다. 위 로그를 Claude 에게 보여주세요."; }
echo "   앱 실행 중 ✓"

pub_ip=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo "?")
[ -n "$pub_ip" ] || pub_ip="?"
dns_ip=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)
if [ "$pub_ip" = "?" ]; then
  [ -n "$dns_ip" ] || printf '\n   ⚠ %s 가 아직 어떤 서버도 가리키지 않습니다. DuckDNS 에서 이 서버의 공인 IP 를 넣어주세요.\n' "$DOMAIN"
elif [ "$dns_ip" != "$pub_ip" ]; then
  printf '\n   ⚠ %s 가 이 서버(%s)가 아니라 %s 를 가리키고 있습니다.\n     DuckDNS 에서 IP 를 %s 로 바꾸면 몇 분 안에 HTTPS 가 켜집니다.\n' \
    "$DOMAIN" "$pub_ip" "${dns_ip:-없음}" "$pub_ip"
else
  echo "   주소 연결 확인 ✓ ($DOMAIN → $pub_ip)"
fi

df -h "$DATA_DIR" | awk 'NR==2{printf "   저장 공간: 전체 %s · 남은 공간 %s\n", $2, $4}'

cat <<EOF

────────────────────────────────────────────
 설치 완료 →  https://$DOMAIN

 · 처음 몇 분은 HTTPS 인증서를 받는 중이라 접속이 안 될 수 있어요.
   5분이 지나도 안 되면 Oracle 콘솔의 '보안 목록(Security List)'에서
   80·443 포트를 열었는지 확인하세요.
 · 설정 바꾸기   : sudo nano $ENV_FILE  →  sudo systemctl restart openhouse-photos
 · 최신 코드 반영: sudo bash oracle-setup.sh  (이 명령을 다시 실행)
 · 로그 보기     : sudo journalctl -u openhouse-photos -f
 · 사진 위치     : $DATA_DIR
────────────────────────────────────────────
EOF
