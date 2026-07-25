"""하드 가드레일 (C-5: LLM 제안은 이 검증을 통과해야만 주문이 된다 — 타협 불가).

리뷰 반영:
 v2 — NaN/Infinity 차단(A1) · 킬스위치 fail-closed(A5)
 v3 — 킬스위치를 별도 예외로 분리(일시정지 ≠ 영구거절) · **당일 명목가 총량 상한**(일손실한도가
      스켈레톤에서 발화 불가능하므로 이것이 실질 브레이크다) · KR 정수수량 검증
"""
import math
import os
from dataclasses import dataclass


@dataclass
class Limits:
    max_order_krw: float          # 1회 주문 명목가 상한
    daily_notional_krw: float     # ★ 당일 체결 명목가 합계 상한 = 총 노출의 실질 상한
    daily_loss_limit_krw: float   # 일 실현손실 한도(원가 구현 전까지 미발화 — README 참조)
    allowed_markets: tuple
    kill_switch_path: str


class GuardrailViolation(Exception):
    """영구 거절 사유(한도 초과·잘못된 값 등). 제안은 rejected로 종결된다."""


class KillSwitchOn(GuardrailViolation):
    """일시 정지 사유. **제안을 거절하지 말고 되돌려야 한다** — 킬스위치는 '나중에 다시'이지
    '이 제안은 틀렸다'가 아니다. (2차 리뷰: 킬스위치 켜는 몇 초 사이에 집힌 제안이
    영구 거절되고 client_key 때문에 재생성도 안 되던 문제.)"""


def validate_kill_switch_dir(limits: Limits):
    """기동 시 1회: 킬스위치 디렉터리가 접근 가능해야 엔진 가동 허용.
    볼륨 미마운트/권한 오류로 스위치가 '안 보이는' 채 주문하는 것 방지."""
    d = os.path.dirname(limits.kill_switch_path) or "/"
    try:
        os.stat(d)
    except OSError as e:
        raise GuardrailViolation(f"kill switch dir {d} inaccessible ({e}) — 엔진 기동 거부(fail-closed)")


def check_kill_switch(limits: Limits):
    try:
        if os.path.exists(limits.kill_switch_path):
            raise KillSwitchOn(f"KILL SWITCH ON ({limits.kill_switch_path}) — 신규 주문 전면 정지")
        # exists()는 EACCES에서 False를 주므로 부모 디렉터리 접근성으로 이중 확인(fail-closed)
        os.stat(os.path.dirname(limits.kill_switch_path) or "/")
    except GuardrailViolation:
        raise
    except OSError as e:
        raise KillSwitchOn(f"kill switch state unknown ({e}) — fail-closed, 주문 차단")


def check_proposal(limits: Limits, market: str, side: str, qty: float, limit_price: float,
                   today_realized_krw: float, today_filled_notional_krw: float = 0.0):
    check_kill_switch(limits)
    if market not in limits.allowed_markets:
        raise GuardrailViolation(f"market {market} not allowed {limits.allowed_markets}")
    if side not in ("buy", "sell"):
        raise GuardrailViolation(f"invalid side {side}")
    # NaN은 모든 비교에 False라 부등호 검사를 전부 통과한다 — isfinite를 먼저.
    if not (math.isfinite(qty) and math.isfinite(limit_price)):
        raise GuardrailViolation(f"non-finite qty/limit_price (qty={qty}, price={limit_price})")
    if qty <= 0 or limit_price <= 0:
        raise GuardrailViolation("qty/limit_price must be positive")
    if market == "KR" and qty != int(qty):
        raise GuardrailViolation(f"KR 시장은 정수 수량만 (qty={qty})")

    notional = qty * limit_price
    if not math.isfinite(notional) or notional > limits.max_order_krw:
        raise GuardrailViolation(f"notional {notional:,.0f} > max_order_krw {limits.max_order_krw:,.0f}")

    # ★ 총 노출 상한. 건당 상한만 있으면 "50만원 × 제안 N건"으로 무제한 노출된다(2차 리뷰).
    if today_filled_notional_krw + notional > limits.daily_notional_krw:
        raise GuardrailViolation(
            f"daily notional cap: 오늘 체결 {today_filled_notional_krw:,.0f} + 이번 {notional:,.0f} "
            f"> {limits.daily_notional_krw:,.0f} — 오늘 신규 주문 차단")

    if today_realized_krw <= -limits.daily_loss_limit_krw:
        raise GuardrailViolation(
            f"daily loss limit hit ({today_realized_krw:,.0f} ≤ -{limits.daily_loss_limit_krw:,.0f}) — 오늘 신규 주문 차단")
    # TODO(D10+): 세션 캘린더(KRX/미국 정규·주간, 휴장일) · 종목 화이트리스트 ·
    #             지정가 sanity(현재가 대비 밴드) · 포지션 합산 상한
