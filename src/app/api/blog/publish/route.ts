import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { savePost, deletePost, generateSlug } from "@/lib/blog";
import type { Post } from "@/lib/blog";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { randomUUID } from "crypto";

/**
 * 시크릿 헤더 인증 블로그 발행 웹훅 (Slack 봇/에이전트 → 1클릭 발행용).
 *
 * - 관리자 NextAuth 세션 대신 `x-webhook-secret` 헤더로 인증한다
 *   (/api/portfolio/sync 의 AIRTABLE_WEBHOOK_SECRET 과 동일한 패턴).
 * - Supabase service role 키는 Vercel 환경변수에만 두고, 여기서 supabaseAdmin 경유로만 사용.
 *   외부(미니)에는 BLOG_PUBLISH_SECRET 공유 시크릿만 보유 → 키 확산 없음.
 *
 * POST          : 글 생성·발행 (coverImageBase64 주면 uploads 버킷에 올려 cover 로 사용).
 * DELETE ?id=.. : 글 삭제 (발행 테스트 정리 / 게시 철회용).
 */
const PUBLISH_SECRET = process.env.BLOG_PUBLISH_SECRET;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.papercraft.kr";

function authorized(request: Request): boolean {
  return !!PUBLISH_SECRET && request.headers.get("x-webhook-secret") === PUBLISH_SECRET;
}

async function uploadCover(base64: string, filename: string): Promise<string | null> {
  try {
    const buffer = Buffer.from(base64, "base64");
    const ext = filename.match(/\.[a-z0-9]+$/i)?.[0] ?? ".png";
    const name = `blog_${randomUUID()}${ext}`;
    const { error } = await supabaseAdmin.storage
      .from("uploads")
      .upload(name, buffer, { contentType: "image/png", cacheControl: "31536000" });
    if (error) return null;
    const { data } = supabaseAdmin.storage.from("uploads").getPublicUrl(name);
    return data.publicUrl;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!PUBLISH_SECRET) {
    return NextResponse.json({ error: "Publish endpoint not configured" }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content : "";
  if (!title || !content) {
    return NextResponse.json({ error: "title and content are required" }, { status: 400 });
  }

  let coverImage =
    typeof body.coverImage === "string" && body.coverImage ? body.coverImage : undefined;
  if (typeof body.coverImageBase64 === "string" && body.coverImageBase64) {
    const url = await uploadCover(
      body.coverImageBase64,
      typeof body.coverImageFilename === "string" ? body.coverImageFilename : "cover.png"
    );
    if (url) coverImage = url;
  }

  const now = new Date().toISOString();
  const createdAt =
    typeof body.createdAt === "string" && !Number.isNaN(Date.parse(body.createdAt))
      ? body.createdAt
      : now;

  const post: Post = {
    id: randomUUID(),
    slug: generateSlug(title),
    title,
    excerpt: typeof body.excerpt === "string" ? body.excerpt : "",
    content,
    tag: typeof body.tag === "string" ? body.tag : "",
    emoji: typeof body.emoji === "string" && body.emoji ? body.emoji : "📝",
    coverImage,
    published: body.published === false ? false : true,
    createdAt,
    updatedAt: now,
  };

  await savePost(post);
  revalidatePath("/blog");
  revalidatePath(`/blog/${post.slug}`);

  return NextResponse.json(
    {
      ok: true,
      id: post.id,
      slug: post.slug,
      url: `${SITE_URL}/blog/${post.slug}`,
      published: post.published,
    },
    { status: 201 }
  );
}

export async function DELETE(request: Request) {
  if (!PUBLISH_SECRET) {
    return NextResponse.json({ error: "Publish endpoint not configured" }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id query param required" }, { status: 400 });
  }
  await deletePost(id);
  revalidatePath("/blog");
  return NextResponse.json({ ok: true, deleted: id });
}
