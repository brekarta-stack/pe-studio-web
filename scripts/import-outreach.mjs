#!/usr/bin/env node
/**
 * 발굴 리드 일괄 이관 — 배포된 앱의 인테이크 API 로 청크 전송 (Node >= 22, 의존성 없음)
 *
 *   OUTREACH_INTAKE_TOKEN=… node scripts/import-outreach.mjs <payload.json> \
 *       [--base https://www.papercraft.kr] [--dry-run] [--chunk 50]
 *
 * 왜 API 를 거치나: 로컬에는 Supabase 자격증명이 없다(Vercel 환경변수가 Sensitive).
 * payload.json = { "leads": [ IntakeLead, … ] } — 모양은 docs/outreach-intake.md.
 *
 * 청크는 **순서대로** 보낸다. 서버가 청크마다 기존 행을 다시 읽으므로, 앞 청크에서 만든 기관에
 * 뒤 청크의 초안이 merge 로 붙는다. 다만 기관 안의 시간순(첫 초안이 행이 됨)은 청크 안에서만
 * 보장되니, 이관 전에 payload 를 createdAt 오름차순으로 정렬해 둔다(이 스크립트가 해 준다).
 *
 * 토큰은 절대 출력하지 않는다.
 */
import { readFileSync } from "node:fs";

/* src/lib/site.ts SITE_URL 과 같은 값 — 맨도메인은 www 로 리다이렉트되며 POST 헤더가 빠질 수 있다 */
const DEFAULT_BASE = process.env.INTAKE_BASE_URL ?? "https://www.papercraft.kr";
const MAX_CHUNK = 200; // 서버 상한

function usage(msg) {
  if (msg) console.error(`오류: ${msg}\n`);
  console.error(
    "사용법: OUTREACH_INTAKE_TOKEN=… node scripts/import-outreach.mjs <payload.json> [--base URL] [--dry-run] [--chunk 50]"
  );
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { file: "", base: DEFAULT_BASE, dryRun: false, chunk: 50 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--base") opts.base = argv[++i] ?? usage("--base 값이 없습니다");
    else if (a === "--chunk") opts.chunk = Number(argv[++i]);
    else if (a === "-h" || a === "--help") usage();
    else if (a.startsWith("--")) usage(`모르는 옵션 ${a}`);
    else if (!opts.file) opts.file = a;
    else usage(`인자가 너무 많습니다: ${a}`);
  }
  if (!opts.file) usage("payload.json 경로가 필요합니다");
  if (!Number.isInteger(opts.chunk) || opts.chunk < 1 || opts.chunk > MAX_CHUNK) {
    usage(`--chunk 는 1..${MAX_CHUNK} 정수`);
  }
  opts.base = opts.base.replace(/\/+$/, "");
  return opts;
}

/** createdAt 오름차순, 없는 건 뒤로 (서버 planIntake 와 같은 규칙을 청크 경계 너머로 넓힌다) */
function sortLeads(leads) {
  const t = (l) => {
    const v = Date.parse(l?.createdAt ?? "");
    return Number.isNaN(v) ? null : v;
  };
  return leads
    .map((l, i) => ({ l, i, t: t(l) }))
    .sort((a, b) => {
      if (a.t === null && b.t === null) return a.i - b.i;
      if (a.t === null) return 1;
      if (b.t === null) return -1;
      return a.t - b.t || a.i - b.i;
    })
    .map((x) => x.l);
}

function pad(s, n) {
  s = String(s ?? "");
  // 한글은 터미널에서 두 칸 — 대충이라도 열을 맞춘다
  const w = [...s].reduce((acc, ch) => acc + (/[ᄀ-ￜ]/.test(ch) ? 2 : 1), 0);
  return s + " ".repeat(Math.max(1, n - w));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const token = process.env.OUTREACH_INTAKE_TOKEN;
  if (!token) usage("OUTREACH_INTAKE_TOKEN 환경변수가 없습니다");

  let payload;
  try {
    payload = JSON.parse(readFileSync(opts.file, "utf8"));
  } catch (e) {
    usage(`payload 를 읽을 수 없습니다: ${e.message}`);
  }
  if (!payload || !Array.isArray(payload.leads)) usage("payload 는 { leads: [...] } 모양이어야 합니다");

  const leads = sortLeads(payload.leads);

  /* dry-run 은 아무것도 저장하지 않으므로 뒤 청크가 앞 청크의 "생성"을 못 본다 → 생성이 부풀려진다.
     서버 상한 안이면 한 번에 보내 정확한 계획을 받는다 */
  if (opts.dryRun && leads.length > opts.chunk) {
    if (leads.length <= MAX_CHUNK) opts.chunk = leads.length;
    else console.warn(`주의: ${MAX_CHUNK}건 초과 dry-run — 청크 경계를 넘는 같은 기관은 '생성'으로 중복 집계된다`);
  }
  const url = `${opts.base}/api/admin/outreach/intake`;
  console.log(`대상: ${url}  리드 ${leads.length}건  청크 ${opts.chunk}${opts.dryRun ? "  (dry-run)" : ""}`);

  const all = [];
  const total = { created: 0, merged: 0, skipped: 0 };
  let failed = false;

  for (let i = 0; i < leads.length; i += opts.chunk) {
    const chunk = leads.slice(i, i + opts.chunk);
    const n = i / opts.chunk + 1;
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-intake-token": token },
        body: JSON.stringify({ leads: chunk, dryRun: opts.dryRun }),
        redirect: "manual", // 리다이렉트로 토큰 헤더가 다른 호스트로 새지 않게
      });
    } catch (e) {
      console.error(`청크 ${n}: 요청 실패 — ${e.message}`);
      failed = true;
      break;
    }

    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* HTML 오류 페이지 등 */
    }

    if (res.status !== 200 && res.status !== 207) {
      const loc = res.headers.get("location");
      console.error(
        `청크 ${n}: HTTP ${res.status}${loc ? ` → ${loc} (--base 를 이 주소로)` : ""} — ${json?.error ?? text.slice(0, 200)}`
      );
      failed = true;
      break;
    }

    const s = json?.summary ?? { created: 0, merged: 0, skipped: 0 };
    total.created += s.created;
    total.merged += s.merged;
    total.skipped += s.skipped;
    all.push(...(json?.results ?? []));
    console.log(`청크 ${n} (${chunk.length}건) HTTP ${res.status}: 생성 ${s.created} · 합침 ${s.merged} · 건너뜀 ${s.skipped}`);
  }

  console.log("");
  console.log(pad("기관", 34) + pad("동작", 8) + "id / 사유");
  console.log("-".repeat(90));
  for (const r of all) {
    const tail = [r.id ?? r.existingId, r.reason].filter(Boolean).join("  ");
    console.log(pad(r.org, 34) + pad(r.action, 8) + tail);
  }
  console.log("-".repeat(90));
  console.log(`합계: 생성 ${total.created} · 합침 ${total.merged} · 건너뜀 ${total.skipped}${opts.dryRun ? "  (dry-run, 저장 안 함)" : ""}`);

  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
