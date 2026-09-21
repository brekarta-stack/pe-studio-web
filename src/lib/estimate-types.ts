/**
 * 견적서(estimates) — 순수 로직. 서버·클라이언트·테스트가 함께 쓴다.
 *
 * 흐름은 생성 → 확인 → 발송 세 단계다.
 *   draft      : DB 내용이 아직 시트에 반영되지 않았다 (시트 없음·수정 후 다시 그리기 전·그리기 실패)
 *   generated  : 지금 DB 내용으로 시트를 그리는 데 성공했다. 사람이 열어 보고 확인해야 한다
 *   confirmed  : 확인 완료. 발송 대기
 *   sending    : 발송 중 — 중복 발송을 막는 잠금 상태
 *   sent       : 발송 완료. 더 이상 고칠 수 없다
 *
 * 금액이 고객에게 그대로 나가는 문서라, 계산은 전부 여기 한 곳에서 한다.
 * 시트의 수식(금액 = 수량 × 단가, 부가세 = 원 미만 절사)도 이 계산과 같은 규칙이다.
 */

/* ── 구분(카테고리) ─────────────────────────────────────────── */

export const ESTIMATE_CATEGORIES = ["papertoy", "woodrock"] as const;
export type EstimateCategory = (typeof ESTIMATE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<EstimateCategory, string> = {
  papertoy: "페이퍼토이",
  woodrock: "우드락",
};

/** 구글 드라이브 분류 폴더 이름 — 견적서/<이 이름>/ 아래에 시트가 쌓인다 */
export const CATEGORY_FOLDERS: Record<EstimateCategory, string> = {
  papertoy: "페이퍼크래프트",
  woodrock: "우드락",
};

/** 문서 번호 접두어. 기존 견적서 양식의 "TO" + YYMMDD 를 따르고, 우드락은 WR 로 구분한다 */
export const DOC_PREFIX: Record<EstimateCategory, string> = {
  papertoy: "TO",
  woodrock: "WR",
};

export const DRIVE_ROOT_FOLDER = "견적서";

export function isEstimateCategory(v: unknown): v is EstimateCategory {
  return typeof v === "string" && (ESTIMATE_CATEGORIES as readonly string[]).includes(v);
}

/* ── 상태 ───────────────────────────────────────────────────── */

export const ESTIMATE_STATUSES = ["draft", "generated", "confirmed", "sending", "sent"] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

export const STATUS_LABELS: Record<EstimateStatus, string> = {
  draft:     "시트 미반영",
  generated: "확인 대기",
  confirmed: "발송 대기",
  sending:   "발송 중",
  sent:      "발송 완료",
};

export const STATUS_COLORS: Record<EstimateStatus, string> = {
  draft:     "bg-slate-100 text-slate-600",
  generated: "bg-amber-100 text-amber-800",
  confirmed: "bg-blue-100 text-blue-800",
  sending:   "bg-violet-100 text-violet-800",
  sent:      "bg-emerald-100 text-emerald-800",
};

export function isEstimateStatus(v: unknown): v is EstimateStatus {
  return typeof v === "string" && (ESTIMATE_STATUSES as readonly string[]).includes(v);
}

/** 내용을 고칠 수 있는 상태 — 발송했거나 발송 중인 건은 손대지 않는다 */
export const EDITABLE_STATUSES = ["draft", "generated", "confirmed"] as const satisfies readonly EstimateStatus[];

export function isEditable(status: EstimateStatus): boolean {
  return (EDITABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * "발송 중" 잠금이 이보다 오래되면 멈춘 것으로 본다. 견적서 화면의 maxDuration(60초)보다
 * 충분히 길어야 한다 — 살아 있는 발송 요청과 사람의 정리 조작이 겹치지 않게.
 */
export const SEND_STUCK_MS = 3 * 60 * 1000;

/** 목록 정렬 — 사람 손이 필요한 건을 위로 (발송 중 멈춤 → 확인 대기 → 발송 대기 → 미반영 → 완료) */
export const STATUS_PRIORITY: Record<EstimateStatus, number> = {
  sending: 0,
  generated: 1,
  confirmed: 2,
  draft: 3,
  sent: 4,
};

/** 3단계 진행 표시용 — 지금 몇 번째 단계까지 끝났는가 (0~3) */
export function completedSteps(status: EstimateStatus): number {
  switch (status) {
    case "draft":     return 0;
    case "generated": return 1;
    case "confirmed": return 2;
    case "sending":   return 2;
    case "sent":      return 3;
  }
}

/* ── 품목 ───────────────────────────────────────────────────── */

export interface EstimateItem {
  /** 품목 — 비워 두면 바로 위 행의 품목에 묶인다 (시트에서 세로 병합) */
  group: string;
  /** 품명 */
  name: string;
  quantity: number;
  /** 공급단가 (원, 부가세 별도) */
  unitPrice: number;
  /** 비고 */
  note: string;
}

export const MAX_ITEMS = 30;
const MAX_TEXT = 200;
const MAX_QUANTITY = 10_000_000;
const MAX_UNIT_PRICE = 10_000_000_000;
/** 공급가액 상한 1조 원 — 이 아래면 JS·시트·JSON 어디서도 정수 정밀도를 잃지 않는다 */
export const MAX_SUPPLY = 1_000_000_000_000;

/**
 * 기본 품목 — 새 견적서를 만들 때 채워지는 출발점이다. 화면에서 얼마든지 고친다.
 *
 * 페이퍼토이: 기존 견적서 시트(CREATIVE 13 건)의 내역 그대로. 합계 700만 원(부가세 별도).
 *   수량 0 인 행은 선택 옵션이다 — 금액 0 으로 표에 남겨 고객이 옵션을 볼 수 있게 한다.
 * 우드락: 크래커플러스 사양(부가세 포함 726만 원 = 별도 660만 원)을 비율대로 늘려
 *   합계 900만 원(부가세 별도)에 맞추고 만 원 단위로 반올림했다.
 *   목형 140 / 제조 420 / 개발 200 / CS 70 / 생산관리 70 (만 원).
 */
export const ESTIMATE_TEMPLATES: Record<EstimateCategory, { spec: string; items: EstimateItem[] }> = {
  papertoy: {
    spec: "230g, 2매, 끼워서 조립",
    items: [
      { group: "디자인 작업비", name: "지기 구조 설계 및 디자인 비용", quantity: 1, unitPrice: 2_000_000, note: "디자인 변경시 재청구" },
      { group: "샘플 제작비", name: "디자인 확인용 제품 샘플 제작 및 발송", quantity: 1, unitPrice: 500_000, note: "" },
      { group: "설명서 제작", name: "설명서 영상 제작", quantity: 1, unitPrice: 1_000_000, note: "도면 내 QR코드 삽입" },
      { group: "", name: "설명서 디자인 및 생산", quantity: 0, unitPrice: 1_500_000, note: "" },
      { group: "제품 생산", name: "230g, 2매, 끼워서 조립 기준, 목형 및 톰슨 포함", quantity: 1_000, unitPrice: 3_500, note: "" },
      { group: "포장 및 납품", name: "표지 + OPP 필름, 개별 단가", quantity: 0, unitPrice: 500, note: "벌크납품" },
    ],
  },
  woodrock: {
    spec: "A4 2장 1,000개(4장 500개), 2단 접지 표지, OPP",
    items: [
      { group: "목형", name: "우드락 재단용 목형 제작", quantity: 1, unitPrice: 1_400_000, note: "" },
      { group: "제조", name: "A4 2장 1,000개(4장 500개), 2단 접지 표지, OPP", quantity: 1_000, unitPrice: 4_200, note: "" },
      { group: "개발", name: "구조 설계 및 디자인 개발", quantity: 1, unitPrice: 2_000_000, note: "" },
      { group: "CS", name: "고객 응대 및 사후 관리", quantity: 1, unitPrice: 700_000, note: "" },
      { group: "생산관리", name: "생산 일정 및 품질 관리", quantity: 1, unitPrice: 700_000, note: "" },
    ],
  },
};

/** 기본 품목의 복사본 — 화면에서 고쳐도 원본이 바뀌지 않게 */
export function templateItems(category: EstimateCategory): EstimateItem[] {
  return ESTIMATE_TEMPLATES[category].items.map((i) => ({ ...i }));
}

/* ── 금액 ───────────────────────────────────────────────────── */

export function lineAmount(item: Pick<EstimateItem, "quantity" | "unitPrice">): number {
  return item.quantity * item.unitPrice;
}

/** 부가세 — 원 미만 절사. 시트 수식 ROUNDDOWN(공급가액 * 0.1, 0) 과 같다 */
export function vatOf(supply: number): number {
  return Math.floor(supply / 10);
}

export interface EstimateTotals {
  /** 공급가액 (부가세 별도 합계) */
  supply: number;
  vat: number;
  /** 합계 (부가세 포함) */
  total: number;
}

export function computeTotals(items: Pick<EstimateItem, "quantity" | "unitPrice">[]): EstimateTotals {
  const supply = items.reduce((sum, i) => sum + lineAmount(i), 0);
  const vat = vatOf(supply);
  return { supply, vat, total: supply + vat };
}

/**
 * 시트에서 읽은 합계가 스스로 맞는가 — 사람이 부가세·합계 칸을 숫자로 덮어쓰면
 * 공급가액과 따로 놀 수 있다. 맞지 않으면 확인을 받지 않는다.
 */
export function sheetTotalsConsistent(t: EstimateTotals): boolean {
  return (
    Number.isSafeInteger(t.supply) &&
    t.supply >= 0 &&
    t.supply <= MAX_SUPPLY &&
    t.vat === vatOf(t.supply) &&
    t.total === t.supply + t.vat
  );
}

export function sameTotals(a: EstimateTotals, b: EstimateTotals): boolean {
  return a.supply === b.supply && a.vat === b.vat && a.total === b.total;
}

/** 1234567 → "1,234,567" (시트의 #,##0 과 같은 모양) */
export function formatAmount(n: number): string {
  return Math.trunc(n).toLocaleString("en-US");
}

/* ── 입력 정리·검증 ─────────────────────────────────────────── */

function cleanText(v: unknown, max = MAX_TEXT): string {
  if (typeof v !== "string") return "";
  // 제어문자는 시트·메일 헤더에 섞이면 곤란하다 — 줄바꿈까지 공백으로 바꾼다
  return v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
}

function cleanInt(v: unknown, max: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "").trim()) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > max) return null;
  return n;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * 화면에서 넘어온 품목 목록 → 검증된 품목.
 * 완전히 빈 행(품목·품명·단가가 모두 비어 있음)은 조용히 버린다.
 */
export function sanitizeItems(raw: unknown): Checked<EstimateItem[]> {
  if (!Array.isArray(raw)) return { ok: false, error: "품목 형식이 올바르지 않습니다." };
  const items: EstimateItem[] = [];
  for (let idx = 0; idx < raw.length; idx++) {
    const r = raw[idx] as Record<string, unknown> | null;
    if (!r || typeof r !== "object") continue;
    const group = cleanText(r.group);
    const name = cleanText(r.name);
    const note = cleanText(r.note);
    const qtyBlank = r.quantity === "" || r.quantity === undefined || r.quantity === null;
    const priceBlank = r.unitPrice === "" || r.unitPrice === undefined || r.unitPrice === null;
    if (!group && !name && !note && priceBlank && qtyBlank) continue;

    const row = idx + 1;
    if (!name) return { ok: false, error: `${row}번째 행: 품명을 입력하세요.` };
    const quantity = cleanInt(qtyBlank ? 0 : r.quantity, MAX_QUANTITY);
    if (quantity === null) return { ok: false, error: `${row}번째 행: 수량은 0 이상의 정수여야 합니다.` };
    const unitPrice = cleanInt(priceBlank ? 0 : r.unitPrice, MAX_UNIT_PRICE);
    if (unitPrice === null) return { ok: false, error: `${row}번째 행: 단가는 0 이상의 정수(원)여야 합니다.` };
    items.push({ group, name, quantity, unitPrice, note });
  }
  if (items.length === 0) return { ok: false, error: "품목을 한 줄 이상 입력하세요." };
  if (computeTotals(items).supply > MAX_SUPPLY) return { ok: false, error: "공급가액 합계가 너무 큽니다 (최대 1조 원)." };
  if (items.length > MAX_ITEMS) return { ok: false, error: `품목은 최대 ${MAX_ITEMS}줄까지입니다.` };
  // 첫 행의 품목이 비어 있으면 묶일 위 행이 없다 — 시트 병합이 어긋나지 않게 막는다
  if (!items[0].group) return { ok: false, error: "첫 행의 품목을 입력하세요." };
  return { ok: true, value: items };
}

export interface EstimateInput {
  category: EstimateCategory;
  clientCompany: string;
  clientContact: string;
  clientEmail: string;
  /** YYYY-MM-DD (한국 날짜) */
  issuedOn: string;
  deliveryTerm: string;
  deliveryPlace: string;
  paymentTerm: string;
  items: EstimateItem[];
  quoteId: string | null;
}

const EMAIL_RE = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']+$/;

export function isEmail(v: string): boolean {
  return EMAIL_RE.test(v);
}

/** 쉼표·세미콜론·공백으로 구분된 주소 목록 → 검증된 배열 */
export function parseEmailList(raw: string, max = 10): Checked<string[]> {
  const list = raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  const bad = list.find((e) => !isEmail(e));
  if (bad) return { ok: false, error: `이메일 주소 형식이 올바르지 않습니다: ${bad}` };
  if (list.length > max) return { ok: false, error: `받는 사람은 최대 ${max}명입니다.` };
  return { ok: true, value: [...new Set(list)] };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function sanitizeEstimateInput(raw: unknown): Checked<EstimateInput> {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!isEstimateCategory(r.category)) return { ok: false, error: "구분(우드락/페이퍼토이)을 선택하세요." };

  const clientCompany = cleanText(r.clientCompany, 100);
  if (!clientCompany) return { ok: false, error: "고객사명을 입력하세요." };

  const clientEmail = cleanText(r.clientEmail, 200);
  if (clientEmail && !isEmail(clientEmail)) return { ok: false, error: "고객 이메일 형식이 올바르지 않습니다." };

  const issuedOn = cleanText(r.issuedOn, 10);
  if (!isIsoDate(issuedOn)) return { ok: false, error: "견적 일자를 YYYY-MM-DD 형식으로 입력하세요." };

  const items = sanitizeItems(r.items);
  if (!items.ok) return items;

  const quoteId = isUuid(r.quoteId) ? r.quoteId : null;

  return {
    ok: true,
    value: {
      category: r.category,
      clientCompany,
      clientContact: cleanText(r.clientContact, 100),
      clientEmail,
      issuedOn,
      deliveryTerm: cleanText(r.deliveryTerm, 100) || DEFAULT_TERMS.deliveryTerm,
      deliveryPlace: cleanText(r.deliveryPlace, 100) || DEFAULT_TERMS.deliveryPlace,
      paymentTerm: cleanText(r.paymentTerm, 100) || DEFAULT_TERMS.paymentTerm,
      items: items.value,
      quoteId,
    },
  };
}

export const DEFAULT_TERMS = {
  deliveryTerm: "지정 기일",
  deliveryPlace: "귀사 지정장소",
  paymentTerm: "현 금",
} as const;

/**
 * 환경변수로 받은 사이트 주소 정리 — 앞뒤 공백·줄바꿈과 끝의 / 를 뗀다.
 * 실제로 운영 NEXTAUTH_URL 끝에 줄바꿈이 들어 있어 OAuth 리디렉션 주소가
 * "https://www.papercraft.kr\n/api/…" 로 만들어져 구글이 거절했다.
 */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/* ── 날짜 (한국 시간) ───────────────────────────────────────── */

/** 서버(Vercel)는 UTC 로 돈다 — 날짜는 반드시 서울 기준으로 자른다 */
export function kstToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isIsoDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

const WEEKDAYS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

/** "2026-07-28" → "2026년 7월 28일 화요일" (기존 양식의 견적 일자 표기) */
export function formatKoreanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${y}년 ${m}월 ${d}일 ${WEEKDAYS[wd]}`;
}

/** 화면 표시용 서울 시각 — "26. 09. 21. 오후 03:04" */
export function formatKstDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ── 문서 번호·파일 이름 ────────────────────────────────────── */

/** 같은 날 같은 구분의 n번째 견적서 → "TO260921", "TO260921-2", … */
export function buildDocNumber(category: EstimateCategory, issuedOn: string, seq: number): string {
  const base = docNumberBase(category, issuedOn);
  return seq <= 1 ? base : `${base}-${seq}`;
}

export function docNumberBase(category: EstimateCategory, issuedOn: string): string {
  return `${DOC_PREFIX[category]}${issuedOn.slice(2).replace(/-/g, "")}`;
}

/** 이미 쓰인 문서 번호들 → 다음 순번 */
export function nextDocSeq(base: string, existing: string[]): number {
  let max = 0;
  for (const n of existing) {
    if (n === base) max = Math.max(max, 1);
    else if (n.startsWith(`${base}-`)) {
      const s = Number(n.slice(base.length + 1));
      if (Number.isInteger(s) && s > 0) max = Math.max(max, s);
    }
  }
  return max + 1;
}

/** 드라이브 파일 이름 — 고객사명과 생성(견적)일을 담는다. 경로 구분자는 뺀다 */
export function buildFileName(e: { clientCompany: string; issuedOn: string; docNumber: string }): string {
  const company = e.clientCompany.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "고객사";
  return `견적서_${company}_${e.issuedOn}_${e.docNumber}`;
}

/* ── 발송 메일 기본 문구 ────────────────────────────────────── */

export interface EmailDraft {
  subject: string;
  body: string;
}

export function defaultEmailDraft(e: {
  clientCompany: string;
  clientContact: string;
  docNumber: string;
  supply: number;
}): EmailDraft {
  const greet = e.clientContact ? `${e.clientContact} 님` : `${e.clientCompany} 담당자님`;
  return {
    subject: `[PE Studio] ${e.clientCompany} 견적서 송부 (${e.docNumber})`,
    body: [
      `안녕하세요, ${greet}.`,
      "(주)스테이지 PE Studio 오세기입니다.",
      "",
      "요청하신 견적서를 첨부 파일로 보내드립니다.",
      "",
      `· 문서 번호: ${e.docNumber}`,
      `· 견적 금액: ${formatAmount(e.supply)}원 (부가세 별도)`,
      "",
      "본 견적은 견적일로부터 7일간 유효합니다.",
      "궁금하신 점은 이 메일에 회신하시거나 010-4075-2661로 연락 주세요.",
      "",
      "감사합니다.",
      "오세기 드림",
    ].join("\n"),
  };
}

/* ── 발송 실패 분류 ─────────────────────────────────────────── */

/**
 * Resend 실패를 둘로 나눈다.
 *   rejected  : 요청이 확실히 거절됐다 (검증·주소·한도·요청 과다) → 발송 대기로 되돌려도 된다
 *   ambiguous : 메일이 나갔는지 알 수 없다 (네트워크·응답 파싱·서버 오류·같은 키의 이전 요청)
 *               → 되돌리면 두 번 나갈 수 있으니 발송 중에 두고 사람이 판정한다
 */
export function classifySendError(err: { statusCode?: number | null; name?: string } | null | undefined): "rejected" | "ambiguous" {
  if (!err) return "ambiguous";
  if (err.name === "invalid_idempotent_request" || err.name === "concurrent_idempotent_requests") return "ambiguous";
  const code = err.statusCode;
  if (code === null || code === undefined) return "ambiguous";
  if (code >= 500) return "ambiguous";
  return "rejected";
}
