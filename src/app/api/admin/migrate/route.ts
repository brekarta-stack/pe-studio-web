import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { readFileSync } from "fs";
import path from "path";

/**
 * 마이그레이션 실행 API — 어드민 > DB 셋업의 "마이그레이션 실행" 버튼이 호출한다.
 *
 * 왜 별도 API 가 필요한가:
 * supabase-js(PostgREST)로는 CREATE TABLE / ALTER TABLE 같은 DDL 을 실행할 수 없다.
 * 임의 SQL 을 돌리려면 Supabase Management API 를 써야 하고, 여기에는
 * 프로젝트 키가 아니라 계정 단위의 Personal Access Token 이 필요하다.
 *
 * 필요한 환경변수:
 *  - SUPABASE_ACCESS_TOKEN  : Supabase Dashboard > Account > Access Tokens 에서 발급
 *  - SUPABASE_PROJECT_REF   : 생략 가능. 없으면 SUPABASE_URL 서브도메인에서 추출한다.
 *
 * 토큰이 없으면 501 을 돌려주고, 화면은 기존처럼 SQL 복사·붙여넣기 안내로 폴백한다.
 */

/**
 * 실행 허용 목록 — supabase/ 기준 상대경로. 임의 경로를 읽지 못하게 화이트리스트로 제한한다.
 *
 * 경로를 supabase/ 아래로 고정하는 것은 보안뿐 아니라 번들 트레이싱 때문이기도 하다.
 * process.cwd() 를 그대로 join 하면 Next 가 프로젝트 전체를 배포에 끌고 들어간다.
 */
const ALLOWED_FILES = new Set([
  "schema.sql",
  "migrations/20260607_artists.sql",
  "migrations/20260707_studio_reviews.sql",
  "migrations/20260728_quote_pipeline.sql",
  "migrations/20260729_quote_dropped.sql",
]);

const SQL_DIR = "supabase";

/** SUPABASE_URL(https://<ref>.supabase.co) 에서 프로젝트 ref 추출 */
function projectRef(): string | null {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  const url = process.env.SUPABASE_URL;
  if (!url) return null;
  const m = /^https?:\/\/([a-z0-9-]+)\.supabase\./i.exec(url);
  return m?.[1] ?? null;
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 401 });
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = projectRef();

  if (!token || !ref) {
    return NextResponse.json(
      {
        error:
          "자동 실행이 설정되지 않았습니다. SUPABASE_ACCESS_TOKEN 을 환경변수에 추가하거나, 아래 SQL 을 Supabase SQL Editor 에 붙여넣어 실행하세요.",
      },
      { status: 501 }
    );
  }

  let files: string[];
  try {
    const body = (await req.json()) as { files?: unknown };
    files = Array.isArray(body.files) ? body.files.filter((f): f is string => typeof f === "string") : [];
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  if (files.length === 0) {
    return NextResponse.json({ error: "실행할 마이그레이션이 없습니다." }, { status: 400 });
  }

  const invalid = files.filter((f) => !ALLOWED_FILES.has(f));
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `허용되지 않은 파일입니다: ${invalid.join(", ")}` },
      { status: 400 }
    );
  }

  const results: { file: string; ok: boolean; error?: string }[] = [];

  for (const file of files) {
    let sql: string;
    try {
      sql = readFileSync(path.join(process.cwd(), SQL_DIR, file), "utf-8");
    } catch {
      results.push({ file, ok: false, error: "파일을 읽을 수 없습니다." });
      continue;
    }

    try {
      const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      });

      if (!res.ok) {
        const text = await res.text();
        results.push({ file, ok: false, error: `${res.status} ${text.slice(0, 300)}` });
      } else {
        results.push({ file, ok: true });
      }
    } catch (e) {
      results.push({ file, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const allOk = results.every((r) => r.ok);
  return NextResponse.json({ ok: allOk, results }, { status: allOk ? 200 : 500 });
}
