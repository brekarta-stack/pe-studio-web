import { NextResponse } from "next/server";
import { getPostById, savePost, deletePost } from "@/lib/blog";
import { requireAdminApi, isAdminSession } from "@/lib/session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const isAdmin = await isAdminSession();
  const { id } = await params;
  const post = await getPostById(id);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // 비공개 글은 어드민만 접근 가능
  if (!post.published && !isAdmin) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(post);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  const { id } = await params;
  const post = await getPostById(id);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  const updated = { ...post, ...body, id, updatedAt: new Date().toISOString() };
  await savePost(updated);
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  const { id } = await params;
  const post = await getPostById(id);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await deletePost(id);
  return NextResponse.json({ ok: true });
}
