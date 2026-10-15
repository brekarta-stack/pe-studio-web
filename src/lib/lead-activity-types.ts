/**
 * 리드 활동 기록 타입 + 기관명 정규화 — 클라이언트/서버 공용 (순수 함수만).
 * (DB 접근 함수는 server-only 인 src/lib/lead-activities.ts 에 있음)
 *
 * 활동 기록 = 리드(quotes) 하나에 쌓이는 접촉 타임라인. 발송·통화·메모·단계 변경·전환.
 * **append-only** 다 — 수정·삭제 경로를 만들지 않는다. 감사 기록이자 CRM 타임라인이라
 * "누가 언제 무엇을 했는지"가 사후에 바뀌면 기록의 의미가 없어진다.
 * (마이그레이션: supabase/migrations/20261013_sales_pipeline.sql)
 */

export const ACTIVITY_KINDS = [
  "note",
  "call",
  "email",
  "meeting",
  "proposal_sent",
  "stage",
  "convert",
  "drop",
  "restore",
  "system",
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  note:          "메모",
  call:          "통화",
  email:         "이메일",
  meeting:       "미팅",
  proposal_sent: "제안서 발송",
  stage:         "단계 변경",
  convert:       "전환",
  drop:          "Drop",
  restore:       "복구",
  system:        "시스템",
};

export function isActivityKind(v: unknown): v is ActivityKind {
  return typeof v === "string" && (ACTIVITY_KINDS as readonly string[]).includes(v);
}

export interface LeadActivity {
  id: string;
  /** 대상 리드 (quotes.id) */
  quoteId: string;
  kind: ActivityKind;
  body: string;
  /** 기록한 사람 — 관리자 이메일, 에이전트 이름 등. 모르면 빈 문자열 */
  actor: string;
  /** 실제로 일어난 시각 (ISO) — 통화를 나중에 적어도 그 시각으로 정렬되게 created_at 과 따로 둔다 */
  occurredAt: string;
  /** 기록된 시각 (ISO) */
  createdAt: string;
}

/** 추가 입력 — id·createdAt 은 DB 가 만든다. occurredAt 을 생략하면 지금 */
export interface LeadActivityInput {
  quoteId: string;
  kind: ActivityKind;
  body?: string;
  actor?: string;
  occurredAt?: string;
}

/* ── 기관명 정규화 ───────────────────────────────────────────
 * 중복 제안은 캠페인 slug 가 아니라 **기관 단위**로 막는다. 실제로
 * nie-ecology-friends / nie-ecorium-friends 가 둘 다 국립생태원으로 나갔다.
 * 그래서 사람이 쓰는 표기 흔들림을 하나의 키로 접는다:
 *
 *   1. NFKC + 소문자 — 전각 괄호·전각 영문을 반각으로
 *   2. 괄호 안 내용 제거 — "(주)", "(NIE)", "[본원]"
 *   3. 법인격 접두어 제거 — 사단법인·재단법인·주식회사·유한회사
 *   4. 영문 법인격 단어 제거 — corporation·corp·inc·co·ltd·llc (단어 단위라 tesco 의 co 는 안 지운다)
 *   5. 공백·문장부호·기호 전부 제거 — "국립 생태원" = "국립생태원"
 *   6. 한글 접미어를 ORG_SUFFIXES 순서대로, 더 이상 안 맞을 때까지 반복해 떼어 낸다.
 *      긴 것을 먼저 둔다 — "특례시"보다 "시"를 먼저 떼면 "수원특례시"가 "수원특례"로 남아
 *      "수원시"("수원")와 갈라진다.
 *      단, 떼고 난 나머지가 **2자 미만이면 떼지 않는다** — "대구"의 "구", "서구청"의 "구청"을
 *      떼어 한 글자 키가 생기면 엉뚱한 기관끼리 충돌한다.
 *   7. 결과가 비면(입력이 "(주)" 뿐 등) 5단계까지의 압축본, 그것도 비면 원문 소문자로 — 빈 키는 만들지 않는다.
 *
 * 결과: 국립생태원 / 국립생태원(NIE) / 국립 생태원 → "국립생태원"
 *       수원특례시청 / 수원특례시 / 수원시청 / 수원시 → "수원"
 * "서울시"·"서울특별시" → "서울" 처럼 접미어를 뗀 지명끼리 겹칠 수 있는데, 같은 지자체이므로 의도한 충돌이다.
 * 키는 판정 보조일 뿐 — 경고를 띄우고 최종 판단은 사람이 한다. */

const ORG_PREFIXES = ["사단법인", "재단법인", "주식회사", "유한회사"] as const;

const ORG_LATIN_WORDS = /\b(?:corporation|corp|inc|co|ltd|llc)\b/g;

/** 긴 접미어 먼저 — 짧은 것이 먼저 맞으면 긴 것의 일부만 떨어진다 */
const ORG_SUFFIXES = [
  "특별자치시청",
  "특별자치도청",
  "특별시청",
  "광역시청",
  "특례시청",
  "특별자치시",
  "특별자치도",
  "특별시",
  "광역시",
  "특례시",
  "주식회사",
  "유한회사",
  "시청",
  "군청",
  "구청",
  "도청",
  "재단",
  "공단",
  "공사",
  "시",
  "군",
  "구",
] as const;

/** 접미어를 뗀 뒤 남아야 하는 최소 글자 수 */
const MIN_KEY_LENGTH = 2;

export function normalizeOrgKey(org: string): string {
  const base = (org ?? "").normalize("NFKC").toLowerCase().trim();
  if (!base) return "";

  /* 5단계까지의 압축본 — 접미어 제거가 모두 지워 버릴 때의 폴백 */
  const compact = base.replace(/[\s\p{P}\p{S}]/gu, "");

  let s = base.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  for (const p of ORG_PREFIXES) s = s.split(p).join(" ");
  s = s.replace(/[\p{P}\p{S}]/gu, " ").replace(ORG_LATIN_WORDS, " ");
  s = s.replace(/[\s\p{P}\p{S}]/gu, "");

  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of ORG_SUFFIXES) {
      if (s.endsWith(suf) && s.length - suf.length >= MIN_KEY_LENGTH) {
        s = s.slice(0, -suf.length);
        changed = true;
        break;
      }
    }
  }

  return s || compact || base;
}

/* ── 180일 중복 제안 경고 ────────────────────────────────────
 * 같은 기관(org_key)에 최근 제안한 이력이 있으면 등록 시점에 경고한다.
 * 기준 시각은 실제 발송 시각(proposalSentAt), 발송 기록이 없으면 등록일(createdAt).
 * 날짜 차이는 로컬 자정끼리 센다 — daysUntil 과 같은 이유(시:분:초 때문에 경계가 하루 밀림).
 * 정확히 days 일 전은 **포함**한다 ("180일 이내"). */

interface ProposalRecord {
  orgKey: string;
  createdAt: string;
  proposalSentAt: string | null;
}

/** ISO 시각/날짜 → 로컬 자정 기준 경과 일수. 해석 불가면 null */
function daysSince(iso: string, today: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const a = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const b = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function isRecentlyProposed<T extends ProposalRecord>(
  existing: T[],
  orgKey: string,
  days = 180,
  today = new Date()
): { hit: boolean; match?: T; daysAgo?: number } {
  // 빈 키끼리 맞으면 기관명 없는 리드가 전부 서로 중복으로 잡힌다
  if (!orgKey) return { hit: false };

  let best: { rec: T; ago: number } | null = null;
  for (const rec of existing) {
    if (rec.orgKey !== orgKey) continue;
    const ago = daysSince(rec.proposalSentAt ?? rec.createdAt, today);
    if (ago == null || ago > days) continue;
    if (!best || ago < best.ago) best = { rec, ago };
  }
  return best ? { hit: true, match: best.rec, daysAgo: best.ago } : { hit: false };
}
