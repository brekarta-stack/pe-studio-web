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

/** 목록용 글 — 본문(content)을 뺀 것. 본문이 전체 전송량의 대부분이다 */
export type PostSummary = Omit<Post, "content">;

/** 본문을 뺀 칸만 — PostgREST select 문자열 */
const SUMMARY_COLUMNS =
  "id, slug, title, excerpt, tag, emoji, cover_image, published, created_at, updated_at";

function toSummary(p: Post): PostSummary {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { content: _content, ...rest } = p;
  return rest;
}

/**
 * 글 목록 — 본문 없이. 블로그 목록·글 하단 "다른 글"·사이트맵·RSS·llms.txt 가 쓴다.
 *
 * 예전에는 이 자리마다 getPosts()(본문 포함 전체)를 불렀다. 글 페이지는 5분마다 다시 그려지고
 * 페이지마다 모든 글의 본문을 받아 갔다 — Supabase 전송량과 /blog 페이지 크기(본문이 클라이언트
 * 목록 컴포넌트로 통째로 넘어갔다)를 함께 키웠다. (2026-09-22 무료 한도 초과 뒤 정리)
 */
export async function getPostSummaries(): Promise<PostSummary[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("posts")
      .select(SUMMARY_COLUMNS)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return mergePosts((data ?? []).map((r) => toPost({ ...r, content: "" }))).map(toSummary);
  } catch {
    return mergePosts([]).map(toSummary);
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

/** PostgREST 가 "그런 컬럼 없다"고 답했는지 — 스키마 캐시 오류 코드/문구로 판별 */
function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST204" ||
    !!error.message?.includes("schema cache") ||
    !!error.message?.includes("does not exist")
  );
}

export async function savePost(post: Post): Promise<void> {
  const base = {
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    content: post.content,
    tag: post.tag,
    emoji: post.emoji,
    cover_image: post.coverImage ?? null,
    published: post.published,
    created_at: post.createdAt,
    updated_at: post.updatedAt,
  };

  const { error } = await supabaseAdmin.from("posts").upsert({
    ...base,
    queued: post.queued ?? false,
    auto_published_at: post.autoPublishedAt ?? null,
  });
  if (!error) return;

  // 20260808_blog_scheduling 마이그레이션 전이면 예약 컬럼이 없다.
  // 이 코드는 마이그레이션보다 먼저 배포되므로, 그 사이에도 글 저장은 계속 되어야 한다.
  if (isMissingColumnError(error)) {
    const { error: retryError } = await supabaseAdmin.from("posts").upsert(base);
    if (retryError) throw retryError;
    return;
  }
  throw error;
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
