/**
 * 아티스트 포털 계정 데이터 접근 (server-only).
 *
 * 저장소: Supabase `artist_accounts`
 * (마이그레이션: supabase/migrations/20260802_artist_portal.sql)
 *
 * 테이블이 아직 없으면 "계정 없음"으로 폴백한다 — artists.ts / assignments.ts 와 같은 방침.
 * 그래야 마이그레이션 전에도 관리자 로그인과 기존 어드민 화면이 죽지 않는다.
 * (계정이 없으면 아무도 통과하지 못하므로 폴백이 보안 구멍이 되지는 않는다)
 */

import { randomBytes } from "crypto";
import { supabaseAdmin } from "./supabase-admin";
import { getAllArtists } from "./artists";
import type { ArtistAccount, ArtistAccountView } from "./artist-account-types";
import {
  INVITE_TTL_DAYS,
  isAccountStatus,
  normalizeEmail,
} from "./artist-account-types";

export type { ArtistAccount, ArtistAccountView } from "./artist-account-types";

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
function toAccount(row: any): ArtistAccount {
  return {
    id: row.id,
    email: row.email ?? null,
    artistId: row.artist_id ?? null,
    status: isAccountStatus(row.status) ? row.status : "pending",
    displayName: row.display_name ?? "",
    phone: row.phone ?? "",
    note: row.note ?? "",
    inviteToken: row.invite_token ?? null,
    inviteExpiresAt: row.invite_expires_at ?? null,
    approvedAt: row.approved_at ?? null,
    lastLoginAt: row.last_login_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 이메일로 계정 조회. 없거나 테이블이 없으면 null */
export async function getAccountByEmail(email: string): Promise<ArtistAccount | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const { data, error } = await supabaseAdmin
    .from("artist_accounts")
    .select("*")
    .eq("email", normalized)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return data ? toAccount(data) : null;
}

/** 초대 토큰으로 계정 조회 */
export async function getAccountByInviteToken(token: string): Promise<ArtistAccount | null> {
  if (!token) return null;
  const { data, error } = await supabaseAdmin
    .from("artist_accounts")
    .select("*")
    .eq("invite_token", token)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return data ? toAccount(data) : null;
}

export async function getAccount(id: string): Promise<ArtistAccount | null> {
  const { data, error } = await supabaseAdmin
    .from("artist_accounts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return data ? toAccount(data) : null;
}

/**
 * 전체 계정 목록 + 매칭된 아티스트 이름.
 *
 * 아티스트 이름은 PostgREST 임베딩 대신 따로 붙인다 — artists 는 테이블이
 * 없을 때 SEED_ARTISTS 로 폴백하므로(getAllArtists) DB 조인으로는 그 폴백을 못 탄다.
 */
export async function listAccountViews(): Promise<ArtistAccountView[]> {
  const { data, error } = await supabaseAdmin
    .from("artist_accounts")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }

  const accounts = (data ?? []).map(toAccount);
  if (accounts.length === 0) return [];

  const { artists } = await getAllArtists();
  const nameOf = new Map(artists.map((a) => [a.id, a.name]));

  return accounts.map((a) => ({
    ...a,
    artistName: a.artistId ? nameOf.get(a.artistId) ?? a.artistId : null,
  }));
}

/**
 * 가입 신청 — 공개 폼(/artist/apply)이 호출한다.
 *
 * 같은 이메일로 다시 신청하면 새 행을 만들지 않고 신청 내용만 갱신한다.
 * 이미 승인된 계정이면 아무것도 바꾸지 않는다 — 재신청으로 권한이
 * 흔들리면 안 되기 때문.
 */
export async function applyForAccount(input: {
  email: string;
  displayName: string;
  phone: string;
  note: string;
}): Promise<{ status: "created" | "updated" | "already_approved" }> {
  const email = normalizeEmail(input.email);
  const existing = await getAccountByEmail(email);

  if (existing) {
    if (existing.status === "approved") return { status: "already_approved" };
    const { error } = await supabaseAdmin
      .from("artist_accounts")
      .update({
        display_name: input.displayName,
        phone: input.phone,
        note: input.note,
        // 거절됐던 계정이 다시 신청하면 승인 대기로 되돌린다
        status: "pending",
      })
      .eq("id", existing.id);
    if (error) throw error;
    return { status: "updated" };
  }

  const { error } = await supabaseAdmin.from("artist_accounts").insert({
    email,
    status: "pending",
    display_name: input.displayName,
    phone: input.phone,
    note: input.note,
  });
  if (error) throw error;
  return { status: "created" };
}

/** 초대 토큰 생성 — URL-safe, 추측 불가 */
function newInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * 아티스트를 지정해 초대 링크를 발급한다 (관리자).
 * 이미 그 아티스트의 계정이 있으면 토큰만 새로 발급해 재사용한다 —
 * artist_id 는 부분 유니크라 중복 행을 만들 수 없다.
 */
export async function createInvite(
  artistId: string,
  displayName: string
): Promise<ArtistAccount> {
  const token = newInviteToken();
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString();

  const { data: existingRow, error: findError } = await supabaseAdmin
    .from("artist_accounts")
    .select("*")
    .eq("artist_id", artistId)
    .maybeSingle();
  if (findError && !isMissingTable(findError)) throw findError;

  if (existingRow) {
    const existing = toAccount(existingRow);
    if (existing.status === "approved") {
      throw new Error("이미 승인된 계정이 있는 아티스트입니다.");
    }
    const { data, error } = await supabaseAdmin
      .from("artist_accounts")
      .update({ status: "invited", invite_token: token, invite_expires_at: expires })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return toAccount(data);
  }

  const { data, error } = await supabaseAdmin
    .from("artist_accounts")
    .insert({
      artist_id: artistId,
      status: "invited",
      display_name: displayName,
      invite_token: token,
      invite_expires_at: expires,
    })
    .select("*")
    .single();
  if (error) throw error;
  return toAccount(data);
}

/**
 * 초대 수락 — 토큰이 가리키는 계정에 이메일을 붙이고 바로 승인한다.
 * 관리자가 아티스트를 지목해 발급한 링크이므로 추가 승인 단계는 두지 않는다.
 *
 * 토큰은 여기서 소진한다(null) — 링크가 유출돼도 두 번 쓰이지 않게.
 */
export async function acceptInvite(token: string, email: string): Promise<ArtistAccount> {
  const account = await getAccountByInviteToken(token);
  if (!account) throw new Error("초대 링크를 찾을 수 없습니다.");

  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error("이메일이 필요합니다.");

  // 다른 계정이 이미 그 이메일을 쓰고 있으면 유니크 제약에 걸리므로 먼저 걸러 안내한다
  const owner = await getAccountByEmail(normalized);
  if (owner && owner.id !== account.id) {
    throw new Error("이미 등록된 이메일입니다. 해당 계정으로 로그인해 주세요.");
  }

  const { data, error } = await supabaseAdmin
    .from("artist_accounts")
    .update({
      email: normalized,
      status: "approved",
      approved_at: new Date().toISOString(),
      invite_token: null,
      invite_expires_at: null,
    })
    .eq("id", account.id)
    .select("*")
    .single();
  if (error) throw error;
  return toAccount(data);
}

/** 계정 상태/매칭 변경 (관리자) */
export async function updateAccount(
  id: string,
  patch: Partial<Pick<ArtistAccount, "status" | "artistId" | "displayName" | "phone" | "note">>
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    row.status = patch.status;
    if (patch.status === "approved") row.approved_at = new Date().toISOString();
  }
  if (patch.artistId !== undefined) row.artist_id = patch.artistId;
  if (patch.displayName !== undefined) row.display_name = patch.displayName;
  if (patch.phone !== undefined) row.phone = patch.phone;
  if (patch.note !== undefined) row.note = patch.note;
  if (Object.keys(row).length === 0) return;

  const { error } = await supabaseAdmin.from("artist_accounts").update(row).eq("id", id);
  if (error) throw error;
}

export async function deleteAccount(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from("artist_accounts").delete().eq("id", id);
  if (error) throw error;
}

/**
 * 로그인 시각 기록. 실패해도 로그인을 막지 않는다 —
 * 이건 편의 정보일 뿐이라 여기서 예외를 던지면 로그인만 깨진다.
 */
export async function touchLastLogin(id: string): Promise<void> {
  try {
    await supabaseAdmin
      .from("artist_accounts")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", id);
  } catch (e) {
    console.error("[artist-accounts] last_login_at 기록 실패:", e);
  }
}
