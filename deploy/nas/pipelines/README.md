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
| `pipeline_runner` (n8n 사업 파이프라인) | `part_definitions` 읽기, `leads` 읽기·쓰기 | 매매 테이블 일체 |
| `trade_analyst` (n8n 매매 분석가) | `trade_proposals` 제안 INSERT | 주문·멱등키·손익, 리드 |
| `agent` (엔진·관리) | 전부 | — |
→ 사업 파이프라인이 침해돼도 매매를 못 건드리고, 그 반대도 마찬가지다.

## 실측 검증 (2026-07-25)
- `sync-parts.sh` → biz-a active / biz-b·c inactive 반영 확인
- 공용 리드발굴 워크플로 실행 → 활성 파트만 순회 → `classify-fast` 스코어링(0.6) → `leads` 적재
- **재실행 시 중복 0건**(`dedup_key` UNIQUE + `ON CONFLICT DO NOTHING`)

## 활성화 전 교체할 것
`wf-leadgen-generic.json`의 **"수집 (데모)"** 노드 → 네이버 검색 API / 구글 뉴스 노드.
나머지 단계(파트 로드·스코어링·임계값·적재·중복방지)는 그대로 쓴다.
