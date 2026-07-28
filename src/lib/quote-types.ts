import { isQuoteStage, type QuoteStage } from "./assignment-types";

/** 광고 유입정보 — 세션 첫 진입의 gclid/UTM (instrumentation-client.ts 가 수집). 견적 제출에 첨부 */
export interface QuoteAcquisition {
  referrer: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  /** Google Ads 클릭 ID — 구글 오프라인 전환 임포트의 키 */
  gclid: string;
  /** UTM 미설정 광고 클릭 힌트 'google' | 'naver' | '' */
  adHint: string;
}

export interface QuoteSubmission {
  id: string;
  product: string;
  quantity: string;
  deliveryDate: string;
  purpose: string;
  customDesign: string;
  /** 디자인 스타일 — 리얼리즘 / 캐릭터라이즈 / 전문가 위임 */
  styleType: string;
  /** 제품에 삽입할 문구 (회사명·슬로건 등) */
  productText: string;
  colorRequest: string;
  notes: string;
  name: string;
  email: string;
  phone: string;
  fileName: string;
  /** 참고 자료 파일의 공개 URL (Supabase Storage) — 어드민/이메일 열람용. 마이그레이션 20260710 이후 저장 */
  fileUrl: string;
  /** 회사 로고 파일명 (선택) */
  logoFileName: string;
  /** 회사 로고 파일의 공개 URL (선택) */
  logoFileUrl: string;
  /** 샘플링 희망 — B2B 기업 주문 시 필수 */
  sampling: boolean;
  /** 최대한 빠르게 제작 (납품 희망일 대체) */
  rushed: boolean;
  /** 포장 방식 — paper-box / opp / bulk */
  packaging: string;
  /** 광고 유입정보 (gclid·UTM) — 전환 측정/오프라인 임포트용. 마이그레이션 적용 전이면 저장 생략 */
  acquisition?: QuoteAcquisition | null;
  /** 진행 여부 체크박스 — 어드민 시트에서 토글 (마이그레이션 20260728) */
  inProgress: boolean;
  /** 진행 단계 — QUOTE_STAGES 참고 (마이그레이션 20260728) */
  stage: QuoteStage;
  createdAt: string;
}

/**
 * Supabase `quotes` 로우 → QuoteSubmission.
 *
 * 어드민 대시보드·제작 문의 시트·GET /api/quote 세 곳이 같은 매핑을 쓰므로 여기로 모은다.
 * 마이그레이션이 아직 적용되지 않은 컬럼은 전부 기본값으로 흡수한다 —
 * 그래야 마이그레이션 전에도 화면이 죽지 않는다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function quoteFromRow(r: any): QuoteSubmission {
  return {
    id:           r.id,
    product:      r.product,
    quantity:     r.quantity,
    deliveryDate: r.delivery_date,
    purpose:      r.purpose,
    customDesign: r.custom_design,
    styleType:    r.style_type ?? "",
    productText:  r.product_text ?? "",
    colorRequest: r.color_request,
    notes:        r.notes,
    name:         r.name,
    email:        r.email,
    phone:        r.phone,
    fileName:     r.file_name,
    fileUrl:      r.file_url ?? "",
    logoFileName: r.logo_file_name ?? "",
    logoFileUrl:  r.logo_file_url ?? "",
    sampling:     !!r.sampling,
    rushed:       !!r.rushed,
    packaging:    r.packaging ?? "",
    acquisition:  r.acquisition ?? null,
    inProgress:   !!r.in_progress,
    stage:        isQuoteStage(r.stage) ? r.stage : "new",
    createdAt:    r.created_at,
  };
}
