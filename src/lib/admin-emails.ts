/**
 * 관리자 계정 목록 — ADMIN_EMAIL 을 쉼표로 나눠 여러 계정을 받는다.
 *
 *     ADMIN_EMAIL="brekarta@gmail.com,ask@papercraft.kr"
 *
 * 한 개만 적힌 옛 값도 그대로 동작한다. auth.ts(로그인 판정)와 proxy.ts(옛 토큰 폴백)가
 * 같은 규칙을 써야 해서 여기 모았다 — 한쪽만 목록을 알면 로그인은 되는데 화면이 튕긴다.
 * 의존성 없는 순수 함수라 프록시에서도 불러올 수 있다.
 */

export function parseAdminEmails(raw: string | null | undefined): string[] {
  return [
    ...new Set(
      (raw ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

export function isAdminEmail(email: string | null | undefined, admins: readonly string[]): boolean {
  const normalized = (email ?? "").trim().toLowerCase();
  return !!normalized && admins.includes(normalized);
}
