import { NextResponse } from "next/server";
import {
  getItemByAirtableId,
  saveItem,
  deleteItemByAirtableId,
} from "@/lib/portfolio";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { PortfolioItem } from "@/lib/portfolio-types";
import { CATEGORIES } from "@/lib/portfolio-types";
import { randomUUID } from "crypto";
import path from "path";

/* ── 웹훅 시크릿 (없으면 서버 시작 시 에러가 아닌 요청 시점에 503 반환) ── */
const WEBHOOK_SECRET = process.env.AIRTABLE_WEBHOOK_SECRET;

/* ── SSRF 방지: 허용된 Airtable 이미지 호스트만 fetch ── */
const ALLOWED_IMAGE_HOSTS = [
  "dl.airtable.com",
  "v5.airtableusercontent.com",
  "v4.airtableusercontent.com",
  "v3.airtableusercontent.com",
];

function isAllowedImageUrl(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    return (
      protocol === "https:" &&
      ALLOWED_IMAGE_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`))
    );
  } catch {
    return false;
  }
}

interface AirtableImage {
  url: string;
  filename: string;
}

interface AirtablePayload {
  action: "create" | "update" | "delete";
  record: {
    id: string;
    title?: string;
    category?: string;
    description?: string;
    client?: string;
    published?: boolean;
    images?: AirtableImage[];
  };
}

async function uploadImageToStorage(url: string, filename: string): Promise<string> {
  if (!isAllowedImageUrl(url)) {
    throw new Error(`Blocked SSRF attempt: ${url}`);
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status}): ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const ext = path.extname(filename) || ".jpg";
  const name = `airtable_${randomUUID()}${ext}`;

  const { error } = await supabaseAdmin.storage
    .from("uploads")
    .upload(name, buffer, { contentType: res.headers.get("content-type") ?? "image/jpeg", cacheControl: "31536000" });

  if (error) throw error;

  const {
    data: { publicUrl },
  } = supabaseAdmin.storage.from("uploads").getPublicUrl(name);
  return publicUrl;
}

export async function POST(request: Request) {
  /* ── 웹훅 시크릿 필수 — 설정되지 않으면 비활성 상태로 거부 ── */
  if (!WEBHOOK_SECRET) {
    console.error("[webhook] AIRTABLE_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  /* ── 헤더 기반 인증 (body에 시크릿을 포함하지 않음) ── */
  const authHeader = request.headers.get("x-webhook-secret");
  if (authHeader !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /* ── 페이로드 파싱 ── */
  let payload: AirtablePayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action, record } = payload;
  if (!record?.id) {
    return NextResponse.json({ error: "Missing record.id" }, { status: 400 });
  }

  if (action === "delete") {
    await deleteItemByAirtableId(record.id);
    return NextResponse.json({ ok: true, action: "deleted", airtableId: record.id });
  }

  /* ── 이미지 업로드 (SSRF 방지 포함) ── */
  const uploadedImages: string[] = [];
  for (const img of record.images ?? []) {
    try {
      uploadedImages.push(await uploadImageToStorage(img.url, img.filename));
    } catch (e) {
      console.error("[webhook] Image upload failed:", e instanceof Error ? e.message : e);
    }
  }

  const rawCategory = record.category ?? "팝업북";
  const category = (CATEGORIES as readonly string[]).includes(rawCategory)
    ? (rawCategory as PortfolioItem["category"])
    : "팝업북";

  const now = new Date().toISOString();
  const existing = await getItemByAirtableId(record.id);

  const item: PortfolioItem = {
    id:          existing?.id ?? randomUUID(),
    airtableId:  record.id,
    title:       record.title       ?? existing?.title       ?? "",
    category,
    description: record.description ?? existing?.description ?? "",
    client:      record.client      ?? existing?.client      ?? "",
    images:      uploadedImages.length > 0 ? uploadedImages : (existing?.images ?? []),
    published:   record.published   ?? existing?.published   ?? false,
    createdAt:   existing?.createdAt ?? now,
    updatedAt:   now,
  };

  await saveItem(item);
  return NextResponse.json({ ok: true, action, airtableId: record.id });
}
