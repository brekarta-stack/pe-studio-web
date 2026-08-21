/**
 * 제작 문의(/quote) 입력 정규화 — POST /api/quote 와 테스트가 함께 쓴다.
 *
 * 배경 — 예전에는 zod 스키마가 길이·형식이 어긋나면 그 자리에서 400 을 냈다.
 * 그런데 폼에는 글자 수 제한이 없었다. 그래서
 *   · 추가 메모를 500자 넘게 쓰면
 *   · 연락처를 "010-… / 02-… 내선100" 처럼 두 개 적으면(30자 초과)
 *   · 메일 주소를 아웃룩에서 복사해 "홍길동 <a@b.com>" 로 붙여넣으면
 *   · 광고 링크를 타고 들어와 referrer 가 1024자를 넘으면
 * 접수가 통째로 거절됐다. 화면에는 "제출 중 오류가 발생했습니다" 만 떠서
 * 고객은 무엇을 고쳐야 하는지 알 수 없었고, 특히 마지막 경우(referrer)는
 * 사용자가 손댈 수 없는 값이라 그 세션 내내 몇 번을 눌러도 실패했다.
 *
 * 원칙 — **부가 정보 때문에 접수가 실패하지 않는다.**
 *   · 길이 초과        → 자른다 (거절하지 않는다)
 *   · 모르는 선택지 값 → 빈 값으로 떨어뜨린다
 *   · 첨부 URL 이 우리 스토리지가 아니면 → 버린다 (주입 차단은 그대로 유지)
 *   · 광고 유입정보    → 무슨 값이 와도 잘라 담는다
 *   · 하드 실패는 "회신할 방법이 없을 때" 뿐 — 이름·이메일.
 *
 * 잘라내거나 버린 항목은 dropped 로 돌려준다. 라우트가 그걸 로그로 남겨야
 * 조용한 유실이 나중에 눈에 보인다.
 */

import { COMPLEXITY_LEVELS, MANUAL_OPTIONS, ORDER_TYPES } from "./quote-pricing.ts";
import type { DesignLine, OrderType } from "./quote-pricing.ts";
import type { QuoteAcquisition, QuoteFile } from "./quote-types.ts";

/** 제품 유형 — 폼의 PRODUCTS + USAGES 와 일치해야 한다 */
export const QUOTE_PRODUCTS = [
  "papercraft", "action", "popup", "foamboard", "unsure", "education", "promotion", "hobby",
] as const;

/** 선호 작가 — 레거시(디자인 스타일) 값도 받는다. 지우면 옛 초안 제출이 값을 잃는다 */
export const QUOTE_STYLES = [
  "osegi", "cheolho", "jaeho", "recommend", "realism", "characterize", "expert",
] as const;

export const QUOTE_PACKAGINGS = ["paper-box", "opp", "bulk"] as const;

/**
 * 필드별 상한 (글자 수).
 *
 * 폼(QuoteForm)의 maxLength 와 짝이다. 여기 값이 폼보다 **넉넉해야** 한다 —
 * 폼에서 막힌 길이는 여기 오지 않고, 옛 초안·외부 제출만 여기서 잘려 들어온다.
 * 저장 컬럼은 전부 TEXT 라 상한을 키우는 비용은 없다.
 */
export const QUOTE_LIMITS = {
  quantity:       30,
  deliveryDate:   40,
  purpose:        200,
  productText:    500,
  colorRequest:   4000,
  notes:          4000,
  name:           120,
  email:          200,
  phone:          60,
  fileName:       255,
  url:            1024,
  designId:       64,
  designName:     200,
  designs:        20,
  files:          5,
  ageGroup:       80,
  ageGroups:      10,
  assemblyMethod: 120,
  designStyle:    120,
  acqReferrer:    1024,
  acqUtm:         200,
  acqGclid:       512,
  acqAdHint:      20,
} as const;

/* ── 문자열 다듬기 ───────────────────────────────────────── */

/** 짝 없는 서로게이트 — 붙여넣기로 반토막 난 이모지. 그대로 두면 DB insert 가 깨진다 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/** 제어문자 — 개행(\n)·탭(\t)·복귀(\r)만 남긴다 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
/** 제로폭 문자 — 웹/한글 문서에서 복사할 때 딸려온다 */
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;

function toText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return String(v);
  return "";
}

/** 상한에서 자르되 이모지를 반토막 내지 않는다 */
function clampChars(s: string, max: number): string {
  if (s.length <= max) return s;
  let out = s.slice(0, max);
  const last = out.charCodeAt(out.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1); // 상위 서로게이트만 남는 컷 방지
  return out;
}

/** 무엇이 오든 안전한 문자열로. 절대 실패하지 않는다 */
export function cleanText(v: unknown, max: number): string {
  const s = toText(v)
    .replace(CONTROL_CHARS, "")
    .replace(LONE_SURROGATE, "")
    .replace(ZERO_WIDTH, "")
    .replace(/\u00A0/g, " ")
    .trim();
  return clampChars(s, max);
}

/**
 * 한 줄짜리 필드 — 줄바꿈·탭을 공백으로 접는다.
 *
 * 이름은 알림 메일 제목(route.ts 의 subject)에 그대로 들어간다. 개행이 섞이면
 * 메일 헤더가 갈라질 여지가 생기고, 어드민 목록에서도 줄이 깨진다.
 * 개행이 의미 있는 곳은 메모·색상 요청뿐이라 그 둘만 cleanText 를 쓴다.
 */
export function cleanLine(v: unknown, max: number): string {
  return cleanText(v, max)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** 목록에 없는 값은 빈 문자열 — 선택지가 바뀌어도 옛 클라이언트 제출이 막히지 않는다 */
function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | "" {
  const s = toText(v).trim();
  return (allowed as readonly string[]).includes(s) ? (s as T) : "";
}

function toBool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

/**
 * 이메일 정규화 — 붙여넣기로 딸려오는 군더더기를 떼어낸다.
 *   "홍길동 <a@b.com>" → a@b.com
 *   "a@b.com;"        → a@b.com
 *   "mailto:a@b.com"  → a@b.com
 * 전각 ＠ · 제로폭 문자 · NBSP 도 여기서 정리한다.
 */
export function normalizeEmail(raw: unknown): string {
  let s = toText(raw)
    .replace(CONTROL_CHARS, "")
    .replace(LONE_SURROGATE, "")
    .replace(ZERO_WIDTH, "")
    .replace(/\u00A0/g, " ")
    .trim();

  const angled = s.match(/<([^<>]+)>/); // "이름 <메일>" 형태는 꺾쇠 안쪽만
  if (angled) s = angled[1];

  s = s
    .replace(/^mailto:/i, "")
    .replace(/＠/g, "@")            // 전각 ＠
    .replace(/[．。]/g, ".")    // 전각 마침표 · 한글 문장부호
    .replace(/^[\s'"([<]+/, "")
    .replace(/[\s'")\]>]+$/, "")
    .replace(/[.,;:]+$/, "")
    .trim();

  /* 여기서 상한에 맞춰 자르면 안 된다. 226자 주소를 200자로 자르면 형식은 멀쩡한
     다른 주소가 되어 확인 메일과 replyTo 가 엉뚱한 곳으로 간다.
     길이 초과는 isEmailLike 가 거절한다 (병적으로 긴 입력만 넉넉한 선에서 끊는다). */
  return clampChars(s, QUOTE_LIMITS.email * 2);
}

/**
 * 회신 가능한 주소인가. 도메인은 ASCII 만 — Resend 의 replyTo 로 그대로 쓰는 값이다.
 * (로컬파트는 관대하게 — 한글 아이디를 받는 메일 서버가 있다)
 */
const EMAIL_RE =
  /^[^\s@,;:<>()[\]\\"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export function isEmailLike(s: string): boolean {
  return s.length > 0 && s.length <= QUOTE_LIMITS.email && EMAIL_RE.test(s);
}

/**
 * 첨부 URL 검증 — 우리 스토리지의 공개 https URL 만 통과.
 * (어드민·알림 메일에서 href 로 렌더되므로 javascript:/data: 주입을 막는다)
 * 어긋나면 **버린다** — 첨부 하나 때문에 접수 전체가 실패하면 안 된다.
 */
/**
 * 허용되는 첨부 URL 접두사 — 우리 Supabase 프로젝트의 공개 스토리지만.
 *
 * 예전에는 경로 패턴(/storage/v1/object/public/)만 봤다. 호스트를 고정하지 않아
 * https://evil.example.com/storage/v1/object/public/x.png 같은 남의 주소가 통과했고,
 * 그 링크가 운영자 알림 메일에 "참고 자료 · 열기" 로 렌더됐다 — 인증 없는 폼이라
 * 누구나 심을 수 있는 피싱 경로였다.
 */
const PUBLIC_STORAGE_PREFIX = (() => {
  const fallback = "https://syrfoqwvsciicfbeemqv.supabase.co";
  /* 이 모듈은 폼(클라이언트)도 import 한다. 브라우저 번들에서 process 가 없을 수 있으므로
     간접 참조로 읽는다 — 값이 없으면 알려진 호스트로 떨어진다(첨부 검증은 서버에서만 쓴다). */
  const env: Record<string, string | undefined> | undefined =
    typeof process !== "undefined" ? process.env : undefined;
  const url = env?.NEXT_PUBLIC_SUPABASE_URL || env?.SUPABASE_URL || fallback;
  try {
    return `https://${new URL(url).host}/storage/v1/object/public/`;
  } catch {
    return `${fallback}/storage/v1/object/public/`;
  }
})();

/** URL 에 들어와서는 안 되는 문자 — 메일·어드민에서 href 속성으로 렌더된다 */
const UNSAFE_URL_CHARS = /["'<>\s\\]/;

export function safeFileUrl(v: unknown): string {
  /* 상한보다 1자 더 읽어 "잘렸는지"를 판별한다 — 잘린 URL 은 깨진 링크라 담을 이유가 없다 */
  const s = cleanText(v, QUOTE_LIMITS.url + 1);
  if (!s || s.length > QUOTE_LIMITS.url) return "";
  if (!s.startsWith(PUBLIC_STORAGE_PREFIX)) return "";
  if (UNSAFE_URL_CHARS.test(s)) return "";
  return s;
}

function normalizeFile(v: unknown): QuoteFile | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const url = safeFileUrl(o.url);
  if (!url) return null; // URL 이 없거나 우리 것이 아니면 열어볼 방법이 없다
  return { name: cleanLine(o.name, QUOTE_LIMITS.fileName), url };
}

/* ── 정규화 결과 ─────────────────────────────────────────── */

export interface NormalizedQuote {
  product: string;
  quantity: string;
  deliveryDate: string;
  purpose: string;
  customDesign: string;
  styleType: string;
  productText: string;
  colorRequest: string;
  notes: string;
  name: string;
  email: string;
  phone: string;
  fileName: string;
  fileUrl: string;
  files: QuoteFile[];
  designs: DesignLine[];
  logoFileName: string;
  logoFileUrl: string;
  sampling: boolean;
  samplingImprove: boolean;
  supervision: boolean;
  premiumFinish: boolean;
  ageGroups: string[];
  assemblyMethod: string;
  designStyle: string;
  manualOption: string;
  rushed: boolean;
  packaging: string;
  orderType: OrderType | "";
  acquisition: QuoteAcquisition | null;
}

export type QuoteParseResult =
  | { ok: true; value: NormalizedQuote; dropped: string[] }
  | { ok: false; field: "name" | "email" | "body"; message: string };

/**
 * 제출 본문 → 저장 가능한 값. 이름·이메일이 없을 때만 실패한다.
 *
 * dropped 에는 "잘렸다/버려졌다"가 필드명으로 담긴다 — 라우트가 로그로 남겨
 * 조용한 유실이 눈에 보이게 한다.
 */
export function normalizeQuoteInput(raw: unknown): QuoteParseResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, field: "body", message: "잘못된 요청 형식입니다." };
  }
  const o = raw as Record<string, unknown>;
  const dropped: string[] = [];

  /** 잘린 경우에만 흔적을 남긴다 */
  const cut = (key: string, v: unknown, max: number, oneLine = true): string => {
    const clean = oneLine ? cleanLine(v, Number.MAX_SAFE_INTEGER) : cleanText(v, Number.MAX_SAFE_INTEGER);
    const out = oneLine ? cleanLine(v, max) : cleanText(v, max);
    if (clean.length > out.length) dropped.push(`${key}(${clean.length}자→${out.length}자)`);
    return out;
  };

  const name = cleanLine(o.name, QUOTE_LIMITS.name);
  if (!name) {
    return { ok: false, field: "name", message: "이름을 입력해 주세요." };
  }

  const email = normalizeEmail(o.email);
  if (!isEmailLike(email)) {
    return {
      ok: false,
      field: "email",
      message: "이메일 주소를 다시 확인해 주세요. (예: example@company.com)",
    };
  }

  /* 제품 미선택·모르는 값은 '미정(담당자 상의)' 으로 받는다 — 접수를 막을 이유가 없다 */
  const product = oneOf(o.product, QUOTE_PRODUCTS) || "unsure";

  const rawFiles = Array.isArray(o.files) ? o.files : [];
  if (rawFiles.length > QUOTE_LIMITS.files) {
    dropped.push(`files(${rawFiles.length}개→${QUOTE_LIMITS.files}개)`);
  }
  const keptFiles = rawFiles.slice(0, QUOTE_LIMITS.files);
  const files = keptFiles.map(normalizeFile).filter((f): f is QuoteFile => f !== null);
  if (files.length < keptFiles.length) dropped.push("files(허용되지 않는 URL 제외)");

  const rawDesigns = Array.isArray(o.designs) ? o.designs : [];
  if (rawDesigns.length > QUOTE_LIMITS.designs) {
    dropped.push(`designs(${rawDesigns.length}종→${QUOTE_LIMITS.designs}종)`);
  }
  const designs = rawDesigns
    .slice(0, QUOTE_LIMITS.designs)
    .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
    .map((d) => ({
      id:         cleanLine(d.id, QUOTE_LIMITS.designId),
      name:       cleanLine(d.name, QUOTE_LIMITS.designName),
      quantity:   cleanLine(d.quantity, QUOTE_LIMITS.quantity),
      complexity: oneOf(d.complexity, COMPLEXITY_LEVELS),
      file:       normalizeFile(d.file),
    }));

  const rawAges = Array.isArray(o.ageGroups) ? o.ageGroups : [];
  if (rawAges.length > QUOTE_LIMITS.ageGroups) {
    dropped.push(`ageGroups(${rawAges.length}개→${QUOTE_LIMITS.ageGroups}개)`);
  }
  const ageGroups = rawAges
    .slice(0, QUOTE_LIMITS.ageGroups)
    .map((a) => cleanLine(a, QUOTE_LIMITS.ageGroup))
    .filter((a) => a !== "");

  /* 광고 유입정보 — 사용자가 손댈 수 없는 값이다. 무슨 길이가 와도 잘라 담고 절대 거절하지 않는다 */
  const acqRaw = o.acquisition;
  const acquisition: QuoteAcquisition | null =
    acqRaw && typeof acqRaw === "object" && !Array.isArray(acqRaw)
      ? (() => {
          const a = acqRaw as Record<string, unknown>;
          return {
            referrer:    cut("acquisition.referrer", a.referrer, QUOTE_LIMITS.acqReferrer),
            utmSource:   cut("acquisition.utmSource", a.utmSource, QUOTE_LIMITS.acqUtm),
            utmMedium:   cut("acquisition.utmMedium", a.utmMedium, QUOTE_LIMITS.acqUtm),
            utmCampaign: cut("acquisition.utmCampaign", a.utmCampaign, QUOTE_LIMITS.acqUtm),
            gclid:       cut("acquisition.gclid", a.gclid, QUOTE_LIMITS.acqGclid),
            adHint:      cleanLine(a.adHint, QUOTE_LIMITS.acqAdHint),
          };
        })()
      : null;

  const fileUrl = safeFileUrl(o.fileUrl);
  const logoFileUrl = safeFileUrl(o.logoFileUrl);
  if (!fileUrl && cleanLine(o.fileUrl, QUOTE_LIMITS.url)) dropped.push("fileUrl(허용되지 않는 URL)");
  if (!logoFileUrl && cleanLine(o.logoFileUrl, QUOTE_LIMITS.url)) dropped.push("logoFileUrl(허용되지 않는 URL)");

  return {
    ok: true,
    dropped,
    value: {
      product,
      quantity:     cut("quantity", o.quantity, QUOTE_LIMITS.quantity),
      deliveryDate: cut("deliveryDate", o.deliveryDate, QUOTE_LIMITS.deliveryDate),
      purpose:      cut("purpose", o.purpose, QUOTE_LIMITS.purpose),
      customDesign: oneOf(o.customDesign, ["yes", "no"] as const),
      styleType:    oneOf(o.styleType, QUOTE_STYLES),
      productText:  cut("productText", o.productText, QUOTE_LIMITS.productText),
      /* 요구사항 두 곳만 줄바꿈을 살린다 — 나머지는 한 줄로 접는다 */
      colorRequest: cut("colorRequest", o.colorRequest, QUOTE_LIMITS.colorRequest, false),
      notes:        cut("notes", o.notes, QUOTE_LIMITS.notes, false),
      name,
      email,
      phone:        cut("phone", o.phone, QUOTE_LIMITS.phone),
      fileName:     cleanLine(o.fileName, QUOTE_LIMITS.fileName),
      fileUrl,
      files,
      designs,
      logoFileName: cleanLine(o.logoFileName, QUOTE_LIMITS.fileName),
      logoFileUrl,
      sampling:        toBool(o.sampling),
      samplingImprove: toBool(o.samplingImprove),
      supervision:     toBool(o.supervision),
      premiumFinish:   toBool(o.premiumFinish),
      ageGroups,
      assemblyMethod: cut("assemblyMethod", o.assemblyMethod, QUOTE_LIMITS.assemblyMethod),
      designStyle:    cut("designStyle", o.designStyle, QUOTE_LIMITS.designStyle),
      manualOption:   oneOf(o.manualOption, MANUAL_OPTIONS),
      rushed:         toBool(o.rushed),
      packaging:      oneOf(o.packaging, QUOTE_PACKAGINGS),
      orderType:      oneOf(o.orderType, ORDER_TYPES),
      acquisition,
    },
  };
}
