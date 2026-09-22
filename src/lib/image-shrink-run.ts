/**
 * 이미지 한 장 줄이기 (sharp) — 규칙은 image-shrink.ts. 서버에서만 쓴다.
 * 테스트가 실제 이미지로 돌려 볼 수 있게 라우트에서 떼어 냈다.
 */

import sharp, { type Metadata } from "sharp";
import {
  ENCODE_OPTIONS,
  MAX_EDGE,
  isAnimatedPng,
  isLosslessWebp,
  planAfterMetadata,
  type ShrinkFormat,
} from "./image-shrink.ts";

/**
 * @param expectedSize 저장소 목록이 알려 준 크기 — 받은 바이트가 다르면(중간에 끊김) 굳히지 않는다
 */
export async function shrinkBuffer(
  buf: Buffer,
  format: ShrinkFormat,
  expectedSize?: number,
): Promise<{ out: Buffer } | { skip: string }> {
  if (expectedSize && buf.length !== expectedSize) return { skip: "받은 크기가 목록과 다름" };
  if (format === "webp" && isLosslessWebp(buf)) return { skip: "무손실 WebP" };
  if (format === "png" && isAnimatedPng(buf)) return { skip: "움직이는 PNG(APNG)" };

  let meta: Metadata;
  try {
    // 잘린 파일을 줄여서 굳히지 않게 — 깨졌으면 여기서 멈춘다
    meta = await sharp(buf, { failOn: "truncated" }).metadata();
  } catch {
    return { skip: "이미지를 읽을 수 없음(깨졌거나 잘림)" };
  }
  // 목록의 형식 표시와 실제 내용이 다르면(예: PNG 인데 jpeg 로 표시) 투명 부분이 검게 변할 수 있다
  if (meta.format !== format) return { skip: `형식 표시와 실제 내용이 다름(${meta.format})` };
  const early = planAfterMetadata({ width: meta.width, height: meta.height, pages: meta.pages }, buf.length);
  if (early?.action === "skip") return { skip: early.reason };

  try {
    // rotate(): EXIF 방향을 픽셀에 반영한 뒤 메타데이터를 버린다(기본 동작) — 돌아간 사진이 나오지 않게.
    // 폭만 제한한다 — 높이까지 묶으면 세로로 긴 그림이 뭉개진다.
    // keepIccProfile(): P3 등 넓은 색 공간 사진의 색이 바뀌지 않게 원래 프로파일을 남긴다.
    // 단 CMYK 는 예외 — keepIccProfile 을 켜면 내장 프로파일 대신 libvips 기본 CMYK 로 변환돼 색이
    // 눈에 띄게 바뀐다. 기본 동작(내장 프로파일로 sRGB 변환)이 브라우저가 원본을 보여 주는 방식과 같다.
    let pipe = sharp(buf, { failOn: "truncated" }).rotate().resize({ width: MAX_EDGE, withoutEnlargement: true });
    if (meta.space !== "cmyk") pipe = pipe.keepIccProfile();
    const out =
      format === "jpeg"
        ? await pipe.jpeg(ENCODE_OPTIONS.jpeg).toBuffer()
        : format === "png"
          ? await pipe.png(ENCODE_OPTIONS.png).toBuffer()
          : await pipe.webp(ENCODE_OPTIONS.webp).toBuffer();
    return { out };
  } catch {
    return { skip: "이미지를 읽을 수 없음(깨졌거나 잘림)" };
  }
}
