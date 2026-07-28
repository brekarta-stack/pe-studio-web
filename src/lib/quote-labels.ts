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

/** 디자인 스타일 — QuoteForm 의 STYLE_OPTIONS 와 값이 일치해야 한다 */
export const STYLE_LABELS: Record<string, string> = {
  realism:      "리얼리즘",
  characterize: "캐릭터라이즈",
  expert:       "전문가 위임",
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

/** 코드를 라벨로. 표에 없는 값이면 원본을 그대로 보여준다(데이터 유실 방지) */
export function label(map: Record<string, string>, code: string | null | undefined): string {
  if (!code) return "";
  return map[code] ?? code;
}
