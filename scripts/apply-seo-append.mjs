/**
 * SEO/GEO 보강 문구 일괄 적용기 (로컬 CLI)
 *
 *   node scripts/apply-seo-append.mjs           # 드라이런 — 무엇이 바뀌는지 출력만
 *   node scripts/apply-seo-append.mjs --apply   # 실제 DB 반영
 *
 * data/seo-append-updates.json 의 각 항목(summary/description 완성본)을
 * portfolio_items 에 반영한다. 원본 백업은 data/portfolio-dump.json.
 *
 * 상세 페이지는 revalidate = 300 (ISR) 이므로 반영 후 최대 5분 내 자동 갱신,
 * 목록/메인은 force-dynamic 이라 즉시 반영된다.
 *
 * 필요한 값 (.env.local): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

// .env.local → process.env (run-migration.mjs 와 같은 방식)
for (const file of [".env.production.local", ".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const raw of readFileSync(file, "utf-8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

const apply = process.argv.includes("--apply");
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (apply && (!url || !key)) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다 (.env.local).");
  process.exit(1);
}

const updates = JSON.parse(readFileSync("data/seo-append-updates.json", "utf-8"));
const supabase = apply
  ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

let ok = 0;
let fail = 0;
for (const u of updates) {
  if (!apply) {
    console.log(`[dry-run] ${u.title} — summary ${u.summary.length}자, description ${u.description.length}자`);
    ok++;
    continue;
  }
  const { error } = await supabase
    .from("portfolio_items")
    .update({
      summary: u.summary,
      description: u.description,
      updated_at: new Date().toISOString(),
    })
    .eq("id", u.id);
  if (error) {
    fail++;
    console.error(`실패: ${u.title} — ${error.message}`);
  } else {
    ok++;
    console.log(`반영: ${u.title}`);
  }
}

console.log(`\n${apply ? "반영" : "드라이런"} 완료 — 성공 ${ok}건, 실패 ${fail}건 / 전체 ${updates.length}건`);
if (!apply) console.log("실제 반영은 --apply 옵션을 붙여 실행하세요.");
