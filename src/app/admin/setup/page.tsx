"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import Link from "next/link";
import { readFileSync } from "fs";
import path from "path";
import MigrateButton from "@/components/admin/MigrateButton";

const TABLES = [
  "portfolio_items",
  "posts",
  "quotes",
  "analytics_events",
  "studio_reviews",
  "artists",
  "assignments",
] as const;

type TableName = (typeof TABLES)[number];

// studio_reviews 는 id 컬럼이 없고 skey 가 PK → 테이블별 존재 확인용 컬럼 매핑
const PROBE_COL: Record<string, string> = { studio_reviews: "skey" };

/**
 * 테이블 → 그 테이블을 만드는 SQL 파일 (supabase/ 기준 상대경로).
 * 누락된 것만 골라 실행하므로, 이미 있는 테이블의 SQL 을 다시 돌리지 않는다.
 * (모든 구문이 IF NOT EXISTS 라 재실행 자체는 안전하다)
 *
 * 경로를 supabase/ 아래로 고정하는 이유는 /api/admin/migrate 와 같다 —
 * process.cwd() 를 그대로 join 하면 Next 가 프로젝트 전체를 트레이싱한다.
 */
const SQL_DIR = "supabase";

const TABLE_SQL: Record<TableName, string> = {
  portfolio_items:  "schema.sql",
  posts:            "schema.sql",
  quotes:           "schema.sql",
  analytics_events: "schema.sql",
  studio_reviews:   "migrations/20260707_studio_reviews.sql",
  artists:          "migrations/20260607_artists.sql",
  assignments:      "migrations/20260728_quote_pipeline.sql",
};

/** 테이블은 있는데 나중에 추가된 컬럼만 없는 경우 — 컬럼 단위로도 확인한다 */
const COLUMN_CHECKS: { table: TableName; column: string; sql: string; note: string }[] = [
  {
    table: "quotes",
    column: "in_progress",
    sql: "migrations/20260728_quote_pipeline.sql",
    note: "quotes.in_progress / quotes.stage (진행 여부·단계)",
  },
  {
    table: "quotes",
    column: "dropped_at",
    sql: "migrations/20260729_quote_dropped.sql",
    note: "quotes.dropped_at (Drop 제외 처리)",
  },
];

async function checkTable(name: string): Promise<"ok" | "missing" | "error"> {
  try {
    const { error } = await supabaseAdmin.from(name).select(PROBE_COL[name] ?? "id").limit(1);
    if (!error) return "ok";
    // PostgREST "relation does not exist" 류 오류
    if (
      error.message.includes("does not exist") ||
      error.message.includes("schema cache") ||
      error.code === "PGRST204" ||
      error.code === "PGRST205" ||
      error.code === "42P01"
    )
      return "missing";
    return "error";
  } catch {
    return "error";
  }
}

/**
 * 자동 실행 가능 여부 — /api/admin/migrate 와 같은 조건을 본다.
 * 여기서 미리 알아야 눌러도 안 되는 버튼을 활성 상태로 두지 않는다.
 */
function canAutoRunMigration(): boolean {
  if (!process.env.SUPABASE_ACCESS_TOKEN) return false;
  if (process.env.SUPABASE_PROJECT_REF) return true;
  const url = process.env.SUPABASE_URL;
  return !!url && /^https?:\/\/([a-z0-9-]+)\.supabase\./i.test(url);
}

/** 컬럼 존재 확인 — 테이블이 없으면 판단 불가(null) */
async function checkColumn(table: string, column: string): Promise<boolean | null> {
  try {
    const { error } = await supabaseAdmin.from(table).select(column).limit(1);
    if (!error) return true;
    if (error.message.includes("does not exist") || error.message.includes("schema cache")) return false;
    return null;
  } catch {
    return null;
  }
}

export default async function SetupPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/admin/login");

  const results = await Promise.all(
    TABLES.map(async (t) => ({ name: t, status: await checkTable(t) }))
  );

  const statusOf = new Map(results.map((r) => [r.name, r.status]));
  const missing = results.filter((r) => r.status === "missing").map((r) => r.name);

  // 테이블은 있는데 컬럼만 없는 경우도 "적용 필요"로 잡는다
  const missingColumns: typeof COLUMN_CHECKS = [];
  for (const c of COLUMN_CHECKS) {
    if (statusOf.get(c.table) !== "ok") continue;
    if ((await checkColumn(c.table, c.column)) === false) missingColumns.push(c);
  }

  const allOk = missing.length === 0 && missingColumns.length === 0 &&
    results.every((r) => r.status === "ok");

  /* 실행해야 할 SQL 파일 (중복 제거, 정의 순서 유지) */
  const files = [
    ...new Set([
      ...missing.map((n) => TABLE_SQL[n]),
      ...missingColumns.map((c) => c.sql),
    ]),
  ];

  const sqlByFile = files.map((f) => {
    try {
      return { file: f, sql: readFileSync(path.join(process.cwd(), SQL_DIR, f), "utf-8") };
    } catch {
      return { file: f, sql: `-- ${SQL_DIR}/${f} 파일을 읽을 수 없습니다.` };
    }
  });
  const combinedSql = sqlByFile
    .map((s) => `-- ═══ ${SQL_DIR}/${s.file} ═══\n${s.sql}`)
    .join("\n\n");

  const statusLabel = (s: string) => {
    if (s === "ok")      return { text: "✅ 정상", cls: "text-green-600 bg-green-50 border-green-200" };
    if (s === "missing") return { text: "❌ 없음", cls: "text-red-600 bg-red-50 border-red-200" };
    return               { text: "⚠️ 오류",  cls: "text-amber-600 bg-amber-50 border-amber-200" };
  };

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">DB 셋업</h1>
        <p className="text-slate-500 text-sm mt-0.5">Supabase 테이블 상태 확인</p>
      </div>

      {/* 테이블 상태 */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
        <h2 className="font-bold text-slate-900 mb-4">테이블 상태</h2>
        <div className="space-y-3">
          {results.map(({ name, status }) => {
            const lbl = statusLabel(status);
            return (
              <div key={name} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                <code className="text-sm font-mono text-slate-700">{name}</code>
                <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${lbl.cls}`}>
                  {lbl.text}
                </span>
              </div>
            );
          })}
        </div>

        {missingColumns.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            테이블은 있지만 아래 컬럼이 없습니다 — 마이그레이션이 필요합니다.
            <ul className="mt-1 ml-4 list-disc text-xs">
              {missingColumns.map((c) => (
                <li key={`${c.table}.${c.column}`}><code className="font-mono">{c.note}</code></li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {allOk ? (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center">
          <p className="text-2xl mb-2">🎉</p>
          <p className="font-bold text-green-800">모든 테이블이 정상입니다!</p>
          <Link href="/admin" className="inline-block mt-4 text-sm text-green-700 underline">
            어드민으로 돌아가기
          </Link>
        </div>
      ) : (
        <>
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6">
            <p className="font-bold text-amber-800 mb-1">적용이 필요한 마이그레이션</p>
            <ul className="text-sm text-amber-700 ml-4 list-disc space-y-0.5">
              {sqlByFile.map((s) => (
                <li key={s.file}><code className="font-mono text-xs">{SQL_DIR}/{s.file}</code></li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-amber-700">
              모든 구문이 <code className="font-mono text-xs">IF NOT EXISTS</code> 라 여러 번 실행해도 안전합니다.
            </p>
          </div>

          <MigrateButton files={files} sql={combinedSql} canAutoRun={canAutoRunMigration()} />

          {/* SQL 코드 블록 */}
          <div className="bg-slate-900 rounded-2xl overflow-hidden mb-6">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
              <span className="text-xs text-slate-400 font-mono">
                {sqlByFile.map((s) => `${SQL_DIR}/${s.file}`).join(", ")}
              </span>
              <span className="text-xs text-slate-500">복사하여 Supabase SQL Editor에 붙여넣기</span>
            </div>
            <pre className="p-4 text-xs text-green-300 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-[32rem]">
              {combinedSql}
            </pre>
          </div>

          {/* Supabase 링크 */}
          <a
            href="https://supabase.com/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-center py-3.5 rounded-xl font-bold text-white transition-opacity hover:opacity-90"
            style={{ background: "linear-gradient(135deg, #3ECF8E, #1B7F4F)" }}
          >
            Supabase SQL Editor 열기 →
          </a>

          <p className="text-xs text-slate-400 text-center mt-4">
            실행 후 이 페이지를 새로고침하면 상태가 업데이트됩니다.
          </p>
        </>
      )}
    </div>
  );
}
