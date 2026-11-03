import { isQuoteStage, type QuoteStage } from "./assignment-types.ts";
import { isOrderType } from "./quote-pricing.ts";
import type { DesignLine, OrderType } from "./quote-pricing.ts";

/** 첨부파일 한 건 — 표시명 + 공개 URL (Supabase Storage) */
export interface QuoteFile {
  name: string;
  url: string;
}

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

/* ── 수동 등록 문의 ─────────────────────────────────────────
 * 전화·이메일처럼 폼 밖으로 들어온 문의는 관리자가 직접 등록한다.
 * 그 사실을 acquisition 에 남겨 두면 유입 열에서 "직접 등록 · 전화"로 보이고,
 * 나중에 "폼 유입 vs 직접 문의" 비중도 그대로 집계할 수 있다.
 * (별도 컬럼을 만들지 않은 이유 — 유입 경로는 이미 acquisition 이 담당한다) */

/** acquisition.utmSource 가 이 값이면 관리자가 직접 등록한 문의 */
export const MANUAL_SOURCE = "manual";

export const MANUAL_CHANNELS = ["phone", "email", "kakao", "referral", "offline", "etc"] as const;
export type ManualChannel = (typeof MANUAL_CHANNELS)[number];

export const MANUAL_CHANNEL_LABELS: Record<ManualChannel, string> = {
  phone:    "전화",
  email:    "이메일",
  kakao:    "카카오톡",
  referral: "소개·추천",
  offline:  "오프라인",
  etc:      "기타",
};

export function isManualChannel(v: unknown): v is ManualChannel {
  return typeof v === "string" && (MANUAL_CHANNELS as readonly string[]).includes(v);
}

/** 수동 등록 문의의 유입정보를 만든다 — 접수 경로를 utmMedium 에 담는다 */
export function manualAcquisition(channel: ManualChannel): QuoteAcquisition {
  return {
    referrer: "",
    utmSource: MANUAL_SOURCE,
    utmMedium: channel,
    utmCampaign: "",
    gclid: "",
    adHint: "",
  };
}

/* ── 원천(source) ───────────────────────────────────────────
 * inbound  — 고객이 먼저 연락해 온 문의(폼·전화·이메일 전부)
 * outbound — 내가 먼저 제안서를 보낸 리드 (마이그레이션 20261013)
 * 전환 후에도 바꾸지 않는다 — 아웃바운드의 매출 기여를 나중에 세기 위해서다.
 * (수동 등록 문의의 접수 경로는 여전히 acquisition 이 담당한다 — 그건 인바운드의 하위 구분) */
export const QUOTE_SOURCES = ["inbound", "outbound"] as const;
export type QuoteSource = (typeof QUOTE_SOURCES)[number];

export const SOURCE_LABELS: Record<QuoteSource, string> = {
  inbound:  "인바운드",
  outbound: "아웃바운드",
};

export function isQuoteSource(v: unknown): v is QuoteSource {
  return typeof v === "string" && (QUOTE_SOURCES as readonly string[]).includes(v);
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
  /** 참고 자료 파일의 공개 URL (Supabase Storage) — 어드민/이메일 열람용. 마이그레이션 20260710 이후 저장 (레거시 단일) */
  fileUrl: string;
  /** 다중 첨부파일 (최대 5개) — 마이그레이션 20260730. 신규 폼은 여기에 담는다 */
  files: QuoteFile[];
  /** 주문 형태 — 도면만/제품 생산/완제품. 견적 구조를 정한다 (마이그레이션 20260804).
   *  폼 개편 이전 문의는 빈 문자열 */
  orderType: OrderType | "";
  /** 제작 희망 디자인 목록 (마이그레이션 20260803).
   *  종류 = 배열 길이, 총 수량 = quantity 합계. 옛 문의는 빈 배열 */
  designs: DesignLine[];
  /** 회사 로고 파일명 (선택) */
  logoFileName: string;
  /** 회사 로고 파일의 공개 URL (선택) */
  logoFileUrl: string;
  /** 샘플링 희망 — B2B 기업 주문 시 권장 */
  sampling: boolean;
  /** 샘플링을 보고 디자인 개선 희망 (마이그레이션 20260805) */
  samplingImprove: boolean;
  /** 생산 시 감리 진행 희망 (마이그레이션 20260805) */
  supervision: boolean;
  /** 별도 가공·고급 소재 사용 희망 (마이그레이션 20260806) */
  premiumFinish: boolean;
  /** 제품 이용 연령 — 복수 선택, 라벨 문자열 그대로 저장 (마이그레이션 20260805) */
  ageGroups: string[];
  /** 만드는 방식 — 목공풀/끼워 만들기/PE 스튜디오 추천, 라벨 그대로 (마이그레이션 20260806) */
  assemblyMethod: string;
  /** 디자인 설계 스타일 — 폴리곤/파츠 결합/PE STUDIO 권장, 라벨 그대로 (마이그레이션 20260806) */
  designStyle: string;
  /** 설명서 생산 — guide(도면 내 가이드)/qr(QR·영상)/print(인쇄) (마이그레이션 20260807) */
  manualOption: string;
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
  /** Drop(제외) 처리 시각 (ISO). null 이면 활성 문의 (마이그레이션 20260729) */
  droppedAt: string | null;

  /* ── 영업 파이프라인 (마이그레이션 20261013) ── 적용 전 로우는 전부 기본값 */
  /** 원천 — 전환 후에도 유지 */
  source: QuoteSource;
  /** 기관·회사명 (아웃바운드 필수, 인바운드 선택) */
  org: string;
  /** 중복 제안 판정용 정규화 기관명 — normalizeOrgKey(org) */
  orgKey: string;
  /** 공공·박물관·대학·기업·지자체 … 자유 텍스트 */
  segment: string;
  /** 적합도 점수 (발굴 에이전트 산출). 없으면 null */
  score: number | null;
  /** 제안서 덱 링크 */
  proposalUrl: string;
  /** 제안서 발송 시각 (ISO) */
  proposalSentAt: string | null;
  /** 제안서 수신처 */
  proposalSentTo: string;
  /** 다음 액션(팔로업) 예정일 (YYYY-MM-DD) */
  nextActionAt: string | null;
  /** 아웃바운드 → 상담 전환 시각 (ISO) */
  convertedAt: string | null;
  /** 마지막 단계 변경 시각 (ISO) */
  stageChangedAt: string | null;
  /** 완료(delivered/settled) 진입 시각 (ISO) */
  closedAt: string | null;
  /** Drop 사유 */
  lostReason: string;
  /** 발굴 에이전트 산출물 원문 {subject, body_text, matched_cases, …} */
  outreach: Record<string, unknown> | null;

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
    files:        Array.isArray(r.files)
      ? r.files.filter((f: unknown): f is QuoteFile =>
          !!f && typeof (f as QuoteFile).url === "string")
      : [],
    orderType:    isOrderType(r.order_type) ? r.order_type : "",
    designs:      Array.isArray(r.designs)
      ? r.designs.filter((d: unknown): d is DesignLine => !!d && typeof d === "object")
      : [],
    logoFileName: r.logo_file_name ?? "",
    logoFileUrl:  r.logo_file_url ?? "",
    sampling:     !!r.sampling,
    samplingImprove: !!r.sampling_improve,
    supervision:  !!r.supervision,
    premiumFinish: !!r.premium_finish,
    ageGroups:    Array.isArray(r.age_groups)
      ? r.age_groups.filter((a: unknown): a is string => typeof a === "string")
      : [],
    assemblyMethod: r.assembly_method ?? "",
    designStyle:  r.design_style ?? "",
    manualOption: r.manual_option ?? "",
    rushed:       !!r.rushed,
    packaging:    r.packaging ?? "",
    acquisition:  r.acquisition ?? null,
    inProgress:   !!r.in_progress,
    stage:        isQuoteStage(r.stage) ? r.stage : "new",
    droppedAt:    r.dropped_at ?? null,
    source:       isQuoteSource(r.source) ? r.source : "inbound",
    org:          r.org ?? "",
    orgKey:       r.org_key ?? "",
    segment:      r.segment ?? "",
    /* INTEGER 지만 문자열로 오는 드라이버도 있어 숫자로 바꾸고, 못 바꾸면 null */
    score:        r.score == null || !Number.isFinite(Number(r.score)) ? null : Number(r.score),
    proposalUrl:  r.proposal_url ?? "",
    proposalSentAt: r.proposal_sent_at ?? null,
    proposalSentTo: r.proposal_sent_to ?? "",
    nextActionAt: r.next_action_at ?? null,
    convertedAt:  r.converted_at ?? null,
    stageChangedAt: r.stage_changed_at ?? null,
    closedAt:     r.closed_at ?? null,
    lostReason:   r.lost_reason ?? "",
    /* JSONB 는 객체일 때만 믿는다 — 배열·문자열이 섞여 들어와도 화면이 죽지 않게 */
    outreach:     r.outreach && typeof r.outreach === "object" && !Array.isArray(r.outreach)
      ? (r.outreach as Record<string, unknown>)
      : null,
    createdAt:    r.created_at,
  };
}
