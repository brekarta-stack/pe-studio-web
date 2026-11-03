/**
 * 인테이크 사진 한 장을 두 판으로 — 저장소에 올릴 판과 모델에게 보여 줄 판.
 * sharp 를 쓰므로 서버·CLI 전용. 규칙은 image-shrink.ts(사이트 공통)를 따른다.
 */
import sharp, { type Metadata } from "sharp";
import { ENCODE_OPTIONS, MAX_EDGE } from "./image-shrink.ts";

/** 모델에게 보여 줄 판의 긴 변 — 1280 이면 접합부·인쇄 디테일까지 보이고 사진당 1,500 토큰 안쪽 */
export const VISION_MAX_EDGE = 1280;

export type IntakeUploadFormat = "jpeg" | "png" | "webp";

export interface PreparedIntakeImage {
  /** 저장소에 올릴 판 — 사이트 규칙과 같은 1920 폭·화질. 형식은 원본을 따른다(투명도 보존) */
  upload: Buffer;
  uploadContentType: `image/${IntakeUploadFormat}`;
  /** 모델에게 보여 줄 판 — 항상 JPEG */
  vision: Buffer;
  width: number;
  height: number;
}

export async function prepareIntakeImage(input: Buffer): Promise<PreparedIntakeImage> {
  let meta: Metadata;
  try {
    // 잘린 파일을 굳히지 않게 — 깨졌으면 여기서 멈춘다
    meta = await sharp(input, { failOn: "truncated" }).metadata();
  } catch {
    throw new Error("이미지를 읽을 수 없음(깨졌거나 잘림)");
  }
  if (!meta.width || !meta.height) throw new Error("이미지 크기를 알 수 없음");
  if ((meta.pages ?? 1) > 1) throw new Error("움직이는 이미지는 받지 않음");

  // PNG·WebP 는 같은 형식으로 — JPEG 로 바꾸면 투명한 부분이 검게 깔린다 (shrink-images 와 같은 원칙)
  const format: IntakeUploadFormat = meta.format === "png" ? "png" : meta.format === "webp" ? "webp" : "jpeg";
  // rotate(): EXIF 방향을 픽셀에 반영 — 휴대폰 사진이 눕지 않게. keepIccProfile(): 넓은 색 공간 유지(CMYK 제외)
  const base = () => {
    let p = sharp(input, { failOn: "truncated" }).rotate();
    if (meta.space !== "cmyk") p = p.keepIccProfile();
    return p.resize({ width: MAX_EDGE, withoutEnlargement: true });
  };
  const upload =
    format === "png"
      ? await base().png(ENCODE_OPTIONS.png).toBuffer()
      : format === "webp"
        ? await base().webp(ENCODE_OPTIONS.webp).toBuffer()
        : await base().jpeg(ENCODE_OPTIONS.jpeg).toBuffer();

  const vision = await sharp(input, { failOn: "truncated" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: VISION_MAX_EDGE, height: VISION_MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  const sideways = (meta.orientation ?? 1) >= 5;
  return {
    upload,
    uploadContentType: `image/${format}`,
    vision,
    width: sideways ? meta.height : meta.width,
    height: sideways ? meta.width : meta.height,
  };
}
