# 매매 엔진 스켈레톤 (D7, v2 — 적대 리뷰 반영) — C-5 구조의 결정적 실행부

```
[LLM 분석가]                     [이 엔진 (NAS 격리 컨테이너, GD-1)]
 trade_proposals INSERT만   ──→   가드레일 → 멱등성 게이트(GD-2) → 브로커 → 상태머신 기록
 (trade_analyst 롤, 주문권한 0)    킬스위치(fail-closed)·일손실한도·토큰버킷 20/s
```

## 지금 되는 것
- 상태머신(+DB CHECK) · 전이 필드 화이트리스트 · 크래시 편향=주문 누락(안전, 재발사 없음)
- 가드레일: 명목가 상한 / **일손실한도(FILLED가 trade_daily_pnl UPSERT — 데이터원 보장)** /
  시장 화이트리스트 / **NaN·Infinity 차단(DB CHECK+isfinite 이중)** / **킬스위치 fail-closed**
- 멱등성: 행 단위(idempotency_keys) + **의도 단위(`trade_proposals.client_key` UNIQUE)** —
  제안자(n8n)는 재시도 안전을 위해 client_key를 결정적으로 채울 것(예: `analyst:2026-07-25:005930:buy`)
- 갇힌 상태 스윕(`stale_sweep`): pending 키/비종결 주문 목록 — selftest 기동 시 경고 출력
- 셀프테스트 9케이스(왕복/멱등/한도/킬스위치/NaN/일손실/브로커거절/브로커예외/스윕) + DB 부수효과 검증

## 실행 (NAS)
```sh
cd ~/agent-backbone
sudo docker compose --profile trading up -d trading-loop   # 상시 폴링 루프(제안→검증→주문)
sudo docker logs agent-backbone-trading-loop-1 --tail 20
sudo docker compose --profile trading stop trading-loop    # 정지
sudo docker compose --profile trading run --rm trading     # 셀프테스트(루프 정지 상태에서만)
```
- **셀프테스트는 스키마를 DROP+재생성**하므로 루프 가동 중엔 advisory lock으로 **거부**된다(의도된 안전장치).
- 루프는 단일 인스턴스만 가능(같은 advisory lock) — 두 번째는 즉시 종료(exit 3).
- **HALT 상태**(대사 미완 주문 존재): 컨테이너는 살아있되 주문을 안 낸다. 로그에 이유가 주기적으로 찍힌다.
  → "컨테이너 Up"과 "주문 처리 중"은 다르다. 로그로 구분할 것.
**킬스위치(비상 전면 정지)** — 상시 컨테이너가 없어도 동작하는 형태(C19):
```sh
sudo docker compose --profile trading run --rm --no-deps trading touch /data/KILL   # ON
sudo docker compose --profile trading run --rm --no-deps trading rm /data/KILL     # OFF
```
셀프테스트는 운영자 킬스위치가 켜져 있으면 **실행을 거부**한다(exit 2) — 끄지 않는다.

## 갇힌 상태 런북 (A4)
selftest/기동 로그에 `WARN stale:`가 보이면: `trade:` pending 키 = 과거 크래시 잔재.
1) `trade_orders`에서 해당 idem_key 조회 → SUBMITTED면 **브로커 체결내역과 대사 후** 수동 종결
2) 대사 확인 전엔 키를 지우지 말 것(지우면 재발사 가능해짐 — 계약 위반)

## 스키마 주의
- 스켈레톤 단계 `init-trading.sql`은 **DROP+재생성**(현재 데이터=selftest뿐, 엔진이 기동 시 자동 적용).
- **KIS 단계 첫 작업 = 이 파일을 추가형 마이그레이션으로 전환**(DROP 제거). 실데이터 이후 DROP 금지.

## KIS 연결 단계 (D10+, 사용자 개입 필수)
1. **자격증명은 사용자가 직접**: KIS Developers 모의투자 appkey/secret → NAS `.env`에
   `KIS_APPKEY= KIS_APPSECRET= KIS_ACCOUNT=` (600 유지). 미니의 kis_token*.json 재사용 금지(새 발급).
   자동화 세션은 증권 자격증명을 다루지 않는다.
2. `KISBroker` 구현 — broker.py 독스트링의 필수 목록(토큰 앵커 갱신·웹소켓·캘린더·지정가·
   **기동 시 SUBMITTED↔KIS 주문조회 대사** · PG advisory lock 단일 인스턴스 · Decimal 전달).
   참고 구현: `reference/kis-balance`, `reference/kis-order`(미니에서 회수한 검증 코드, 시크릿 없음).
3. `trade_analyst` 롤에 LOGIN+비밀번호 부여(사용자) → n8n 분석가 워크플로는 이 롤로만 접속.
4. 모의계좌 레이트리밋은 실전보다 낮음 — bucket 하향. 성공 기준: **KIS 모의 지정가 1건 왕복**.

## 설계 불변 (위반 금지)
- LLM에 주문권한·이 컨테이너 셸 접근 부여 금지. 분석가는 trade_proposals INSERT까지만.
- 시그널 판매·타인계좌 불법(§3-5). 본인 계좌만.
