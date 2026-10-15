/**
 * 리드 활동 기록 데이터 접근 (server-only) — 제안 영업 보드·제작 문의의 타임라인.
 *
 * 저장소: Supabase `lead_activities` 테이블
 * (마이그레이션: supabase/migrations/20261013_sales_pipeline.sql)
 *
 * **append-only — 일부러 update/delete 함수를 두지 않는다.** 활동 기록은 감사 기록이자
 * CRM 타임라인이라 사후에 고칠 수 있으면 기록의 의미가 사라진다. 잘못 적었으면
 * 정정 메모를 한 줄 더 남긴다. (리드가 영구 삭제되면 FK ON DELETE CASCADE 로만 지워진다)
 *
 * 테이블이 아직 없으면 읽기는 빈 결과로 폴백해 어드민이 죽지 않게 한다 — assignments.ts 와 같은 방침.
 * 쓰기는 폴백하지 않는다 — 기록이 조용히 사라지는 편이 더 나쁘다.
 */

import { supabaseAdmin } from "./supabase-admin";
import { isActivityKind } from "./lead-activity-types";
import type { LeadActivity, LeadActivityInput } from "./lead-activity-types";

export type { LeadActivity, LeadActivityInput } from "./lead-activity-types";

/** PostgREST 가 "테이블 없음"을 알리는 신호인지 — 이 경우만 조용히 폴백한다 (assignments.ts 와 같은 판정) */
export function isMissingTable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "PGRST204" ||
    (error.message ?? "").includes("does not exist") ||
    (error.message ?? "").includes("schema cache")
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toActivity(row: any): LeadActivity {
  return {
    id: row.id,
    quoteId: row.quote_id,
    /* DB 에 CHECK 제약이 없으므로 모르는 값은 system 으로 읽는다 — 화면이 라벨을 못 찾아 죽지 않게 */
    kind: isActivityKind(row.kind) ? row.kind : "system",
    body: row.body ?? "",
    actor: row.actor ?? "",
    occurredAt: row.occurred_at ?? row.created_at,
    createdAt: row.created_at,
  };
}

/** 리드 하나의 활동 기록 — 최신순. 테이블이 없으면 빈 배열 */
export async function listActivities(quoteId: string): Promise<LeadActivity[]> {
  if (!quoteId) return [];
  const { data, error } = await supabaseAdmin
    .from("lead_activities")
    .select("*")
    .eq("quote_id", quoteId)
    .order("occurred_at", { ascending: false });
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return (data ?? []).map(toActivity);
}

/**
 * 여러 리드의 활동 기록을 한 번에 — 보드 목록에서 리드마다 쿼리를 날리지 않기 위해.
 * 요청한 id 는 기록이 없어도 빈 배열 키로 넣어 준다(화면에서 undefined 검사 불필요).
 */
export async function listActivitiesForQuotes(
  ids: string[]
): Promise<Record<string, LeadActivity[]>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out: Record<string, LeadActivity[]> = {};
  for (const id of unique) out[id] = [];
  if (unique.length === 0) return out;

  const { data, error } = await supabaseAdmin
    .from("lead_activities")
    .select("*")
    .in("quote_id", unique)
    .order("occurred_at", { ascending: false });
  if (error) {
    if (isMissingTable(error)) return out;
    throw error;
  }
  for (const row of data ?? []) {
    const a = toActivity(row);
    (out[a.quoteId] ??= []).push(a);
  }
  return out;
}

/** 활동 한 줄 추가. 실패하면 던진다 (append-only — 수정·삭제 함수는 없다) */
export async function addActivity(input: LeadActivityInput): Promise<LeadActivity> {
  if (!isActivityKind(input.kind)) throw new Error(`알 수 없는 활동 종류: ${String(input.kind)}`);
  const { data, error } = await supabaseAdmin
    .from("lead_activities")
    .insert({
      quote_id: input.quoteId,
      kind: input.kind,
      body: input.body ?? "",
      actor: input.actor ?? "",
      // 생략하면 DB DEFAULT now() 가 채운다
      ...(input.occurredAt ? { occurred_at: input.occurredAt } : {}),
    })
    .select("*")
    .single();
  if (error) throw error;
  return toActivity(data);
}
