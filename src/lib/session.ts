/**
 * 세션 권한 확인 (server-only) — 페이지와 서버 액션의 공통 관문.
 *
 * 프록시(src/proxy.ts)가 이미 경로별로 한 번 거르지만, 프록시는 네비게이션만
 * 본다. 서버 액션은 프록시를 거치지 않고 직접 호출될 수 있으므로 액션마다
 * 여기서 다시 확인한다 — 게이트는 두 겹이어야 한다.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "./auth";

export interface ArtistSession {
  /** artists.id — 이 값으로만 데이터를 좁힌다 */
  artistId: string;
  email: string;
  name: string;
}

/** 로그인한 아티스트. 관리자이거나 비로그인이면 null */
export async function getArtistSession(): Promise<ArtistSession | null> {
  const session = await getServerSession(authOptions);
  const user = session?.user;
  if (!user || user.role !== "artist" || !user.artistId) return null;
  return {
    artistId: user.artistId,
    email: user.email ?? "",
    name: user.name ?? "",
  };
}

/** 아티스트 권한 강제 — 아니면 예외. 서버 액션에서 쓴다 */
export async function requireArtist(): Promise<ArtistSession> {
  const artist = await getArtistSession();
  if (!artist) throw new Error("권한이 없습니다. 다시 로그인해 주세요.");
  return artist;
}

/** 관리자 여부 */
export async function isAdminSession(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  return session?.user?.role === "admin";
}

/** 관리자 권한 강제 — 아니면 예외 */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdminSession())) throw new Error("권한이 없습니다.");
}
