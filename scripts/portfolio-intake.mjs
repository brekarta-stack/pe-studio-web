#!/usr/bin/env node
/**
 * 포트폴리오 인테이크 CLI — 로컬 사진 묶음을 사이트의 /api/portfolio/intake 로 보낸다.
 * Slack 봇과 같은 뒷단을 타므로, 봇을 붙이기 전 시험 운전과 수동 일괄 등록에 쓴다.
 *
 *   PORTFOLIO_INTAKE_SECRET=… node scripts/portfolio-intake.mjs [옵션] <사진 또는 폴더>…
 *
 *   --plan            파일만 묶어서 보여 주고 끝 (네트워크 없음) — 키 확인용
 *   --probe           서버 설정 상태 확인 (어떤 환경변수가 비었는지)
 *   --dry-run         업로드·저장 없이 글만 생성해 보여 준다
 *   --publish         등록 즉시 공개 (기본은 비공개 초안)
 *   --content <파일>  { "<키>": { title, summary, … } } JSON 파일 — 서버 생성 대신 이 내용을 쓴다
 *   --site <url>      기본 https://www.papercraft.kr
 *
 * 사진은 보내기 전에 여기서 1920 폭으로 줄인다 (Vercel 본문 한계 4.5MB). 그래도 큰 묶음은
 * 여러 요청으로 나눠 보내고, 서버는 같은 키의 뒤 사진을 기존 초안에 덧붙인다.
 * --content 의 imageAlts 도 그 순서에 맞춰 잘라 보낸다.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { groupIntakeFiles } from "../src/lib/portfolio-intake.ts";

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
/** base64 글자 수 기준 — JSON 포장 뒤에도 4.5MB 안쪽 */
export const CHUNK_LIMIT = 3.3 * 1024 * 1024;

function usage(msg) {
  if (msg) console.error(`오류: ${msg}\n`);
  console.error(
    readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^#!.*\n\/\*\*\n/, "").replace(/^ \* ?/gm, ""),
  );
  process.exit(msg ? 2 : 0);
}

export function parseArgs(argv) {
  const o = { site: "https://www.papercraft.kr", plan: false, probe: false, dryRun: false, publish: false, content: null, paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--plan") o.plan = true;
    else if (a === "--probe") o.probe = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--publish") o.publish = true;
    else if (a === "--site") o.site = argv[++i];
    else if (a === "--content") o.content = argv[++i];
    else if (a === "-h" || a === "--help") usage();
    else if (a.startsWith("--")) usage(`모르는 옵션 ${a}`);
    else o.paths.push(a);
  }
  o.site = (o.site ?? "").replace(/\/$/, "");
  return o;
}

function collectFiles(paths) {
  const out = [];
  for (const p of paths) {
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const n of readdirSync(p).sort()) if (IMAGE_EXT.test(n)) out.push(path.join(p, n));
    } else {
      out.push(p);
    }
  }
  return out.map((full) => ({ name: path.basename(full), path: full }));
}

async function shrinkForUpload(file) {
  const img = sharp(file.path, { failOn: "truncated" }).rotate().resize({ width: 1920, withoutEnlargement: true });
  const buf = /\.png$/i.test(file.name)
    ? await img.png({ compressionLevel: 9 }).toBuffer()
    : /\.webp$/i.test(file.name)
      ? await img.webp({ quality: 82 }).toBuffer()
      : await img.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  return { name: file.name, base64: buf.toString("base64") };
}

/** 묶음을 요청 크기 안쪽으로 나눈다. 순서는 지킨다 */
export function chunk(files, limit = CHUNK_LIMIT) {
  const chunks = [];
  let cur = [];
  let size = 0;
  for (const f of files) {
    if (cur.length && size + f.base64.length > limit) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(f);
    size += f.base64.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** --content 의 imageAlts 를 이번 청크에 든 사진 범위로 잘라 준다 (나머지 필드는 그대로) */
export function contentForChunk(content, offset, count) {
  if (!content || typeof content !== "object") return undefined;
  if (!Array.isArray(content.imageAlts)) return content;
  return { ...content, imageAlts: content.imageAlts.slice(offset, offset + count) };
}

async function post(site, secret, body) {
  const res = await fetch(`${site}/api/portfolio/intake`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-webhook-secret": secret },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text.slice(0, 300) };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${data.error ?? text.slice(0, 300)}`);
  return data;
}

function printGroupResult(g) {
  const tag = { created: "등록(초안)", appended: "사진 추가", "dry-run": "생성만", failed: "실패" }[g.action] ?? g.action;
  console.log(`\n[${tag}] ${g.client} / ${g.titleHint} (${g.producedAt}, ${g.imageCount}장)`);
  if (g.title) console.log(`  제목: ${g.title}`);
  if (g.adminUrl) console.log(`  어드민: ${g.adminUrl}`);
  if (g.publicUrl) console.log(`  공개 주소: ${g.publicUrl}${g.published ? "" : " (공개 전)"}`);
  if (g.error) console.log(`  오류: ${g.error}`);
  if (g.action === "dry-run" && g.generated) console.log(JSON.stringify(g.generated, null, 2));
  for (const s of g.skippedImages ?? []) console.log(`  건너뜀: ${s.name} — ${s.reason}`);
}

export async function main(argv = process.argv.slice(2)) {
  const o = parseArgs(argv);
  const secret = process.env.PORTFOLIO_INTAKE_SECRET;

  if (o.probe) {
    if (!secret) usage("PORTFOLIO_INTAKE_SECRET 환경변수가 필요합니다");
    const res = await fetch(`${o.site}/api/portfolio/intake?probe=1`, { headers: { "x-webhook-secret": secret } });
    console.log(res.status, await res.text());
    return;
  }

  if (!o.paths.length) usage("사진 파일이나 폴더를 주세요");
  const files = collectFiles(o.paths);
  const { groups, skipped } = groupIntakeFiles(files);

  console.log(`묶음 ${groups.length}건, 건너뜀 ${skipped.length}장`);
  for (const g of groups) {
    console.log(`\n키: ${g.key}\n  고객 ${g.client} / 제작 ${g.producedAt} / 명칭 ${g.title} / ${g.files.length}장`);
    for (const f of g.files) console.log(`   ${f.parsed.index}. ${f.file.name}`);
  }
  for (const s of skipped) console.log(`\n건너뜀: ${s.name} — ${s.reason}`);
  if (o.plan) return;

  if (!secret) usage("PORTFOLIO_INTAKE_SECRET 환경변수가 필요합니다");
  const content = o.content ? JSON.parse(readFileSync(o.content, "utf8")) : undefined;

  for (const g of groups) {
    const shrunk = [];
    for (const f of g.files) shrunk.push(await shrinkForUpload(f.file));
    const chunks = chunk(shrunk);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      if (chunks.length > 1) console.log(`\n${g.key}: ${i + 1}/${chunks.length} 번째 묶음 전송 (${chunks[i].length}장)`);
      const own = content?.[g.key] ? { [g.key]: contentForChunk(content[g.key], offset, chunks[i].length) } : undefined;
      const result = await post(o.site, secret, {
        files: chunks[i],
        publish: o.publish,
        dryRun: o.dryRun,
        content: own,
        source: "cli",
      });
      for (const r of result.groups) printGroupResult(r);
      for (const s of result.skipped) console.log(`  건너뜀: ${s.name} — ${s.reason}`);
      offset += chunks[i].length;
    }
  }
}

// 직접 실행할 때만 돈다 — 테스트는 chunk/contentForChunk 를 import 해서 쓴다
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`실패: ${e.message}`);
    process.exit(1);
  });
}
