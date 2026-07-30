import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getItems, saveItem, ensureUniqueSlug } from "@/lib/portfolio";
import type { PortfolioItem } from "@/lib/portfolio";
import { deriveSlug, slugify } from "@/lib/portfolio-meta";
import { randomUUID } from "crypto";
import { requireAdminApi, isAdminSession } from "@/lib/session";

export async function GET() {
  const isAdmin = await isAdminSession();
  const items = await getItems();
  const visible = isAdmin ? items : items.filter((i) => i.published);
  return NextResponse.json(visible);
}

export async function POST(request: Request) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  const body = await request.json();
  const now = new Date().toISOString();
  const id = randomUUID();

  // slug 자동 생성 (명시된 값 우선) + 유니크 보장 (기존 항목과 겹치면 접미사)
  const requestedSlug = typeof body.slug === "string" ? slugify(body.slug) : "";
  const baseSlug =
    requestedSlug ||
    deriveSlug({ id, slug: "", client: body.client ?? "", title: body.title ?? "" });
  const slug = await ensureUniqueSlug(baseSlug, id);

  const newItem: PortfolioItem = {
    id,
    airtableId: body.airtableId,
    slug,
    title: body.title ?? "",
    summary: typeof body.summary === "string" ? body.summary : undefined,
    category: body.category ?? "팝업북",
    description: body.description ?? "",
    client: body.client ?? "",
    clientType: typeof body.clientType === "string" ? body.clientType : undefined,
    tags: Array.isArray(body.tags)
      ? body.tags.filter((t: unknown): t is string => typeof t === "string")
      : [],
    keywords: Array.isArray(body.keywords)
      ? body.keywords.filter((k: unknown): k is string => typeof k === "string")
      : [],
    images: body.images ?? [],
    imageAlts: Array.isArray(body.imageAlts) ? body.imageAlts : [],
    published: body.published ?? false,
    featured: body.featured ?? false,
    producedAt: typeof body.producedAt === "string" ? body.producedAt : undefined,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await saveItem(newItem);
  } catch (e) {
    console.error("[api/portfolio POST] save error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "저장 실패" },
      { status: 500 },
    );
  }

  // 발행된 사례면 메인·포트폴리오·상세 페이지 즉시 갱신
  if (newItem.published) {
    revalidatePath("/");
    revalidatePath("/portfolio");
    revalidatePath(`/portfolio/${newItem.slug}`);
  }

  return NextResponse.json(newItem, { status: 201 });
}
