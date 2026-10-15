/**
 * 제안서 AI 작성 작업(맥 스튜디오 작업자)의 순수 규칙 — DB·네트워크를 모른다 (docs/proposal-editor-plan.md §8).
 * proposal-docs.ts(서버)와 편집기(클라이언트)가 함께 쓰고, tests/proposal-jobs.test.mjs 가 그대로 비교한다.
 */

export const GEN_STATUSES = ["idle", "requested", "running", "done", "failed"] as const;
export type GenStatus = (typeof GEN_STATUSES)[number];

export const GEN_MODES = ["create", "regenerate"] as const;
export type GenMode = (typeof GEN_MODES)[number];

/** running 이 이만큼 지나도 결과가 없으면 작업자가 죽은 것으로 본다 */
export const GEN_STALE_MS = 20 * 60 * 1000;
/** 한 요청을 작업자가 잡아 가는 횟수 한도 — 넘으면 failed("시간 초과") */
export const GEN_MAX_ATTEMPTS = 2;
export const GEN_ERROR_MAX = 300;
export const GEN_TIMEOUT_ERROR = "시간 초과";

/** 마이그레이션 전(컬럼 없음)이나 모르는 값은 idle */
export function normalizeGenStatus(v: unknown): GenStatus {
  return typeof v === "string" && (GEN_STATUSES as readonly string[]).includes(v) ? (v as GenStatus) : "idle";
}

export function isGenMode(v: unknown): v is GenMode {
  return typeof v === "string" && (GEN_MODES as readonly string[]).includes(v);
}

/** 요청이 살아 있다(작업자가 잡아 가기 전이거나 쓰는 중) — 새 요청은 아무것도 하지 않는다 */
export function isGenActive(s: GenStatus): boolean {
  return s === "requested" || s === "running";
}

/**
 * 오래된 running 하나를 어떻게 할지. null = 아직 기다린다.
 * attempts 는 이미 잡아 간 횟수(running 이 될 때 +1) — 한도보다 적으면 다시 줄을 세우고, 아니면 실패로 닫는다.
 */
export function staleDecision(
  job: { startedAt: string | null; attempts: number },
  now: number = Date.now()
): "requeue" | "fail" | null {
  const started = job.startedAt ? Date.parse(job.startedAt) : NaN;
  // 시작 시각이 없거나 깨졌으면 오래된 것으로 친다 — 영원히 running 으로 남지 않게
  if (Number.isFinite(started) && now - started < GEN_STALE_MS) return null;
  return job.attempts < GEN_MAX_ATTEMPTS ? "requeue" : "fail";
}

/**
 * 작업자 결과를 바로 적용해도 되는가 — 처음 여는 문서(create)이고, 요청한 뒤로 아무도 저장하지 않았을 때만.
 * 다시 쓰기(regenerate)는 언제나 편집기에서 사람이 "적용하기"를 누른다.
 */
export function shouldAutoApply(job: { mode: GenMode | null; rev: number; requestedRev: number | null }): boolean {
  return job.mode === "create" && job.requestedRev != null && job.rev === job.requestedRev;
}

/** 오류 문구 정리 — 줄바꿈을 걷고 300자로 자른다. 비면 기본 문구 */
export function clipGenError(e: unknown, max = GEN_ERROR_MAX): string {
  const s = (typeof e === "string" ? e : e instanceof Error ? e.message : e == null ? "" : String(e))
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "알 수 없는 오류";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
