# 브랜드 자산 — PE Studio Cheer 로고

2026-08 적용. 원본 콘셉트 설명은 `public/brand/README.md` 참고.

## 마크

소품 없이 두 팔을 들어 올린 저폴리곤 인형. 얼굴이 없고 V자 팔과 열린 자세만으로
완성의 기쁨을 전달한다. 다각형 면은 종이를 재단해 접는 작업 방식을 나타낸다.

## 컬러

| 이름 | 값 | 쓰임 |
|---|---|---|
| Primary Blue | `#1E22B2` | 브랜드 기본색, 푸터 배경, `theme_color` |
| Deep Ink | `#0F172A` | 로고 워드마크 글자 |
| Blueprint Teal | `#173F48` | 앱 아이콘 배경, PWA `background_color` |
| Pale Cyan | `#B8E4EF` | 어두운 배경 위 보조 텍스트 |

## 파일과 용도

`public/brand/` (웹에서 접근 가능)

| 파일 | 크기 | 용도 |
|---|---|---|
| `pe-studio-mark.png` | 202×256 | **화면에 실제로 쓰는 마크** — 헤더·푸터·어드민·로그인 |
| `pe-studio-mark-512.png` | 404×512 | OG 이미지 생성용 (data URI 로 인라인) |
| `pe-studio-icon-512.png` | 512×512 | PWA 아이콘 — **모서리까지 불투명 풀블리드** |
| `pe-studio-icon-192.png` | 192×192 | PWA 아이콘 (Lighthouse installable 요건) |
| `pe-studio-lockup.png` | 1200×1120 | 세로형 — 제안서·명함·패키지 (보관용, 웹 미사용) |
| `pe-studio-lockup-reversed.png` | 1200×1120 | 세로형 어두운 배경용 (보관용) |
| `pe-studio-horizontal.png` | 1800×700 | 가로형 (보관용) |

`src/app/` (Next.js 파일 기반 메타데이터 — 자동으로 `<link>` 연결)

| 파일 | 용도 |
|---|---|
| `favicon.ico` | 브라우저 탭 |
| `icon.png` | 512 아이콘 |
| `apple-icon.png` | iOS 홈 화면 |
| `manifest.ts` | PWA 매니페스트 |
| `opengraph-image.tsx` | 카톡·슬랙 공유 썸네일 (1200×630) |

## 사용 규칙

- **웹 화면에는 마크만 쓰고 글자는 HTML 텍스트로 둔다.** 가로형·세로형 락업 PNG에는
  글자가 그려져 있어 작은 화면에서 뭉개지고 스크린리더가 읽지 못한다.
  락업은 인쇄물·제안서용으로만 쓴다.
- **밝은 배경**: 마크를 판 없이 그대로 얹는다 (헤더·어드민·로그인).
- **어두운 배경**: 마크가 남색 계열이라 묻힌다. 흰 판을 깔거나
  `pe-studio-lockup-reversed.png` 를 쓴다 (푸터가 전자).
- 마크는 장식이므로 `alt=""` + `aria-hidden`. 링크 이름은 감싸는 `<Link>` 의
  `aria-label` 이나 옆의 텍스트가 담당한다.
- 작은 크기에서는 `PAPER ENGINEERING` 부제를 생략한다 (헤더가 `lg` 미만에서 숨김).
- `next/image` 의 `width`/`height` 는 원본 크기가 아니라 **실제 렌더 크기**를 준다.
  원본(202×256)을 주면 필요보다 큰 변환본을 내려받는다.
- 헤더 로고에 `priority` 를 붙이지 않는다. 루트 레이아웃이라 전 페이지에서 preload 가
  걸리고, 진짜 LCP 후보(히어로 이미지)보다 앞서 나가 손해다.

## 앱 아이콘 규칙 (중요)

`apple-icon.png` 와 매니페스트 아이콘은 **모서리까지 불투명하게 채운 정사각형**이어야 한다.
투명한 라운드 모서리를 그대로 넣으면 iOS 는 투명 영역을 검정으로 합성한 뒤 자기 마스크를
다시 씌워 검은 잔상이 남고, 안드로이드는 흰 판 위에 올려 "둥근 아이콘 안의 둥근 아이콘"이 된다.

현재 아이콘은 `#173F48` 풀블리드 배경에 인형을 캔버스의 **56% 높이**로 배치했다.
maskable 안전영역(중앙 80%) 안에 들어오므로 `purpose: "any"` 와 `"maskable"` 양쪽에 같은
파일을 쓴다. 다시 만들어야 하면 `pe-studio-mark-512.png` 를 같은 비율로 합성하면 된다.

## OG 이미지 캐시

`src/lib/site.ts` 의 `OG_VERSION` 을 올려야 카카오톡·페이스북·네이버가 새 썸네일을 가져온다.
이미지 내용만 바꾸고 URL 이 그대로면 캐시된 옛 배너가 계속 노출된다.

## 새 크기가 필요할 때

원본은 Orca 드롭 폴더(`.orca/drops/`, gitignore 대상)에서 왔다.
저장소 안의 최대 해상도 원본은 `public/brand/pe-studio-lockup.png`(1200×1120)와
`pe-studio-horizontal.png`(1800×700). 마크 단독 원본이 더 필요하면 디자인 쪽에 요청한다.
