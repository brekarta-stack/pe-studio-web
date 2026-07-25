# 매매 엔진 (D7 스켈레톤 v3 — 2차 적대 리뷰 반영) — C-5 구조의 결정적 실행부

```
[LLM 분석가]                     [이 엔진 (NAS 격리 컨테이너, GD-1)]
 trade_proposals INSERT만   ──→   가드레일 → 멱등성 게이트(GD-2) → 브로커 → 상태머신 기록
 (trade_analyst 롤, 주문권한 0)    킬스위치(fail-closed)·명목가 상한·총량 상한·토큰버킷 20/s
```

## 가드레일 — 지금 실제로 발화하는 것 / 아직 아닌 것

| 가드레일 | 상태 | 기본값 |
|---|---|---|
| 킬스위치(fail-closed, 상태 불명도 차단) | ✅ 발화 | `/data/KILL` 파일 |
| 건당 명목가 상한 | ✅ 발화 | `TRADE_MAX_ORDER_KRW` 50만 |
| **당일 명목가 총량 상한** ← 실질 브레이크 | ✅ 발화 | `TRADE_DAILY_NOTIONAL_KRW` 150만 |
| 시장 화이트리스트 / 종목 형식(`^[0-9]{6}$`) / KR 정수수량 | ✅ 발화 | `TRADE_ALLOWED_MARKETS=KR` |
| NaN·Infinity 차단(DB CHECK + isfinite) | ✅ 발화 | — |
| 제안 TTL(오래된 제안 expired) | ✅ 발화 | `TRADE_PROPOSAL_TTL_MIN` 30분 |
| **일 실현손실 한도** | ⚠️ **미발화** | 원가·포지션 미구현이라 `realized_krw`가 항상 0. 경로만 있고 조건이 참이 안 된다. KIS 단계에서 포지션/평단 테이블과 함께 구현. **그때까지 총 노출을 막는 건 위 총량 상한이다.** |
| 세션 캘린더(휴장·시간외) / 지정가 sanity / 종목 화이트리스트 | ⬜ 미구현 | KIS 단계 |

## 그 밖에 되는 것
- 상태머신 VALIDATED→SUBMITTED→FILLED/REJECTED/FAILED(+DB CHECK, 불법 전이 차단, 전이 필드 화이트리스트)
- 멱등성 2층: 행 단위(`idempotency_keys`) + **의도 단위**(`trade_proposals.client_key` UNIQUE)
- **킬스위치는 보류(deferred)**: 드레인 중 스위치가 켜지면 그 제안은 거절이 아니라 pending 복귀 → 해제 시 재개
- 실패 격리: 같은 제안 3회 실패 시 `picked`로 남기고 넘어감(무한 재시도 루프 방지)
- 대사(reconcile) 플래그: 브로커 예외 시 `needs_reconcile=true` → 엔진이 **주문을 멈춘다**(HALT)
- 관측: `/data/status.json`(active/paused/stopped) + compose healthcheck + `TRADE_HEARTBEAT_URL`

## 실행 (NAS)
```sh
cd ~/agent-backbone
sudo docker compose --profile trading up -d trading-loop   # 상시 폴링 루프
sudo docker ps --filter name=trading-loop                  # (healthy)면 실제로 주문 처리 중
sudo docker exec agent-backbone-trading-loop-1 cat /data/status.json
sudo docker compose --profile trading stop trading-loop
sudo docker compose --profile trading run --rm trading     # 셀프테스트(루프 정지 상태에서만, 13케이스)
```

## 비상 정지 (킬스위치)
```sh
sudo docker exec agent-backbone-trading-loop-1 touch /data/KILL   # ON — 다음 사이클(≤5초)부터 정지
sudo docker exec agent-backbone-trading-loop-1 rm /data/KILL      # OFF — 자동 재개(재시작 불필요)
```
루프가 안 떠 있을 때: `sudo docker compose --profile trading run --rm --no-deps trading touch /data/KILL`
- selftest는 `/data/KILL.selftest`를 쓴다 — **테스트가 운영 킬스위치를 지우지 않도록 경로가 분리돼 있다.**

## 갇힌 상태 런북
로그에 `WARN stale:` 또는 `HALT: 대사 미완`이 보이면:
1. `SELECT * FROM trade_orders WHERE needs_reconcile AND reconciled_at IS NULL;`
2. **브로커 체결내역과 대조** — 실제로 나갔는가?
3. 확인 후 `UPDATE trade_orders SET reconciled_at=now() WHERE id=...;` → 엔진이 자동 재개
4. ⚠️ 대사 확인 전에 멱등키를 지우지 말 것(지우면 재발사 가능 = 계약 위반)

## 스키마 주의
- 스켈레톤 단계 `init-trading.sql`은 DROP+재생성. **`apply_schema`가 non-mock 브로커 주문이 있으면 거부**한다
  (강제: `TRADE_FORCE_SCHEMA_RESET=1`).
- **KIS 단계 첫 작업 = 이 파일을 추가형 마이그레이션으로 전환**(DROP/DELETE 제거).

## KIS 연결 단계 (D10+, 사용자 개입 필수)
1. **자격증명은 사용자가 직접**: KIS Developers 모의투자 appkey/secret → NAS `.env`에 아래 이름으로.
   **이름의 정본은 `docker-compose.yml`의 trading-loop 환경변수다**(문서마다 달랐던 것을 통일):
   ```
   KIS_APPKEY=      KIS_APPSECRET=      KIS_ACCOUNT=      KIS_ENV=paper
   ```
   `.env`는 600 유지. 미니의 `kis_token*.json`은 토큰 캐시일 뿐이니 재사용하지 말고 새로 발급할 것.
   ⚠️ 미니에 **실전 키가 이미 존재**한다 — 모의용을 따로 발급해 `KIS_ENV=paper`로 두고,
   실전 전환은 사람이 명시적으로 바꾸는 것 외에는 일어나지 않게 한다.
   자동화 세션은 증권 자격증명을 다루지 않는다.
2. `KISBroker` 구현 — broker.py 독스트링의 필수 목록(토큰 앵커 갱신·웹소켓·세션 캘린더·지정가 전용·
   **기동 시 SUBMITTED↔KIS 주문조회 대사** · Decimal 전달 · 제출 타임아웃).
   참고 구현: `reference/kis-balance`, `reference/kis-order`(미니에서 회수, 시크릿 없음).
3. `trade_analyst` 롤에 LOGIN 부여 완료(비밀번호는 NAS `.env`) — n8n은 이 롤로만 접속한다.
4. 모의계좌 레이트리밋은 실전보다 낮음 — `TRADE_RATE_PER_SEC` 하향. 성공 기준: **모의 지정가 1건 왕복**.

## 설계 불변 (위반 금지)
- LLM에 주문권한·이 컨테이너 셸 접근 부여 금지. 분석가는 trade_proposals INSERT까지만.
- 분석가 `client_key`는 **LLM 출력과 무관**해야 한다(인젝션의 dedup 우회 차단).
- 시그널 판매·타인계좌 불법(§3-5). 본인 계좌만.
