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
| `pe-studio-icon-512.png` | 512×512 | PWA 매니페스트 아이콘 (Blueprint Teal 라운드 배경) |
| `pe-studio-icon-180.png` | 180×180 | 매니페스트 보조 아이콘 |
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

## 새 크기가 필요할 때

원본은 Orca 드롭 폴더(`.orca/drops/`, gitignore 대상)에서 왔다.
저장소 안의 최대 해상도 원본은 `public/brand/pe-studio-lockup.png`(1200×1120)와
`pe-studio-horizontal.png`(1800×700). 마크 단독 원본이 더 필요하면 디자인 쪽에 요청한다.
