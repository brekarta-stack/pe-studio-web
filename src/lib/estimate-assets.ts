/**
 * 견적서 시트에 들어가는 이미지 — 상단 배너와 회사 도장.
 *
 * 구글 시트의 IMAGE() 함수는 구글 서버가 직접 받아 갈 수 있는 공개 주소만 읽는다.
 *  - 배너: 브랜드 이미지라 public/estimate/banner.png 로 그냥 공개한다.
 *  - 도장: 인감 이미지를 누구나 받아 갈 수 있는 주소에 두면 위조에 쓰인다.
 *    그래서 레포에도 public/ 에도 두지 않는다. 비공개 스토리지 버킷에 두고,
 *    배포 비밀에서 파생한 키가 붙은 주소(/api/estimate-asset/seal?k=…)로만 내보낸다.
 *    그 주소는 우리 드라이브의 시트 수식 안에만 있고, 고객은 PDF 만 받는다.
 *    도장 이미지는 백오피스 견적서 화면에서 올린다.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "./supabase-admin";

const BUCKET = "estimate-assets";
const SEAL_PATH = "seal.png";
/** 서버 액션 본문 한도(기본 1MB)보다 작게 — multipart 머리 몫을 남긴다 */
export const SEAL_MAX_BYTES = 800 * 1024;
export const SEAL_TYPES = ["image/png", "image/jpeg"] as const;

/** 시트가 이미지를 받아 갈 사이트 주소. 프리뷰 배포에서 시험할 때만 바꾼다 */
export function assetBase(): string {
  return (process.env.ESTIMATE_ASSET_BASE ?? "https://www.papercraft.kr").replace(/\/+$/, "");
}

export function bannerUrl(): string {
  return `${assetBase()}/estimate/banner.png`;
}

/**
 * 도장 주소의 키. 주소가 새어 나갔다면 ESTIMATE_SEAL_SECRET 을 새 값으로 넣어 키를 바꾸고
 * 시트를 다시 그린다 (없으면 NEXTAUTH_SECRET 에서 파생).
 */
function sealKey(): string {
  const secret = process.env.ESTIMATE_SEAL_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET 이 설정되지 않았습니다.");
  return createHmac("sha256", secret).update("estimate-seal").digest("hex").slice(0, 32);
}

export function isValidSealKey(k: string | null): boolean {
  if (!k) return false;
  const a = Buffer.from(k);
  const b = Buffer.from(sealKey());
  return a.length === b.length && timingSafeEqual(a, b);
}

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const { data } = await supabaseAdmin.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) throw error;
  }
  bucketReady = true;
}

/** 도장 정보 — 올린 적이 없으면 null. updatedAt 은 시트 이미지 캐시를 끊는 데 쓴다 */
export async function getSealInfo(): Promise<{ updatedAt: string } | null> {
  try {
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).list("", { search: SEAL_PATH, limit: 5 });
    if (error || !data) return null;
    const f = data.find((o) => o.name === SEAL_PATH);
    if (!f) return null;
    return { updatedAt: f.updated_at ?? f.created_at ?? "" };
  } catch {
    return null;
  }
}

/** 시트 수식에 넣을 도장 주소. 도장이 없으면 null (시트에는 "(인)" 글자가 들어간다) */
export async function sealUrlForSheet(): Promise<string | null> {
  const info = await getSealInfo();
  if (!info) return null;
  const v = encodeURIComponent(info.updatedAt.replace(/\D/g, "").slice(0, 14));
  return `${assetBase()}/api/estimate-asset/seal?k=${sealKey()}&v=${v}`;
}

export async function uploadSeal(bytes: Buffer, contentType: string): Promise<void> {
  await ensureBucket();
  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(SEAL_PATH, bytes, { contentType, upsert: true, cacheControl: "60" });
  if (error) throw new Error(`도장 이미지 저장 실패: ${error.message}`);
}

export async function downloadSeal(): Promise<{ bytes: Buffer; contentType: string } | null> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(SEAL_PATH);
  if (error || !data) return null;
  return { bytes: Buffer.from(await data.arrayBuffer()), contentType: data.type || "image/png" };
}
