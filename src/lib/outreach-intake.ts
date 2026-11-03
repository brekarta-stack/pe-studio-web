/**
 * 발굴 리드 인테이크 — 순수 판정 로직 (DB·Next 의존 없음).
 *
 * 쓰는 곳: POST /api/admin/outreach/intake (src/app/api/admin/outreach/intake/route.ts)
 *          → 옛 발굴 에이전트(~/agents-bd) 초안 일괄 이관 + 앞으로의 매일 인테이크.
 *
 * 왜 기관 단위로 묶는가:
 * 옛 에이전트는 중복 방지 키를 캠페인 slug 로 잡아서 제안서 109건이 기관 53곳에 몰렸다
 * (소방청 15번). 그래서 여기서는 **기관 = normalizeOrgKey(org)** 로만 판정한다.
 *   - 처음 보는 기관 → 새 리드 1행(create)
 *   - 이미 있는 기관 → 새 행을 만들지 않고, 그 리드의 활동 기록에 초안 한 줄(merge)
 * Drop 된 리드에도 합친다 — 버린 기관에 다시 제안이 들어왔다는 사실 자체가 기록할 가치가 있고,
 * 새 행을 만들면 "같은 기관 두 행" 문제가 그대로 돌아온다.
 *
 * 판정을 순수 함수로 떼어 둔 이유: dryRun 과 실제 실행이 같은 계획을 쓰게 하고,
 * DB 없이 테스트로 규칙을 못 박기 위해서다.
 */

import { normalizeOrgKey } from "./lead-activity-types.ts";
import { isOutreachStage } from "./assignment-types.ts";
import { clip, LIMITS, safeHttpUrl } from "./outreach.ts";

export interface IntakeLead {
  org: string;
  slug?: string;
  segment?: string;
  score?: number | null;
  contactName?: string;
  contactEmail?: string;
  phone?: string;
  contactFormUrl?: string;
  subject?: string;
  matchedCases?: string[];
  proposalUrl?: string;
  createdAt?: string;
  stage?: string;
  bodyText?: string;
  imagePrompt?: string;
  sourceFile?: string;
}

type StringField =
  | "slug"
  | "segment"
  | "contactName"
  | "contactEmail"
  | "phone"
  | "contactFormUrl"
  | "subject"
  | "proposalUrl"
  | "bodyText"
  | "imagePrompt"
  | "sourceFile";

/**
 * 문자열 필드 — [정식 키, 받아 주는 별칭들, 최대 길이].
 * 발굴 에이전트 JSON 은 snake_case(body_text, matched_cases…)이고 이관 스크립트는 camelCase 라
 * 둘 다 받는다. 앞쪽 키가 우선. view_url 은 옛 에이전트가 덱 링크를 담던 이름이다.
 * 빈 값이면 아예 키를 두지 않는다 (DB 에 "" 와 null 이 섞이지 않게).
 */
const STRING_FIELDS: readonly [StringField, readonly string[], number][] = [
  ["slug", ["slug"], LIMITS.slug],
  ["segment", ["segment"], LIMITS.segment],
  ["contactName", ["contactName", "contact_name"], LIMITS.contact],
  ["contactEmail", ["contactEmail", "contact_email"], LIMITS.contact],
  ["phone", ["phone"], LIMITS.contact],
  ["contactFormUrl", ["contactFormUrl", "contact_form_url"], LIMITS.body],
  ["subject", ["subject"], LIMITS.subject],
  ["proposalUrl", ["proposalUrl", "proposal_url", "view_url"], LIMITS.body],
  ["bodyText", ["bodyText", "body_text"], LIMITS.bodyText],
  ["imagePrompt", ["imagePrompt", "image_prompt"], LIMITS.bodyText],
  ["sourceFile", ["sourceFile", "source_file"], LIMITS.contact],
];

/** 링크 필드 — http(s) 가 아니면 리드는 받고 그 필드만 버린다 (보드가 그대로 <a href> 로 연다) */
const URL_FIELDS: readonly StringField[] = ["proposalUrl", "contactFormUrl"];

/** 별칭 중 처음으로 값이 있는(undefined·null 아님) 키와 값 */
function pick(r: Record<string, unknown>, keys: readonly string[]): { key: string; value: unknown } | null {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null) return { key: k, value: r[k] };
  }
  return null;
}

/**
 * 점수 → 1..5 정수. 보드·수정 폼이 1~5 척도라 그 밖의 값은 null —
 * 10점·100점 척도 값을 잘라 넣으면 틀린 값이 진짜처럼 보이고, 수정 폼이 그 값을 되돌려 보내다 실패한다.
 */
function toScore(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isInteger(n)) return null;
  return n >= 1 && n <= 5 ? n : null;
}

export function validateLead(
  raw: unknown
): { ok: true; lead: IntakeLead } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "리드는 객체여야 합니다." };
  }
  const r = raw as Record<string, unknown>;

  const org = typeof r.org === "string" ? clip(r.org, LIMITS.org) : "";
  if (!org) return { ok: false, error: "org(기관명)가 비어 있습니다." };

  const lead: IntakeLead = { org };

  for (const [field, keys, max] of STRING_FIELDS) {
    const hit = pick(r, keys);
    if (!hit) continue;
    if (typeof hit.value !== "string") return { ok: false, error: `${hit.key} 는 문자열이어야 합니다.` };
    let t: string;
    if (URL_FIELDS.includes(field)) {
      // 링크는 잘라 넣으면 깨진 주소가 진짜처럼 남는다 — 너무 길면 버린다
      const raw = hit.value.trim();
      t = raw.length > max ? "" : safeHttpUrl(raw);
    } else {
      t = clip(hit.value, max);
    }
    if (t) lead[field] = t;
  }

  if ("score" in r) lead.score = toScore(r.score);

  const cases = pick(r, ["matchedCases", "matched_cases"]);
  if (cases) {
    const v = cases.value;
    if (!Array.isArray(v) || !v.every((c) => typeof c === "string")) {
      return { ok: false, error: `${cases.key} 는 문자열 배열이어야 합니다.` };
    }
    lead.matchedCases = (v as string[]).map((c) => clip(c, LIMITS.subject)).filter(Boolean);
  }

  if (r.stage !== undefined && r.stage !== null && r.stage !== "") {
    const s = typeof r.stage === "string" ? r.stage.trim() : r.stage;
    // 인테이크는 "내가 먼저 보내는 제안" 입구 — 인바운드·완료 단계로 바로 꽂히면 보드가 꼬인다
    if (!isOutreachStage(s)) return { ok: false, error: `stage 는 제안 영업 단계여야 합니다: ${String(r.stage)}` };
    lead.stage = s;
  }

  const created = pick(r, ["createdAt", "created_at"]);
  if (created && created.value !== "") {
    const c = typeof created.value === "string" ? created.value.trim() : "";
    if (!c || Number.isNaN(Date.parse(c))) {
      return { ok: false, error: `${created.key} 을 날짜로 읽을 수 없습니다: ${String(created.value)}` };
    }
    lead.createdAt = c;
  }

  return { ok: true, lead };
}

export interface ExistingLead {
  id: string;
  orgKey: string;
  createdAt: string;
  proposalUrl: string;
  stage: string;
  droppedAt: string | null;
}

export type IntakeAction =
  | { kind: "create"; orgKey: string; lead: IntakeLead; stage: string }
  | { kind: "merge"; orgKey: string; lead: IntakeLead; existingId: string; updateProposal: boolean }
  | { kind: "skip"; orgKey: string; lead: IntakeLead; reason: string };

/** ISO → epoch ms, 없거나 못 읽으면 null */
function timeOf(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * 같은 기관 행이 여럿이면(과거 수기 중복) 대표 하나를 고른다 —
 * 살아 있는 행 우선, 그다음 최신. 활동을 Drop 된 옛 행에 붙이면 보드에서 안 보인다.
 */
function preferExisting(a: ExistingLead, b: ExistingLead): ExistingLead {
  const aLive = !a.droppedAt;
  const bLive = !b.droppedAt;
  if (aLive !== bLive) return aLive ? a : b;
  return (timeOf(b.createdAt) ?? 0) > (timeOf(a.createdAt) ?? 0) ? b : a;
}

/**
 * 인테이크 계획. 초안이 오래된 것부터 처리되게 createdAt 오름차순으로 정렬한다
 * (날짜 없는 건 맨 뒤, 같은 값끼리는 입력 순서 유지) — 그래야 기관당 첫 초안이 행이 되고
 * 나머지는 시간순 활동으로 쌓인다.
 */
export function planIntake(leads: IntakeLead[], existing: ExistingLead[]): IntakeAction[] {
  const byKey = new Map<string, ExistingLead>();
  for (const ex of existing) {
    if (!ex.orgKey) continue;
    const cur = byKey.get(ex.orgKey);
    byKey.set(ex.orgKey, cur ? preferExisting(cur, ex) : { ...ex });
  }

  const ordered = leads
    .map((lead, i) => ({ lead, i, t: timeOf(lead.createdAt) }))
    .sort((a, b) => {
      if (a.t === null && b.t === null) return a.i - b.i;
      if (a.t === null) return 1;
      if (b.t === null) return -1;
      return a.t - b.t || a.i - b.i;
    });

  const actions: IntakeAction[] = [];
  for (const { lead } of ordered) {
    const orgKey = normalizeOrgKey(lead.org);
    if (!orgKey) {
      actions.push({ kind: "skip", orgKey, lead, reason: "기관명을 정규화할 수 없음" });
      continue;
    }

    const ex = byKey.get(orgKey);
    if (!ex) {
      const stage = lead.stage ?? (lead.proposalUrl ? "drafted" : "sourced");
      actions.push({ kind: "create", orgKey, lead, stage });
      // 같은 배치의 두 번째 초안이 merge 가 되도록 가상 행을 남긴다. id 는 실행기가 삽입 후 채운다
      byKey.set(orgKey, {
        id: "",
        orgKey,
        createdAt: lead.createdAt ?? "",
        proposalUrl: lead.proposalUrl ?? "",
        stage,
        droppedAt: null,
      });
      continue;
    }

    // 제안서 링크는 "더 새 초안"일 때만 바꾼다 — 옛 초안을 나중에 이관해도 최신 덱이 덮이지 않게
    const tl = timeOf(lead.createdAt);
    const te = timeOf(ex.createdAt);
    const newer = te === null ? true : tl === null ? false : tl >= te;
    const updateProposal = !!lead.proposalUrl && (!ex.proposalUrl || newer);

    actions.push({ kind: "merge", orgKey, lead, existingId: ex.id, updateProposal });

    if (updateProposal) {
      ex.proposalUrl = lead.proposalUrl ?? ex.proposalUrl;
      if (tl !== null && (te === null || tl >= te)) ex.createdAt = lead.createdAt ?? ex.createdAt;
    }
  }
  return actions;
}

export function summarizeActions(actions: IntakeAction[]): {
  created: number;
  merged: number;
  skipped: number;
} {
  let created = 0;
  let merged = 0;
  let skipped = 0;
  for (const a of actions) {
    if (a.kind === "create") created++;
    else if (a.kind === "merge") merged++;
    else skipped++;
  }
  return { created, merged, skipped };
}

/** ISO → YYYY-MM-DD (KST 기준). 원문이 이미 날짜만이면 그대로 */
function dateLabel(iso: string | undefined): string {
  if (!iso) return "날짜 미상";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "날짜 미상";
  // 서버(UTC)에서 돌아도 운영자가 보는 한국 날짜로 찍히게
  return new Date(t + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 합쳐진 초안을 활동 기록 한 줄로 — "제안 초안 2026-06-16 · binggrae · https://…" */
export function activityBodyForDraft(lead: IntakeLead): string {
  const parts = [`제안 초안 ${dateLabel(lead.createdAt)}`];
  if (lead.slug) parts.push(lead.slug);
  if (lead.proposalUrl) parts.push(lead.proposalUrl);
  else if (lead.subject) parts.push(lead.subject);
  return parts.join(" · ");
}
