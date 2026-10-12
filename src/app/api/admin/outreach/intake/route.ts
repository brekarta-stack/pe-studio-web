import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminApi } from "@/lib/session";
import { addActivity } from "@/lib/lead-activities";
import {
  validateLead,
  planIntake,
  activityBodyForDraft,
  type ExistingLead,
  type IntakeAction,
  type IntakeLead,
} from "@/lib/outreach-intake";
import { isMissingColumnError } from "@/lib/outreach";

/**
 * 발굴 리드 인테이크 API — POST /api/admin/outreach/intake
 *
 * 왜 이 라우트가 있는가:
 *  1) 로컬 맥에는 Supabase 자격증명이 없다(Vercel 환경변수가 Sensitive 라 내려받을 수 없음).
 *     그래서 옛 발굴 에이전트(~/agents-bd) 초안 이관은 배포된 앱을 거쳐야 한다
 *     → scripts/import-outreach.mjs 가 이 엔드포인트를 청크로 두드린다.
 *  2) 발굴 에이전트를 다시 돌리면 매일 여기로 리드를 넣는다. 중복 판정은 캠페인 slug 가 아니라
 *     기관(normalizeOrgKey) 단위 — 옛 slug 원장(proposed-ledger.json)을 대체한다.
 *     (계획서는 "중복이면 409" 였지만, 이관 요구에 맞춰 중복은 기존 행에 활동으로 합친다)
 *
 * 인증: `x-intake-token` 또는 `Authorization: Bearer <token>` 이 OUTREACH_INTAKE_TOKEN 과 같거나,
 *       관리자 세션. 프록시 matcher 는 /api/** 를 안 보므로 여기서 직접 막는다.
 *
 * 판정 규칙·요청/응답 모양: docs/outreach-intake.md
 */

export const dynamic = "force-dynamic";

const MAX_LEADS = 200;
const ACTOR = "intake";

/** 토큰 비교 — 길이가 다르면 timingSafeEqual 이 던지므로 먼저 거른다. 환경변수가 없으면 토큰 경로 자체를 닫는다 */
function tokenMatches(req: Request): boolean {
  const expected = process.env.OUTREACH_INTAKE_TOKEN?.trim();
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  const given =
    req.headers.get("x-intake-token")?.trim() ||
    (bearer && /^Bearer\s+/i.test(bearer) ? bearer.replace(/^Bearer\s+/i, "").trim() : "");
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

/**
 * 발굴 에이전트 산출물 원문 — 보드에서 본문·이미지 프롬프트를 다시 볼 수 있게 통째로 둔다.
 * 키는 snake_case — 계획서 §3.1 과 발굴 에이전트 JSON 이 쓰는 이름 그대로라 보드가 한 모양만 읽으면 된다.
 */
function outreachJson(lead: IntakeLead) {
  return {
    slug: lead.slug ?? null,
    subject: lead.subject ?? null,
    matched_cases: lead.matchedCases ?? [],
    body_text: lead.bodyText ?? null,
    image_prompt: lead.imagePrompt ?? null,
    contact_form_url: lead.contactFormUrl ?? null,
    source_file: lead.sourceFile ?? null,
  };
}

interface ResultRow {
  org: string;
  orgKey: string;
  action: "create" | "merge" | "skip" | "error";
  id?: string;
  existingId?: string;
  reason?: string;
}

export async function POST(req: Request) {
  if (!tokenMatches(req)) {
    const guard = await requireAdminApi();
    if (guard) return guard;
  }

  let body: { leads?: unknown; dryRun?: unknown };
  try {
    body = (await req.json()) as { leads?: unknown; dryRun?: unknown };
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (!body || !Array.isArray(body.leads)) {
    return NextResponse.json({ error: "leads 배열이 필요합니다." }, { status: 400 });
  }
  if (body.leads.length > MAX_LEADS) {
    return NextResponse.json(
      { error: `한 번에 ${MAX_LEADS}건까지 받습니다. 나눠서 보내 주세요.` },
      { status: 413 }
    );
  }
  const dryRun = body.dryRun === true;

  /* 검증 실패는 배치를 멈추지 않고 skip 으로 보고한다 — 110건 중 1건 때문에 전부 다시 보내지 않게 */
  const valid: IntakeLead[] = [];
  const invalid: ResultRow[] = [];
  body.leads.forEach((raw, i) => {
    const r = validateLead(raw);
    if (r.ok) valid.push(r.lead);
    else {
      const org =
        raw && typeof raw === "object" && typeof (raw as { org?: unknown }).org === "string"
          ? (raw as { org: string }).org
          : "";
      invalid.push({ org, orgKey: "", action: "skip", reason: `#${i}: ${r.error}` });
    }
  });

  // PostgREST 기본 상한(1000행)을 넘기면 중복 판정이 새는데, 아웃바운드 규모상 당분간 여유가 크다
  const { data: rows, error } = await supabaseAdmin
    .from("quotes")
    .select("id, org_key, created_at, proposal_url, stage, dropped_at")
    .not("org_key", "is", null);
  if (error) {
    if (isMissingColumnError(error)) {
      return NextResponse.json(
        { error: "영업 파이프라인 마이그레이션이 아직 적용되지 않았습니다." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: errMessage(error) }, { status: 500 });
  }

  const existing: ExistingLead[] = (rows ?? []).map((r) => ({
    id: r.id,
    orgKey: r.org_key ?? "",
    createdAt: r.created_at ?? "",
    proposalUrl: r.proposal_url ?? "",
    stage: r.stage ?? "",
    droppedAt: r.dropped_at ?? null,
  }));

  const actions = planIntake(valid, existing);

  if (dryRun) {
    const results: ResultRow[] = [
      ...actions.map((a) => toPlannedRow(a)),
      ...invalid,
    ];
    return NextResponse.json({
      ok: true,
      dryRun: true,
      summary: summarize(results),
      results,
    });
  }

  /* 순서대로 하나씩 — 같은 배치에서 방금 만든 행에 다음 초안이 붙어야 하므로 병렬로 돌리지 않는다 */
  const idByKey = new Map<string, string>();
  const results: ResultRow[] = [];
  for (const a of actions) {
    try {
      results.push(await execute(a, idByKey));
    } catch (e) {
      results.push({ org: a.lead.org, orgKey: a.orgKey, action: "error", reason: errMessage(e) });
    }
  }
  results.push(...invalid);

  const summary = summarize(results);
  const clean = results.every((r) => r.action === "create" || r.action === "merge");
  return NextResponse.json({ ok: clean, summary, results }, { status: clean ? 200 : 207 });
}

function toPlannedRow(a: IntakeAction): ResultRow {
  if (a.kind === "create") return { org: a.lead.org, orgKey: a.orgKey, action: "create" };
  if (a.kind === "merge") {
    return {
      org: a.lead.org,
      orgKey: a.orgKey,
      action: "merge",
      // 빈 id = 같은 배치에서 새로 만들 행
      ...(a.existingId ? { existingId: a.existingId } : { reason: "같은 배치의 새 리드에 합침" }),
    };
  }
  return { org: a.lead.org, orgKey: a.orgKey, action: "skip", reason: a.reason };
}

/** 응답 집계 — 실행 오류·검증 실패도 skipped 로 센다 (생성·합침이 아닌 건 전부 사람이 봐야 할 것) */
function summarize(results: ResultRow[]) {
  let created = 0;
  let merged = 0;
  let skipped = 0;
  for (const r of results) {
    if (r.action === "create") created++;
    else if (r.action === "merge") merged++;
    else skipped++;
  }
  return { created, merged, skipped };
}

async function execute(a: IntakeAction, idByKey: Map<string, string>): Promise<ResultRow> {
  const { lead, orgKey } = a;

  if (a.kind === "skip") return { org: lead.org, orgKey, action: "skip", reason: a.reason };

  if (a.kind === "create") {
    const at = lead.createdAt ? new Date(lead.createdAt).toISOString() : new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("quotes")
      .insert({
        source: "outbound",
        stage: a.stage,
        org: lead.org,
        org_key: orgKey,
        segment: lead.segment ?? null,
        score: lead.score ?? null,
        name: lead.contactName ?? "",
        email: lead.contactEmail ?? "",
        phone: lead.phone ?? "",
        proposal_url: lead.proposalUrl ?? null,
        notes: lead.subject ?? "",
        created_at: at,
        stage_changed_at: at,
        outreach: outreachJson(lead),
      })
      .select("id")
      .single();
    if (error) throw error;
    const id = data.id as string;
    idByKey.set(orgKey, id);

    // 활동 기록은 부가 정보 — 실패해도 리드 행은 이미 생겼으니 결과를 error 로 바꾸지 않는다
    try {
      await addActivity({
        quoteId: id,
        kind: "system",
        body: "발굴 리드 등록" + (lead.slug ? ` · ${lead.slug}` : ""),
        actor: ACTOR,
        occurredAt: at,
      });
    } catch (e) {
      return { org: lead.org, orgKey, action: "create", id, reason: `활동 기록 실패: ${errMessage(e)}` };
    }
    return { org: lead.org, orgKey, action: "create", id };
  }

  // merge — 같은 배치에서 만든 행이면 실제 id 로 바꿔 끼운다
  const id = a.existingId || idByKey.get(orgKey) || "";
  if (!id) throw new Error("합칠 리드 행이 없습니다 (같은 배치의 생성이 실패함).");

  await addActivity({
    quoteId: id,
    kind: "system",
    body: activityBodyForDraft(lead),
    actor: ACTOR,
    ...(lead.createdAt ? { occurredAt: new Date(lead.createdAt).toISOString() } : {}),
  });

  if (a.updateProposal) {
    const { data: cur, error: readErr } = await supabaseAdmin
      .from("quotes")
      .select("segment, score")
      .eq("id", id)
      .single();
    if (readErr) throw readErr;

    // 사람이 고쳐 둔 분류·점수를 에이전트 값으로 덮지 않는다 — 비어 있을 때만 채운다
    const patch: Record<string, unknown> = {
      proposal_url: lead.proposalUrl,
      outreach: outreachJson(lead),
    };
    if (cur?.segment == null && lead.segment) patch.segment = lead.segment;
    if (cur?.score == null && lead.score != null) patch.score = lead.score;

    const { error: upErr } = await supabaseAdmin.from("quotes").update(patch).eq("id", id);
    if (upErr) throw upErr;
  }

  return { org: lead.org, orgKey, action: "merge", id };
}
