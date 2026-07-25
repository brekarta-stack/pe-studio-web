"""상시 폴링 루프 (D7+, C-5의 실행 주체).

설계:
 - **단일 인스턴스 강제**: PG advisory lock(B13). 두 번째 인스턴스는 즉시 종료 → 레이트리밋 합산 초과·
   대사(reconcile) 경합 방지.
 - **제안 집기**: `FOR UPDATE SKIP LOCKED`로 pending 제안을 잠그고 picked로 표시 후 처리(A15).
   정확성은 멱등키가 보장하지만, 이 잠금이 없으면 폴러가 같은 행을 반복해 duplicate만 찍는다.
 - **부팅 스윕**: 갇힌 pending 키/비종결 주문을 먼저 보고(A4). RECONCILE 필요 주문이 있으면
   기본적으로 **주문을 멈춘다**(TRADE_ALLOW_UNRECONCILED=1 로만 강제 진행) — "나갔는지 모르는 주문"이
   있는 채로 신규 주문을 내는 것이 매매에서 가장 위험하다.
 - **킬스위치**: 매 사이클 확인(가드레일 내부에서도 재확인). ON이면 주문 없이 대기만.
 - 종료: SIGTERM/SIGINT에 현재 제안 처리를 마치고 정지(부분 상태 최소화).
"""
import os
import signal
import sys
import time

import psycopg

from .core import apply_schema, db_connect, load_limits, process_proposal, stale_sweep
from .guardrails import GuardrailViolation, check_kill_switch, validate_kill_switch_dir
from .ratelimit import TokenBucket

ADVISORY_LOCK_KEY = 0x7472616465  # 'trade'
_stop = False


def _handle_stop(signum, _frame):
    global _stop
    _stop = True
    print(f"[main] signal {signum} — 현재 작업 후 정지", flush=True)


def acquire_singleton(conn) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT pg_try_advisory_lock(%s) AS got", (ADVISORY_LOCK_KEY,))
        return bool(cur.fetchone()["got"])


def claim_proposal(conn) -> dict | None:
    """pending 제안 1건을 잠그고 picked로 표시해 반환(SKIP LOCKED로 다중 폴러 안전)."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE trade_proposals SET status = 'picked' WHERE id = ("
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
    max_cycles = int(os.environ.get("TRADE_MAX_CYCLES", "0"))  # 0=무한(테스트는 유한)
    bucket = TokenBucket(float(os.environ.get("TRADE_RATE_PER_SEC", "20")))

    signal.signal(signal.SIGTERM, _handle_stop)
    signal.signal(signal.SIGINT, _handle_stop)

    with db_connect() as conn:
        if os.environ.get("TRADE_APPLY_SCHEMA") == "1":
            apply_schema(conn)
        if not acquire_singleton(conn):
            print("[main] 다른 인스턴스가 이미 실행 중(advisory lock) — 종료", flush=True)
            return 3

        stale = stale_sweep(conn)
        for item in stale:
            print(f"[main] WARN stale: {item}", flush=True)

        print(f"[main] broker={broker_name} poll={interval}s limits={limits}", flush=True)
        cycles = 0
        while not _stop:
            cycles += 1
            paused_reason = None

            # 대사 미완 주문이 있으면 "살아있되 주문 안 함"(HALT). 프로세스를 죽이지 않는 이유:
            # 재시작 루프가 되고, 로그·모니터에서 상태를 못 본다. 매 사이클 재확인하므로
            # 운영자가 대사를 끝내면 재시작 없이 스스로 재개한다.
            if os.environ.get("TRADE_ALLOW_UNRECONCILED") != "1":
                with conn.cursor() as cur:
                    cur.execute("SELECT count(*) AS n FROM trade_orders WHERE reject_reason LIKE '%RECONCILE_NEEDED%'")
                    unrec = cur.fetchone()["n"]
                conn.commit()
                if unrec:
                    paused_reason = (f"HALT: 대사 미완 주문 {unrec}건 — 브로커 체결내역 대조 후 해소할 것 "
                                     f"(런북: README '갇힌 상태' / 강제 진행: TRADE_ALLOW_UNRECONCILED=1)")

            if paused_reason is None:
                try:
                    check_kill_switch(limits)
                except GuardrailViolation as e:
                    paused_reason = f"paused: {e}"

            if paused_reason and (cycles == 1 or cycles % 12 == 0):
                print(f"[main] {paused_reason}", flush=True)

            if paused_reason is None:
                while not _stop:
                    prop = claim_proposal(conn)
                    if prop is None:
                        break
                    try:
                        res = process_proposal(conn, prop, broker_name, limits, bucket)
                        print(f"[main] proposal {prop['id']} → {res}", flush=True)
                    except Exception as e:                      # 처리 실패해도 루프는 살린다
                        conn.rollback()
                        print(f"[main] ERROR proposal {prop['id']}: {e}", flush=True)
                        with conn.cursor() as cur:              # 무한 재집기 방지
                            cur.execute("UPDATE trade_proposals SET status='pending' WHERE id=%s AND status='picked'",
                                        (prop["id"],))
                            conn.commit()
                        time.sleep(1)

            if max_cycles and cycles >= max_cycles:
                print(f"[main] max cycles {max_cycles} 도달 — 정지", flush=True)
                break
            for _ in range(int(interval * 10)):
                if _stop:
                    break
                time.sleep(0.1)

    print("[main] stopped", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
