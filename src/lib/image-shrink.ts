/**
 * 이미 올라간 공개 이미지 원본 줄이기 — 판단 규칙 (순수 함수).
 *
 * 2026-09-22 Supabase 캐시 전송량 초과의 원인 중 하나는 원본 크기(1~3MB)였다. 사이트가 쓰는
 * 가장 큰 폭은 1920(next.config deviceSizes)이라 그보다 큰 원본은 쓸모없이 무겁기만 하다.
 *
 * 안전장치
 *  - 공개 버킷(uploads)의 맨 위 파일만 다룬다. quote/(고객 첨부)·deliverable/(작가 납품물) 같은
 *    폴더는 원본 그대로가 의미 있는 파일이라 건드리지 않는다.
 *  - 같은 경로·같은 형식으로 덮어쓴다 → DB·코드의 주소를 바꿀 필요가 없고, 캐시에 남은 옛 판도
 *    같은 그림이라 어긋날 일이 없다.
 *  - 덮어쓰기 전에 원본을 비공개 버킷(uploads-originals)에 같은 이름으로 보관한다. 되돌리기 가능.
 *  - GIF·SVG·움직이는 이미지(움직이는 WebP·APNG)·무손실 WebP 는 건너뛴다. 15% 이상 줄지 않으면 바꾸지 않는다.
 *  - 폭만 1920 으로 제한한다 — 세로로 긴 그림(인포그래픽·전개도)의 높이를 묶으면 폭이 뭉개진다.
 *  - 줄인 파일에는 표식(metadata.shrunk)을 남긴다. 되돌리기는 표식이 있는 파일만 — 그 뒤에 같은
 *    이름으로 교체된 새 파일을 옛 보관본으로 덮지 않게.
 */

export const SHRINK_BUCKET = "uploads";
export const BACKUP_BUCKET = "uploads-originals";

/** 사이트가 요청하는 가장 큰 폭 (next.config deviceSizes 의 최댓값). 높이는 제한하지 않는다 */
export const MAX_EDGE = 1920;
/** 한 번 호출에서 이 시간이 지나면 멈추고 다음 호출로 넘긴다 — 함수 상한(60초) 안전 여유 */
export const TIME_BUDGET_MS = 40_000;
/** 이보다 작은 파일은 줄여도 얻는 게 적다 */
export const MIN_BYTES = 300 * 1024;
/** 이만큼 이상 줄어야 바꾼다 */
export const MIN_SAVING_RATIO = 0.15;
/** 한 번 호출에 처리할 최대 개수 — 함수 상한(60초) 안에 끝나게 */
export const MAX_BATCH = 8;

export type ShrinkFormat = "jpeg" | "png" | "webp";

export const ENCODE_OPTIONS = {
  jpeg: { quality: 82, mozjpeg: true, progressive: true },
  png: { compressionLevel: 9, adaptiveFiltering: true },
  webp: { quality: 82 },
} as const;

export function formatOf(name: string, contentType: string | null | undefined): ShrinkFormat | null {
  const ct = (contentType ?? "").toLowerCase();
  if (ct === "image/jpeg" || ct === "image/jpg") return "jpeg";
  if (ct === "image/png") return "png";
  if (ct === "image/webp") return "webp";
  if (ct && ct !== "application/octet-stream") return null; // gif·svg·pdf 등
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "jpg" || ext === "jpeg") return "jpeg";
  if (ext === "png") return "png";
  if (ext === "webp") return "webp";
  return null;
}

export type ShrinkPlan =
  | { action: "process"; format: ShrinkFormat }
  | { action: "skip"; reason: string };

/** 내려받기 전에 판단할 수 있는 것만 — 크기·형식·위치 */
export function planObject(o: { name: string; size: number | null | undefined; contentType?: string | null }): ShrinkPlan {
  if (!o.name || o.name.includes("/")) return { action: "skip", reason: "폴더 안 파일(고객 첨부·납품물) — 다루지 않음" };
  if (o.name.startsWith(".")) return { action: "skip", reason: "숨김 파일" };
  // 저장소 클라이언트가 경로를 인코딩하지 않아 다른 파일로 요청된다 — 대시보드로만 생기는 이름
  if (/[?#%]/.test(o.name)) return { action: "skip", reason: "이름에 ?·#·% 가 있음 — 다루지 않음" };
  const format = formatOf(o.name, o.contentType);
  if (!format) return { action: "skip", reason: "대상 형식 아님(GIF·SVG·문서 등)" };
  if (!o.size || o.size < MIN_BYTES) return { action: "skip", reason: "이미 작음" };
  return { action: "process", format };
}

/** 내려받은 뒤 — 움직이는 이미지·이미 작은 해상도 */
export function planAfterMetadata(m: { width?: number; height?: number; pages?: number }, size: number): ShrinkPlan | null {
  if ((m.pages ?? 1) > 1) return { action: "skip", reason: "움직이는 이미지" };
  if (!m.width || !m.height) return { action: "skip", reason: "크기를 읽을 수 없음" };
  // 폭이 이미 작고 파일도 아주 크지 않으면 재압축만으로는 얻는 게 적다
  if (m.width <= MAX_EDGE && size < MIN_BYTES * 2) return { action: "skip", reason: "이미 작음" };
  return null;
}

/**
 * 무손실 WebP(VP8L) — 손실 압축으로 바꾸면 글자·선이 번진다.
 * ICC·EXIF 가 붙은 파일은 첫 청크가 VP8X 라 RIFF 청크를 훑어 VP8L 이 있는지 본다.
 */
export function isLosslessWebp(buf: Uint8Array): boolean {
  const tag = (at: number) => String.fromCharCode(buf[at], buf[at + 1], buf[at + 2], buf[at + 3]);
  if (buf.length < 20 || tag(0) !== "RIFF" || tag(8) !== "WEBP") return false;
  let at = 12;
  while (at + 8 <= buf.length) {
    if (tag(at) === "VP8L") return true;
    const size = buf[at + 4] | (buf[at + 5] << 8) | (buf[at + 6] << 16) | (buf[at + 7] << 24);
    if (size < 0) return false;
    at += 8 + size + (size & 1);
  }
  return false;
}

/** APNG — libvips 가 여러 장으로 알려 주지 않아 직접 본다. acTL 청크가 IDAT 앞에 있다 */
export function isAnimatedPng(buf: Uint8Array): boolean {
  const head = Buffer.from(buf.buffer, buf.byteOffset, Math.min(buf.length, 1 << 20)).toString("latin1");
  const actl = head.indexOf("acTL");
  const idat = head.indexOf("IDAT");
  return actl !== -1 && (idat === -1 || actl < idat);
}

/** 이 도구가 줄인 파일에 남기는 표식 (Supabase Storage 사용자 메타데이터) */
export const SHRUNK_MARK = "shrink-images/v1";

/**
 * 지금 파일이 이 도구가 줄인 그 판인가 — 표식만으로는 부족하다. 대시보드(재개 가능 업로드)로
 * 같은 이름에 새 파일을 올리면 옛 사용자 메타데이터가 그대로 남는다. 그래서 줄일 때 적어 둔
 * 크기까지 같아야 "우리 판"으로 본다.
 */
export function isOurShrunkCopy(
  meta: Record<string, unknown> | null | undefined,
  currentSize: number | null | undefined,
): boolean {
  if (!meta || meta.shrunk !== SHRUNK_MARK) return false;
  const bytes = Number(meta.shrunkBytes);
  return Number.isFinite(bytes) && bytes > 0 && currentSize === bytes;
}

/** 목록의 cache-control("max-age=3600") → 올릴 때 넘기는 초 문자열. 모르면 저장소 기본값 */
export function cacheSecondsOf(cacheControl: unknown): string {
  const m = typeof cacheControl === "string" ? /max-age=(\d+)/.exec(cacheControl) : null;
  return m ? m[1] : "3600";
}

/** 저장소 오류가 "이미 있음"인가 — 상태 코드로 먼저 보고, 메시지는 보조로 */
export function isAlreadyExists(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { statusCode?: unknown; status?: unknown; message?: unknown };
  if (String(e.statusCode) === "409" || e.status === 409) return true;
  return typeof e.message === "string" && /already exists|duplicate/i.test(e.message);
}

export function worthReplacing(before: number, after: number): boolean {
  return after > 0 && after <= before * (1 - MIN_SAVING_RATIO);
}

export function clampBatch(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : MAX_BATCH;
  return Math.min(Math.max(v, 1), MAX_BATCH);
}
