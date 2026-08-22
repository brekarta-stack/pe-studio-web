/**
 * 제작 문의 첨부파일 규칙 — 폼(고르는 쪽)과 업로드 라우트(받는 쪽)가 함께 쓴다.
 *
 * 두 곳이 따로 적혀 있으면 반드시 어긋난다. 실제로 폼의 accept 에는 있는데
 * 서버 화이트리스트에는 없는 확장자를 고르면, 고객은 파일을 고를 수 있는데
 * 업로드만 실패하는 상태가 된다 — 원인을 알 수 없는 오류로 보인다.
 *
 * 노드 전용 모듈(node:path 등)을 import 하지 않는다 — 폼(클라이언트)도 이 파일을 읽는다.
 */

/**
 * 첨부 용량 상한.
 *
 * 예전 4MB 는 "Vercel 요청 본문 한도 4.5MB" 를 근거로 잡은 값이었는데 그 한도는
 * 이제 100MB 다. 그 사이 로고 원본(.ai)·인쇄용 PDF 는 대부분 4MB 를 넘어서,
 * 고객사가 로고를 첨부하려다 "파일이 너무 큽니다" 로 막히는 일이 생겼다.
 * 사진은 클라이언트에서 미리 축소해 보내므로 이 상한에 닿는 건 문서·원본 파일뿐이다.
 */
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024; // 20 MB

/** 확장자 → 저장 시 강제할 content-type. file.type 은 믿지 않는다 */
export const UPLOAD_EXT_MIME: Record<string, string> = {
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png":  "image/png",
  ".webp": "image/webp",
  ".gif":  "image/gif",
  // 아이폰 기본 사진 형식. 데스크톱에서 그대로 올리면 예전에는 "허용되지 않는 형식" 이었다
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".pdf":  "application/pdf",
  ".ai":   "application/pdf",   // 최신 .ai 는 PDF 호환 — 브라우저에서 열림
  ".svg":  "image/svg+xml",     // 로고용
  ".zip":  "application/zip",
};

/** <input accept> 값 — 폼에서 고를 수 있는 것과 서버가 받는 것을 같게 유지한다 */
export const UPLOAD_ACCEPT = Object.keys(UPLOAD_EXT_MIME).join(",");

/** 로고 첨부용 — 벡터·이미지 위주 (ZIP 은 로고로 받을 이유가 없다) */
export const LOGO_ACCEPT = ".svg,.ai,.pdf,.png,.jpg,.jpeg,.webp,.heic,.heif";

/** 사람이 읽는 허용 형식 안내 — 오류 메시지와 폼 안내가 어긋나지 않게 */
export const UPLOAD_FORMAT_LABEL = "PNG·JPG·HEIC·WEBP·GIF·PDF·AI·SVG·ZIP";

/** 파일명에서 확장자 (소문자). node:path 의 extname 과 같은 규칙 — 숨김파일은 확장자 없음 */
export function fileExt(name: string): string {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i).toLowerCase() : "";
}

/** 매직 바이트 기본 검증 — 확장자만 바꿔 올린 파일을 걸러낸다 */
export function magicOk(ext: string, h: Uint8Array): boolean {
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return h[0] === 0xff && h[1] === 0xd8;
    case ".png":
      return h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47;
    case ".gif":
      return h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46; // GIF
    case ".webp":
      return h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46; // RIFF
    case ".heic":
    case ".heif":
      // ISO-BMFF: 4바이트 박스 길이 뒤에 'ftyp'
      return h[4] === 0x66 && h[5] === 0x74 && h[6] === 0x79 && h[7] === 0x70;
    case ".pdf":
      return h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46; // %PDF
    case ".zip":
      return h[0] === 0x50 && h[1] === 0x4b; // PK
    case ".ai":
      // 최신 .ai=%PDF, 구형=%!PS — 둘 다 허용, 그 외에도 저장은 허용(관대)
      return true;
    case ".svg":
      return true;
    default:
      return false;
  }
}
