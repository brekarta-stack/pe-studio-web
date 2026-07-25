"""결정적 매매 엔진 코어 (D7 스켈레톤 v3 — 2차 적대 리뷰 반영).

흐름(상태머신): proposal(pending) → [가드레일] VALIDATED → SUBMITTED → FILLED|REJECTED|FAILED
멱등성(GD-2): idempotency_keys check-then-act. 크래시 편향은 항상 "주문 누락(안전)" — 재발사 금지.

v2 반영: 전이필드 화이트리스트 · duplicate가 키 상태 반환 · 브로커 예외→FAILED · FILLED시 pnl UPSERT · 스윕
v3 반영: 킬스위치는 되돌리기(영구거절 아님) · duplicate 제안 종결(picked 잔류 신호 오염 제거) ·
        picked_at 기록 · needs_reconcile 컬럼(자유텍스트 LIKE 탈피) · 당일 명목가 합계 조회 ·
        apply_schema 안전장치(실주문 있으면 DROP 거부)
"""
import os

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json

from .broker import make_broker
from .guardrails import Limits, GuardrailViolation, KillSwitchOn, check_proposal

# 초기 상태(VALIDATED/REJECTED)는 INSERT 경로로 생성 — 이 맵은 UPDATE 전이만 다룬다.
VALID_TRANSITIONS = {
    "VALIDATED": {"SUBMITTED", "REJECTED"},
    "SUBMITTED": {"FILLED", "REJECTED", "CANCELLED", "FAILED"},
}
ALLOWED_TRANSITION_FIELDS = frozenset(
    {"broker_order_id", "filled_qty", "avg_price", "reject_reason", "needs_reconcile"})
KST_TODAY = "(now() AT TIME ZONE 'Asia/Seoul')::date"


def _env(name: str, default: str | None = None) -> str:
    v = os.environ.get(name, default)
    if v is None:
        raise RuntimeError(f"env {name} required")
    return v


def db_connect():
    return psycopg.connect(
        host=_env("PG_HOST", "postgres"), port=int(_env("PG_PORT", "5432")),
        user=_env("PG_USER"), password=_env("PG_PASSWORD"), dbname=_env("PG_DB"),
        row_factory=dict_row,
    )


def schema_present(conn) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('public.trade_proposals') IS NOT NULL AS ok")
        ok = cur.fetchone()["ok"]
    conn.commit()
    return bool(ok)


def apply_schema(conn, path: str = "/app/init-trading.sql"):
    """스키마 적용(스켈레톤 단계 DROP+CREATE).
    안전장치: mock이 아닌 브로커의 주문이 하나라도 있으면 거부 — 실매매 데이터를 테스트가 날리는 것 방지.
    강제하려면 TRADE_FORCE_SCHEMA_RESET=1."""
    if not os.path.exists(path):
        return False
    if schema_present(conn) and os.environ.get("TRADE_FORCE_SCHEMA_RESET") != "1":
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) AS n FROM trade_orders WHERE broker NOT LIKE 'mock%'")
            real = cur.fetchone()["n"]
        conn.commit()
        if real:
            raise RuntimeError(
                f"apply_schema 거부: 실브로커 주문 {real}건 존재 — DROP하면 매매 기록이 사라진다. "
                f"(추가형 마이그레이션으로 전환할 시점. 정말 지우려면 TRADE_FORCE_SCHEMA_RESET=1)")
    with open(path, encoding="utf-8") as f, conn.cursor() as cur:
        cur.execute(f.read())
    conn.commit()
    return True


def load_limits() -> Limits:
    return Limits(
        max_order_krw=float(_env("TRADE_MAX_ORDER_KRW", "500000")),
        daily_notional_krw=float(_env("TRADE_DAILY_NOTIONAL_KRW", "1500000")),
        daily_loss_limit_krw=float(_env("TRADE_DAILY_LOSS_LIMIT_KRW", "200000")),
        allowed_markets=tuple(_env("TRADE_ALLOWED_MARKETS", "KR").split(",")),
        kill_switch_path=_env("TRADE_KILL_SWITCH", "/data/KILL"),
    )


def today_realized_krw(cur) -> float:
    cur.execute(f"SELECT realized_krw FROM trade_daily_pnl WHERE trade_date = {KST_TODAY}")
    row = cur.fetchone()
    return float(row["realized_krw"]) if row else 0.0


def today_filled_notional_krw(cur) -> float:
    """당일(KST) 체결 명목가 합계 — 총 노출 상한의 기준."""
    cur.execute(
        "SELECT COALESCE(SUM(filled_qty * COALESCE(avg_price,0)), 0) AS s FROM trade_orders "
        f"WHERE state = 'FILLED' AND (created_at AT TIME ZONE 'Asia/Seoul')::date = {KST_TODAY}")
    return float(cur.fetchone()["s"])


def record_fill_pnl(cur, side: str, qty: float, avg_price: float):
    """FILLED 트랜잭션 안에서 호출 — 당일 손익 행을 항상 만든다.
    ⚠️ 스켈레톤: delta=0(원가/포지션 미구현) → **일손실한도는 아직 발화하지 않는다**.
    실질 브레이크는 guardrails의 당일 명목가 총량 상한. KIS 단계에서 포지션·평단 테이블과 함께 구현."""
    delta = 0.0
    cur.execute(
        f"INSERT INTO trade_daily_pnl (trade_date, realized_krw) VALUES ({KST_TODAY}, %s) "
        "ON CONFLICT (trade_date) DO UPDATE SET realized_krw = trade_daily_pnl.realized_krw + EXCLUDED.realized_krw, updated_at = now()",
        (delta,))


def transition(cur, order_id: int, old: str, new: str, **fields):
    if new not in VALID_TRANSITIONS.get(old, set()):
        raise RuntimeError(f"illegal transition {old} -> {new}")
    bad = set(fields) - ALLOWED_TRANSITION_FIELDS
    if bad:
        raise RuntimeError(f"disallowed transition fields: {bad}")   # 컬럼명 주입 차단
    sets = ", ".join(f"{k} = %({k})s" for k in fields)
    sql = f"UPDATE trade_orders SET state = %(new)s, updated_at = now(){', ' + sets if sets else ''} WHERE id = %(id)s AND state = %(old)s"
    cur.execute(sql, {"new": new, "old": old, "id": order_id, **fields})
    if cur.rowcount != 1:
        raise RuntimeError(f"transition race on order {order_id} ({old}->{new})")


def unreconciled_count(cur) -> int:
    cur.execute("SELECT count(*) AS n FROM trade_orders WHERE needs_reconcile AND reconciled_at IS NULL")
    return int(cur.fetchone()["n"])


def stale_sweep(conn, minutes: int = 10) -> list:
    """갇힌 상태 목록 — pending으로 오래된 멱등키 + 비종결 주문 + 집힌 채 방치된 제안.
    picked 판정은 picked_at 기준(created_at으로 하면 백로그 드레인이 전부 오탐)."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT k.key, k.created_at FROM idempotency_keys k "
            "WHERE k.kind='trade' AND k.status='pending' AND k.created_at < now() - (%s * interval '1 minute')",
            (minutes,))
        stale_keys = cur.fetchall()
        cur.execute(
            "SELECT id, state, updated_at FROM trade_orders "
            "WHERE state IN ('VALIDATED','SUBMITTED') AND updated_at < now() - (%s * interval '1 minute')",
            (minutes,))
        stale_orders = cur.fetchall()
        cur.execute(
            "SELECT id, picked_at FROM trade_proposals "
            "WHERE status='picked' AND picked_at IS NOT NULL AND picked_at < now() - (%s * interval '1 minute')",
            (minutes,))
        stale_props = cur.fetchall()
    conn.commit()
    return [("key", r["key"], r["created_at"]) for r in stale_keys] + \
           [("order", r["id"], f"{r['state']}@{r['updated_at']}") for r in stale_orders] + \
           [("proposal", r["id"], f"picked@{r['picked_at']}") for r in stale_props]


def _idem_key(prop: dict) -> str:
    if prop.get("client_key"):
        return f"trade:ck:{prop['client_key']}"
    return f"trade:{prop['id']}:{prop['market']}:{prop['symbol']}:{prop['side']}:{prop['qty']}:{prop['limit_price']}"


def process_proposal(conn, prop: dict, broker_name: str, limits: Limits, bucket) -> dict:
    """제안 1건 처리. outcome: filled|rejected|failed|duplicate|deferred

    deferred = 킬스위치로 보류(제안은 pending 복귀, 멱등키 미소비) — 나중에 다시 처리된다.
    """
    idem_key = _idem_key(prop)

    with conn.cursor() as cur:
        # ── 멱등성 게이트 (GD-2) ──
        cur.execute(
            "INSERT INTO idempotency_keys (key, kind, status) VALUES (%s, 'trade', 'pending') ON CONFLICT (key) DO NOTHING",
            (idem_key,))
        if cur.rowcount == 0:
            cur.execute("SELECT status, created_at FROM idempotency_keys WHERE key = %s", (idem_key,))
            k = cur.fetchone()
            # 제안을 종결시킨다 — 안 그러면 picked로 영구 잔류해 스윕의 "크래시 잔재" 신호를 오염시킨다.
            cur.execute("UPDATE trade_proposals SET status='done' WHERE id=%s AND status='picked'", (prop["id"],))
            conn.commit()
            return {"outcome": "duplicate", "idem_key": idem_key,
                    "key_status": k["status"] if k else "?", "key_created_at": str(k["created_at"]) if k else "?"}

        # ── 가드레일 ──
        try:
            check_proposal(limits, prop["market"], prop["side"], float(prop["qty"]),
                           float(prop["limit_price"]), today_realized_krw(cur), today_filled_notional_krw(cur))
        except KillSwitchOn as e:
            # 일시 정지 — 거절이 아니다. 멱등키를 되돌리고 제안을 pending으로 복귀시킨다.
            conn.rollback()
            with conn.cursor() as c2:
                c2.execute("DELETE FROM idempotency_keys WHERE key=%s AND status='pending'", (idem_key,))
                c2.execute("UPDATE trade_proposals SET status='pending', picked_at=NULL WHERE id=%s AND status='picked'",
                           (prop["id"],))
                conn.commit()
            return {"outcome": "deferred", "reason": str(e), "idem_key": idem_key}
        except GuardrailViolation as e:
            cur.execute(
                "INSERT INTO trade_orders (proposal_id, idem_key, state, broker, reject_reason) "
                "VALUES (%s, %s, 'REJECTED', %s, %s) RETURNING id",
                (prop["id"], idem_key, broker_name, str(e)))
            oid = cur.fetchone()["id"]
            cur.execute("UPDATE idempotency_keys SET status='done', result=%s WHERE key=%s",
                        (Json({"outcome": "rejected", "reason": str(e)}), idem_key))
            cur.execute("UPDATE trade_proposals SET status='rejected' WHERE id=%s", (prop["id"],))
            conn.commit()
            return {"outcome": "rejected", "order_id": oid, "reason": str(e), "idem_key": idem_key}

        cur.execute(
            "INSERT INTO trade_orders (proposal_id, idem_key, state, broker) VALUES (%s, %s, 'VALIDATED', %s) RETURNING id",
            (prop["id"], idem_key, broker_name))
        oid = cur.fetchone()["id"]
        conn.commit()

    # ── 제출 (의도 커밋 → 부작용 순서: 크래시 시 편향은 '누락', 재발사 아님) ──
    bucket.acquire(1)
    broker = make_broker(broker_name)
    with conn.cursor() as cur:
        transition(cur, oid, "VALIDATED", "SUBMITTED")
        conn.commit()
    try:
        res = broker.submit_limit_order(prop["market"], prop["symbol"], prop["side"],
                                        float(prop["qty"]), float(prop["limit_price"]))
    except Exception as e:   # 예외 = FAILED + 대사 필요("나갔을 수도 있다")
        with conn.cursor() as cur:
            transition(cur, oid, "SUBMITTED", "FAILED",
                       reject_reason=f"broker exception: {e}", needs_reconcile=True)
            cur.execute("UPDATE idempotency_keys SET status='failed', result=%s WHERE key=%s",
                        (Json({"outcome": "failed", "error": str(e)}), idem_key))
            cur.execute("UPDATE trade_proposals SET status='done' WHERE id=%s", (prop["id"],))
            conn.commit()
        return {"outcome": "failed", "order_id": oid, "reason": str(e), "idem_key": idem_key}

    with conn.cursor() as cur:
        if res.ok:
            transition(cur, oid, "SUBMITTED", "FILLED",
                       broker_order_id=res.broker_order_id, filled_qty=res.filled_qty, avg_price=res.avg_price)
            record_fill_pnl(cur, prop["side"], float(res.filled_qty), float(res.avg_price or 0))
            outcome = "filled"
        else:
            # TODO(D10+): KIS가 타임아웃을 '거절 형태'로 반환하는 응답이 있으면 needs_reconcile=True로
            #             표시해야 한다. 어댑터 구현 시 응답 코드별 분기 필요.
            transition(cur, oid, "SUBMITTED", "REJECTED", reject_reason=res.reason or "broker reject")
            outcome = "rejected"
        cur.execute("UPDATE idempotency_keys SET status='done', result=%s WHERE key=%s",
                    (Json({"outcome": outcome, "broker_order_id": res.broker_order_id}), idem_key))
        cur.execute("UPDATE trade_proposals SET status='done' WHERE id=%s", (prop["id"],))
        conn.commit()
    return {"outcome": outcome, "order_id": oid, "broker_order_id": res.broker_order_id,
            "reason": res.reason, "idem_key": idem_key}
