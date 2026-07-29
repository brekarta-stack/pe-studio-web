/**
 * 아티스트 포털 데이터 접근 (server-only) — /artist/** 의 단일 출처.
 *
 * 핵심 규칙: **여기서만 아티스트 시점의 데이터를 만든다.**
 * 모든 조회가 artistId 로 먼저 좁히고, ArtistWork 로 변환하면서 고객 개인정보와
 * 원청 매출을 떨어뜨린다. 페이지 컴포넌트는 이 결과만 받으므로 실수로 더
 * 넓은 데이터를 넘길 수 없다.
 */

import { supabaseAdmin } from "./supabase-admin";
import { getAssignment, listAssignmentsByArtist } from "./assignments";
import { artistPayout } from "./assignment-types";
import type { Assignment, Deliverable } from "./assignment-types";
import type { ArtistWork, WorkBrief } from "./artist-portal-types";
import type { QuoteFile } from "./quote-types";

/** PostgREST 가 "테이블/컬럼 없음"을 알리는 신호인지 — 이 경우만 조용히 폴백한다 */
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

/**
 * 아티스트에게 보낼 브리프로 좁힌다.
 *
 * quotes 로우에는 고객 이름·이메일·전화가 들어 있지만 여기서 아무것도
 * 옮기지 않는다 — 아래 select 목록에서도 애초에 안 가져온다(이중 방어).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toBrief(q: any): WorkBrief {
  /* 참고 자료: 다중 첨부(files)가 기본이고, 그 이전 데이터는 단일 file_url 에 있다.
     아티스트 입장에선 구분이 무의미하므로 하나의 목록으로 합쳐 준다. */
  const files: QuoteFile[] = Array.isArray(q?.files)
    ? q.files.filter((f: unknown): f is QuoteFile => !!f && typeof (f as QuoteFile).url === "string")
    : [];
  if (files.length === 0 && q?.file_url) {
    files.push({ name: q.file_name || "참고 자료", url: q.file_url });
  }

  return {
    product: q?.product ?? "",
    quantity: q?.quantity ?? "",
    deliveryDate: q?.delivery_date ?? "",
    purpose: q?.purpose ?? "",
    customDesign: q?.custom_design ?? "",
    styleType: q?.style_type ?? "",
    productText: q?.product_text ?? "",
    colorRequest: q?.color_request ?? "",
    notes: q?.notes ?? "",
    packaging: q?.packaging ?? "",
    sampling: !!q?.sampling,
    rushed: !!q?.rushed,
    files,
    logoFileName: q?.logo_file_name ?? "",
    logoFileUrl: q?.logo_file_url ?? "",
    createdAt: q?.created_at ?? "",
  };
}

const EMPTY_BRIEF: WorkBrief = toBrief(null);

function toWork(a: Assignment, quoteRow: unknown): ArtistWork {
  return {
    id: a.id,
    offerStatus: a.offerStatus,
    offeredAt: a.offeredAt,
    respondedAt: a.respondedAt,
    declineReason: a.declineReason,
    status: a.status,
    progress: a.progress,
    dueDate: a.dueDate,
    startedAt: a.startedAt,
    memo: a.memo,
    deliverables: a.deliverables,
    payout: artistPayout(a),
    brief: quoteRow ? toBrief(quoteRow) : EMPTY_BRIEF,
  };
}

/**
 * 고객 개인정보를 뺀 quotes 컬럼 목록.
 * name·email·phone·acquisition 은 의도적으로 없다 — 쿼리 자체에서 제외한다.
 *
 * 한 줄 리터럴로 두는 이유: supabase-js 는 select 문자열을 타입 수준에서 파싱해
 * 결과 타입을 만든다. 여러 조각을 이어 붙이면 파싱에 실패해 결과가
 * GenericStringError 로 떨어진다.
 */
const QUOTE_BRIEF_COLUMNS =
  "id, product, quantity, delivery_date, purpose, custom_design, style_type, product_text, color_request, notes, packaging, sampling, rushed, files, file_name, file_url, logo_file_name, logo_file_url, created_at";

/**
 * 이 아티스트의 업무 목록.
 * draft(아직 제안하지 않은 배정)는 제외한다 — 관리자가 조건을 다듬는 중이라
 * 아티스트가 보면 안 된다.
 */
export async function listArtistWorks(artistId: string): Promise<ArtistWork[]> {
  if (!artistId) return [];

  const assignments = await listAssignmentsByArtist(artistId);
  const mine = assignments.filter((a) => a.offerStatus !== "draft");
  if (mine.length === 0) return [];

  const quoteIds = [...new Set(mine.map((a) => a.quoteId))];
  const { data: quoteRows, error: qError } = await supabaseAdmin
    .from("quotes")
    .select(QUOTE_BRIEF_COLUMNS)
    .in("id", quoteIds);
  if (qError && !isMissingTable(qError)) throw qError;

  const quotes = new Map((quoteRows ?? []).map((q) => [q.id as string, q]));
  return mine.map((a) => toWork(a, quotes.get(a.quoteId)));
}

/**
 * 업무 한 건 — **반드시 artistId 와 함께 조회한다.**
 * id 만으로 열 수 있으면 다른 아티스트의 업무를 URL 로 훔쳐볼 수 있다.
 * 남의 것이거나 아직 제안 전이면 null.
 */
export async function getArtistWork(
  artistId: string,
  assignmentId: string
): Promise<ArtistWork | null> {
  if (!artistId || !assignmentId) return null;

  const assignment = await getAssignment(assignmentId);
  if (!assignment) return null;
  if (assignment.artistId !== artistId) return null;
  if (assignment.offerStatus === "draft") return null;

  const { data: quoteRow, error } = await supabaseAdmin
    .from("quotes")
    .select(QUOTE_BRIEF_COLUMNS)
    .eq("id", assignment.quoteId)
    .maybeSingle();
  if (error && !isMissingTable(error)) throw error;

  return toWork(assignment, quoteRow);
}

/**
 * 소유권 확인 전용 — 액션에서 쓰기 전에 "내 업무가 맞는지" 확인한다.
 * 브리프까지 읽지 않으므로 getArtistWork 보다 가볍다.
 */
export async function assertOwnedAssignment(
  artistId: string,
  assignmentId: string
): Promise<Assignment> {
  const assignment = await getAssignment(assignmentId);
  if (!assignment || assignment.artistId !== artistId) {
    throw new Error("업무를 찾을 수 없습니다.");
  }
  return assignment;
}

/** 결과물 목록에 한 건 추가 (기존 목록 보존) */
export function appendDeliverable(
  current: Deliverable[],
  file: { name: string; url: string }
): Deliverable[] {
  return [...current, { name: file.name, url: file.url, uploadedAt: new Date().toISOString() }];
}
