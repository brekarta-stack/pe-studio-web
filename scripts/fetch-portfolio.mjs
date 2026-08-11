/**
 * 포트폴리오 전체 항목을 Supabase에서 읽어 JSON으로 덤프한다.
 * env는 메인 저장소의 .env.local에서 로드 (비밀값은 출력하지 않음).
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/Users/seakimacultra/orca/workspaces/pe-studio-web/SEO-GUI/package.json");
const { createClient } = require("@supabase/supabase-js");

const ENV_FILE = process.env.ENV_FILE ?? new URL("../.env.local", import.meta.url).pathname;
if (existsSync(ENV_FILE)) {
  for (const raw of readFileSync(ENV_FILE, "utf-8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 누락");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supabase
  .from("portfolio_items")
  .select("id, slug, title, summary, category, description, client, client_type, tags, keywords, images, image_alts, published, produced_at")
  .order("created_at", { ascending: false });

if (error) {
  console.error("조회 실패:", error.message);
  process.exit(1);
}

const out = process.argv[2] ?? "portfolio-dump.json";
writeFileSync(out, JSON.stringify(data, null, 2));
console.log(`총 ${data.length}건 저장 → ${out}`);
for (const item of data) {
  console.log(`- [${item.published ? "공개" : "비공개"}] ${item.title} (images: ${item.images?.length ?? 0})`);
}
