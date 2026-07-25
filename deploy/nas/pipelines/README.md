# 공용 파이프라인 런타임 (D5 골격 — 배포본)

> 설계 근거·패턴은 `deploy/pipelines/README.md`. 여기는 **NAS에서 실제로 도는 것**의 사용법.

## 구성

| 파일 | 역할 |
|---|---|
| `init-parts.sql` | `part_definitions` 테이블 + `leads.dedup_key` + `pipeline_runner` 롤 (추가형, 재적용 안전) |
| `load-parts.py` | `part-definitions.yaml` → upsert SQL 생성(NAS 시스템 python3 + pyyaml만 필요) |
| `sync-parts.sh` | 위 둘을 묶어 실행 — **YAML 고친 뒤 이것만 돌리면 반영** |

## 흐름

```
deploy/pipelines/part-definitions.yaml   ← 사람이 편집(SSOT, 주석 포함)
        │  sync-parts.sh
        ▼
   part_definitions 테이블               ← n8n이 읽는 런타임 소스
        │
        ▼
공용 워크플로 1개 × 파트 N개              ← 사업 추가 = 표에 행 추가(워크플로 복제 없음)
```

## 사용

```sh
# YAML 수정 후 반영(멱등)
cd ~/agent-backbone && sh pipelines/sync-parts.sh
```
- YAML에서 사라진 파트는 **비활성화(active=false)** 되고 삭제되지 않는다("대체 검증 전 삭제 금지").
- `active=false` 또는 `lead_gen.enabled=false`인 파트는 워크플로 **쿼리 단계에서 걸러진다**
  → 도메인 게이트 통과 전에는 biz-a만 돈다. 게이트 후 b/c의 `active: true`만 켜면 끝.

## 권한 분리 (C-5와 같은 원칙)

| 롤 | 할 수 있는 것 | 못 하는 것 |
|---|---|---|
| `pipeline_runner` (n8n 사업 파이프라인) | `part_definitions` 읽기 · `leads` 읽기·쓰기 · `idempotency_keys` **(kind=publish\|email 그리고 key 접두사가 kind와 일치할 때만 — RLS가 강제)** | 매매 테이블 일체, `trade:` 키(조회조차 불가) |
| `trade_analyst` (n8n 매매 분석가) | `trade_proposals` 제안 INSERT(컬럼 한정) | 주문·멱등키·손익, 리드, 파트 정의 |
| `agent` (엔진·관리) | 전부(테이블 소유자라 RLS 우회) | — |

> 멱등키 테이블은 GD-2 결정에 따라 매매와 **공유**한다. 그래서 kind만 막으면 부족하다 —
> `kind='publish'`인 채 `key='trade:...'`를 심으면 매매 엔진이 그 제안을 "이미 처리됨"으로 보고
> **주문 없이 종결**한다(무단 주문은 못 내지만 매매를 조용히 멈출 수 있다).
> RLS 정책이 `key LIKE kind || ':%'`까지 강제하는 이유다.

## 실측 검증 (2026-07-25)
- **크레덴셜 감사**(`wf-credential-audit.json`): n8n이 실제로 `pipeline_runner`/`trade_analyst`로 접속하고
  둘 다 `is_superuser=off`, pipeline_runner가 보는 `trade:` 키 0개 — 권한 분리가 장식이 아님을 확인.
- `sync-parts.sh` → biz-a active / biz-b·c inactive 반영.
- 공용 리드발굴 워크플로: **파트 1개로 end-to-end 1회 통과**. `classify-fast` 스코어링 → `leads` 적재 →
  같은 날 재실행 시 중복 0건. ⚠️ **N>1 fan-out(파트 2개 이상 동시 순회)은 아직 미검증** — 게이트 후 스모크 필요.
- RLS 네거티브 테스트: pipeline_runner의 `trade` 키 INSERT는 정책 위반으로 거부, DELETE는 권한 없음.

## 활성화 전 교체할 것
`wf-leadgen-generic.json`의 **`수집`** 노드 → 네이버 검색 API / 구글 뉴스 노드.
⚠️ **노드 이름은 정확히 `수집`으로 유지**하고 타입만 바꿔라 — 뒤 노드 3곳이 `$('수집')`으로 참조한다
(삭제 후 새로 만들면 참조가 런타임에 깨진다).

## 알려진 공백 (게이트 전에 채울 것)
- `leads.contact` 미채움, 수집 단계가 데모 Set 노드 — 실제 검색 API 연결 전까지 영업에 쓸 수 없다.
- 실패·무행 알림이 #ops로 안 간다(Slack 크레덴셜 대기). 지금은 `활성 파트 있는지` 필터가
  0행일 때 조용히 끝나므로, 전 사업 중단이 "성공"으로 보인다.
- `pricebooks/*.yaml`·`templates/*.html`(견적용) 실체 파일 없음.
