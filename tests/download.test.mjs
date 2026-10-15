/**
 * 배포 프로그램 다운로드 링크 테스트 (node --test)
 *   node --test tests/download.test.mjs
 *
 * 왜 이런 방식인가:
 * 다운로드 버튼이 두 번 죽었다. 두 번 다 원인은 코드가 아니라 "외부 호스팅이
 * 사라진 것"이었고, 두 번 다 사람이 버튼을 눌러 보고서야 발견했다.
 *   · 2026-08-25 — GitHub 계정 플래그로 릴리스 직링크가 익명 404
 *   · 2026-09-15 — Vercel Blob 스토어가 무료 한도 초과로 정지되어 403
 *
 * 그래서 두 가지를 못 박는다.
 *   1) 구조 — 대외 노출 링크는 항상 우리 도메인의 고정 경로여야 한다.
 *      벤더 URL 을 버튼이나 JSON-LD 에 직접 박으면 이전 때마다 링크가 전멸한다.
 *   2) 생존 — 실제 파일 URL 이 지금 살아 있는가. 이게 있었으면 두 사고 모두
 *      사람이 아니라 테스트가 먼저 알았다.
 *
 * 생존 검사는 프로덕션이 실제로 쓰는 값(DOWNLOAD_FILE_URL 환경변수 → 없으면 소스
 * fallback)을 그대로 본다. 소스만 보면, 환경변수로 비상 복구한 뒤에는 테스트가
 * 영원히 엉뚱한 주소를 검사하게 된다.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf-8");

const siteSource = read("../src/lib/site.ts");
const pageSource = read("../src/app/download/page.tsx");
const routeSource = read("../src/app/download/app/route.ts");
const robotsSource = read("../src/app/robots.ts");

/** site.ts 의 DOWNLOAD 블록만 떼어낸다 — 파일 전체 정규식은 엉뚱한 필드를 문다 */
function downloadBlock() {
  const m = /export const DOWNLOAD = \{([\s\S]*?)\} as const;/.exec(siteSource);
  assert.ok(m, "DOWNLOAD 블록을 찾지 못했습니다");
  return m[1];
}

function downloadField(name) {
  const m = new RegExp(`\\b${name}:\\s*"([^"]*)"`).exec(downloadBlock());
  assert.ok(m, `DOWNLOAD.${name} 을 찾지 못했습니다`);
  return m[1];
}

/**
 * 프로덕션이 실제로 쓰게 될 파일 URL.
 * site.ts 의 `process.env.DOWNLOAD_FILE_URL ?? "<fallback>"` 과 같은 우선순위로 판정한다.
 */
function fileUrl() {
  if (process.env.DOWNLOAD_FILE_URL) return process.env.DOWNLOAD_FILE_URL;
  const m = /const DOWNLOAD_FILE_URL =[\s\S]*?"(https:\/\/[^"]+)"/.exec(siteSource);
  assert.ok(m, "DOWNLOAD_FILE_URL 기본값을 찾지 못했습니다");
  return m[1];
}

test("대외 링크는 고정 경로(/download/app)다 — 벤더 URL 직링크 금지", () => {
  assert.equal(downloadField("href"), "/download/app");
});

test("다운로드 버튼이 원본 URL 이 아니라 고정 경로를 가리킨다", () => {
  assert.match(pageSource, /href=\{DOWNLOAD\.href\}/);
  assert.doesNotMatch(
    pageSource,
    /href=\{DOWNLOAD\.url\}/,
    "버튼이 벤더 URL 을 직접 링크하면 호스팅 이전 때 다시 죽는다",
  );
});

/**
 * 거부 목록(denylist)이 아니라 허용 목록이다. "blob.vercel-storage.com 금지" 식으로
 * 적어 두면 다음 호스팅(r2.dev 등)을 그대로 박는 것을 못 막는다 — 막으려던 실패
 * 모드가 정확히 그거다.
 */
test("페이지에 외부 절대 URL 이 하나도 없다 — 원본 호스트는 site.ts 한 곳에만", () => {
  const ALLOWED = ["https://schema.org"];
  const found = [...pageSource.matchAll(/https?:\/\/[^\s"'`)]+/g)]
    .map((m) => m[0])
    .filter((u) => !ALLOWED.some((a) => u.startsWith(a)));
  assert.deepEqual(
    found,
    [],
    `페이지에 절대 URL 이 있습니다: ${found.join(", ")} — 파일 위치는 site.ts 로 옮기세요`,
  );
});

test("JSON-LD downloadUrl 도 고정 경로다 — 검색엔진 색인이 이전에 살아남게", () => {
  assert.match(pageSource, /downloadUrl: `\$\{SITE_URL\}\$\{DOWNLOAD\.href\}`/);
});

test("리다이렉트 라우트가 미설정 URL 을 그대로 내보내지 않는다", () => {
  assert.match(routeSource, /REPLACE_ME/, "플레이스홀더 가드가 있어야 한다");
  assert.match(routeSource, /status:\s*503/);
  assert.match(routeSource, /status:\s*302/);
  assert.match(
    routeSource,
    /Location:\s*target/,
    "302 에 Location 이 붙지 않으면 브라우저가 아무 데도 못 간다",
  );
});

test("리다이렉트 응답이 캐시되지 않는다 — 굳으면 호스팅 이전이 안 먹는다", () => {
  assert.match(routeSource, /no-store/);
});

/**
 * 봇 차단. 302 를 따라가는 크롤러 하나가 126MB 전송이고, 그 전송량이 스토어를
 * 정지시켰다. robots.txt 는 착한 봇만 막으므로 헤더도 함께 본다.
 */
test("다운로드 리다이렉트가 크롤러에 노출되지 않는다", () => {
  assert.match(robotsSource, /"\/download\/app"/, "robots.txt disallow 에 있어야 한다");
  assert.match(routeSource, /"X-Robots-Tag":\s*"noindex, nofollow"/);
  assert.match(pageSource, /rel="nofollow"/);
});

test("환경변수 오입력으로 자기 자신을 가리키면 리다이렉트 루프가 되지 않는다", () => {
  assert.match(routeSource, /SITE_URL/, "자기 호스트 배제 가드가 있어야 한다");
});

/**
 * 생존 확인 — 실제 파일이 지금 받아지는가. 이 테스트가 붉어지면 배포 파일이 죽었다.
 *
 * 네트워크 오류를 전부 skip 으로 삼키면 "버킷이 통째로 사라져 DNS 가 안 풀리는"
 * 경우까지 조용히 넘어간다. 그래서 인터넷 자체가 되는지 먼저 재 보고,
 * 인터넷은 되는데 이 URL 만 안 되면 실패로 판정한다.
 */
async function online() {
  try {
    await fetch("https://cloudflare.com/cdn-cgi/trace", {
      method: "HEAD",
      signal: AbortSignal.timeout(8000),
    });
    return true;
  } catch {
    return false;
  }
}

test("배포 파일 URL 이 살아 있다", async (t) => {
  const url = fileUrl();
  if (url.includes("REPLACE_ME")) {
    t.skip("배포 파일 호스팅이 아직 설정되지 않았습니다 (DOWNLOAD_FILE_URL 미지정)");
    return;
  }

  let res;
  try {
    res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    if (!(await online())) {
      t.skip(`오프라인이라 확인할 수 없습니다: ${err.message}`);
      return;
    }
    assert.fail(
      `배포 파일에 접속할 수 없습니다 (버킷 삭제·DNS 소멸 가능): ${url}\n  ${err.message}`,
    );
  }

  assert.ok(
    res.ok,
    `배포 파일이 HTTP ${res.status} 입니다 — 다운로드 버튼이 죽었습니다: ${url}`,
  );

  // content-length 를 안 주는 오리진도 있다. 주는 경우에만 크기를 본다
  // (오류 페이지가 200 으로 오는 걸 거르는 용도).
  const raw = res.headers.get("content-length");
  if (raw !== null) {
    const expected = Number(/(\d+)\s*MB/.exec(downloadField("fileSize"))?.[1] ?? 0) * 1e6;
    assert.ok(
      Number(raw) > expected * 0.8,
      `배포 파일 크기가 ${raw} B 입니다 — ${downloadField("fileSize")} zip 이 아니라 오류 페이지일 수 있습니다`,
    );
  }
});
