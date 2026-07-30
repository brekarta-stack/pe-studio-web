import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getItemById, saveItem, deleteItem, ensureUniqueSlug } from "@/lib/portfolio";
import { slugify } from "@/lib/portfolio-meta";
import { requireAdminApi, isAdminSession } from "@/lib/session";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const isAdmin = await isAdminSession();
  const { id } = await params;
  const item = await getItemById(id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // 비공개 아이템은 어드민만 접근 가능
  if (!item.published && !isAdmin) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(item);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  const { id } = await params;
  const item = await getItemById(id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  // slug 가 들어오면 slugify, 빈 문자열이면 기존 slug 유지. 다른 항목과 겹치면 접미사로 유니크 보장.
  const slugBase =
    typeof body.slug === "string" && body.slug.trim() ? slugify(body.slug) : (item.slug ?? "");
  const slug = slugBase ? await ensureUniqueSlug(slugBase, id) : item.slug;
  const updated = { ...item, ...body, id, slug, updatedAt: new Date().toISOString() };
  try {
    await saveItem(updated);
  } catch (e) {
    console.error("[api/portfolio PUT] save error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "저장 실패" },
      { status: 500 },
    );
  }

  // 변경 즉시 메인·포트폴리오·상세 페이지 갱신
  revalidatePath("/");
  revalidatePath("/portfolio");
  if (item.slug) revalidatePath(`/portfolio/${item.slug}`);
  if (updated.slug && updated.slug !== item.slug) revalidatePath(`/portfolio/${updated.slug}`);

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  const { id } = await params;
  const item = await getItemById(id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await deleteItem(id);

  revalidatePath("/");
  revalidatePath("/portfolio");
  if (item.slug) revalidatePath(`/portfolio/${item.slug}`);

  return NextResponse.json({ ok: true });
}
