/**
 * 업무 배정 데이터 접근 (server-only) — /admin/quotes 의 담당 아티스트 컬럼과
 * /admin/works(작업 관리) 페이지의 단일 출처.
 *
 * 저장소: Supabase `assignments` 테이블
 * (마이그레이션: supabase/migrations/20260728_quote_pipeline.sql)
 *
 * 테이블이 아직 없으면 빈 배열로 폴백해 어드민이 죽지 않게 한다 — artists.ts 와 같은 방침.
 * (테이블 누락은 /admin/setup 에서 안내한다)
 */

import { supabaseAdmin } from "./supabase-admin";
import { getAllArtists } from "./artists";
import type { Assignment, AssignmentInput, AssignmentView } from "./assignment-types";
import {
  isAssignmentStatus,
  isPayoutStatus,
  isQuoteStage,
} from "./assignment-types";

export type { Assignment, AssignmentInput, AssignmentView } from "./assignment-types";

/** PostgREST 가 "테이블 없음"을 알리는 신호인지 — 이 경우만 조용히 폴백한다 */
function isMissingTable(error: { message?: string; code?: string } | null): boolean {
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
function toAssignment(row: any): Assignment {
  return {
    id: row.id,
    quoteId: row.quote_id,
    artistId: row.artist_id,
    status: isAssignmentStatus(row.status) ? row.status : "assigned",
    progress: typeof row.progress === "number" ? row.progress : 0,
    artistFee: row.artist_fee == null ? null : Number(row.artist_fee),
    clientAmount: row.client_amount == null ? null : Number(row.client_amount),
    payoutStatus: isPayoutStatus(row.payout_status) ? row.payout_status : "unpaid",
    paidAt: row.paid_at ?? null,
    dueDate: row.due_date ?? null,
    startedAt: row.started_at ?? null,
    memo: row.memo ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(input: AssignmentInput) {
  return {
    quote_id: input.quoteId,
    artist_id: input.artistId,
    status: input.status,
    progress: input.progress,
    artist_fee: input.artistFee,
    client_amount: input.clientAmount,
    payout_status: input.payoutStatus,
    paid_at: input.paidAt,
    due_date: input.dueDate,
    started_at: input.startedAt,
    memo: input.memo,
  };
}

/** 전체 배정 조회. 테이블이 없으면 빈 배열 */
export async function listAssignments(): Promise<Assignment[]> {
  const { data, error } = await supabaseAdmin
    .from("assignments")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return (data ?? []).map(toAssignment);
}

/**
 * 배정 + 리드 + 아티스트를 합친 화면용 목록.
 *
 * 조인을 PostgREST 임베딩으로 하지 않고 따로 조회해 합치는 이유:
 * artists 는 테이블이 없을 때 SEED_ARTISTS 로 폴백하므로(getAllArtists),
 * DB 조인으로는 그 폴백을 탈 수 없다.
 */
export async function listAssignmentViews(): Promise<AssignmentView[]> {
  const assignments = await listAssignments();
  if (assignments.length === 0) return [];

  const { artists } = await getAllArtists();
  const artistName = new Map(artists.map((a) => [a.id, a.name]));

  const quoteIds = [...new Set(assignments.map((a) => a.quoteId))];
  const { data: quoteRows, error } = await supabaseAdmin
    .from("quotes")
    .select("id, name, product, stage, created_at")
    .in("id", quoteIds);
  if (error && !isMissingTable(error)) throw error;

  const quotes = new Map(
    (quoteRows ?? []).map((q) => [
      q.id as string,
      q as { id: string; name: string; product: string; stage: string; created_at: string },
    ])
  );

  return assignments.map((a) => {
    const q = quotes.get(a.quoteId);
    return {
      ...a,
      artistName: artistName.get(a.artistId) ?? a.artistId,
      quoteName: q?.name ?? "(삭제된 리드)",
      quoteProduct: q?.product ?? "",
      quoteCreatedAt: q?.created_at ?? a.createdAt,
      quoteStage: isQuoteStage(q?.stage) ? q.stage : "new",
    };
  });
}

/** 특정 리드의 배정 목록 */
export async function listAssignmentsByQuote(quoteId: string): Promise<Assignment[]> {
  const all = await listAssignments();
  return all.filter((a) => a.quoteId === quoteId);
}

export async function createAssignment(input: AssignmentInput): Promise<Assignment> {
  const { data, error } = await supabaseAdmin
    .from("assignments")
    .insert(toRow(input))
    .select("*")
    .single();
  if (error) throw error;
  return toAssignment(data);
}

export async function updateAssignment(
  id: string,
  patch: Partial<AssignmentInput>
): Promise<void> {
  // 부분 수정 — 전달된 키만 스네이크 케이스로 옮긴다
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.progress !== undefined) row.progress = patch.progress;
  if (patch.artistFee !== undefined) row.artist_fee = patch.artistFee;
  if (patch.clientAmount !== undefined) row.client_amount = patch.clientAmount;
  if (patch.payoutStatus !== undefined) row.payout_status = patch.payoutStatus;
  if (patch.paidAt !== undefined) row.paid_at = patch.paidAt;
  if (patch.dueDate !== undefined) row.due_date = patch.dueDate;
  if (patch.startedAt !== undefined) row.started_at = patch.startedAt;
  if (patch.memo !== undefined) row.memo = patch.memo;
  if (patch.artistId !== undefined) row.artist_id = patch.artistId;
  if (Object.keys(row).length === 0) return;

  const { error } = await supabaseAdmin.from("assignments").update(row).eq("id", id);
  if (error) throw error;
}

export async function deleteAssignment(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from("assignments").delete().eq("id", id);
  if (error) throw error;
}

/**
 * 리드의 담당 아티스트를 지정한다 — /admin/quotes 시트의 드롭다운용.
 *
 * 시트에서는 "이 리드의 담당자" 하나만 다루므로, 기존 배정이 있으면 그 아티스트를
 * 교체하고(작업비·납기 등 기존 값 유지), 없으면 새로 만든다.
 * artistId 가 null 이면 배정을 모두 해제한다.
 * (여러 명 배정은 /admin/works 에서 관리)
 */
export async function setQuoteArtist(quoteId: string, artistId: string | null): Promise<void> {
  const existing = await listAssignmentsByQuote(quoteId);

  if (artistId === null) {
    for (const a of existing) await deleteAssignment(a.id);
    return;
  }

  if (existing.some((a) => a.artistId === artistId)) return; // 이미 배정됨

  if (existing.length > 0) {
    // 가장 먼저 만들어진 배정을 주담당으로 보고 그 아티스트만 교체한다
    const primary = existing.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
    await updateAssignment(primary.id, { artistId });
    return;
  }

  await createAssignment({
    quoteId,
    artistId,
    status: "assigned",
    progress: 0,
    artistFee: null,
    clientAmount: null,
    payoutStatus: "unpaid",
    paidAt: null,
    dueDate: null,
    startedAt: null,
    memo: "",
  });
}
