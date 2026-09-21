/**
 * 구글 드라이브·시트 연동 (서버 전용).
 *
 * 인증: 관리자가 백오피스에서 "구글 드라이브 연결"을 한 번 눌러 받은 refresh token 을
 * 암호화해 google_drive_connection 에 한 줄로 보관한다. 로그인용 구글 OAuth 클라이언트
 * (GOOGLE_CLIENT_ID)를 그대로 쓰되, 로그인과는 별개의 동의 흐름이다.
 *
 * 권한은 drive.file 하나 — 앱이 만든 파일·폴더만 보고 고칠 수 있다. 민감 권한이 아니라
 * 구글 앱 검수가 필요 없고, 연결한 계정의 다른 문서에는 손이 닿지 않는다.
 * 그래서 템플릿 복사가 아니라 코드로 시트를 그린다 (estimate-sheet.ts).
 *
 * 라이브러리(googleapis) 없이 REST 를 직접 부른다 — 쓰는 엔드포인트가 열 개 남짓이라
 * 수십 MB 의존성을 들일 이유가 없다.
 */

import { randomInt } from "node:crypto";
import { supabaseAdmin } from "./supabase-admin";
import { decryptToken, encryptToken } from "./token-crypto";
import { CATEGORY_FOLDERS, DRIVE_ROOT_FOLDER, normalizeBaseUrl, type EstimateCategory } from "./estimate-types";
import {
  buildSheetRequests,
  buildSpreadsheetPropertiesRequest,
  NAMED_RANGES,
  SHEET_TITLE,
  type SheetInput,
} from "./estimate-sheet";
import { bannerUrl, sealUrlForSheet } from "./estimate-assets";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const TABLE = "google_drive_connection";
const ROW_ID = "default";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const DRIVE = "https://www.googleapis.com/drive/v3";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const FOLDER_MIME = "application/vnd.google-apps.folder";
/**
 * 구글 호출 하나의 상한 — 한 호출이 걸려도 함수 상한(60초) 안에서 오류로 끝나
 * 상태를 되돌릴 시간이 남게 한다.
 */
const GOOGLE_TIMEOUT_MS = 15_000;
const timeout = () => AbortSignal.timeout(GOOGLE_TIMEOUT_MS);
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";

/** 연결이 없거나 끊겼다 — 화면은 "다시 연결" 버튼으로 안내한다 */
export class GoogleNotConnectedError extends Error {}

export class GoogleApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET 이 설정되지 않았습니다.");
  return s;
}

function clientCreds(): { id: string; secret: string } {
  const id = process.env.GOOGLE_CLIENT_ID;
  const sec = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !sec) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 이 설정되지 않았습니다.");
  return { id, secret: sec };
}

/** 사이트 기준 주소 — 구글 콘솔에 등록할 리디렉션 URI 가 여기서 나온다 */
export function siteBase(): string {
  const base = normalizeBaseUrl(process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "");
  if (!base) throw new Error("NEXTAUTH_URL 이 설정되지 않았습니다.");
  return base;
}

export function oauthRedirectUri(): string {
  return `${siteBase()}/api/admin/google/callback`;
}

export function buildAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: clientCreds().id,
    redirect_uri: oauthRedirectUri(),
    response_type: "code",
    scope: `openid email ${DRIVE_SCOPE}`,
    // offline + consent — 두 번째 연결부터는 consent 가 없으면 refresh token 을 주지 않는다
    access_type: "offline",
    prompt: "consent select_account",
    state,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

/* ── 연결 정보 ──────────────────────────────────────────────── */

export interface DriveConnection {
  email: string;
  connectedAt: string;
  lastError: string | null;
  folderIds: Partial<Record<"root" | EstimateCategory, string>>;
}

/** 연결 정보 (토큰 제외). 표가 아직 없거나 연결 전이면 null */
export async function getConnection(): Promise<DriveConnection | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("email, connected_at, last_error, folder_ids")
    .eq("id", ROW_ID)
    .maybeSingle();
  if (error || !data) return null;
  return {
    email: data.email ?? "",
    connectedAt: data.connected_at,
    lastError: data.last_error ?? null,
    folderIds: (data.folder_ids ?? {}) as DriveConnection["folderIds"],
  };
}

/**
 * 액세스 토큰 캐시 — 어느 연결로 받은 토큰인지(connected_at)까지 기억한다.
 * 계정을 바꾸면 다른 함수 인스턴스의 캐시가 옛 계정 토큰으로 파일을 만들지 않게.
 */
let cached: { token: string; exp: number; connectedAt: string } | null = null;

export async function saveConnection(input: { email: string; refreshToken: string; scope: string }) {
  const prev = await getConnection();
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from(TABLE).upsert({
    id: ROW_ID,
    email: input.email,
    refresh_token: encryptToken(input.refreshToken, secret()),
    scope: input.scope,
    // 다른 계정으로 바꾸면 이전 계정의 폴더 id 는 보이지도 않는다 — 새로 만든다
    folder_ids: prev && prev.email === input.email ? prev.folderIds : {},
    connected_at: now,
    updated_at: now,
    last_error: null,
  });
  if (error) throw new Error(`구글 연결 저장 실패: ${error.message}`);
  cached = null;
}

/** 연결 해제 — 구글 쪽 권한도 회수한다 (회수 실패는 무시하고 행은 지운다) */
export async function deleteConnection(): Promise<void> {
  const { data } = await supabaseAdmin.from(TABLE).select("refresh_token").eq("id", ROW_ID).maybeSingle();
  const token = data?.refresh_token ? decryptToken(data.refresh_token, secret()) : null;
  if (token) {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: timeout(),
    }).catch((e) => console.warn("[google-drive] revoke failed:", e));
  }
  const { error } = await supabaseAdmin.from(TABLE).delete().eq("id", ROW_ID);
  if (error) throw new Error(`구글 연결 삭제 실패: ${error.message}`);
  cached = null;
}

async function markError(message: string) {
  await supabaseAdmin
    .from(TABLE)
    .update({ last_error: message, updated_at: new Date().toISOString() })
    .eq("id", ROW_ID)
    .then(({ error }) => error && console.error("[google-drive] markError:", error.message));
}

/* ── 토큰 ───────────────────────────────────────────────────── */

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

/** id_token 의 이메일 — 구글 토큰 엔드포인트에서 TLS 로 직접 받은 값이라 서명 검증 없이 읽어도 된다 */
function emailFromIdToken(idToken: string | undefined, clientId: string): string {
  if (!idToken) return "";
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
    if (payload.aud !== clientId) return "";
    return typeof payload.email === "string" ? payload.email : "";
  } catch {
    return "";
  }
}

export async function exchangeCode(code: string): Promise<{ refreshToken: string; scope: string; email: string }> {
  const { id, secret: sec } = clientCreds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: sec,
      redirect_uri: oauthRedirectUri(),
      grant_type: "authorization_code",
    }),
    cache: "no-store",
    signal: timeout(),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !body.access_token) {
    throw new Error(`구글 인증 코드 교환 실패: ${body.error_description ?? body.error ?? res.status}`);
  }
  const scope = body.scope ?? "";
  // 동의 화면에서 드라이브 권한 체크를 풀고 넘어오면 로그인만 되고 권한이 없다
  if (!scope.split(" ").includes(DRIVE_SCOPE)) {
    throw new Error("드라이브 권한이 허용되지 않았습니다. 동의 화면에서 드라이브 항목을 체크한 채로 다시 연결하세요.");
  }
  if (!body.refresh_token) {
    throw new Error("구글이 장기 토큰을 주지 않았습니다. 구글 계정 > 보안 > 타사 앱 액세스에서 이 앱을 삭제한 뒤 다시 연결하세요.");
  }
  // 여기서 받은 액세스 토큰은 캐시하지 않는다 — 연결 저장이 실패하면 새 계정 토큰만 남는다
  return { refreshToken: body.refresh_token, scope, email: emailFromIdToken(body.id_token, id) };
}

async function loadRefreshToken(): Promise<{ token: string; connectedAt: string }> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("refresh_token, connected_at")
    .eq("id", ROW_ID)
    .maybeSingle();
  if (error || !data?.refresh_token) {
    throw new GoogleNotConnectedError("구글 드라이브가 연결되지 않았습니다. 견적서 화면에서 먼저 연결하세요.");
  }
  const token = decryptToken(data.refresh_token, secret());
  if (!token) {
    throw new GoogleNotConnectedError("저장된 구글 연결을 읽을 수 없습니다(배포 비밀이 바뀌었을 수 있습니다). 다시 연결하세요.");
  }
  return { token, connectedAt: String(data.connected_at) };
}

async function getAccessToken(): Promise<string> {
  // 연결 행은 매번 읽는다 — 다른 인스턴스에서 계정을 바꿨거나 해제했을 수 있다
  const { token: refreshToken, connectedAt } = await loadRefreshToken();
  if (cached && cached.connectedAt === connectedAt && cached.exp > Date.now() + 60_000) return cached.token;
  const { id, secret: sec } = clientCreds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: sec,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
    signal: timeout(),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !body.access_token) {
    if (body.error === "invalid_grant") {
      const msg = "구글 연결이 만료되었거나 해제되었습니다. 다시 연결하세요.";
      await markError(msg);
      throw new GoogleNotConnectedError(msg);
    }
    throw new GoogleApiError(`구글 토큰 갱신 실패: ${body.error_description ?? body.error ?? res.status}`, res.status);
  }
  cached = { token: body.access_token, exp: Date.now() + (body.expires_in ?? 3600) * 1000, connectedAt };
  return cached.token;
}

/* ── REST 호출 ──────────────────────────────────────────────── */

async function gfetch(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: timeout(),
  });
  if (res.status === 401 && retry) {
    cached = null;
    return gfetch(url, init, false);
  }
  return res;
}

async function describe(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  let msg = text.slice(0, 300);
  try {
    const j = JSON.parse(text);
    msg = j?.error?.message ?? msg;
  } catch {
    /* 본문이 JSON 이 아니면 앞부분만 보여 준다 */
  }
  if (/has not been used|is disabled|accessNotConfigured/i.test(msg)) {
    return `구글 클라우드 프로젝트에서 Google Sheets API 와 Google Drive API 를 사용 설정해야 합니다. (${msg})`;
  }
  return `구글 API 오류 (${res.status}): ${msg}`;
}

async function gjson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await gfetch(url, init);
  if (!res.ok) throw new GoogleApiError(await describe(res), res.status);
  return (await res.json()) as T;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/* ── 폴더 ───────────────────────────────────────────────────── */

async function folderAlive(id: string): Promise<boolean> {
  const res = await gfetch(`${DRIVE}/files/${encodeURIComponent(id)}?fields=id,trashed,mimeType&supportsAllDrives=true`);
  if (res.status === 404) return false;
  if (!res.ok) throw new GoogleApiError(await describe(res), res.status);
  const f = (await res.json()) as { trashed?: boolean; mimeType?: string };
  return !f.trashed && f.mimeType === FOLDER_MIME;
}

async function createFolder(name: string, parent?: string): Promise<string> {
  const f = await gjson<{ id: string }>(
    `${DRIVE}/files?fields=id&supportsAllDrives=true`,
    jsonInit("POST", { name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}) }),
  );
  return f.id;
}

/**
 * 견적서/<분류> 폴더 id — 없거나 휴지통에 들어갔으면 새로 만든다.
 * 폴더 id 는 연결 행에 캐시한다 (drive.file 권한으로는 이름 검색도 앱이 만든 것만 보인다).
 */
export async function ensureCategoryFolder(category: EstimateCategory): Promise<string> {
  const conn = await getConnection();
  if (!conn) throw new GoogleNotConnectedError("구글 드라이브가 연결되지 않았습니다. 견적서 화면에서 먼저 연결하세요.");
  let ids = { ...conn.folderIds };
  let changed = false;

  if (!ids.root || !(await folderAlive(ids.root))) {
    // 루트가 새로 생기면 옛 하위 폴더는 옛 루트 안에 있으므로 함께 버린다
    ids = { root: await createFolder(DRIVE_ROOT_FOLDER) };
    changed = true;
  }
  let sub = ids[category];
  if (!sub || !(await folderAlive(sub))) {
    sub = await createFolder(CATEGORY_FOLDERS[category], ids.root);
    ids[category] = sub;
    changed = true;
  }
  if (changed) {
    const { error } = await supabaseAdmin
      .from(TABLE)
      .update({ folder_ids: ids, updated_at: new Date().toISOString() })
      .eq("id", ROW_ID);
    if (error) console.error("[google-drive] folder_ids 저장 실패:", error.message);
  }
  return sub;
}

/* ── 시트 ───────────────────────────────────────────────────── */

export async function createSpreadsheetFile(name: string, folderId: string): Promise<{ id: string; url: string }> {
  const f = await gjson<{ id: string; webViewLink?: string }>(
    `${DRIVE}/files?fields=id,webViewLink&supportsAllDrives=true`,
    jsonInit("POST", { name, mimeType: SHEET_MIME, parents: [folderId] }),
  );
  return { id: f.id, url: f.webViewLink ?? `https://docs.google.com/spreadsheets/d/${f.id}/edit` };
}

interface SpreadsheetMeta {
  properties?: { importFunctionsExternalUrlAccessAllowed?: boolean };
  sheets?: { properties: { sheetId: number; title: string } }[];
  namedRanges?: { namedRangeId: string; name: string }[];
}

/**
 * 견적서 탭을 새로 그린다 — 새 탭을 만들어 채운 뒤 옛 탭을 지우는 방식.
 * 칸마다 지우고 다시 쓰는 것보다 병합·테두리 찌꺼기가 남지 않는다.
 *
 * managedGid: 앱이 관리하는 탭 id. null 이면 갓 만든 파일이라 기본 탭을 전부 지운다.
 * 사람이 따로 추가한 탭(예: 디자인 예시)은 건드리지 않는다.
 */
export async function renderEstimateSheet(
  spreadsheetId: string,
  managedGid: number | null,
  input: SheetInput,
  fileName: string,
): Promise<{ gid: number }> {
  const sid = encodeURIComponent(spreadsheetId);
  const meta = await gjson<SpreadsheetMeta>(
    `${SHEETS}/${sid}?fields=properties(importFunctionsExternalUrlAccessAllowed),sheets.properties(sheetId,title),namedRanges(namedRangeId,name)`,
  );
  const sheets = meta.sheets ?? [];
  const taken = new Set(sheets.map((s) => s.properties.sheetId));
  let gid = 0;
  do gid = randomInt(1, 2_000_000_000);
  while (taken.has(gid));

  const { requests } = buildSheetRequests(input, gid, {
    bannerUrl: bannerUrl(),
    sealUrl: await sealUrlForSheet(),
  });

  const ours = new Set<string>(Object.values(NAMED_RANGES));
  const drop = managedGid === null ? sheets : sheets.filter((s) => s.properties.sheetId === managedGid);
  const dropIds = new Set(drop.map((s) => s.properties.sheetId));
  const titleTaken = sheets.some((s) => !dropIds.has(s.properties.sheetId) && s.properties.title === SHEET_TITLE);

  const batch = [
    ...(meta.namedRanges ?? [])
      .filter((n) => ours.has(n.name))
      .map((n) => ({ deleteNamedRange: { namedRangeId: n.namedRangeId } })),
    { addSheet: { properties: { sheetId: gid, title: `__estimate_${gid}`, index: 0 } } },
    ...requests,
    ...drop.map((s) => ({ deleteSheet: { sheetId: s.properties.sheetId } })),
    {
      updateSheetProperties: {
        properties: { sheetId: gid, title: titleTaken ? `${SHEET_TITLE} (자동)` : SHEET_TITLE, index: 0 },
        fields: "title,index",
      },
    },
    // 배너·도장 IMAGE() 가 #REF! 로 막히지 않게 외부 이미지 액세스를 켠다 (이미 켜졌으면 생략)
    buildSpreadsheetPropertiesRequest(fileName, !meta.properties?.importFunctionsExternalUrlAccessAllowed),
  ];

  await gjson(`${SHEETS}/${sid}:batchUpdate`, jsonInit("POST", { requests: batch }));
  return { gid };
}

export interface FileMeta {
  modifiedTime: string;
  trashed: boolean;
  webViewLink: string;
}

export async function getFileMeta(fileId: string): Promise<FileMeta | null> {
  const res = await gfetch(
    `${DRIVE}/files/${encodeURIComponent(fileId)}?fields=modifiedTime,trashed,webViewLink&supportsAllDrives=true`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new GoogleApiError(await describe(res), res.status);
  const f = (await res.json()) as Partial<FileMeta>;
  return { modifiedTime: f.modifiedTime ?? "", trashed: !!f.trashed, webViewLink: f.webViewLink ?? "" };
}

/** 시트가 계산한 합계 — 시트에서 직접 고친 내용까지 반영된 실제 발송 금액 */
export async function readSheetTotals(fileId: string): Promise<{ supply: number; vat: number; total: number }> {
  const q = [NAMED_RANGES.supply, NAMED_RANGES.vat, NAMED_RANGES.total]
    .map((r) => `ranges=${encodeURIComponent(r)}`)
    .join("&");
  const body = await gjson<{ valueRanges?: { values?: unknown[][] }[] }>(
    `${SHEETS}/${encodeURIComponent(fileId)}/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE`,
  );
  const nums = (body.valueRanges ?? []).map((v) => v.values?.[0]?.[0]);
  if (nums.length !== 3 || nums.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
    throw new Error("시트에서 합계를 읽지 못했습니다. 합계 칸을 지웠거나 수식이 깨졌을 수 있습니다 — 앱에서 저장해 시트를 다시 그리세요.");
  }
  const [supply, vat, total] = nums as number[];
  return { supply: Math.round(supply), vat: Math.round(vat), total: Math.round(total) };
}

function isPdf(buf: Buffer): boolean {
  return buf.subarray(0, 5).toString("latin1") === "%PDF-";
}

/**
 * 시트 → PDF. 미리보기와 발송이 이 함수 하나를 같이 쓴다 — 사람이 확인한 것과 고객이 받는 것이 같아야 한다.
 *
 * 인쇄 옵션(A4·너비 맞춤·격자 숨김·해당 탭만)을 지정할 수 있는 시트 내보내기 주소를 쓴다.
 * 일시 오류(429·5xx)는 잠깐 쉬고 다시 시도한다. 드라이브 공식 내보내기는 파일의 모든 탭을
 * 기본 인쇄 설정으로 뽑으므로, 탭이 견적서 하나뿐일 때만 대신 쓴다 — 사람이 추가한 탭이
 * 고객 PDF 에 섞여 나가면 안 된다.
 */
export async function exportSheetPdf(fileId: string, gid: number | null): Promise<Buffer> {
  const params = new URLSearchParams({
    format: "pdf",
    size: "A4",
    portrait: "true",
    fitw: "true",
    gridlines: "false",
    printtitle: "false",
    sheetnames: "false",
    pagenum: "UNDEFINED",
    fzr: "false",
    horizontal_alignment: "CENTER",
    top_margin: "0.4",
    bottom_margin: "0.4",
    left_margin: "0.4",
    right_margin: "0.4",
  });
  if (gid !== null) params.set("gid", String(gid));
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(fileId)}/export?${params}`;

  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
    const res = await gfetch(url);
    lastStatus = res.status;
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (isPdf(buf)) return buf;
      break; // PDF 가 아닌 응답(로그인 화면 등)은 다시 해도 같다
    }
    await res.body?.cancel().catch(() => undefined);
    if (res.status !== 429 && res.status < 500) break;
  }

  console.warn(`[google-drive] sheet export 실패 (${lastStatus}) — 탭이 하나면 drive export 로 대신한다`);
  const meta = await gjson<SpreadsheetMeta>(
    `${SHEETS}/${encodeURIComponent(fileId)}?fields=sheets.properties(sheetId,title)`,
  );
  const tabs = meta.sheets ?? [];
  if (tabs.length !== 1 || (gid !== null && tabs[0].properties.sheetId !== gid)) {
    throw new Error(
      `구글에서 견적서 PDF 를 받지 못했습니다 (${lastStatus || "응답 없음"}). 시트에 다른 탭이 있어 대체 내보내기를 쓰지 않았습니다. 잠시 후 다시 시도하세요.`,
    );
  }
  const res = await gfetch(`${DRIVE}/files/${encodeURIComponent(fileId)}/export?mimeType=application/pdf`);
  if (!res.ok) throw new GoogleApiError(await describe(res), res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!isPdf(buf)) throw new Error("구글에서 받은 PDF 가 올바르지 않습니다.");
  return buf;
}

/** 휴지통으로 — 드라이브에서 30일 안에 되살릴 수 있다 */
export async function trashFile(fileId: string): Promise<void> {
  const res = await gfetch(
    `${DRIVE}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
    jsonInit("PATCH", { trashed: true }),
  );
  if (res.status === 404) return;
  if (!res.ok) throw new GoogleApiError(await describe(res), res.status);
}
