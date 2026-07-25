# D2 배포 런북 — NAS 백본 + Studio 24/7 (금요일, RAM 32GB 도착 후)

> 목표: 하루 안에 백본 컨테이너 4종 기동 + Studio 로컬 티어 상시화 + Tailscale 연결.
> ⚠️ 모든 image 태그는 설치 시점 현재 안정판으로 핀(§compose 주석). 지식 컷오프 이후 버전 재확인.

## 0. 선행 (RAM 증설)
- NAS 전원 OFF → 8GB + 32GB(또는 16+16=32) 장착 → 부팅 → UGOS에서 메모리 인식 확인.
- UGOS: 텔레메트리 OFF(제어판) + **자동 업데이트 OFF**(월례 수동). SSH 활성(제어판>터미널).

## 1. Tailscale (기기 이름 고정 = IP 안정화)
- NAS·Studio에 Tailscale 로그인(같은 계정). MagicDNS ON.
- 각 기기 이름 확인: `tailscale status`. 이 이름을 config의 `N8N_HOST`/`STUDIO_HOST`에 사용(IP 금지).
- 공유기: NAS·Studio DHCP 예약(고정 IP). **포트포워딩은 하지 않음.**

## 2. Studio 하드닝 (로컬 티어)
```bash
bash deploy/studio/harden-studio.sh   # pmset · ollama를 **Studio Tailscale IP(100.x)에만** 바인딩 · 모델 4종 pull
#  ⚠️ 0.0.0.0 바인딩이 아니다(H2 수정 이후). 따라서 localhost:11434는 응답하지 않는다 —
#     Studio에서 테스트할 때도 http://100.65.201.6:11434 를 써야 한다.
bash deploy/studio/ollama-warmup.sh   # (선택) 즉시 워밍업. 상시화는 com.agent.ollama-warmup.plist
# macOS 방화벽 ON. 출력의 Tailscale 이름을 기록(STUDIO_HOST).
```

## 3. NAS 백본 기동
```bash
# NAS SSH 접속 후, 데이터 볼륨에 배포 파일 배치(/volume1/...). 레포에서 deploy/nas/ 복사.
cp deploy/nas/.env.example deploy/nas/.env    # .env 실제 값 채우기(패스워드매니저에도)
#  - N8N_ENCRYPTION_KEY: openssl rand -hex 16
#  - PG_PASSWORD: openssl rand -hex 24
#  - LITELLM_MASTER_KEY: echo "sk-$(openssl rand -hex 24)"   # ★ 반드시 sk- 접두(H4)
#  - NAS_TS_IP: `tailscale ip -4`  (NAS의 100.x — LAN IP 아님, H1)
#  - STUDIO_OLLAMA_BASE=http://<studio-ts-ip>:11434  (harden-studio.sh 출력값)
#  - N8N_HOST=nas.<tailnet>.ts.net
# litellm-config.yaml: 모델ID(claude/gpt/kimi)를 현재값으로 교체. compose의 image 태그 핀.
cd deploy/nas
# (포트 충돌 예방) 3001·4000·5678이 UGOS 다른 앱과 겹치지 않는지 확인: lsof -i :3001 등
docker compose up -d
docker compose ps          # 4개 up + postgres healthy 확인
docker compose logs -f litellm   # 라우터 로드 확인
# UGOS: 제어판>Docker에서 '컨테이너 자동 시작' 켜기(월례 재부팅 후 restart 정책이 실제로 동작하도록)
```

### 3-b. 스키마 확인 (기존 볼륨 재배포 시, M1)
`init-db.sql`은 **Postgres 볼륨이 비었을 때만 1회** 실행된다. 재배포·복원 등으로 볼륨이 이미 있으면 수동 적용:
```bash
docker compose exec -T postgres psql -U $PG_USER -d $PG_DB < init-db.sql   # 전부 IF NOT EXISTS라 안전
docker compose exec postgres psql -U $PG_USER -d $PG_DB -c "\dt"           # idempotency_keys·leads·archive 확인
```

## 4. 스모크 테스트
```bash
# LiteLLM 라우팅(로컬) — Tailscale 내부에서
curl -s http://nas.<tailnet>.ts.net:4000/v1/chat/completions \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" -H "Content-Type: application/json" \
  -d '{"model":"classify-fast","messages":[{"role":"user","content":"분류 테스트: 안녕"}],"stream":false}'
# → Studio ollama로 응답 오면 로컬 티어 OK.
# 폴백 시연: Studio에서 ollama 잠깐 중지 → 같은 요청 → kimi-cheap로 폴백되면 무중단 OK.
```

## 5. 접속 확인 (전부 Tailscale 내부)
- n8n:    http://nas.<tailnet>.ts.net:5678
- LiteLLM: http://nas.<tailnet>.ts.net:4000  (Admin UI에서 가상 키+예산 설정)
- Kuma:   http://nas.<tailnet>.ts.net:3001

## 6. D2 완료 기준
- [ ] 컨테이너 4종 up, postgres healthy
- [ ] classify-fast(로컬) 응답 + ollama 중지 시 kimi 폴백
- [ ] 관리 UI 3종이 Tailscale로만 접근(공인망 불가)
- [ ] Studio 재부팅해도 ollama 자동 기동(pmset/서비스)

## 다음 (D3~)
- D3: LiteLLM 가상 키·예산캡·80%경고 웹훅(#ops), spec/codegen/review 별칭 확정.
- D4: Kuma에 컨테이너·플로우 등록 + 외부 클라우드 모니터(NAS 감시) + Slack Socket Mode 4채널 + **미니 하드코딩 감사**.
- D5: 백업(pg_dump+encryption key+B2) + 복원 리허설 + 공용 골격(파트 정의 테이블).
