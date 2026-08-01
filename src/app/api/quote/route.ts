import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { randomUUID } from "crypto";
import { z } from "zod";
import { Resend } from "resend";
import { quoteFromRow, type QuoteSubmission } from "@/lib/quote-types";
import { parseAcquisition } from "@/lib/analytics";
import { parseQuantity } from "@/lib/quote-pricing";
import { MANUAL_OPTION_LABELS, STYLE_LABELS } from "@/lib/quote-labels";
import { requireAdminApi } from "@/lib/session";

/* ── 견적 알림 메일 발송 (실패해도 사용자 응답에는 영향 없음) ── */
const PRODUCT_LABEL: Record<string, string> = {
  papercraft: "페이퍼 크래프트",
  action:     "액션 페이퍼 토이",
  popup:      "팝업북",
  foamboard:  "폼보드(우드락)",
  unsure:     "잘 모름 — 담당자 상의 희망",
  education:  "용도 · 교육/교구용",
  promotion:  "용도 · 홍보용",
  hobby:      "용도 · 취미용",
};

async function sendInquiryEmail(s: QuoteSubmission): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to     = process.env.INQUIRY_TO_EMAIL ?? "ask@papercraft.kr";
  const bcc    = process.env.INQUIRY_BCC_EMAIL;
  const from   = process.env.INQUIRY_FROM_EMAIL ?? "Papercraft Quote <onboarding@resend.dev>";
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://papercraft.kr";

  if (!apiKey) {
    console.warn("[api/quote] RESEND_API_KEY not set — skipping email notification");
    return;
  }

  const productLabel = PRODUCT_LABEL[s.product] ?? s.product;
  const PACKAGING_LABEL: Record<string, string> = {
    "paper-box": "종이 박스 (고급)",
    opp:         "OPP 필름 (일반)",
    bulk:        "벌크 납품 (포장 생략)",
  };
  const acqText = (() => {
    const a = s.acquisition;
    if (!a) return "직접/자연 유입 (광고 외)";
    const { source, medium } = parseAcquisition({
      referrer: a.referrer,
      utmSource: a.utmSource,
      utmMedium: a.utmMedium,
      gclid: a.gclid,
      adHint: a.adHint,
    });
    const camp = a.utmCampaign ? ` · 캠페인:${a.utmCampaign}` : "";
    return `${source} / ${medium}${camp}`;
  })();

  // 첨부파일 — 다중(files)이 있으면 각각을, 없으면 레거시 단일(fileName/fileUrl)을 표시
  const attachmentRows: Array<[string, string, string?]> =
    s.files.length > 0
      ? s.files.map((f, i) => [`참고 자료 ${i + 1}`, f.name || "파일", f.url])
      : [["참고 자료 파일", s.fileName || "—", s.fileUrl || undefined]];

  // [라벨, 값, 선택적 href] — href 가 있으면 값이 클릭 가능한 링크로 렌더된다.
  const rows: Array<[string, string, string?]> = [
    ["제품 유형",         productLabel],
    ["샘플링 희망",       s.sampling ? "예 (생산 전 수제작 샘플 발송)" : "아니오"],
    ["디자인 개선 희망",  s.samplingImprove ? "예 (샘플링 후 디자인 개선)" : "아니오"],
    ["생산 감리 희망",    s.supervision ? "예 (생산 시 감리 진행)" : "아니오"],
    ["별도 가공 희망",    s.premiumFinish ? "예 (특수지·특수 가공)" : "아니오"],
    ["수량",              s.quantity || "—"],
    ["희망 납기",         s.rushed ? "최대한 빠르게 (긴급)" : (s.deliveryDate || "—")],
    ["포장 방식",         s.packaging ? (PACKAGING_LABEL[s.packaging] ?? s.packaging) : "—"],
    ["용도",              s.purpose || "—"],
    ["이용 연령",         s.ageGroups.length > 0 ? s.ageGroups.join(", ") : "—"],
    ["만드는 방식",       s.assemblyMethod || "—"],
    ["설계 스타일",       s.designStyle || "—"],
    ["설명서 생산",       s.manualOption ? (MANUAL_OPTION_LABELS[s.manualOption] ?? s.manualOption) : "—"],
    ["선호 작가",         s.styleType ? (STYLE_LABELS[s.styleType] ?? s.styleType) : "—"],
    ["맞춤 디자인 (구)",  s.customDesign === "yes" ? "예" : s.customDesign === "no" ? "아니오" : "—"],
    ["제품 삽입 문구",    s.productText || "—"],
    ["색상·디자인 요청",  s.colorRequest || "—"],
    ["기타 메모",         s.notes || "—"],
    ["담당자 이름",       s.name],
    ["이메일",            s.email],
    ["연락처",            s.phone || "—"],
    ...attachmentRows,
    ["회사 로고 파일",    s.logoFileName || "—", s.logoFileUrl || undefined],
    ["유입 경로",         acqText],
    ["광고 클릭ID(gclid)", s.acquisition?.gclid || "—"],
    ["접수 일시",         s.createdAt],
    ["문의 ID",           s.id],
  ];

  const esc = (v: string) =>
    v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const tableHtml = rows
    .map(([k, v, href]) => {
      const cell = href
        ? `<a href="${esc(href)}" target="_blank" rel="noreferrer" style="color:#6366f1;">${esc(v)} · 열기 ↗</a>`
        : esc(v).replace(/\n/g, "<br/>");
      return `<tr><th align="left" style="padding:8px 14px;border-bottom:1px solid #eee;background:#fafafa;white-space:nowrap;width:120px;color:#555;font-weight:600;">${esc(k)}</th><td style="padding:8px 14px;border-bottom:1px solid #eee;color:#111;">${cell}</td></tr>`;
    })
    .join("");

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
  <div style="padding:24px 28px 12px;border-bottom:1px solid #e5e7eb;">
    <div style="font-size:13px;letter-spacing:1px;color:#6366f1;font-weight:700;">PAPERCRAFT.KR · 새 제작 문의</div>
    <h1 style="margin:8px 0 0;font-size:22px;color:#111;">${esc(s.name)} · ${esc(productLabel)}</h1>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:14px;">${tableHtml}</table>
  <div style="padding:18px 28px;background:#fafafa;border-top:1px solid #e5e7eb;font-size:13px;color:#555;line-height:1.55;">
    이 메일은 <a href="${siteUrl}/quote" style="color:#6366f1;">papercraft.kr/quote</a> 폼 제출에 의해 자동 발송되었습니다.<br/>
    어드민 페이지에서 전체 목록 확인: <a href="${siteUrl}/admin/quotes" style="color:#6366f1;">${siteUrl}/admin/quotes</a>
  </div>
</div></body></html>`;

  const textLines = rows.map(([k, v, href]) => `${k}: ${v}${href ? ` (${href})` : ""}`).join("\n");
  const text = `[papercraft.kr] 새 제작 문의\n\n${textLines}\n\n전체 목록: ${siteUrl}/admin/quotes\n`;

  const resend = new Resend(apiKey);
  const subject = `[papercraft.kr] 새 제작 문의 — ${s.name} · ${productLabel}`;
  // Resend SDK 는 실패 시 throw 하지 않고 { error } 를 반환 — 반드시 체크해서 로그에 드러냄
  const { error } = await resend.emails.send({
    from,
    to:      [to],
    bcc:     bcc ? [bcc] : undefined,
    replyTo: s.email,
    subject,
    html,
    text,
  });
  if (error) throw new Error(`Resend(운영자 알림): ${error.message ?? JSON.stringify(error)}`);
}

/**
 * 고객 접수 확인 자동 회신 — "검토 중이며 3영업일 이내 담당자 회신" 안내.
 * 운영자 알림(sendInquiryEmail)과 독립적으로 best-effort 발송 —
 * 실패해도 접수(201)에는 영향 없음.
 */
async function sendCustomerAckEmail(s: QuoteSubmission): Promise<void> {
  const apiKey  = process.env.RESEND_API_KEY;
  const from    = process.env.INQUIRY_FROM_EMAIL ?? "PE Studio <onboarding@resend.dev>";
  const replyTo = process.env.INQUIRY_TO_EMAIL ?? "ask@papercraft.kr";
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://papercraft.kr";

  if (!apiKey) {
    console.warn("[api/quote] RESEND_API_KEY not set — skipping customer ack email");
    return;
  }
  if (!s.email) return;

  const productLabel = PRODUCT_LABEL[s.product] ?? s.product;
  const shortId = s.id.slice(0, 8).toUpperCase();

  const esc = (v: string) =>
    v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const summaryRows: Array<[string, string]> = [
    ["제품",       productLabel],
    ["수량",       s.quantity ? `${s.quantity}개` : "상담 후 결정"],
    ["희망 납기",  s.rushed ? "최대한 빠르게" : (s.deliveryDate || "상담 후 결정")],
    ["접수 번호",  shortId],
  ];

  const summaryHtml = summaryRows
    .map(
      ([k, v]) =>
        `<tr><th align="left" style="padding:7px 14px;border-bottom:1px solid #eee;background:#fafafa;white-space:nowrap;width:100px;color:#555;font-weight:600;">${esc(k)}</th><td style="padding:7px 14px;border-bottom:1px solid #eee;color:#111;">${esc(v)}</td></tr>`
    )
    .join("");

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
  <div style="padding:26px 28px 18px;border-bottom:1px solid #e5e7eb;">
    <div style="font-size:12px;letter-spacing:1.5px;color:#1E22B2;font-weight:700;">PE STUDIO · PAPER ENGINEERING</div>
    <h1 style="margin:10px 0 0;font-size:21px;color:#111;">제작 문의가 접수되었습니다</h1>
  </div>
  <div style="padding:22px 28px;font-size:14px;color:#333;line-height:1.7;word-break:keep-all;">
    <p style="margin:0 0 14px;">${esc(s.name)}님, 문의해 주셔서 감사합니다.</p>
    <p style="margin:0 0 14px;">
      보내주신 내용은 현재 <strong>검토 중</strong>입니다.<br/>
      담당자가 확인 후 <strong style="color:#1E22B2;">3영업일 이내</strong>에 이 메일 주소로 회신드립니다.
    </p>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:14px;">${summaryHtml}</table>
  <div style="padding:18px 28px;background:#fafafa;border-top:1px solid #e5e7eb;font-size:12px;color:#666;line-height:1.7;word-break:keep-all;">
    급한 문의는 <a href="mailto:${esc(replyTo)}" style="color:#1E22B2;">${esc(replyTo)}</a> 로 연락 주세요.
    이 메일에 바로 회신하셔도 담당자에게 전달됩니다.<br/>
    <a href="${siteUrl}" style="color:#1E22B2;">papercraft.kr</a> · Paper Engineering Studio
  </div>
</div></body></html>`;

  const text = [
    `${s.name}님, 문의해 주셔서 감사합니다.`,
    ``,
    `보내주신 내용은 현재 검토 중입니다.`,
    `담당자가 확인 후 3영업일 이내에 이 메일 주소로 회신드립니다.`,
    ``,
    ...summaryRows.map(([k, v]) => `${k}: ${v}`),
    ``,
    `급한 문의: ${replyTo}`,
    `Paper Engineering Studio · ${siteUrl}`,
  ].join("\n");

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to:      [s.email],
    replyTo,
    subject: `[PE Studio] 제작 문의가 접수되었습니다 (접수번호 ${shortId})`,
    html,
    text,
  });
  if (error) throw new Error(`Resend(고객 확인): ${error.message ?? JSON.stringify(error)}`);
}

/* 첨부파일 URL 검증 — 빈 문자열이거나, 우리 스토리지의 공개 https URL만 허용.
   (javascript:/data: 등 주입 차단 — 어드민/이메일에서 href 로 렌더되므로) */
const QuoteFileUrl = z
  .string()
  .max(1024)
  .default("")
  .refine((v) => v === "" || /^https:\/\/[^\s"'<>]+\/storage\/v1\/object\/public\//.test(v), {
    message: "허용되지 않는 파일 URL 입니다.",
  });

/* ── 입력 스키마 (Zod) ── */
const QuoteSchema = z.object({
  product:      z.enum(["papercraft", "action", "popup", "foamboard", "unsure", "education", "promotion", "hobby"]),
  quantity:     z.string().max(20).default(""),
  deliveryDate: z.string().max(30).default(""),
  purpose:      z.string().max(100).default(""),
  // 기존 customDesign 은 호환 유지 (구버전 제출 케이스), 신규 폼은 styleType 사용
  customDesign: z.enum(["yes", "no", ""]).default(""),
  // 선호 작가 (오세기/김철호/문재호/추천받기) — 구 '디자인 스타일' 값도 호환 유지.
  // 현행 값을 빠뜨리면 작가를 고른 제출이 통째로 400 이 된다.
  styleType:    z.enum(["osegi", "cheolho", "jaeho", "recommend", "realism", "characterize", "expert", ""]).default(""),
  // 신규: 제품에 삽입할 문구
  productText:  z.string().max(200).default(""),
  colorRequest: z.string().max(500).default(""),
  notes:        z.string().max(500).default(""),
  name:         z.string().min(1, "이름은 필수입니다").max(100),
  email:        z.string().email("올바른 이메일을 입력하세요").max(200),
  phone:        z.string().max(30).default(""),
  fileName:     z.string().max(255).default(""),
  // 신규: 참고 자료 파일의 공개 URL (Supabase Storage) — 레거시 단일
  fileUrl:      QuoteFileUrl,
  // 다중 첨부파일 (최대 5개) — 신규 폼은 여기에 담는다
  files:        z
    .array(z.object({ name: z.string().max(255).default(""), url: QuoteFileUrl }))
    .max(5)
    .default([]),
  // 제작 희망 디자인 목록 — 한 줄 = { 이름, 수량, 참고 자료 1개 }
  designs: z
    .array(
      z.object({
        id:       z.string().max(64).default(""),
        name:     z.string().max(200).default(""),
        quantity: z.string().max(20).default(""),
        // 모델 설계 난이도 — 디자인비 산정 근거 (미선택은 빈 문자열)
        complexity: z.enum(["simple", "normal", "complex", ""]).default(""),
        file: z
          .object({ name: z.string().max(255).default(""), url: QuoteFileUrl })
          .nullable()
          .default(null),
      })
    )
    .max(20)
    .default([]),
  // 신규: 회사 로고 파일명 (선택)
  logoFileName: z.string().max(255).default(""),
  // 신규: 회사 로고 파일의 공개 URL (선택)
  logoFileUrl:  QuoteFileUrl,
  // 제작 옵션 (Step 3 확장)
  sampling:     z.boolean().default(false),
  // 샘플링을 보고 디자인 개선 희망 / 생산 시 감리 진행 희망 / 별도 가공·고급 소재
  samplingImprove: z.boolean().default(false),
  supervision:  z.boolean().default(false),
  premiumFinish: z.boolean().default(false),
  // 제품 이용 연령 — 복수 선택 (폼의 AGE_GROUPS 라벨 그대로)
  ageGroups:    z.array(z.string().max(60)).max(10).default([]),
  // 만드는 방식 / 디자인 설계 스타일 — 폼 라벨 그대로
  assemblyMethod: z.string().max(60).default(""),
  designStyle:  z.string().max(60).default(""),
  // 설명서 생산 — guide(무료) / qr(종당 100만) / print(부수당 300원)
  manualOption: z.enum(["guide", "qr", "print", ""]).default(""),
  rushed:       z.boolean().default(false),
  packaging:    z.enum(["paper-box", "opp", "bulk", ""]).default(""),
  // 주문 형태 — 견적 구조를 정한다 (도면만 / 제품 생산 / 완제품)
  orderType:    z.enum(["blueprint", "production", "finished", ""]).default(""),
  // 광고 유입정보 (gclid·UTM) — 선택. 전환 측정/오프라인 임포트용
  acquisition: z
    .object({
      referrer:    z.string().max(1024).default(""),
      utmSource:   z.string().max(120).default(""),
      utmMedium:   z.string().max(120).default(""),
      utmCampaign: z.string().max(120).default(""),
      gclid:       z.string().max(400).default(""),
      adHint:      z.string().max(20).default(""),
    })
    .nullable()
    .optional(),
});

/* ── 단순 IP 레이트 리밋 (분당 5회) ── */
const rateMap = new Map<string, { count: number; reset: number }>();
const RATE_LIMIT = 5;
const WINDOW_MS  = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now > entry.reset) {
    rateMap.set(ip, { count: 1, reset: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// POST /api/quote — 제작 문의 저장 (누구나 가능)
export async function POST(request: Request) {
  /* 레이트 리밋 */
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
  }

  /* 입력 파싱 & 검증 */
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const parsed = QuoteSchema.safeParse(raw);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다.";
    return NextResponse.json({ error: firstError }, { status: 400 });
  }

  const data = parsed.data;

  /* 총 수량은 클라이언트가 보낸 값을 믿지 않고 디자인 라인에서 다시 더한다 —
     화면에 보여준 개략 견적과 접수된 수량이 어긋나면 안 된다.
     라인이 없는 경우(구버전 폼·수동 등록)에는 보내온 quantity 를 그대로 쓴다. */
  const designs = (data.designs ?? []).filter((d) => d.name.trim() || parseQuantity(d.quantity) > 0);
  const totalQty = designs.reduce((sum, d) => sum + parseQuantity(d.quantity), 0);

  const submission: QuoteSubmission = {
    id:           randomUUID(),
    product:      data.product,
    quantity:     totalQty > 0 ? String(totalQty) : data.quantity,
    deliveryDate: data.deliveryDate,
    purpose:      data.purpose,
    customDesign: data.customDesign,
    styleType:    data.styleType,
    productText:  data.productText,
    colorRequest: data.colorRequest,
    notes:        data.notes,
    name:         data.name,
    email:        data.email,
    phone:        data.phone,
    fileName:     data.fileName,
    fileUrl:      data.fileUrl,
    logoFileName: data.logoFileName,
    logoFileUrl:  data.logoFileUrl,
    sampling:     data.sampling,
    samplingImprove: data.samplingImprove,
    supervision:  data.supervision,
    premiumFinish: data.premiumFinish,
    ageGroups:    data.ageGroups,
    assemblyMethod: data.assemblyMethod,
    designStyle:  data.designStyle,
    manualOption: data.manualOption,
    rushed:       data.rushed,
    packaging:    data.packaging,
    orderType:    data.orderType,
    acquisition:  data.acquisition ?? null,
    inProgress:   false,
    stage:        "new",
    droppedAt:    null,
    files:        (data.files ?? []).filter((f) => f.url),
    designs,
    createdAt:    new Date().toISOString(),
  };

  const { error } = await supabaseAdmin.from("quotes").insert({
    id:             submission.id,
    product:        submission.product,
    quantity:       submission.quantity,
    delivery_date:  submission.deliveryDate,
    purpose:        submission.purpose,
    custom_design:  submission.customDesign,
    style_type:     submission.styleType,
    product_text:   submission.productText,
    color_request:  submission.colorRequest,
    notes:          submission.notes,
    name:           submission.name,
    email:          submission.email,
    phone:          submission.phone,
    file_name:      submission.fileName,
    logo_file_name: submission.logoFileName,
    sampling:       submission.sampling,
    rushed:         submission.rushed,
    packaging:      submission.packaging,
    created_at:     submission.createdAt,
  });

  if (error) {
    console.error("[api/quote] DB insert error:", error);
    return NextResponse.json({ error: "견적 접수 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }

  /* 제작 희망 디자인 best-effort 저장 — 'designs' 컬럼(마이그레이션 20260803)이
     없으면 조용히 건너뛴다. 별도 update 라 컬럼 부재 시에도 접수 자체는 성공한다.
     (총 수량은 이미 quantity 에 들어가 있어 마이그레이션 전에도 핵심 정보는 남는다) */
  if (submission.designs.length > 0) {
    const { error: designErr } = await supabaseAdmin
      .from("quotes")
      .update({ designs: submission.designs })
      .eq("id", submission.id);
    if (designErr) {
      console.warn("[api/quote] designs 미저장 (마이그레이션 대기?):", designErr.message);
    }
  }

  /* 샘플링 옵션·이용 연령 best-effort 저장 — 컬럼(마이그레이션 20260805)이 없으면
     조용히 건너뛴다. 별도 update 라 컬럼 부재 시에도 접수 자체는 성공한다. */
  if (submission.samplingImprove || submission.supervision || submission.ageGroups.length > 0) {
    const { error: optErr } = await supabaseAdmin
      .from("quotes")
      .update({
        sampling_improve: submission.samplingImprove,
        supervision:      submission.supervision,
        age_groups:       submission.ageGroups,
      })
      .eq("id", submission.id);
    if (optErr) {
      console.warn("[api/quote] 샘플링 옵션·이용 연령 미저장 (마이그레이션 20260805 대기?):", optErr.message);
    }
  }

  /* 별도 가공·만드는 방식·설계 스타일 best-effort 저장 — 컬럼(마이그레이션 20260806) 대기 대비.
     20260805 와 별개 update 로 둔다 — 한쪽 마이그레이션만 적용된 환경에서도 다른 쪽은 저장되게. */
  if (submission.premiumFinish || submission.assemblyMethod || submission.designStyle) {
    const { error: optErr2 } = await supabaseAdmin
      .from("quotes")
      .update({
        premium_finish:  submission.premiumFinish,
        assembly_method: submission.assemblyMethod,
        design_style:    submission.designStyle,
      })
      .eq("id", submission.id);
    if (optErr2) {
      console.warn("[api/quote] 별도 가공·만드는 방식·설계 스타일 미저장 (마이그레이션 20260806 대기?):", optErr2.message);
    }
  }

  /* 설명서 생산 best-effort 저장 — 'manual_option' 컬럼(마이그레이션 20260807) 대기 대비 */
  if (submission.manualOption) {
    const { error: manualErr } = await supabaseAdmin
      .from("quotes")
      .update({ manual_option: submission.manualOption })
      .eq("id", submission.id);
    if (manualErr) {
      console.warn("[api/quote] 설명서 생산 미저장 (마이그레이션 20260807 대기?):", manualErr.message);
    }
  }

  /* 주문 형태 best-effort 저장 — 'order_type' 컬럼(마이그레이션 20260804) 대기 대비 */
  if (submission.orderType) {
    const { error: typeErr } = await supabaseAdmin
      .from("quotes")
      .update({ order_type: submission.orderType })
      .eq("id", submission.id);
    if (typeErr) {
      console.warn("[api/quote] order_type 미저장 (마이그레이션 대기?):", typeErr.message);
    }
  }

  /* 광고 유입정보 best-effort 저장 — 'acquisition' 컬럼(마이그레이션 20260609)이 없으면 조용히 건너뜀.
     별도 update 라 컬럼 부재 시에도 위 insert(견적 접수)에는 영향이 없다. */
  if (submission.acquisition) {
    const { error: acqErr } = await supabaseAdmin
      .from("quotes")
      .update({ acquisition: submission.acquisition })
      .eq("id", submission.id);
    if (acqErr) {
      console.warn("[api/quote] acquisition 미저장 (마이그레이션 대기?):", acqErr.message);
    }
  }

  /* 첨부파일 URL best-effort 저장 — file_url/logo_file_url 컬럼(마이그레이션 20260710)이
     없으면 조용히 건너뜀. 별도 update 라 컬럼 부재 시에도 위 insert(견적 접수)에는 영향 없음.
     컬럼 생성(SQL Editor에서 1회 실행) 후부터 어드민/이메일에서 첨부 열람 가능. */
  if (submission.fileUrl || submission.logoFileUrl) {
    const { error: fileErr } = await supabaseAdmin
      .from("quotes")
      .update({ file_url: submission.fileUrl, logo_file_url: submission.logoFileUrl })
      .eq("id", submission.id);
    if (fileErr) {
      console.warn("[api/quote] 첨부 URL 미저장 (마이그레이션 20260710 대기?):", fileErr.message);
    }
  }

  /* 다중 첨부파일 best-effort 저장 — files 컬럼(마이그레이션 20260730)이 없으면 조용히 건너뜀.
     별도 update 라 컬럼 부재 시에도 견적 접수(insert)에는 영향 없음. */
  if (submission.files.length > 0) {
    const { error: filesErr } = await supabaseAdmin
      .from("quotes")
      .update({ files: submission.files })
      .eq("id", submission.id);
    if (filesErr) {
      console.warn("[api/quote] 다중 첨부 미저장 (마이그레이션 20260730 대기?):", filesErr.message);
    }
  }

  /* 알림 메일 발송 — 실패해도 사용자에게는 201 응답 유지 */
  try {
    await sendInquiryEmail(submission);
  } catch (mailErr) {
    console.error("[api/quote] email notification failed:", mailErr);
  }

  /* 고객 접수 확인 자동 회신 — 운영자 알림과 독립 best-effort */
  try {
    await sendCustomerAckEmail(submission);
  } catch (ackErr) {
    console.error("[api/quote] customer ack email failed:", ackErr);
  }

  return NextResponse.json(submission, { status: 201 });
}

// GET /api/quote — 어드민 전용 목록 조회
export async function GET() {
  const guard = await requireAdminApi();
  if (guard) return guard;

  const { data, error } = await supabaseAdmin
    .from("quotes")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[api/quote] DB select error:", error);
    return NextResponse.json({ error: "데이터를 불러오지 못했습니다." }, { status: 500 });
  }

  const submissions: QuoteSubmission[] = (data ?? []).map(quoteFromRow);

  return NextResponse.json(submissions);
}
