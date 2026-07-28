# CLAUDE.md — 개인 에이전트 오케스트레이션 시스템 설계 마스터 컨텍스트 (통합본 v2, 2026-07-22)

> **Claude Code에게**: 이 파일은 이 설계 프로젝트의 상시 컨텍스트다. 세션 시작 시 이 문서를 기준으로 삼아라.
> (레포 루트 `CLAUDE.md`는 papercraft.kr 웹앱용이므로 이 설계와 별개다 — 혼동 금지.)
> **통합 근거**: 이 v2는 두 독립 설계(사용자 문서 5종 + Claude 세션 산출물)를 대조·판정·통합한 결과다. 대조표=`design-reconciliation.md`, 게이팅=`gating-decisions.md`.
> **불변 원칙**: (1) 클로드 편향 금지 — 멀티모델 전제. (2) 2주 완성·초보 제약 최우선. (3) 확정을 뒤집으려면 근거 제시. (4) 1인 시스템의 적은 확장성 부족이 아니라 과잉 복잡성 — 단순함·복구가능성·관측성 우선.

---

## A. 고정 전제
- 1인 운영, 초보, **총 2주** 완성.
- 하드웨어(**2기기 확정**): **Mac Studio M3 Ultra 96GB (24/7)** + **UGREEN DXP4800 Plus NAS (x86, RAM 8→32GB, 24/7)**. **Mac mini M4 24GB = 이관용 과도기 기기 → 검증 후 제거**(디바이스 대수 축소).
- **탈클로드**: Claude 외 OpenAI/Kimi/로컬(Ollama) 등 작업별 엔진 선택.
- **무중단(최우선)**: 구독 토큰 소진돼도 운영·관제·매매 지속 → 운영 런타임은 **API 키/로컬 기반**, Claude Code는 개발 도구로만.
- **토큰/비용 최적화**가 핵심 가치.

## B. 운영 목적 + 실제 사업 3
목적 10: 주식 자동매매(KR+US) · 자료수집·학습(퀴즈·아카이빙) · 링크드인 발행 · 업무+구글일정 · 사업 리드→블로그→견적 · 멀티모델 라우팅 · 영상 파이프라인 · 프로젝트관리·관제 · 무중단·토큰최적화 · 보이스 어학(영/일).
**실제 사업 3개(실측 확정)**: `biz-a`=페이퍼크래프트(papercraft.kr) · `biz-b`=지역재생(regen) · `biz-c`=스타트업강의(edu). *(자기점검 리포트로 확인. 나머지 21개 채널은 전략부재 → §I 재편.)*

## C. 확정 아키텍처 (2기기)

**C-0 배치도**
```
NAS DXP4800+ 32GB (24/7 어플라이언스 백본)
  Docker: n8n + Postgres(+pgvector) · LiteLLM · 매매 엔진(격리 컨테이너) · Uptime Kuma · 백업데몬
Mac Studio 96GB (24/7 컴퓨트)
  로컬 추론 전 티어(소형 상주 + Coder/35B, 80B는 JIT) · voicebridge 음성비서 · 이미지(FLUX) · 개발 세션
+ 외부 클라우드 모니터(healthchecks.io/UptimeRobot) — NAS·Studio 생존 감시(감시자 분리)
Slack(Socket Mode) — #ops #approvals #trading #inbox (보고·승인·명령 창구)
```

**C-1 코어 패턴** — n8n(NAS)이 결정적 워크플로 실행, LLM은 워크플로 안 "한 스텝"으로만. **폐기**: 채널별 상시 챗 에이전트가 실행 주체. 슬랙=보고·승인 창구로 축소.

**C-2 모델 관문** — LiteLLM(NAS) 단일 게이트. 작업별 라우팅·비용집계·예산캡·폴백. 워크플로는 **역할 별칭**만 호출(11종, `routing-design.md`). 무중단 실체=예산소진 시 자동 강등.

**C-3 하드웨어 역할(미니 제거 반영)** — NAS=24/7 백본(어플라이언스급, macOS 재부팅 무관). **Studio=24/7 컴퓨트**: 로컬 티어 상주(콜드스타트 복잡성 소멸), 음성·이미지·개발. 로컬 티어의 유일 집(NAS CPU는 추론 부적합). macOS 업데이트 재부팅 순간만 LiteLLM이 클라우드 저가로 백스톱.

**C-4 관제** — n8n Insights + LiteLLM UI + Uptime Kuma(NAS, 컨테이너 감시) + **외부 클라우드 모니터(NAS 자체 감시)** + 슬랙 #ops. 자체 대시보드 재제작 금지. "편리한 스킬 편집"=n8n 웹 편집기.

**C-5 매매(타협 불가)** — LLM 분석가(장전/장후, 읽기전용, 주문권한 0) → 구조화 JSON → 결정적 엔진(python-kis, **NAS 컨테이너**, GD-1)이 하드 가드레일 검증 후 주문.

**하드 가드레일 — 2026-07-25 구현 실측 반영**: ① 1회 주문 명목가 상한 ② **당일 명목가 총량 상한(= 지금의 실질 브레이크)**
③ 일 실현손실 한도 — **포지션·평단 테이블 구현 전까지 발화하지 않는다**(실현손익이 항상 0이라 조건이 참이 안 됨. KIS 단계에서 활성)
④ 킬스위치(파일, fail-closed) ⑤ 시장·종목형식 화이트리스트 ⑥ 제안 TTL. 총 노출의 상한은 ②가 정한다 — ①만 있으면 "상한 × 제안 N건"으로 무제한이다. 상태머신·킬스위치·일손실한도·레이트리밋(20/s 토큰버킷)·토큰 세션앵커 갱신·웹소켓 재접속·**멱등성(GD-2)**. 브로커=KIS OpenAPI(국내+미국, 모의→실전). 본인계좌만 합법(시그널 판매=불법). kis-balance 읽기전용 잔고조회는 이미 가동 중(착수 기점).

**C-6 보안·네트워크** — Tailscale 사설망(관리 UI 전용), 슬랙 Socket Mode(인바운드 0), NAS 포트포워딩 금지, 최소권한(매매 LLM 읽기전용). NAS 내 컨테이너는 컨테이너명 통신. NAS 랜선 상시 연결(단절 구간엔 매매 halt).

**IP 안정화 — 2026-07-25 실측 반영 정정**: 원안은 "기기 참조는 **MagicDNS 호스트네임으로만**"이었으나
**NAS 호스트에서는 MagicDNS가 해석되지 않는다**(Tailscale이 컨테이너로 돌아 호스트 `/etc/resolv.conf`를
관리하지 않음. Studio에서는 정상 해석). 호스트 DNS를 바꾸는 것은 UGOS 업데이트가 되돌리는 취약한 변경이라
채택하지 않는다. 따라서 현행 규칙은:
- **LAN IP(192.168.x·172.30.x) 하드코딩은 여전히 금지** — 실제로 두 번 어긋났다(이사로 서브넷 변경, .25→.10).
- **Tailscale IP(100.x)는 허용**한다. 노드에 고정 할당돼 DHCP로 움직이지 않으므로 C-6의 원래 목적(드리프트 생존)은 충족한다.
- 잔여 위험: 노드를 Tailscale에서 삭제·재등록하면 100.x가 바뀐다 → **복구 런북에 "새 IP로 .env·Kuma 모니터 갱신" 단계 필수**.
- Studio 쪽 참조는 MagicDNS가 되므로 그쪽부터 이름으로 옮겨도 좋다(선택).

**C-7 라우팅** — 상세 `routing-design.md`. 별칭 11종 + 폴백 + 4대 게이트(자동승급·예산·프라이버시·시간대). 로컬티어=Studio 상시. **클라우드 저가(Kimi)=재부팅 순간 백스톱**. EXAONE=개인학습 전용(비상업).

**C-8 운영 vs 개발 분리** — 운영 자동화(n8n)와 프로덕트 개발(Claude Code 세션)은 **별개 프로토콜**. 접점은 얇은 **`portfolio/projects.yaml`**(레포·단계·고객·마일스톤·상태) + 주간 다이제스트(council-project-review 재활용)뿐. 자동화가 프로덕트를 **관측·공급**(리드→고객, 트렌드→기회), 개발은 관리 안 함. 상세 `product-portfolio-management.md`.

## D. 게이팅 결정 — **3개 모두 확정**(`gating-decisions.md`)
1. **매매 엔진 위치 = NAS 컨테이너**(GD-1).
2. **멱등성 = 단일 키 테이블 check-then-act**(GD-2, 매매·발행·이메일).
3. **RTO/RPO 등급별 + 매매 엔진 LLM-옵셔널(직접 API 우회 폴백)**(GD-3).

**남은 열린 결정(구현 중 확정)**: 리드/파트/매매 스키마·SSOT, 재시도·백오프·DLQ, 키 로테이션, 별칭별 실제 예산금액, 로컬 산출물 eval 하네스, 프롬프트 인젝션 신뢰경계(수집→발행/매매), **미니 하드코딩 감사**(제거 전 필수), 40잡/24채널 이주 순서(§I), ADR 습관화.

## E. 안티패턴 (반복 금지)
LLM 직접 주문권한 · 자체 관제 대시보드 재제작 · 채널별 상시 챗 에이전트로 실행백본 · 운영을 구독토큰 의존 · 네이버 블로그 셀레니움 자동발행 · 프로덕트 개발을 n8n에 밀어넣기 · Kubernetes/마이크로서비스 과분할 등 1인 과잉설계 · **효과 미검증 스킬 블라인드 이식**(qc-eval 로그로 먼저 측정).

## F. 사실 참고 (2026-07 리서치·실측)
- **T1 실측**: Studio에서 qwen3.6:35b-a3b **83 tok/s**, 도구호출/JSON 자동채점 통과. 단 대외 견적서에서 가격 10× 오류·사실 날조 → **대외 산출물=프런티어 고정**.
- 96GB 메모리 예산: OS+음성 ~12GB / 소형 상주 ~7GB / Coder-30B ~31GB 상주 가능(여유 ~46GB). **80B는 30B와 동시 상주 불가 → JIT 스왑**. 로컬 코더는 루틴 코딩엔 충분, 최난도는 `code-max`(Claude) 승급.
- NAS/UGOS: Docker 실사용 OK, 단 월례 OS업데이트가 Docker 재시작+권한리셋 → `restart:unless-stopped`+자동업데이트 OFF+장외 수동. 텔레메트리 옵트아웃+DNS차단. 플랜B=TrueNAS/Debian(보증 무해).
- n8n 자기사업 무료 · SQLite 정전파손 → **Postgres 백엔드** · LiteLLM 메모리릭 → 버전핀+메모리상한. Kimi 국제 API 저가 티어.
- 네이버/티스토리 글쓰기 API 폐지 → WordPress 완전자동/네이버 반자동. LinkedIn 심사(2~8주)·YouTube 감사(2~4주, 미통과=업로드 private) → 조기 신청. 영상=Kling API·한국어 TTS=Supertone.
- 백업: pg_dump + N8N_ENCRYPTION_KEY 별도보관 + **오프사이트(B2)** + 복원 리허설. 이미지 버전핀.

## G. 2주 실행 계획 (도메인 게이트 반영 재정렬 — `14-day-plan.md`)
- **D1(대부분 완료)**: ✅인벤토리·백업4레포·좀비정리. 남음: 신청5종(LinkedIn·YouTube·KIS·Kling·Supertone).
- **Track A 인프라(D2–D5, 도메인 무관)**: D2(금,32GB) NAS Docker(n8n+Postgres+LiteLLM+Kuma)+Studio 24/7 하드닝(pmset·ollama 서비스·모델 상주)+Tailscale MagicDNS · D3 LiteLLM 별칭·폴백·예산캡+스튜디오 로컬티어 검증 · D4 Kuma+외부모니터+Socket Mode 4채널+미니 하드코딩 감사 · D5 백업3-2-1+복원리허설+**공용 골격(파트 정의 테이블)**.
- ~~**🚧 GATE**: 도메인 정의~~ ✅ **통과(2026-07-28)** → `domain-definition.md`가 정의의 원본.
  남은 것: 24채널 재편 O/X(`channel-reorg-proposal.md`).
- **Track B-무관(D6–D9)**: 업무·일정 / 매매 엔진 스켈레톤(모의 1왕복) / 어학 보이스(voicebridge Studio 이식).
- **Track B-종속(D10–14, 게이트 후, 이월 허용)**: 수집→퀴즈 / SNS / 리드→블로그→견적 / 영상 MVP.
- **성공 기준**: Track 0+A+B무관 완주. 컷 순서 영상→보이스→퀴즈. 매매는 반쯤 만들 바엔 3주차로.

## H. 11영역 지식 체크리스트 (누락 방지)
컴포넌트·토폴로지 / 데이터 / 통합·시크릿 / 모델·라우팅 / 오케스트레이션(멱등성·HITL) / 신뢰성·가용성(SPOF) / 보안(최소권한·인젝션·매매격리) / 관측성 / 배포·운영(IaC·백업·롤백) / 비용(FinOps) / 진화·이주(교살자). 상세 `architecture-knowledge-map.md`, 성숙도 `design-maturity-checklist.md`.

## I. 이주·재편 (교살자, "켜기 전에 끈다")
- **24채널 → 3사업 + 도메인독립(투자·학습·업무·어학) + 개인 1~2 + 폐기.** 처분 O/X는 `channel-reorg-proposal.md`.
- **재활용 검증 자산**: sns_lines.json·learning.json(파트 정의 테이블 직접 재료) · kis-balance · qc-eval 루프.
- **40잡 이관**: 신 플로우 검증 → 대응 잡 OFF(중복발송 방지) → 최후 celery/slackbot 정리. 미니는 voicebridge Studio 이식·40잡 이관 검증 후 제거.

---

## 동봉 문서
`agent-orchestration-architecture.md`(상세 설계) · `routing-design.md`(별칭) · `gating-decisions.md`(게이팅 3) · `design-reconciliation.md`(통합 대조) · `design-maturity-checklist.md` · `architecture-knowledge-map.md` · `14-day-plan.md` · `channel-reorg-proposal.md` · `domain-definition-template.md` · `product-portfolio-management.md` · `current-system-domains.md`.

## 세션 종료 시
설계·결정 갱신 시 이 파일 업데이트 + 중요한 결정은 ADR로. 다음 세션 맥락 연속성 확보.
