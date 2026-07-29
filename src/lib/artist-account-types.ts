/**
 * 아티스트 포털 계정 타입 — 클라이언트/서버 공용.
 * (DB 접근 함수는 server-only 인 src/lib/artist-accounts.ts 에 있음)
 *
 * 계정 = "이 구글 이메일은 이 아티스트다" 는 한 줄.
 * 인증(비밀번호·세션)은 next-auth Google 이 하고, 이 표는 **누구를 통과시킬지**만 정한다.
 * 그래서 승인되지 않은 계정은 로그인 자체가 막힌다.
 *
 * 가입 경로는 둘:
 *   1) 초대 링크 — 관리자가 아티스트를 지정해 토큰을 발급(status=invited).
 *      아티스트가 /artist/join?token=... 에서 구글 로그인하면 이메일이 붙고 바로 approved.
 *   2) 가입 신청 — 아무나 /artist/apply 로 신청(status=pending).
 *      관리자가 아티스트와 매칭하고 승인해야 approved 가 된다.
 */

export const ACCOUNT_STATUSES = [
  "invited",
  "pending",
  "approved",
  "rejected",
  "disabled",
] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  invited:  "초대 발송",
  pending:  "승인 대기",
  approved: "승인됨",
  rejected: "거절됨",
  disabled: "사용 중지",
};

export const ACCOUNT_STATUS_COLORS: Record<AccountStatus, string> = {
  invited:  "bg-sky-50 text-sky-700 border-sky-200",
  pending:  "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-600 border-red-200",
  disabled: "bg-slate-100 text-slate-500 border-slate-200",
};

export function isAccountStatus(v: unknown): v is AccountStatus {
  return typeof v === "string" && (ACCOUNT_STATUSES as readonly string[]).includes(v);
}

export interface ArtistAccount {
  id: string;
  /** 구글 로그인 이메일 (항상 소문자). 초대만 발급하고 아직 안 받았으면 null */
  email: string | null;
  /** 매칭된 아티스트 (artists.id). 미매칭 신청이면 null */
  artistId: string | null;
  status: AccountStatus;
  /** 신청자가 적은 이름 / 구글 프로필 이름 */
  displayName: string;
  phone: string;
  /** 신청자 소개 + 관리자 메모 */
  note: string;
  /** 초대 링크 토큰. 수락하면 소진되어 null */
  inviteToken: string | null;
  inviteExpiresAt: string | null;
  approvedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 목록 화면용 — 매칭된 아티스트 이름을 붙인 뷰 모델 */
export interface ArtistAccountView extends ArtistAccount {
  /** 매칭된 아티스트 이름. 미매칭이면 null */
  artistName: string | null;
}

/**
 * 로그인을 허용할 계정인가.
 *
 * approved 이고 아티스트에 매칭돼 있어야 한다 — artistId 가 없으면
 * "누구의 업무를 보여줄지"를 정할 수 없으므로 통과시켜도 빈 화면일 뿐이다.
 */
export function canSignIn(
  account: Pick<ArtistAccount, "status" | "artistId"> | null | undefined
): boolean {
  if (!account) return false;
  return account.status === "approved" && !!account.artistId;
}

/** 초대 유효기간 (14일) */
export const INVITE_TTL_DAYS = 14;

/** 초대 토큰이 아직 살아 있는가 */
export function isInviteValid(
  account: Pick<ArtistAccount, "status" | "inviteToken" | "inviteExpiresAt"> | null | undefined,
  now: Date = new Date()
): boolean {
  if (!account) return false;
  if (account.status !== "invited" || !account.inviteToken) return false;
  if (!account.inviteExpiresAt) return true; // 만료 없이 발급된 초대
  return new Date(account.inviteExpiresAt).getTime() > now.getTime();
}

/** 이메일 정규화 — 대소문자/공백 차이로 같은 사람이 두 계정이 되지 않게 */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** 최소한의 이메일 형식 검사 (가입 신청 폼용) */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/** 로그인 거부 사유 → /artist/login 에 띄울 안내 문구 */
export const SIGNIN_ERROR_MESSAGES: Record<string, string> = {
  not_registered:
    "등록되지 않은 계정입니다. 아래에서 가입을 신청하면 관리자 승인 후 이용할 수 있습니다.",
  pending: "가입 신청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다.",
  rejected: "가입이 승인되지 않은 계정입니다. 담당자에게 문의해 주세요.",
  disabled: "사용이 중지된 계정입니다. 담당자에게 문의해 주세요.",
  unmatched:
    "계정은 승인됐지만 아티스트 프로필과 연결되지 않았습니다. 담당자에게 문의해 주세요.",
  invite_invalid: "초대 링크가 유효하지 않거나 만료되었습니다. 담당자에게 다시 요청해 주세요.",
};

/** 로그인 실패 코드 → 사용자 문구 (모르는 코드는 기본 문구) */
export function signInErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return SIGNIN_ERROR_MESSAGES[code] ?? "로그인할 수 없습니다. 담당자에게 문의해 주세요.";
}
