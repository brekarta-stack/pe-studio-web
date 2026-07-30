/**
 * 일회성 마이그레이션 endpoint — 모든 블로그 글의 content 를
 * 깨끗한 HTML 로 정규화해 DB 에 저장.
 *
 * 기존 시드 콘텐츠가 마크다운/HTML 혼합 + 한 줄 안에 ##/** 가 흩어진
 * 형태라 TipTap WYSIWYG 에서 plain text 로 노출되던 문제를 해결.
 *
 * 사용:
 *   POST /api/blog/normalize         → dry-run (변환 결과만 반환, DB 미저장)
 *   POST /api/blog/normalize?save=1  → 실제 DB 저장
 *
 * 인증 필요 (admin 로그인 세션).
 */

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getPosts, savePost } from "@/lib/blog";
import { marked } from "marked";
import { requireAdminApi } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * 원본 콘텐츠 전처리 — marked 가 헤딩으로 인식하도록 정규화.
 *
 * 시드 글의 흔한 패턴:
 *   "본문 끝났습니다. ## 1. 새 헤딩 텍스트... ## 2. 또 다른 헤딩..."
 *
 * 위처럼 한 줄 안에 ## 가 여러 개 있으면 marked 가 헤딩으로 인식 못 함.
 * 줄 시작에 오도록 빈 줄로 분리.
 */
function preprocessMarkdown(raw: string): string {
  let s = raw;
  // 1) 줄 시작 leading whitespace + #+ 정리 ("  ##" → "##")
  s = s.replace(/^[ \t]+(#{1,6}\s)/gm, "$1");
  // 2) 줄 중간의 ## 헤딩을 빈 줄로 분리
  //    "글자.  ## 1." 또는 "글자 ## 1." → "글자.\n\n## 1."
  s = s.replace(/([^\n])\s+(#{1,6}\s+)/g, "$1\n\n$2");
  // 3) 3개 이상의 연속 줄바꿈 → 2개로 정규화
  s = s.replace(/\n{3,}/g, "\n\n");
  return s;
}

/** 정규화: 전처리 → marked.parse → 깨끗한 HTML */
function normalizeToHtml(raw: string): string {
  if (!raw) return "";
  try {
    const pre = preprocessMarkdown(raw);
    const html = marked.parse(pre, { async: false, gfm: true, breaks: false }) as string;
    return html || raw;
  } catch {
    return raw;
  }
}

export async function POST(req: Request) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  const url = new URL(req.url);
  const save = url.searchParams.get("save") === "1";

  const posts = await getPosts();
  const results: Array<{
    id: string;
    slug: string;
    title: string;
    before_len: number;
    after_len: number;
    changed: boolean;
    sample_before?: string;
    sample_after?: string;
    saved?: boolean;
  }> = [];

  for (const p of posts) {
    if (!p.content) continue;
    const next = normalizeToHtml(p.content);
    const changed = next !== p.content;
    const r: typeof results[number] = {
      id: p.id,
      slug: p.slug,
      title: p.title,
      before_len: p.content.length,
      after_len: next.length,
      changed,
      sample_before: p.content.slice(0, 200),
      sample_after: next.slice(0, 200),
    };
    if (save && changed) {
      await savePost({ ...p, content: next, updatedAt: p.updatedAt });
      r.saved = true;
    }
    results.push(r);
  }

  // 저장 시 캐시 무효화
  if (save) {
    revalidatePath("/");
    revalidatePath("/blog");
    for (const r of results) {
      if (r.saved) revalidatePath(`/blog/${r.slug}`);
    }
  }

  return NextResponse.json({
    mode: save ? "saved" : "dry-run",
    total: results.length,
    changed: results.filter((r) => r.changed).length,
    saved: results.filter((r) => r.saved).length,
    results,
  });
}
