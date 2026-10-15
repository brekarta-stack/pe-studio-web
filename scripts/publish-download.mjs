#!/usr/bin/env node
/**
 * 배포 프로그램(126MB zip)을 Cloudflare R2 에 올리고 익명 다운로드까지 검증한다.
 *
 * 왜 스크립트인가: 이 업로드는 지금까지 두 번 손으로 했고, 두 번 다 "어디에 어떻게
 * 올렸는지" 가 커밋 메시지에만 남아 다음 사람이 재현할 수 없었다. 호스팅이 또 죽으면
 * 이 파일 하나를 실행해 복구한다.
 *
 * 왜 R2 인가: 이 파일은 전송량이 문제지 저장량이 문제가 아니다(126MB × 다운로드 수).
 * R2 는 egress 가 무료라 구조적으로 재발하지 않는다. Vercel Blob 은 Hobby 무료
 * 전송량 한도(약 80회 다운로드)에 걸려 2026-09-15 에 스토어가 정지됐다.
 *
 * 필요한 자격증명 (환경변수):
 *   R2_ACCOUNT_ID         Cloudflare 계정 ID
 *   R2_ACCESS_KEY_ID      R2 API 토큰의 Access Key ID
 *   R2_SECRET_ACCESS_KEY  R2 API 토큰의 Secret Access Key
 *   CF_API_TOKEN          버킷 생성·공개 설정용 Cloudflare API 토큰
 *                         (권한: Workers R2 Storage — Edit)
 *
 * 사용:
 *   node scripts/publish-download.mjs <zip 경로> <버전>
 *   예: node scripts/publish-download.mjs ~/Downloads/PapercraftStudio-windows-x64.zip 1.3
 *
 * 버전은 필수다 — 기본값을 두면 인자를 빠뜨렸을 때 현재 라이브 파일을 조용히
 * 덮어쓴다(R2 는 같은 키에 PUT 하면 교체고 롤백이 없다).
 */
import { createHash, createHmac } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

const BUCKET = "papercraft-downloads";

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  CF_API_TOKEN,
} = process.env;

const [, , zipPath, versionArg] = process.argv;

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!zipPath) die("zip 경로를 인자로 주세요. 예: node scripts/publish-download.mjs <zip> 1.3");
if (!versionArg) die("버전을 인자로 주세요 (예: 1.3). 빠뜨리면 라이브 파일을 덮어쓸 수 있습니다.");
if (!/^\d+\.\d+(\.\d+)?$/.test(versionArg)) die(`버전 형식이 이상합니다: ${versionArg}`);
for (const [k, v] of Object.entries({ R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, CF_API_TOKEN })) {
  if (!v) die(`환경변수 ${k} 가 없습니다. 이 파일 상단 주석의 '필요한 자격증명' 을 보세요.`);
}

const version = versionArg;
const fileName = basename(zipPath);
const key = `downloads/v${version}/${fileName}`;
const size = statSync(zipPath).size;

/** Cloudflare REST API 호출 (버킷 생성·공개 도메인 토글) */
async function cf(path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${R2_ACCOUNT_ID}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

/**
 * AWS SigV4 로 R2 S3 엔드포인트에 PUT. aws-sdk 를 새로 의존성에 넣지 않으려고
 * 직접 서명한다 — 이 스크립트가 쓰는 건 PUT 하나뿐이다.
 */
async function putObject(body) {
  const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const region = "auto";
  const service = "s3";
  const payloadHash = createHash("sha256").update(body).digest("hex");
  // SigV4 canonical URI 는 경로 세그먼트를 인코딩한 값이어야 한다.
  // 지금 파일명은 ASCII 지만, 공백·한글이 섞인 순간 서명 불일치로 조용히 403 이 난다.
  const canonicalUri = `/${BUCKET}/${key}`
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const sign = (k, d) => createHmac("sha256", k).update(d).digest();
  let signingKey = sign(`AWS4${R2_SECRET_ACCESS_KEY}`, dateStamp);
  signingKey = sign(signingKey, region);
  signingKey = sign(signingKey, service);
  signingKey = sign(signingKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const res = await fetch(`https://${host}${canonicalUri}`, {
    method: "PUT",
    headers: {
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      "Content-Type": "application/zip",
      "Content-Length": String(body.length),
    },
    body,
  });
  return res;
}

console.log(`· 파일   ${zipPath} (${(size / 1e6).toFixed(1)} MB)`);
console.log(`· 대상   r2://${BUCKET}/${key}`);

// 1. 버킷 확보 (이미 있으면 그대로 쓴다)
const created = await cf(`/r2/buckets`, {
  method: "POST",
  body: JSON.stringify({ name: BUCKET }),
});
if (created.ok) console.log("✓ 버킷 생성");
else if (JSON.stringify(created.body).includes("already exists")) console.log("· 버킷 이미 있음");
else die(`버킷 생성 실패 (${created.status}): ${JSON.stringify(created.body)}`);

// 2. 업로드
const buf = readFileSync(zipPath);
const put = await putObject(buf);
if (!put.ok) die(`업로드 실패 (${put.status}): ${await put.text()}`);
console.log("✓ 업로드");

// 3. 익명 접근용 r2.dev 공개 도메인 활성화
const pub = await cf(`/r2/buckets/${BUCKET}/domains/managed`, {
  method: "PUT",
  body: JSON.stringify({ enabled: true }),
});
if (!pub.ok) die(`공개 설정 실패 (${pub.status}): ${JSON.stringify(pub.body)}`);
const domain = pub.body?.result?.domain;
if (!domain) die(`공개 도메인을 받지 못했습니다: ${JSON.stringify(pub.body)}`);
const url = `https://${domain}/${key}`;
console.log(`✓ 공개   ${url}`);

// 4. 익명 다운로드 검증 — 자격증명 없이 실제로 받아지는지.
//    8월 사고(로그인 상태에선 보이는데 익명은 404)가 정확히 이 검증의 부재였다.
//    공개 설정 전파에 시간이 걸려 몇 번 재시도한다.
let verified = false;
for (let i = 0; i < 6; i += 1) {
  await new Promise((r) => setTimeout(r, i === 0 ? 0 : 5000));
  const res = await fetch(url, { method: "HEAD", redirect: "follow" });
  if (res.ok && Number(res.headers.get("content-length")) === size) {
    verified = true;
    break;
  }
  console.log(`· 검증 재시도 ${i + 1}/6 (HTTP ${res.status})`);
}
if (!verified) die("익명 다운로드 검증 실패 — 공개 설정을 확인하세요");
console.log("✓ 익명 다운로드 검증 완료");

console.log(`\n다음: Vercel 환경변수 DOWNLOAD_FILE_URL 를 아래로 설정하고 재배포하세요.\n  ${url}\n`);
