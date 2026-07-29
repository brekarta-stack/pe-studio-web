/**
 * 마이그레이션 실행기 (로컬 CLI)
 *
 *   node run-migration.mjs supabase/migrations/20260802_artist_portal.sql
 *   node run-migration.mjs --check          # 적용 상태만 확인
 *
 * 어드민 화면의 "마이그레이션 실행" 버튼(/api/admin/migrate)과 같은 일을
 * 터미널에서 한다. 배포 전에 스키마만 먼저 올려야 할 때 쓴다 —
 * 어드민 버튼은 새 코드가 배포된 뒤에야 새 파일을 알아보기 때문.
 *
 * supabase-js(PostgREST)로는 CREATE TABLE 같은 DDL 을 실행할 수 없어
 * Supabase Management API 를 쓴다. 여기에는 프로젝트 키가 아니라
 * 계정 단위의 Personal Access Token 이 필요하다.
 *
 * 필요한 값 (.env.local 또는 환경변수):
 *   SUPABASE_ACCESS_TOKEN  Supabase Dashboard > Account > Access Tokens 에서 발급
 *   SUPABASE_URL           https://<ref>.supabase.co  (또는 SUPABASE_PROJECT_REF 직접 지정)
 */

import { readFileSync, existsSync } from "node:fs";

/** .env.local → process.env (이미 설정된 값은 덮어쓰지 않는다) */
function loadEnvLocal() {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, "utf-8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      // 값의 따옴표는 벗긴다 — .env 관행
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

/** SUPABASE_URL(https://<ref>.supabase.co) 에서 프로젝트 ref 추출 */
function projectRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  const url = process.env.SUPABASE_URL ?? "";
  return /^https?:\/\/([a-z0-9-]+)\.supabase\./i.exec(url)?.[1] ?? null;
}

async function runSql(ref, token, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 500)}`);
  return text;
}

/** 적용 여부 확인 — 이 마이그레이션이 만드는 것들이 실제로 있는지 본다 */
const CHECK_SQL = `
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name='artist_accounts')            AS artist_accounts,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='assignments'
      AND column_name='offer_status')                                        AS offer_status,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='assignments'
      AND column_name='deliverables')                                        AS deliverables;
`;

async function main() {
  loadEnvLocal();

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = projectRef();

  if (!token || !ref) {
    console.error("✖ 자격 증명이 없습니다.\n");
    console.error("  .env.local 에 아래 두 줄을 넣고 다시 실행하세요:\n");
    console.error("    SUPABASE_ACCESS_TOKEN=sbp_...");
    console.error("    SUPABASE_URL=https://<프로젝트ref>.supabase.co\n");
    console.error("  토큰 발급: https://supabase.com/dashboard/account/tokens");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const files = args.filter((a) => !a.startsWith("--"));

  console.log(`프로젝트: ${ref}\n`);

  if (!checkOnly) {
    if (files.length === 0) {
      console.error("✖ 실행할 .sql 파일을 인자로 주세요.");
      process.exit(1);
    }
    for (const file of files) {
      const sql = readFileSync(file, "utf-8");
      process.stdout.write(`▸ ${file} … `);
      try {
        await runSql(ref, token, sql);
        console.log("완료");
      } catch (e) {
        console.log("실패");
        console.error(`  ${e.message}`);
        process.exit(1);
      }
    }
    console.log("");
  }

  // 실행 후(또는 --check) 실제 반영 상태를 눈으로 확인한다
  const result = JSON.parse(await runSql(ref, token, CHECK_SQL));
  const row = Array.isArray(result) ? result[0] : result;
  const mark = (n) => (Number(n) > 0 ? "✅" : "❌");

  console.log("적용 상태");
  console.log(`  ${mark(row.artist_accounts)} artist_accounts 테이블`);
  console.log(`  ${mark(row.offer_status)} assignments.offer_status`);
  console.log(`  ${mark(row.deliverables)} assignments.deliverables`);

  const allOk =
    Number(row.artist_accounts) > 0 &&
    Number(row.offer_status) > 0 &&
    Number(row.deliverables) > 0;
  if (!allOk) process.exit(1);
}

main().catch((e) => {
  console.error(`✖ ${e.message}`);
  process.exit(1);
});
