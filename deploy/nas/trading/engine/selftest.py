"""셀프테스트 v3 (2차 적대 리뷰 반영 — 13 케이스, DB 부수효과까지 검증).

케이스: 1 정상왕복+DB검증 · 2 멱등재처리 · 3 건당한도 · 4 킬스위치=보류(거절 아님) ·
       5 NaN 차단 · 6 일손실한도(시드) · 7 브로커거절 · 8 브로커예외→FAILED+대사플래그 ·
       9 스윕 · 10 당일 명목가 총량 상한 · 11 symbol 형식(인젝션) · 12 KR 정수수량 ·
       13 실브로커 주문 있으면 스키마 DROP 거부
종료코드: 0=통과, 1=실패, 2=거부(킬스위치 ON 또는 루프 가동 중)
"""
import os
import sys
import time

from .core import (apply_schema, db_connect, load_limits, process_proposal, stale_sweep,
                   today_filled_notional_krw, KST_TODAY)
from .guardrails import GuardrailViolation, check_proposal, validate_kill_switch_dir
from .main import acquire_singleton
from .ratelimit import TokenBucket

RUN_ID = str(int(time.time()))
_seq = iter(range(1, 200))


def insert_proposal(conn, symbol="005930", qty="1", price="70000", expect_fail=False):
    ck = f"selftest:{RUN_ID}:{next(_seq)}"
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
    # 운영자가 킬스위치를 켜둔 상태면 테스트가 그걸 건드리면 안 된다.
    # (compose에서 selftest용 경로를 분리했지만, 같은 경로로 실행될 가능성도 방어)
    if os.path.exists(limits.kill_switch_path):
        print(f"REFUSED: kill switch is ON ({limits.kill_switch_path}) — 정지 상태에서 selftest 금지")
        return 2
    validate_kill_switch_dir(limits)

    bucket = TokenBucket(20)
    fails = []
    ok = lambda c, msg: None if c else fails.append(msg)

    with db_connect() as conn:
        # selftest는 스키마를 DROP+재생성한다 → 가동 중인 엔진 밑에서 돌면 안 된다.
        if not acquire_singleton(conn):
            print("REFUSED: trading-loop이 가동 중(advisory lock) — 먼저 정지: "
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

            # 3) 건당 명목가 상한
            big = insert_proposal(conn, qty="1000", price=str(int(limits.max_order_krw)))
            r3 = process_proposal(conn, big, "mock", limits, bucket)
            print(f"[3] over-limit: {r3}")
            ok(r3["outcome"] == "rejected" and "max_order_krw" in (r3.get("reason") or ""), "3: over-limit not rejected")

            # 4) 킬스위치 = **보류(deferred)**, 영구 거절이 아님. 제안은 pending 복귀.
            open(limits.kill_switch_path, "w").close()
            try:
                p4 = insert_proposal(conn)
                with conn.cursor() as c4:
                    c4.execute("UPDATE trade_proposals SET status='picked', picked_at=now() WHERE id=%s", (p4["id"],))
                    conn.commit()
                r4 = process_proposal(conn, p4, "mock", limits, bucket)
                print(f"[4] kill switch: {r4}")
                ok(r4["outcome"] == "deferred" and "KILL" in (r4.get("reason") or ""), "4: kill switch not deferred")
                ok(q1(cur, "SELECT status FROM trade_proposals WHERE id=%s", p4["id"]) == "pending",
                   "4: proposal not returned to pending")
                ok(q1(cur, "SELECT count(*) FROM trade_orders WHERE proposal_id=%s", p4["id"]) == 0,
                   "4: kill switch created an order row")
                ok(q1(cur, "SELECT count(*) FROM idempotency_keys WHERE key=%s", r4["idem_key"]) == 0,
                   "4: idem key not rolled back (재시도 불가 상태)")
            finally:
                os.remove(limits.kill_switch_path)
            # 보류된 제안이 킬스위치 해제 후 정상 처리되는지(자동 재개 실증)
            p4b = q1(cur, "SELECT id FROM trade_proposals WHERE id=%s", p4["id"])
            cur.execute("SELECT * FROM trade_proposals WHERE id=%s", (p4b,))
            r4b = process_proposal(conn, cur.fetchone(), "mock", limits, bucket)
            print(f"[4b] resume after kill switch off: {r4b}")
            ok(r4b["outcome"] == "filled", "4b: deferred proposal did not resume")

            # 5) NaN — DB CHECK가 먼저 막고, 파이썬 가드도 막는다
            try:
                insert_proposal(conn, qty="NaN")
                fails.append("5: NaN INSERT was accepted by DB")
                conn.commit()
            except Exception:
                conn.rollback()
                print("[5] NaN insert: blocked by DB CHECK")
            try:
                check_proposal(limits, "KR", "buy", float("nan"), 100.0, 0.0, 0.0)
                fails.append("5: python guard passed NaN")
            except GuardrailViolation:
                print("[5] NaN python guard: blocked")

            # 6) 일손실한도(원가 미구현이라 시드해서 경로만 검증)
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

            # 7) 브로커 거절
            p7 = insert_proposal(conn)
            r7 = process_proposal(conn, p7, "mock-reject", limits, bucket)
            print(f"[7] broker reject: {r7}")
            ok(r7["outcome"] == "rejected", "7: broker reject not handled")

            # 8) 브로커 예외 → FAILED + needs_reconcile
            p8 = insert_proposal(conn)
            r8 = process_proposal(conn, p8, "mock-explode", limits, bucket)
            print(f"[8] broker exception: {r8}")
            ok(r8["outcome"] == "failed", "8: broker exception not FAILED")
            ok(q1(cur, "SELECT state FROM trade_orders WHERE proposal_id=%s", p8["id"]) == "FAILED", "8: state != FAILED")
            ok(q1(cur, "SELECT needs_reconcile FROM trade_orders WHERE proposal_id=%s", p8["id"]) is True,
               "8: needs_reconcile not set")
            # 테스트가 만든 대사 플래그는 테스트가 해소한다(안 그러면 engine.main이 영구 HALT).
            cur.execute("UPDATE trade_orders SET reconciled_at=now() WHERE proposal_id=%s", (p8["id"],))
            conn.commit()
            ok(q1(cur, "SELECT count(*) FROM trade_orders WHERE needs_reconcile AND reconciled_at IS NULL") == 0,
               "8: selftest left unreconciled artifact")

            # 9) 갇힌 pending 키 → 스윕이 잡는지
            cur.execute("INSERT INTO idempotency_keys (key, kind, status, created_at) "
                        "VALUES ('trade:selftest-stale', 'trade', 'pending', now() - interval '1 hour') "
                        "ON CONFLICT (key) DO UPDATE SET status='pending', created_at=now() - interval '1 hour'")
            conn.commit()
            st = stale_sweep(conn)
            print(f"[9] stale sweep found: {len(st)}")
            ok(any(k == "trade:selftest-stale" for _, k, _ in st), "9: sweep missed stale key")
            cur.execute("DELETE FROM idempotency_keys WHERE key='trade:selftest-stale'")
            conn.commit()

            # 10) 당일 명목가 총량 상한 — 건당 한도는 통과하지만 누적으로 막히는가
            notional_now = today_filled_notional_krw(cur)
            print(f"[10] 당일 체결 명목가 누계: {notional_now:,.0f} / cap {limits.daily_notional_krw:,.0f}")
            tight = load_limits()
            tight.daily_notional_krw = notional_now + 1000   # 다음 주문이 반드시 걸리도록
            p10 = insert_proposal(conn, qty="1", price="70000")
            r10 = process_proposal(conn, p10, "mock", tight, bucket)
            print(f"[10] daily notional cap: {r10}")
            ok(r10["outcome"] == "rejected" and "daily notional" in (r10.get("reason") or ""),
               "10: daily notional cap not enforced")

            # 11) symbol 형식 — 인젝션이 임의 문자열을 종목으로 넣는 것
            try:
                insert_proposal(conn, symbol="EVIL01")
                fails.append("11: non-numeric symbol accepted by DB")
                conn.commit()
            except Exception:
                conn.rollback()
                print("[11] symbol 형식: blocked by DB CHECK")

            # 12) KR 정수 수량
            try:
                check_proposal(limits, "KR", "buy", 0.5, 1000.0, 0.0, 0.0)
                fails.append("12: fractional qty passed KR guard")
            except GuardrailViolation:
                print("[12] KR 소수 수량: blocked")

            # 13) 실브로커 주문이 있으면 스키마 DROP 거부
            cur.execute("INSERT INTO trade_orders (idem_key, state, broker) "
                        "VALUES ('selftest-realbroker-probe','REJECTED','kis-paper')")
            conn.commit()
            try:
                apply_schema(conn)
                fails.append("13: apply_schema wiped tables despite real-broker order")
            except RuntimeError as e:
                print(f"[13] 실주문 존재 시 스키마 리셋: blocked ({str(e)[:60]}...)")
            finally:
                conn.rollback()
                cur.execute("DELETE FROM trade_orders WHERE idem_key='selftest-realbroker-probe'")
                conn.commit()

    if fails:
        print("SELFTEST FAILED:", "; ".join(fails))
        return 1
    print("SELFTEST PASSED (13 cases): roundtrip/idempotency/order-cap/killswitch-defer+resume/"
          "NaN/daily-loss/broker-reject/broker-fail+reconcile/sweep/daily-notional-cap/symbol-format/"
          "KR-integer-qty/schema-guard")
    return 0


if __name__ == "__main__":
    sys.exit(main())
