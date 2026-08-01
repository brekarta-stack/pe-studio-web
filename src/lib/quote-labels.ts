/**
 * 견적 폼 선택지 코드 → 한글 라벨.
 *
 * 폼(src/components/QuoteForm.tsx)이 저장하는 값은 코드이고, 어드민은 라벨로 읽어야 한다.
 * 대시보드·제작 문의 시트가 같은 표를 쓰도록 여기로 모은다.
 */

export const PRODUCT_LABELS: Record<string, string> = {
  papercraft: "페이퍼 크래프트",
  action:     "액션 페이퍼 토이",
  popup:      "팝업북",
  foamboard:  "폼보드(우드락)",
  unsure:     "미정 (상담 원함)",
  education:  "용도 · 교육/교구",
  promotion:  "용도 · 홍보",
  hobby:      "용도 · 취미",
};

/**
 * 선호 작가 — QuoteForm 의 ARTIST_OPTIONS 와 값이 일치해야 한다.
 *
 * 예전에는 '디자인 스타일'(리얼리즘·캐릭터라이즈·전문가 위임)이었다.
 * 옛 값도 남겨 둔다 — 지우면 그때 접수된 문의가 어드민에서 코드로 보인다.
 */
export const STYLE_LABELS: Record<string, string> = {
  // 현행 — 선호 작가
  osegi:     "오세기",
  cheolho:   "김철호",
  jaeho:     "문재호",
  recommend: "추천받기",
  // 레거시 — 디자인 스타일 시절 값 (과거 데이터 열람용)
  realism:      "리얼리즘 (구)",
  characterize: "캐릭터라이즈 (구)",
  expert:       "전문가 위임 (구)",
};

/** 포장 방식 — QuoteForm 의 PACKAGING_OPTIONS 와 값이 일치해야 한다 */
export const PACKAGING_LABELS: Record<string, string> = {
  "paper-box": "종이 박스",
  opp:         "OPP 필름",
  bulk:        "벌크 납품",
};

export const CUSTOM_DESIGN_LABELS: Record<string, string> = {
  yes: "필요",
  no:  "기본",
};

/** 설명서 생산 — QuoteForm 이 저장하는 manualOption 코드와 일치해야 한다 */
export const MANUAL_OPTION_LABELS: Record<string, string> = {
  guide: "도면 내 조립 가이드 (무료)",
  qr:    "도면 내 QR·영상 삽입 (+100만원~/종)",
  print: "설명서·표지 생산 (종당 50만원 + 1,000부당 30만원)",
};

/** 모델 설계 난이도 — 디자인 라인의 complexity 코드와 일치해야 한다 */
export const COMPLEXITY_LABELS: Record<string, string> = {
  simple:  "단순함",
  normal:  "일반적",
  complex: "복잡함",
};

/** 코드를 라벨로. 표에 없는 값이면 원본을 그대로 보여준다(데이터 유실 방지) */
export function label(map: Record<string, string>, code: string | null | undefined): string {
  if (!code) return "";
  return map[code] ?? code;
}
