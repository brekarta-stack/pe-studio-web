"""모의 1왕복 셀프테스트 v2 (리뷰 C17 반영 — DB 부수효과까지 검증).

케이스: 1) 정상 왕복+DB 검증 2) 멱등 재처리(주문 1개 유지) 3) 한도 초과 4) 킬스위치(자기 파일만)
       5) NaN 관통 차단 6) 일손실한도 발화 7) 브로커 거절 8) 브로커 예외→FAILED 9) 갇힌 상태 스윕
종료코드: 0=통과, 1=실패, 2=운영자 킬스위치 가동 중(테스트 거부 — A3).
"""
import os
import sys
import time

from .core import (apply_schema, db_connect, load_limits, process_proposal, stale_sweep,
                   KST_TODAY)
from .guardrails import validate_kill_switch_dir
from .main import acquire_singleton
from .ratelimit import TokenBucket

RUN_ID = str(int(time.time()))  # 실행마다 유일 — 과거 실행의 멱등키와 충돌 방지(밀폐성)
_seq = iter(range(1, 100))


def insert_proposal(conn, symbol="005930", qty="1", price="70000"):
    ck = f"selftest:{RUN_ID}:{next(_seq)}"   # client_key 경로(A7)를 기본 사용 — 의도-단위 멱등 커버
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO trade_proposals (client_key, source, market, symbol, side, qty, limit_price, rationale) "
            "VALUES (%s, 'selftest', 'KR', %s, 'buy', %s::numeric, %s::numeric, 'selftest') RETURNING *",
            (ck, symbol, qty, price))
        row = cur.fetchone()
        conn.commit()
        return row


def q1(cur, sql, *args):
    cur.execute(sql, args)
    r = cur.fetchone()
    return list(r.values())[0] if r else None


def main() -> int:
    limits = load_limits()
    # A3: 운영자가 킬스위치를 켜둔 상태면 테스트가 그걸 건드리면 안 된다 — 즉시 거부.
    if os.path.exists(limits.kill_switch_path):
        print(f"REFUSED: kill switch is ON ({limits.kill_switch_path}) — 운영자 정지 상태에서 selftest 금지")
        return 2
    validate_kill_switch_dir(limits)

    bucket = TokenBucket(20)
    fails = []
    ok = lambda c, msg: None if c else fails.append(msg)

    with db_connect() as conn:
        # selftest는 스키마를 DROP+재생성한다 → 가동 중인 엔진 밑에서 돌면 실데이터/실행중 주문이 날아간다.
        # 엔진과 같은 advisory lock을 잡아 보고, 못 잡으면 = 엔진 가동 중 = 거부.
        if not acquire_singleton(conn):
            print("REFUSED: trading-loop이 가동 중(advisory lock) — 먼저 정지시킬 것: "
                  "docker compose --profile trading stop trading-loop")
            return 2

        applied = apply_schema(conn)
        print(f"[0] schema {'applied' if applied else 'skip (no file)'}")
        for item in stale_sweep(conn):
            print(f"[0] WARN stale: {item}")

        with conn.cursor() as cur:
            # 1) 정상 왕복 + DB 부수효과
            p = insert_proposal(conn)
            r1 = process_proposal(conn, p, "mock", limits, bucket)
            print(f"[1] round trip: {r1}")
            ok(r1["outcome"] == "filled", "1: not filled")
            ok(q1(cur, "SELECT count(*) FROM trade_orders WHERE proposal_id=%s", p["id"]) == 1, "1: order rows != 1")
            ok(q1(cur, "SELECT state FROM trade_orders WHERE proposal_id=%s", p["id"]) == "FILLED", "1: state != FILLED")
            ok(q1(cur, "SELECT status FROM trade_proposals WHERE id=%s", p["id"]) == "done", "1: proposal not done")
            ok(q1(cur, "SELECT status FROM idempotency_keys WHERE key=%s", r1["idem_key"]) == "done", "1: key not done")

            # 2) 멱등 재처리 — 주문 행이 늘지 않아야 함
            r2 = process_proposal(conn, p, "mock", limits, bucket)
            print(f"[2] replay: {r2}")
            ok(r2["outcome"] == "duplicate" and r2.get("key_status") == "done", "2: replay not dedup/done")
            ok(q1(cur, "SELECT count(*) FROM trade_orders WHERE proposal_id=%s", p["id"]) == 1, "2: order rows grew")

            # 3) 한도 초과
            big = insert_proposal(conn, qty="1000", price=str(int(limits.max_order_krw)))
            r3 = process_proposal(conn, big, "mock", limits, bucket)
            print(f"[3] over-limit: {r3}")
            ok(r3["outcome"] == "rejected", "3: over-limit not rejected")

            # 4) 킬스위치 (여기 도달 = 시작 때 없었음 → 자기 파일만 만들고 지움)
            open(limits.kill_switch_path, "w").close()
            try:
                p4 = insert_proposal(conn)
                r4 = process_proposal(conn, p4, "mock", limits, bucket)
                print(f"[4] kill switch: {r4}")
                ok(r4["outcome"] == "rejected" and "KILL" in (r4.get("reason") or ""), "4: kill switch not blocking")
            finally:
                os.remove(limits.kill_switch_path)

            # 5) NaN — DB CHECK가 먼저 막는지(A1). INSERT 자체가 거부돼야 정상.
            try:
                insert_proposal(conn, qty="NaN")
                fails.append("5: NaN INSERT was accepted by DB")
                conn.commit()
            except Exception:
                conn.rollback()
                print("[5] NaN insert: blocked by DB CHECK")
            # 파이썬 가드도 확인(엔진에 NaN이 들어온 상황 가정)
            from .guardrails import check_proposal, GuardrailViolation
            try:
                check_proposal(limits, "KR", "buy", float("nan"), 100.0, 0.0)
                fails.append("5: python guard passed NaN")
            except GuardrailViolation:
                print("[5] NaN python guard: blocked")

            # 6) 일손실한도 발화 (pnl 시드 후 차단 확인 — A2)
            cur.execute(
                f"INSERT INTO trade_daily_pnl (trade_date, realized_krw) VALUES ({KST_TODAY}, %s) "
                "ON CONFLICT (trade_date) DO UPDATE SET realized_krw = EXCLUDED.realized_krw",
                (-limits.daily_loss_limit_krw,))
            conn.commit()
            p6 = insert_proposal(conn)
            r6 = process_proposal(conn, p6, "mock", limits, bucket)
            print(f"[6] daily-loss block: {r6}")
            ok(r6["outcome"] == "rejected" and "daily loss" in (r6.get("reason") or ""), "6: loss limit not blocking")
            cur.execute(f"DELETE FROM trade_daily_pnl WHERE trade_date = {KST_TODAY}")
            conn.commit()

            # 7) 브로커 거절 → REJECTED
            p7 = insert_proposal(conn)
            r7 = process_proposal(conn, p7, "mock-reject", limits, bucket)
            print(f"[7] broker reject: {r7}")
            ok(r7["outcome"] == "rejected", "7: broker reject not handled")

            # 8) 브로커 예외 → FAILED (+RECONCILE 표식)
            p8 = insert_proposal(conn)
            r8 = process_proposal(conn, p8, "mock-explode", limits, bucket)
            print(f"[8] broker exception: {r8}")
            ok(r8["outcome"] == "failed", "8: broker exception not FAILED")
            ok(q1(cur, "SELECT state FROM trade_orders WHERE proposal_id=%s", p8["id"]) == "FAILED", "8: state != FAILED")
            # 테스트가 만든 RECONCILE_NEEDED는 테스트가 치운다 — 안 그러면 engine.main이 이 산출물 때문에
            # 영구 HALT한다(실측). 실제 주문이 아니므로 대사 완료로 표시.
            cur.execute("UPDATE trade_orders SET reject_reason = replace(reject_reason,'RECONCILE_NEEDED','RECONCILED_SELFTEST') "
                        "WHERE proposal_id=%s", (p8["id"],))
            conn.commit()
            ok(q1(cur, "SELECT count(*) FROM trade_orders WHERE reject_reason LIKE %s", "%RECONCILE_NEEDED%") == 0,
               "8: selftest left RECONCILE_NEEDED artifact")

            # 9) 갇힌 pending 키 시뮬레이션 → 스윕이 잡는지
            cur.execute("INSERT INTO idempotency_keys (key, kind, status, created_at) "
                        "VALUES ('trade:selftest-stale', 'trade', 'pending', now() - interval '1 hour') "
                        "ON CONFLICT (key) DO UPDATE SET status='pending', created_at=now() - interval '1 hour'")
            conn.commit()
            st = stale_sweep(conn)
            print(f"[9] stale sweep found: {len(st)}")
            ok(any(k == "trade:selftest-stale" for _, k, _ in st), "9: sweep missed stale key")
            cur.execute("DELETE FROM idempotency_keys WHERE key='trade:selftest-stale'")
            conn.commit()

    if fails:
        print("SELFTEST FAILED:", "; ".join(fails))
        return 1
    print("SELFTEST PASSED: roundtrip/idempotency/limit/killswitch/NaN/daily-loss/reject/failed/sweep (9/9)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
