"""결정적 매매 엔진 코어 (D7 스켈레톤 v2 — 적대 리뷰 반영).

흐름(상태머신): proposal(pending) → [가드레일] VALIDATED → SUBMITTED → FILLED|REJECTED|FAILED
멱등성(GD-2): idempotency_keys check-then-act. 크래시 편향은 항상 "주문 누락(안전)" — 재발사 금지.
리뷰 반영: 전이필드 화이트리스트(A8) · duplicate가 키 상태 반환(A4) · 브로커 예외→FAILED(B11) ·
          FILLED 시 pnl UPSERT(A2, KST 날짜 B16) · 갇힌 상태 스윕(A4) · 스키마 자동적용(A6).
"""
import os

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json

from .broker import make_broker
from .guardrails import Limits, GuardrailViolation, check_proposal

# 초기 상태(VALIDATED/REJECTED)는 INSERT 경로로 생성 — 이 맵은 UPDATE 전이만 다룬다(A9).
VALID_TRANSITIONS = {
    "VALIDATED": {"SUBMITTED", "REJECTED"},
    "SUBMITTED": {"FILLED", "REJECTED", "CANCELLED", "FAILED"},
}
ALLOWED_TRANSITION_FIELDS = frozenset({"broker_order_id", "filled_qty", "avg_price", "reject_reason"})
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


def apply_schema(conn, path: str = "/app/init-trading.sql"):
    """A6: 이미지에 동봉된 스키마를 적용(스켈레톤 단계 DROP+CREATE — 파일 헤더 주의 참조)."""
    if not os.path.exists(path):
        return False
    with open(path, encoding="utf-8") as f, conn.cursor() as cur:
        cur.execute(f.read())
    conn.commit()
    return True


def load_limits() -> Limits:
    return Limits(
        max_order_krw=float(_env("TRADE_MAX_ORDER_KRW", "500000")),
        daily_loss_limit_krw=float(_env("TRADE_DAILY_LOSS_LIMIT_KRW", "200000")),
        allowed_markets=tuple(_env("TRADE_ALLOWED_MARKETS", "KR").split(",")),
        kill_switch_path=_env("TRADE_KILL_SWITCH", "/data/KILL"),
    )


def today_realized_krw(cur) -> float:
    cur.execute(f"SELECT realized_krw FROM trade_daily_pnl WHERE trade_date = {KST_TODAY}")
    row = cur.fetchone()
    return float(row["realized_krw"]) if row else 0.0


def record_fill_pnl(cur, side: str, qty: float, avg_price: float):
    """A2: FILLED 트랜잭션 안에서 호출 — 일손실한도의 데이터원을 항상 만든다.
    스켈레톤: 매수=실현손익 0(원가 취득), 매도=0 + TODO(KIS 단계에서 원가기반 실현손익 계산).
    당일 행 자체를 보장하는 것이 핵심(없으면 한도 체크가 영원히 0만 본다)."""
    delta = 0.0  # TODO(D10+): sell이면 (체결가-평단)*qty. 포지션/평단 테이블과 함께 구현.
    cur.execute(
        f"INSERT INTO trade_daily_pnl (trade_date, realized_krw) VALUES ({KST_TODAY}, %s) "
        "ON CONFLICT (trade_date) DO UPDATE SET realized_krw = trade_daily_pnl.realized_krw + EXCLUDED.realized_krw, updated_at = now()",
        (delta,))


def transition(cur, order_id: int, old: str, new: str, **fields):
    if new not in VALID_TRANSITIONS.get(old, set()):
        raise RuntimeError(f"illegal transition {old} -> {new}")
    bad = set(fields) - ALLOWED_TRANSITION_FIELDS
    if bad:
        raise RuntimeError(f"disallowed transition fields: {bad}")  # A8: 컬럼명 주입 차단
    sets = ", ".join(f"{k} = %({k})s" for k in fields)
    sql = f"UPDATE trade_orders SET state = %(new)s, updated_at = now(){', ' + sets if sets else ''} WHERE id = %(id)s AND state = %(old)s"
    cur.execute(sql, {"new": new, "old": old, "id": order_id, **fields})
    if cur.rowcount != 1:
        raise RuntimeError(f"transition race on order {order_id} ({old}->{new})")


def stale_sweep(conn, minutes: int = 10) -> list:
    """A4: 갇힌 상태 목록 — pending으로 오래된 멱등키 + 비종결 주문 + 집힌 채 방치된 제안.
    크래시 잔재 탐지용. 기동 시 출력, 루프에선 주기 실행+알림."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT k.key, k.created_at FROM idempotency_keys k "
            "WHERE k.kind='trade' AND k.status='pending' AND k.created_at < now() - make_interval(mins => %s)",
            (minutes,))
        stale_keys = cur.fetchall()
        cur.execute(
            "SELECT id, state, updated_at FROM trade_orders "
            "WHERE state IN ('VALIDATED','SUBMITTED') AND updated_at < now() - make_interval(mins => %s)",
            (minutes,))
        stale_orders = cur.fetchall()
        # 'picked'로 남은 제안 = 처리 중 크래시 또는 duplicate로 종결 없이 남은 것(재집기 방지 상태)
        cur.execute(
            "SELECT id, created_at FROM trade_proposals "
            "WHERE status='picked' AND created_at < now() - make_interval(mins => %s)",
            (minutes,))
        stale_props = cur.fetchall()
    return [("key", r["key"], r["created_at"]) for r in stale_keys] + \
           [("order", r["id"], f"{r['state']}@{r['updated_at']}") for r in stale_orders] + \
           [("proposal", r["id"], f"picked@{r['created_at']}") for r in stale_props]


def _idem_key(prop: dict) -> str:
    # A7: 제안자가 client_key(의도 단위)를 줬으면 그것으로 — 재시도 INSERT가 새 행이 돼도 같은 키.
    if prop.get("client_key"):
        return f"trade:ck:{prop['client_key']}"
    return f"trade:{prop['id']}:{prop['market']}:{prop['symbol']}:{prop['side']}:{prop['qty']}:{prop['limit_price']}"


def process_proposal(conn, prop: dict, broker_name: str, limits: Limits, bucket) -> dict:
    """제안 1건 처리. 반환 outcome: filled|rejected|failed|duplicate"""
    idem_key = _idem_key(prop)

    with conn.cursor() as cur:
        # ── 멱등성 게이트 (GD-2) ──
        cur.execute(
            "INSERT INTO idempotency_keys (key, kind, status) VALUES (%s, 'trade', 'pending') ON CONFLICT (key) DO NOTHING",
            (idem_key,))
        if cur.rowcount == 0:
            cur.execute("SELECT status, created_at FROM idempotency_keys WHERE key = %s", (idem_key,))
            k = cur.fetchone()
            conn.commit()
            # A4: pending인 채 발견 = 이전 크래시 잔재 가능 — 호출자가 stale_sweep/런북으로 해소
            return {"outcome": "duplicate", "idem_key": idem_key,
                    "key_status": k["status"] if k else "?", "key_created_at": str(k["created_at"]) if k else "?"}

        # ── 가드레일 ──
        try:
            check_proposal(limits, prop["market"], prop["side"], float(prop["qty"]),
                           float(prop["limit_price"]), today_realized_krw(cur))
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
    except Exception as e:  # B11: 예외 = FAILED. 단 타임아웃류는 "나갔을 수도" — D10 대사(reconcile) 대상.
        with conn.cursor() as cur:
            transition(cur, oid, "SUBMITTED", "FAILED", reject_reason=f"broker exception: {e} [RECONCILE_NEEDED]")
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
            transition(cur, oid, "SUBMITTED", "REJECTED", reject_reason=res.reason or "broker reject")
            outcome = "rejected"
        cur.execute("UPDATE idempotency_keys SET status='done', result=%s WHERE key=%s",
                    (Json({"outcome": outcome, "broker_order_id": res.broker_order_id}), idem_key))
        cur.execute("UPDATE trade_proposals SET status='done' WHERE id=%s", (prop["id"],))
        conn.commit()
    return {"outcome": outcome, "order_id": oid, "broker_order_id": res.broker_order_id,
            "reason": res.reason, "idem_key": idem_key}
