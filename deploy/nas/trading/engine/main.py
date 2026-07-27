"""상시 폴링 루프 (D7+, C-5의 실행 주체). v3 — 2차 적대 리뷰 반영.

설계:
 - **단일 인스턴스**: PG advisory lock. 실패 시 누가 잡고 있는지 진단 정보를 남기고 종료.
 - **제안 집기**: `FOR UPDATE SKIP LOCKED` + **TTL**(오래된 제안은 expired — 3일 전 시세 기준
   지정가가 뒤늦게 쏟아지는 것 방지).
 - **HALT**: 대사 미완 주문이 있으면 살아있되 주문 안 함(재시작 루프 방지, 해소 시 자동 재개).
 - **킬스위치**: 매 사이클 확인. 드레인 중 켜지면 해당 제안은 거절이 아니라 **보류(deferred)**.
 - **실패 격리**: 같은 제안이 반복 실패하면 3회 후 picked로 남기고 넘어간다(무한 재시도 루프 방지).
 - **관측**: status.json(원자적) + 활성일 때만 하트비트(스로틀). 주기적 stale 스윕.
"""
import json
import os
import signal
import sys
import time
import urllib.request

from .core import (apply_schema, db_connect, load_limits, process_proposal, schema_present,
                   stale_sweep, unreconciled_count)
from .guardrails import GuardrailViolation, check_kill_switch, validate_kill_switch_dir
from .ratelimit import TokenBucket

ADVISORY_LOCK_KEY = 0x7472616465  # 'trade'
# 주의: 이 서비스는 compose profile 'trading'에 속한다. 부팅 복구 스크립트(ab-boot-up.sh)가
#       `--profile trading`을 주지 않으면 재부팅 후 **되살아나지 않는다**(2026-07-26 감사에서 적발).
STATUS_PATH = os.environ.get("TRADE_STATUS_FILE", "/data/status.json")
HEARTBEAT_MIN_INTERVAL = 60.0     # 매매 핫패스에서 매 사이클 동기 HTTP는 지연 위험 → 스로틀
_stop = False
_last_ping = 0.0


def _handle_stop(signum, _frame):
    global _stop
    _stop = True
    print(f"[main] signal {signum} — 현재 작업 후 정지", flush=True)


def publish_status(state: str, detail: str = "", processed: int = 0):
    """상태를 파일로 남기고, 활성일 때만 외부 하트비트를 친다.

    '컨테이너 Up'과 '주문 처리 중'을 구분하는 장치 — HALT/킬스위치로 멈춘 동안엔 하트비트를
    **일부러 끊어** 모니터가 빨간불이 되게 한다(조용한 정지가 가장 위험).
    status.json은 compose healthcheck가 읽는다.
    """
    global _last_ping
    payload = {"state": state, "detail": detail, "processed": processed,
               "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    try:
        tmp = STATUS_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, STATUS_PATH)
    except OSError as e:
        print(f"[main] WARN status write failed: {e}", flush=True)

    url = os.environ.get("TRADE_HEARTBEAT_URL")
    now = time.monotonic()
    if url and state == "active" and (now - _last_ping) >= HEARTBEAT_MIN_INTERVAL:
        _last_ping = now
        try:
            urllib.request.urlopen(url, timeout=5).close()
        except Exception as e:      # 하트비트 실패가 매매를 막거나 지연시키면 안 된다
            print(f"[main] WARN heartbeat failed: {e}", flush=True)


def acquire_singleton(conn) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT pg_try_advisory_lock(%s) AS got", (ADVISORY_LOCK_KEY,))
        got = bool(cur.fetchone()["got"])
    conn.commit()
    return got


def lock_holder_info(conn) -> str:
    """락을 못 잡았을 때 누가 잡고 있는지 — '유령 인스턴스'(TCP half-open으로 남은 세션)와
    진짜 중복 실행을 구분하기 위한 진단."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT a.pid, a.state, a.state_change, a.client_addr, a.application_name "
                "FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid "
                "WHERE l.locktype='advisory' AND l.objid = %s AND l.granted",
                (ADVISORY_LOCK_KEY & 0xFFFFFFFF,))
            rows = cur.fetchall()
        conn.commit()
        return "; ".join(f"pid={r['pid']} state={r['state']} since={r['state_change']} addr={r['client_addr']}"
                         for r in rows) or "(보유자 조회 실패 — 이미 해제됐을 수 있음)"
    except Exception as e:
        return f"(진단 조회 실패: {e})"


def expire_stale_proposals(conn, ttl_minutes: float) -> int:
    """TTL 초과 pending 제안을 expired로. 장 상황이 바뀐 뒤 뒤늦게 체결되는 것을 막는다."""
    if ttl_minutes <= 0:
        return 0
    with conn.cursor() as cur:
        # make_interval(mins => ...)은 정수만 받는다 → 곱셈 형태(float 허용)
        cur.execute(
            "UPDATE trade_proposals SET status='expired' "
            "WHERE status='pending' AND created_at < now() - (%s * interval '1 minute')",
            (ttl_minutes,))
        n = cur.rowcount
        conn.commit()
    return n


def claim_proposal(conn):
    """pending 제안 1건을 잠그고 picked로 표시해 반환(SKIP LOCKED로 다중 폴러 안전)."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE trade_proposals SET status = 'picked', picked_at = now() WHERE id = ("
            "  SELECT id FROM trade_proposals WHERE status = 'pending' "
            "  ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *")
        row = cur.fetchone()
        conn.commit()
        return row


def main() -> int:
    limits = load_limits()
    validate_kill_switch_dir(limits)
    broker_name = os.environ.get("TRADE_BROKER", "mock")
    interval = float(os.environ.get("TRADE_POLL_SEC", "5"))
    ttl_minutes = float(os.environ.get("TRADE_PROPOSAL_TTL_MIN", "30"))
    max_cycles = int(os.environ.get("TRADE_MAX_CYCLES", "0"))     # 0=무한
    sweep_every = max(1, int(float(os.environ.get("TRADE_SWEEP_SEC", "3600")) / max(interval, 1)))
    bucket = TokenBucket(float(os.environ.get("TRADE_RATE_PER_SEC", "20")))

    signal.signal(signal.SIGTERM, _handle_stop)
    signal.signal(signal.SIGINT, _handle_stop)

    with db_connect() as conn:
        if os.environ.get("TRADE_APPLY_SCHEMA") == "1":
            apply_schema(conn)
        if not schema_present(conn):
            msg = ("스키마 없음 — trade_proposals 테이블이 없다. 먼저 셀프테스트로 스키마를 적용하라: "
                   "docker compose --profile trading run --rm trading  (또는 TRADE_APPLY_SCHEMA=1)")
            print(f"[main] FATAL: {msg}", flush=True)
            publish_status("error", msg)
            return 5

        if not acquire_singleton(conn):
            info = lock_holder_info(conn)
            msg = f"advisory lock 획득 실패 — 보유자: {info}"
            print(f"[main] {msg}", flush=True)
            print("[main] 다른 인스턴스가 없다면 유령 세션일 수 있다(네트워크 단절 후 잔존). "
                  "postgres에서 해당 pid를 확인 후 pg_terminate_backend로 정리.", flush=True)
            publish_status("lock-contended", msg)
            return 3

        for item in stale_sweep(conn):
            print(f"[main] WARN stale: {item}", flush=True)

        print(f"[main] broker={broker_name} poll={interval}s ttl={ttl_minutes}m limits={limits}", flush=True)
        cycles = 0
        processed = 0
        failures: dict[int, int] = {}

        while not _stop:
            cycles += 1
            paused_reason = None

            # 대사 미완 주문이 있으면 "살아있되 주문 안 함". 프로세스를 죽이면 재시작 루프가 되고
            # 상태를 볼 수 없다. 매 사이클 재확인하므로 대사가 끝나면 재시작 없이 스스로 재개한다.
            if os.environ.get("TRADE_ALLOW_UNRECONCILED") != "1":
                try:
                    with conn.cursor() as cur:
                        unrec = unreconciled_count(cur)
                    conn.commit()
                except Exception as e:
                    conn.rollback()
                    unrec = 0
                    print(f"[main] WARN reconcile check failed: {e}", flush=True)
                if unrec:
                    paused_reason = (f"HALT: 대사 미완 주문 {unrec}건 — 브로커 체결내역 대조 후 "
                                     f"reconciled_at 기록할 것 (README '갇힌 상태' 런북 / "
                                     f"강제 진행: TRADE_ALLOW_UNRECONCILED=1)")

            if paused_reason is None:
                try:
                    check_kill_switch(limits)
                except GuardrailViolation as e:
                    paused_reason = f"paused: {e}"

            if paused_reason and (cycles == 1 or cycles % 12 == 0):
                print(f"[main] {paused_reason}", flush=True)
            publish_status("paused" if paused_reason else "active", paused_reason or "", processed)

            if cycles % sweep_every == 1 and cycles > 1:
                for item in stale_sweep(conn):
                    print(f"[main] WARN stale: {item}", flush=True)

            if paused_reason is None:
                n_expired = expire_stale_proposals(conn, ttl_minutes)
                if n_expired:
                    print(f"[main] {n_expired}건 제안 TTL 만료(expired) — {ttl_minutes}분 초과", flush=True)

                drained = 0
                while not _stop and drained < 50:      # 사이클당 상한(폭주 방지)
                    prop = claim_proposal(conn)
                    if prop is None:
                        break
                    drained += 1
                    try:
                        res = process_proposal(conn, prop, broker_name, limits, bucket)
                        print(f"[main] proposal {prop['id']} → {res}", flush=True)
                        failures.pop(prop["id"], None)
                        if res["outcome"] == "deferred":
                            break                       # 킬스위치 켜짐 — 이 사이클은 여기서 중단
                        processed += 1
                    except Exception as e:
                        conn.rollback()
                        failures[prop["id"]] = failures.get(prop["id"], 0) + 1
                        n = failures[prop["id"]]
                        print(f"[main] ERROR proposal {prop['id']} (실패 {n}회): {e}", flush=True)
                        with conn.cursor() as cur:
                            if n >= 3:
                                # 3회 실패 = 재시도해도 같은 실패. picked로 남겨 스윕이 보고하게 하고 넘어간다.
                                # (pending으로 되돌리면 즉시 재집기 → 무한 루프)
                                print(f"[main] proposal {prop['id']} 격리(picked 유지) — 수동 확인 필요", flush=True)
                            else:
                                cur.execute("UPDATE trade_proposals SET status='pending', picked_at=NULL "
                                            "WHERE id=%s AND status='picked'", (prop["id"],))
                            conn.commit()
                        time.sleep(1)
                        if n >= 3:
                            break

            if max_cycles and cycles >= max_cycles:
                print(f"[main] max cycles {max_cycles} 도달 — 정지", flush=True)
                break
            for _ in range(int(interval * 10)):
                if _stop:
                    break
                time.sleep(0.1)

    publish_status("stopped", "graceful shutdown", processed)
    print("[main] stopped", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
