/**
 * 구글 refresh token 암호화 (AES-256-GCM).
 *
 * refresh token 은 관리자 드라이브에 대한 장기 권한이다. DB 는 service role 로만
 * 읽히지만(RLS 정책 없음), 백업·덤프·SQL 에디터 화면에 평문으로 남지 않게 한 겹 더 싼다.
 * 키는 배포 비밀(NEXTAUTH_SECRET)에서 파생한다 — 비밀이 바뀌면 복호화가 실패하고,
 * 화면은 "다시 연결하세요"로 안내한다.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(`gdrive-token:${secret}`).digest();
}

export function encryptToken(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(".");
}

/** 형식이 틀리거나 키가 다르면 null — 호출 쪽이 "다시 연결" 안내로 처리한다 */
export function decryptToken(sealed: string, secret: string): string | null {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const [, iv, tag, enc] = parts.map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
