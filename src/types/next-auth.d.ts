/**
 * next-auth 타입 확장 — 세션과 JWT 에 역할(role)·아티스트 id 를 얹는다.
 *
 * 이게 없으면 session.user.role 접근이 타입 오류가 난다.
 * 실제로 값을 채우는 곳은 src/lib/auth.ts 의 jwt/session 콜백.
 */
import type { UserRole } from "@/lib/auth";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      /** admin | artist. 권한이 사라진 계정은 null */
      role: UserRole | null;
      /** artist 일 때만 채워진다 (artists.id) */
      artistId: string | null;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: UserRole | null;
    artistId?: string | null;
    /** 역할을 마지막으로 DB 에서 확인한 시각 (epoch ms) */
    roleCheckedAt?: number;
  }
}
