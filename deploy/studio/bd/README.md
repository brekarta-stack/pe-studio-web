# bd-daily — 제안서 서브시스템 Studio 이관 (2026-07-28)

미니 `com.papercraft.bd-daily`의 이관본. 신규 B2B 리드를 발굴해 적합도 상위 1건을
풀 제안서로 작성하고 `#biz` 검토 카드로 발행한다. **고객 자동발송은 없다** — 승인 게이트가 있다.

## 이관하며 내린 판단

**선별 이관.** `~/agents` 전체는 5.1GB인데 이 잡의 런타임 의존물은 약 140MB다
(`reference/proposals` 92M · `outputs/proposals` 42M · `bin` · `config` · `templates` ·
`memory` · `mcp-servers` · `.claude`). 나머지(채널 에이전트 50종·대시보드·큐·vendor)는
C-1에서 폐기하기로 한 구조라 가져오지 않았고 미니와 함께 보낸다.
새 위치는 `~/agents-bd` — 이름을 바꿔 "구 시스템 전체가 아니라 이 서브시스템만"임을 드러냈다.

`bin/`은 3.1MB뿐이라 통째로 가져왔다. 제안서 경로가 부르는 스크립트를 정적 분석으로
정확히 추리려 했지만 `.bak-*` 파일들 때문에 의존 그래프가 오염됐다. 안 쓰는 스크립트는
호출되지 않는 한 무해하므로, 정확도를 추구하다 빠뜨리는 것보다 낫다고 판단했다.

## ★ 핵심: `claude --print`의 권한 함정

**이 잡은 2026-07-10 이후 18일간 매일 돌면서 산출물이 0건이었다. 아무도 몰랐다.**

- 마지막 성공 제안서: `2026-07-10-gyeongju-museum-tou-papercraft.json`
- 미니의 claude CLI 갱신: **2026-07-11** (2.1.206)
- 그 뒤 로그: `WebSearch`/`WebFetch`/`Write` 전부 "권한이 승인되지 않았습니다"

원인은 **`--print`(비대화형)에서 프로젝트 `.claude/settings.json`의 `permissions.allow`가
그대로 적용되지 않는다**는 것이다. 대화형이면 권한 프롬프트가 뜨지만, 헤드리스는
프롬프트를 띄울 데가 없으니 그냥 거부된다. 에이전트는 "추측 금지" 원칙을 지키느라
지어내는 대신 정직하게 멈췄고 — 그래서 실패가 크래시가 아니라 **정상 종료로 보였다.**

수정(`bin/ask`, 이 디렉터리의 `ask-permission-patch.txt`):

```python
cmd = ["claude", "--print", "--output-format", "text",
       "--mcp-config", str(ROOT / ".mcp.json"),
       "--permission-mode", "acceptEdits",
       "--allowed-tools",
       "Read", "Glob", "Grep", "TodoWrite", "Task", "WebSearch", "WebFetch",
       "Write", "Edit", "NotebookEdit"]
```

`--dangerously-skip-permissions`는 쓰지 않았다. 그건 Bash·삭제까지 여는 전면 우회다.
허용 목록은 원래 `settings.json`이 허용하던 범위와 같다.

> **다른 헤드리스 에이전트 잡에도 같은 함정이 있다.** launchd/cron에서 `claude --print`를
> 부르는 모든 잡은 이 플래그가 필요하다. 미니에 남은 잡들(sns-daily·learning-* 등)을
> 이관할 때 제일 먼저 확인할 것.

## 검증 (2026-07-28)

launchd 환경에서(내 셸 세션과 분리) `BD_DRY=1`로 실행:

- 실제 웹 리서치 수행 — 고양시청 신임 민경선 시장 2026-07-01 취임 + 「고양고양이」 공식
  부활을 찾아내 선정 근거로 사용(학습 데이터로는 알 수 없는 최신 사실)
- 5곳 스코어링 → 상위 1건 풀 제안서 작성
- 산출 JSON 유효, 8섹션 구조, 담당 부서·이메일·매칭 사례 2건 포함
- `pending` 8 → 9건

이 검증 뒤에 미니 잡을 껐다(`.disabled-20260728-studio`).

## 알려진 문제

- `outputs/proposals/pending/` 의 기존 8건 중 **3건은 JSON 파싱 실패** 상태다
  (`nfa-yeonghungi`, `nie-ecology-friends`, `independence-hall-mugunghwa-friends`).
  나머지 5건은 이미 원장에 있어 `proposal-publish`가 중복으로 건너뛴다.
  즉 "밀려 있는 제안서 8건"이 아니라 **깨진 3건 + 처리 완료 잔재 5건**이다.
- Google 토큰(슬라이드 덱 생성용)은 테스트 모드라 7일마다 만료된다.
  갱신 자체는 되지만, OAuth 앱을 Production으로 올리면 이 만료가 사라진다.

## 실행

```
launchctl kickstart gui/$(id -u)/com.agent.bd-daily     # 즉시 1회
BD_DRY=1 ~/agents-bd/scripts/bd-daily.sh                # 발행 없이 발굴만
```

로그: `~/agents-bd/logs/studio/bd-daily.log`
