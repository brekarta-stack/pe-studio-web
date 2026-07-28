#!/bin/sh
# install-cron.sh — NAS에 하트비트+백업 cron 설치 (root로 1회 실행, 재실행 안전)
# 사용: sudo sh install-cron.sh <COMPOSE_DIR> <BACKUP_ROOT>
#   예: sudo sh install-cron.sh /home/user/agent-backbone /volume3/backup/agent-backbone
# 보안: 스크립트를 /usr/local/sbin에 root 소유로 복사해 cron이 그 사본만 실행
#       (root cron이 사용자 소유 파일을 실행하는 권한상승 경로 차단).
# UGOS 업데이트 후엔 /etc/cron.d/agent-backbone 존재를 재확인할 것(없으면 재실행).

set -eu

COMPOSE_DIR="${1:?usage: install-cron.sh <COMPOSE_DIR> <BACKUP_ROOT>}"
BACKUP_ROOT="${2:?usage: install-cron.sh <COMPOSE_DIR> <BACKUP_ROOT>}"

case "$COMPOSE_DIR" in /*) ;; *) echo "FATAL: absolute path required"; exit 1;; esac
case "$BACKUP_ROOT" in /*) ;; *) echo "FATAL: absolute path required"; exit 1;; esac
# cron 라인을 깨뜨리는 문자 거부(% = cron 개행 치환, ' = 인용 붕괴)
case "$COMPOSE_DIR$BACKUP_ROOT" in *%*|*"'"*) echo "FATAL: path must not contain % or '"; exit 1;; esac
[ "$(id -u)" -eq 0 ] || { echo "FATAL: run as root (sudo)"; exit 1; }
[ -f "$COMPOSE_DIR/docker-compose.yml" ] || { echo "FATAL: $COMPOSE_DIR has no docker-compose.yml"; exit 1; }

SRC_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[ -f "$SRC_DIR/hc-ping.sh" ] || { echo "FATAL: $SRC_DIR/hc-ping.sh missing"; exit 1; }
[ -f "$SRC_DIR/backup-daily.sh" ] || { echo "FATAL: $SRC_DIR/backup-daily.sh missing"; exit 1; }
[ -f "$SRC_DIR/ab-boot-up.sh" ] || { echo "FATAL: $SRC_DIR/ab-boot-up.sh missing"; exit 1; }
[ -f "$SRC_DIR/weekly-selfcheck.sh" ] || { echo "FATAL: $SRC_DIR/weekly-selfcheck.sh missing"; exit 1; }
[ -f "$SRC_DIR/offsite-sync.sh" ] || { echo "FATAL: $SRC_DIR/offsite-sync.sh missing"; exit 1; }

# root 소유 사본 설치
BIN_DIR=/usr/local/sbin
mkdir -p "$BIN_DIR"
cp "$SRC_DIR/hc-ping.sh" "$BIN_DIR/ab-hc-ping.sh"
cp "$SRC_DIR/backup-daily.sh" "$BIN_DIR/ab-backup-daily.sh"
cp "$SRC_DIR/ab-boot-up.sh" "$BIN_DIR/ab-boot-up.sh"
cp "$SRC_DIR/weekly-selfcheck.sh" "$BIN_DIR/ab-weekly-selfcheck.sh"
cp "$SRC_DIR/offsite-sync.sh" "$BIN_DIR/ab-offsite-sync.sh"
for f in ab-hc-ping.sh ab-backup-daily.sh ab-boot-up.sh ab-weekly-selfcheck.sh ab-offsite-sync.sh; do
  chown root:root "$BIN_DIR/$f"; chmod 755 "$BIN_DIR/$f"
done

# 커널 파라미터(부팅 시 TS IP 바인딩 실패 방지) — 레포의 정본을 복사·적용해 복원 가능하게 한다.
# (이전엔 수동 설정이라 레포·백업 어디에도 없었다 — 감사 지적)
SYSCTL_SRC="$SRC_DIR/../sysctl-99-agent-backbone.conf"
if [ -f "$SYSCTL_SRC" ]; then
  cp "$SYSCTL_SRC" /etc/sysctl.d/99-agent-backbone.conf
  chmod 644 /etc/sysctl.d/99-agent-backbone.conf
  sysctl -p /etc/sysctl.d/99-agent-backbone.conf >/dev/null 2>&1 && echo "sysctl 적용됨(ip_nonlocal_bind)"
else
  echo "WARN: $SYSCTL_SRC 없음 — 부팅 시 TS IP 바인딩 실패 방어가 빠진다"
fi

# 백업 목적지: root 소유(사용자 계정 침해 시 심볼릭링크 스왑 방지)
mkdir -p "$BACKUP_ROOT/daily"
chown root:root "$BACKUP_ROOT" "$BACKUP_ROOT/daily" 2>/dev/null || true
chmod 700 "$BACKUP_ROOT" "$BACKUP_ROOT/daily" 2>/dev/null || true

# 백업 시각: 호스트 TZ 기준 03:30 KST 목표.
HOST_TZ_OFFSET=$(date +%z)   # 예: +0900
if [ "$HOST_TZ_OFFSET" = "+0900" ]; then
  BK_MIN=30; BK_HOUR=3       # 03:30 KST
else
  BK_MIN=30; BK_HOUR=18      # 18:30 UTC = 03:30 KST (호스트 UTC 가정)
  echo "NOTE: host TZ=$HOST_TZ_OFFSET — backup cron 18:30 host time (=03:30 KST if UTC)."
fi

CRON_FILE=/etc/cron.d/agent-backbone
cat > "$CRON_FILE" <<EOF
# agent-backbone: 하트비트(5분) + 일일백업. install-cron.sh 가 생성/갱신함.
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
@reboot root sh $BIN_DIR/ab-boot-up.sh '$COMPOSE_DIR' >> /var/log/agent-backbone-boot.log 2>&1
*/5 * * * * root sh $BIN_DIR/ab-hc-ping.sh '$COMPOSE_DIR/heartbeat.url' >/dev/null 2>&1
$BK_MIN $BK_HOUR * * * root COMPOSE_DIR='$COMPOSE_DIR' BACKUP_ROOT='$BACKUP_ROOT' sh $BIN_DIR/ab-backup-daily.sh >> '$BACKUP_ROOT/backup.log' 2>&1
0 9 * * 1 root COMPOSE_DIR='$COMPOSE_DIR' REPORT_DIR='$BACKUP_ROOT/selfcheck' sh $BIN_DIR/ab-weekly-selfcheck.sh >> '$BACKUP_ROOT/selfcheck.log' 2>&1
# 오프사이트: 일일백업(03:30)이 끝난 뒤에 올린다. 순서가 뒤집히면 어제 것만 올라간다.
0 5 * * * root COMPOSE_DIR='$COMPOSE_DIR' OFFSITE_SRC='$BACKUP_ROOT/daily' HOME=/root sh $BIN_DIR/ab-offsite-sync.sh >> '$BACKUP_ROOT/offsite.log' 2>&1
EOF
chmod 644 "$CRON_FILE"
chown root:root "$CRON_FILE" 2>/dev/null || true

# cron 데몬 리로드(대부분 자동 감지하지만 보험)
if command -v systemctl >/dev/null 2>&1; then
  systemctl reload cron 2>/dev/null || systemctl reload crond 2>/dev/null || true
fi

echo "installed: $CRON_FILE (scripts → $BIN_DIR/ab-*.sh)"
echo "----------------------------------------"
cat "$CRON_FILE"
echo "----------------------------------------"
echo "다음 확인: 이 NAS의 cron이 /etc/cron.d를 읽는지 — 5~10분 뒤 syslog나 heartbeat 첫 핑으로 검증."
echo "  (미지원이면 root crontab -e 폴백: 위 두 줄에서 'root' 필드만 빼고 등록)"
echo "activate heartbeat : echo '<ping-url>' > $COMPOSE_DIR/heartbeat.url"
echo "backup heartbeat   : echo '<ping-url>' > $COMPOSE_DIR/heartbeat-backup.url  (선택)"
echo "manual backup test : sudo COMPOSE_DIR='$COMPOSE_DIR' BACKUP_ROOT='$BACKUP_ROOT' sh $BIN_DIR/ab-backup-daily.sh"
echo "⚠️ 스크립트 수정 시 install-cron.sh 재실행(sbin 사본 갱신)."
echo "⚠️ 오프사이트(rclone crypt) 비밀번호를 패스워드매니저 등 **NAS 밖**에 반드시 보관."
echo "   분실하면 Google Drive에 올라간 사본을 영원히 못 연다 — 오프사이트를 둔 의미가 사라진다."
