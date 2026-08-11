import { supabaseAdmin } from "./supabase-admin";
import { SEED_POSTS } from "./blog-seed";

export interface Post {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  tag: string;
  emoji: string;
  coverImage?: string;
  published: boolean;
  /** 자동 발행 대기열 — true 인 비공개 글을 주간 크론이 순서대로 발행 */
  queued?: boolean;
  /** 자동 발행된 시각 — 주 1회 발행 가드에 사용 */
  autoPublishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPost(row: any): Post {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    content: row.content,
    tag: row.tag,
    emoji: row.emoji,
    coverImage: row.cover_image ?? undefined,
    published: row.published,
    queued: row.queued ?? false,
    autoPublishedAt: row.auto_published_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Supabase 의 DB 글과 코드 내장 SEED_POSTS 를 머지.
 * - 동일 slug 가 DB 에 있으면 DB 가 우선 (운영자가 admin 에서 시드 글을 덮어쓸 수 있도록)
 * - DB 가 비어있거나 연결 실패 시에도 SEED 글은 항상 보임 (SEO 색인 보호)
 * - 최신순 정렬
 */
function mergePosts(dbPosts: Post[]): Post[] {
  const dbSlugs = new Set(dbPosts.map((p) => p.slug));
  const seedFiltered = SEED_POSTS.filter((p) => !dbSlugs.has(p.slug));
  const merged = [...dbPosts, ...seedFiltered];
  return merged.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function getPosts(): Promise<Post[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("posts")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return mergePosts((data ?? []).map(toPost));
  } catch {
    // DB 연결/권한 실패 시에도 seed 만이라도 노출
    return mergePosts([]);
  }
}

export async function getPostById(id: string): Promise<Post | undefined> {
  try {
    const { data } = await supabaseAdmin.from("posts").select("*").eq("id", id).maybeSingle();
    if (data) return toPost(data);
  } catch {
    /* fall through to seed */
  }
  return SEED_POSTS.find((p) => p.id === id);
}

export async function getPostBySlug(slug: string): Promise<Post | undefined> {
  try {
    const { data } = await supabaseAdmin
      .from("posts")
      .select("*")
      .eq("slug", slug)
      .eq("published", true)
      .maybeSingle();
    if (data) return toPost(data);
  } catch {
    /* fall through to seed */
  }
  const seed = SEED_POSTS.find((p) => p.slug === slug && p.published);
  return seed;
}

export async function savePost(post: Post): Promise<void> {
  const { error } = await supabaseAdmin.from("posts").upsert({
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    content: post.content,
    tag: post.tag,
    emoji: post.emoji,
    cover_image: post.coverImage ?? null,
    published: post.published,
    queued: post.queued ?? false,
    auto_published_at: post.autoPublishedAt ?? null,
    created_at: post.createdAt,
    updated_at: post.updatedAt,
  });
  if (error) throw error;
}

export async function deletePost(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from("posts").delete().eq("id", id);
  if (error) throw error;
}

export function generateSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^\w\s가-힣]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 80) || "post"
  );
}
