# 무엇이 어디서 도는가 — 관측·조작 지점 지도 (2026-07-25)

> "이 자동화는 n8n에서 볼 수 있나?"에 대한 답. **n8n은 워크플로 자동화만** 담당하고,
> 인프라 자동화(백업·부팅·하트비트)와 격리 실행(매매 엔진)은 의도적으로 n8n **밖**에 산다(C-1, GD-1).

## 한눈에

| 자동화 | 사는 곳 | 보는 곳 | 조작 |
|---|---|---|---|
| 아침 브리핑(08:30) | **n8n** 워크플로 | n8n UI → Executions | n8n UI에서 Active 토글 |
| 매매 분석가(장전 08:20) | **n8n** 워크플로 | n8n UI → Executions | n8n UI |
| n8n↔LiteLLM 스모크 | **n8n** 워크플로 | n8n UI | 수동 실행 |
| **매매 주문 실행** | NAS 도커 `trading-loop` | `docker logs`, `trade_orders` 테이블 | 킬스위치 파일 / compose |
| 일일 백업(03:30) | NAS cron | `/volume2/backup/agent-backbone/backup.log` | `install-cron.sh` |
| 생존 하트비트(5분) | NAS cron | healthchecks.io(가입 후) | `heartbeat.url` 파일 |
| 부팅 복구 | NAS cron `@reboot` | `/var/log/agent-backbone-boot.log` | — |
| 컨테이너 감시 | Uptime Kuma | `http://100.86.100.119:3001` | Kuma UI |
| 모델 라우팅·예산 | LiteLLM | `http://100.86.100.119:4000` (Admin UI) | 가상 키 |
| 음성 비서 | Studio launchd | `http://localhost:8765` | `launchctl` |

## n8n에서 볼 수 있는 것 (http://100.86.100.119:5678, Tailscale 필요)

현재 워크플로 3종 — 전부 **inactive**(수동 실행만, 스케줄 미가동):

| 워크플로 | ID | 상태 | 활성화 조건 |
|---|---|---|---|
| `smoke: n8n→LiteLLM` | `tbsmoke000000001` | 검증 완료 | (테스트용, 활성화 불필요) |
| `업무·일정: 아침 브리핑` | `tbbrief000000001` | 골격 E2E 성공 | Google Calendar OAuth + Slack 크레덴셜 |
| `매매: LLM 분석가 → 제안 큐` | `tbanalyst0000001` | **E2E 성공** | 시세·뉴스 소스 노드 연결 |

- **Executions 탭**에 실행 이력과 노드별 입출력 데이터가 남는다(성공/실패, 소요시간 포함).
- 크레덴셜 2종이 등록돼 있다: `LiteLLM n8n-ops`(예산 $25/월 걸린 가상 키), `PG trade_analyst`(제안 INSERT 전용 DB 롤).
- ⚠️ n8n CLI로 실행할 땐 브로커 포트 충돌 회피 필요: `-e N8N_RUNNERS_BROKER_PORT=5699`

## 매매가 n8n 밖인 이유 (C-5 / GD-1, 타협 불가)

```
n8n(분석가) ──제안 INSERT──> [Postgres] <──집기── trading-loop(격리 컨테이너)
  · trade_analyst 롤              큐            · 가드레일·킬스위치·멱등성·상태머신
  · 주문 테이블 권한 0                           · 여기만 브로커에 주문을 낸다
```
n8n이 침해되거나 프롬프트 인젝션을 당해도 **주문을 낼 수 없다** — DB 권한이 없기 때문(실측 검증됨).
이 경계를 n8n 안으로 합치면 설계가 무너진다.

## 자주 쓰는 확인 명령

```bash
ssh nas 'sudo docker ps --format "{{.Names}}\t{{.Status}}"'
```
```bash
ssh nas 'sudo docker logs agent-backbone-trading-loop-1 --tail 20'
```
```bash
ssh nas 'sudo tail -20 /volume2/backup/agent-backbone/backup.log'
```

## 매매 엔진 상태 확인 ("Up"과 "주문 처리 중"은 다르다)

```bash
ssh nas 'sudo docker exec agent-backbone-trading-loop-1 cat /data/status.json'
```
```json
{"state":"active|paused|stopped","detail":"멈춘 이유","processed":3,"ts":"..."}
```
- `paused`는 킬스위치 ON 또는 대사 미완(HALT). **컨테이너는 Up인 채로 주문만 안 낸다.**
- `.env`에 `TRADE_HEARTBEAT_URL`(Kuma push 또는 healthchecks)을 넣으면 **active일 때만** 핑을 보낸다
  → 멈추면 모니터가 자동으로 빨간불. 조용한 정지를 막는 장치.
- 실측 드릴: 킬스위치 ON → 8초 내 `paused`, OFF → 자동 `active` 복귀(재시작 불필요).

## Kuma 모니터 4종 (http://100.86.100.119:3001)

| 모니터 | 방식 | 무엇을 잡는가 |
|---|---|---|
| studio-ollama | HTTP | Studio 로컬 티어 다운 |
| n8n | HTTP | n8n 웹 다운 |
| litellm | HTTP | 게이트웨이 다운 |
| **trading-loop(push)** | **Push** | **"컨테이너는 Up인데 주문을 안 내는" 상태** |

push 방식인 이유: 매매 엔진은 킬스위치·대사 미완 시 **의도적으로 살아있되 멈춘다**.
HTTP 감시로는 이걸 못 잡는다. 엔진이 `active`일 때만 핑을 보내므로, 멈추면 핑이 끊겨 빨간불이 된다.
- 실측 왕복(2026-07-25): 킬스위치 ON → `No heartbeat in the time window`(빨강) → OFF → `OK`(초록).

## 관측 공백 (알고 있을 것)
- n8n 워크플로가 inactive면 아무 일도 안 일어난다 — Executions가 비어 있는 게 정상.
  **현재 워크플로 7종 전부 inactive**(placeholder를 실물로 바꾸기 전엔 켜도 무의미하거나 비용만 든다).
- Kuma → Slack 알림 미연결: 빨간불이 떠도 **아무도 안 부른다**. 웹훅 등록이 남은 사용자 작업.
- n8n 워크플로 실패는 Executions에만 남고 #ops로 안 간다(Slack 크레덴셜 대기).
