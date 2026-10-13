/**
 * 포트폴리오 자동 등록(인테이크) 규칙 (node --test)
 *   - 파일명 '고객명-YYMMDD-명칭 (n).jpg' 파싱: 공백·NFD·8자리 날짜·(n)·_n·잘못된 날짜
 *   - 같은 고객·날짜·명칭끼리 묶이고 번호순으로 정렬된다
 *   - 모델 출력이 규격 밖이어도 사이트 규격(카테고리·고객 유형·alt 개수)으로 들어온다
 *   - 처리 흐름(가짜 의존성): 새 초안 / 기존 초안에 덧붙임 / 공개된 사례 거부 / 실패 시 빈 자리 삭제 / 동시 자리 잡기
 *   - Slack 서명 검증, "사람이 올린 사진 메시지" 판별, 다운로드 허용 호스트, 재전송 처리
 *   - 실제 sharp 처리: 저장판 1920 폭, 비전판 1280 안쪽, EXIF 방향 반영, PNG·WebP 형식 유지
 *   - CLI 의 청크 나누기와 --content alt 자르기
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import sharp from "sharp";

import {
  GENERATED_CONTENT_SCHEMA,
  INTAKE_SYSTEM_PROMPT,
  buildIntakeUserPrompt,
  groupIntakeFiles,
  inferCategory,
  intakeExternalId,
  intakeKey,
  normalizeGenerated,
  parseIntakeFilename,
  toIsoDate,
} from "../src/lib/portfolio-intake.ts";
import { CATEGORIES, CLIENT_TYPES } from "../src/lib/portfolio-types.ts";
import {
  ALREADY_PUBLISHED_ERROR,
  hasContent,
  placeholderDraft,
  runIntakeFlow,
} from "../src/lib/portfolio-intake-flow.ts";
import {
  formatIntakeReply,
  isAllowedSlackFileUrl,
  pickPortfolioUpload,
  shouldIgnoreSlackRetry,
  verifySlackSignature,
} from "../src/lib/slack-events.ts";
import { prepareIntakeImage, VISION_MAX_EDGE } from "../src/lib/portfolio-intake-images.ts";
import { chunk, contentForChunk } from "../scripts/portfolio-intake.mjs";

/* ── 실제로 들어온 파일명 8개 (2026-10-13 시험 운전 묶음) ── */
const REAL_NAMES = [
  "서울문화교육센터-260907- 무대 위 안무가들 (1).jpg",
  "서울문화교육센터-260907- 무대 위 안무가들 (2).jpg",
  "서울문화교육센터-260907- 무대 위 안무가들 (3).jpg",
  "서울문화교육센터-260907- 무대 위 안무가들 (4).jpg",
  "서울문화교육센터-260907- 무대 위 안무가들 (5).jpg",
  "서울문화교육센터-260907- 무대 위 안무가들 (6).jpg",
  "온더룩-261013-고양이탈 (2).jpg",
  "온더룩-261013-고양이탈 (1).jpg",
];

test("parseIntakeFilename: 실제 파일명 — 구분자 옆 공백이 있어도 고객·날짜·명칭·번호가 나온다", () => {
  const p = parseIntakeFilename(REAL_NAMES[2]);
  assert.deepEqual(p, { client: "서울문화교육센터", producedAt: "2026-09-07", title: "무대 위 안무가들", index: 3, ext: ".jpg" });
  const c = parseIntakeFilename(REAL_NAMES[6]);
  assert.deepEqual(c, { client: "온더룩", producedAt: "2026-10-13", title: "고양이탈", index: 2, ext: ".jpg" });
});

test("parseIntakeFilename: 번호 없음·_n·8자리 날짜·경로 접두·대문자 확장자", () => {
  assert.equal(parseIntakeFilename("경주박물관-20260301-금관 마스크.PNG").index, 1);
  assert.equal(parseIntakeFilename("경주박물관-20260301-금관 마스크.PNG").ext, ".png");
  assert.equal(parseIntakeFilename("경주박물관-20260301-금관 마스크.PNG").producedAt, "2026-03-01");
  assert.equal(parseIntakeFilename("경주박물관-260301-금관 마스크_4.jpg").index, 4);
  assert.equal(parseIntakeFilename("/tmp/drops/온더룩-261013-고양이탈 (1).jpg").client, "온더룩");
  // 하이픈+숫자는 명칭의 일부 — 번호로 먹지 않는다
  assert.equal(parseIntakeFilename("이노션-260501-아이오닉-5.jpg").title, "아이오닉-5");
});

test("parseIntakeFilename: macOS NFD 한글은 NFC 로 모아 같은 키가 된다", () => {
  const nfd = "온더룩-261013-고양이탈 (1).jpg".normalize("NFD");
  assert.notEqual(nfd, "온더룩-261013-고양이탈 (1).jpg");
  const p = parseIntakeFilename(nfd);
  assert.equal(p.client, "온더룩");
  assert.equal(intakeKey(p), intakeKey(parseIntakeFilename("온더룩-261013-고양이탈 (2).jpg")));
});

test("parseIntakeFilename: 형식 밖이면 null — 날짜 없음, 달력에 없는 날, 명칭 없음", () => {
  assert.equal(parseIntakeFilename("IMG_1234.jpg"), null);
  assert.equal(parseIntakeFilename("온더룩-고양이탈.jpg"), null);
  assert.equal(parseIntakeFilename("온더룩-261313-고양이탈.jpg"), null);
  assert.equal(parseIntakeFilename("온더룩-260230-고양이탈.jpg"), null);
  assert.equal(parseIntakeFilename("온더룩-261013-.jpg"), null);
});

test("toIsoDate", () => {
  assert.equal(toIsoDate("260907"), "2026-09-07");
  assert.equal(toIsoDate("20261013"), "2026-10-13");
  assert.equal(toIsoDate("2610131"), null);
  assert.equal(toIsoDate("260431"), null);
});

test("groupIntakeFiles: 8장이 2묶음으로, 번호순으로, 형식 밖은 이유와 함께 skipped", () => {
  const files = [...REAL_NAMES, "메모.txt", "IMG_0001.jpg", "온더룩-261013-고양이탈.gif"].map((name) => ({ name }));
  const { groups, skipped } = groupIntakeFiles(files);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].client, "서울문화교육센터");
  assert.equal(groups[0].files.length, 6);
  assert.deepEqual(groups[0].files.map((f) => f.parsed.index), [1, 2, 3, 4, 5, 6]);
  assert.equal(groups[1].client, "온더룩");
  assert.deepEqual(groups[1].files.map((f) => f.file.name), ["온더룩-261013-고양이탈 (1).jpg", "온더룩-261013-고양이탈 (2).jpg"]);
  assert.equal(skipped.length, 3);
  assert.match(skipped.find((s) => s.name === "온더룩-261013-고양이탈.gif").reason, /확장자/);
  assert.match(skipped.find((s) => s.name === "IMG_0001.jpg").reason, /형식/);
});

test("intakeKey / intakeExternalId: 키는 고객|날짜|명칭, 외부 ID 는 intake: 접두", () => {
  const p = parseIntakeFilename(REAL_NAMES[0]);
  assert.equal(intakeKey(p), "서울문화교육센터|2026-09-07|무대 위 안무가들");
  assert.equal(intakeExternalId(intakeKey(p)), "intake:서울문화교육센터|2026-09-07|무대 위 안무가들");
});

test("GENERATED_CONTENT_SCHEMA: 필수 키가 속성과 일치하고 enum 은 쓰지 않는다", () => {
  assert.deepEqual([...GENERATED_CONTENT_SCHEMA.required].sort(), Object.keys(GENERATED_CONTENT_SCHEMA.properties).sort());
  assert.equal(GENERATED_CONTENT_SCHEMA.additionalProperties, false);
  assert.equal(JSON.stringify(GENERATED_CONTENT_SCHEMA).includes('"enum"'), false);
});

test("INTAKE_SYSTEM_PROMPT: 카테고리·고객 유형 전부와 문체 예시가 들어 있고 가변값은 없다", () => {
  for (const c of CATEGORIES) assert.ok(INTAKE_SYSTEM_PROMPT.includes(c), c);
  for (const t of CLIENT_TYPES) assert.ok(INTAKE_SYSTEM_PROMPT.includes(t), t);
  assert.ok(INTAKE_SYSTEM_PROMPT.includes("참고하기 좋은 사례예요"));
  assert.doesNotMatch(INTAKE_SYSTEM_PROMPT, /20\d\d-\d\d-\d\d/);
});

test("buildIntakeUserPrompt: 고객·시기·명칭·사진 수, 덧붙일 때는 기존 글을 함께", () => {
  const p = buildIntakeUserPrompt({ client: "온더룩", producedAt: "2026-10-13", titleHint: "고양이탈", imageCount: 2 });
  assert.match(p, /고객명: 온더룩/);
  assert.match(p, /2026-10-13/);
  assert.match(p, /2장/);
  assert.doesNotMatch(p, /기존 제목/);
  const q = buildIntakeUserPrompt({ client: "온더룩", producedAt: "2026-10-13", titleHint: "고양이탈", imageCount: 1, existing: { title: "기존", description: "본문" } });
  assert.match(q, /기존 제목: 기존/);
});

test("inferCategory: 파일명 힌트로 보수적 기본값", () => {
  assert.equal(inferCategory("고양이탈"), "모자/마스크");
  assert.equal(inferCategory("무대 위 안무가들 팝업"), "팝업북");
  assert.equal(inferCategory("오토마타 기린"), "액션 크래프트");
  assert.equal(inferCategory("아이오닉 5"), "페이퍼 크래프트");
});

test("normalizeGenerated: 목록 밖 값은 기본값으로, alt 는 사진 수에 맞춰, 태그는 중복 제거", () => {
  const g = normalizeGenerated(
    {
      title: ' "온더룩 고양이탈" ',
      summary: "요약",
      description: "첫 문단\r\n\r\n\r\n\r\n둘째 문단   \n셋째",
      category: "마스크",
      clientType: "스타트업",
      tags: ["#브랜드 캐릭터", "브랜드 캐릭터", "", 42, "굿즈"],
      keywords: "아님",
      imageAlts: ["첫 사진"],
    },
    { client: "온더룩", titleHint: "고양이탈", imageCount: 3 },
  );
  assert.equal(g.title, "온더룩 고양이탈");
  assert.equal(g.category, "모자/마스크");
  assert.equal(g.clientType, undefined);
  assert.deepEqual(g.tags, ["브랜드 캐릭터", "굿즈"]);
  assert.deepEqual(g.keywords, []);
  assert.deepEqual(g.imageAlts, ["첫 사진", null, null]);
  assert.equal(g.description, "첫 문단\n\n둘째 문단\n셋째");
});

test("normalizeGenerated: 아예 깨진 입력이어도 제목은 고객+명칭으로 채워진다", () => {
  const g = normalizeGenerated("not json object", { client: "온더룩", titleHint: "고양이탈", imageCount: 1 });
  assert.equal(g.title, "온더룩 고양이탈");
  assert.equal(g.category, "모자/마스크");
  assert.deepEqual(g.imageAlts, [null]);
});

/* ── 처리 흐름 (가짜 의존성) ── */

const CAT_FILES = ["온더룩-261013-고양이탈 (1).jpg", "온더룩-261013-고양이탈 (2).jpg"].map((name) => ({ name, bytes: Buffer.from(name) }));
const CAT_KEY = "온더룩|2026-10-13|고양이탈";
const NOW = "2026-10-13T00:00:00.000Z";

function generated(n, title = "온더룩 고양이 페이퍼 마스크") {
  return {
    title,
    summary: "요약",
    description: "본문",
    category: "모자/마스크",
    clientType: "기업·브랜드",
    tags: ["브랜드 캐릭터"],
    keywords: ["고양이 탈"],
    imageAlts: Array.from({ length: n }, (_, i) => `alt${i + 1}`),
  };
}

function draft(over = {}) {
  return {
    id: "existing-id",
    airtableId: intakeExternalId(CAT_KEY),
    slug: "case-exist",
    title: "기존 제목",
    category: "모자/마스크",
    description: "기존 본문",
    client: "온더룩",
    tags: [],
    keywords: [],
    images: ["https://cdn/old1.jpg", "https://cdn/old2.jpg"],
    imageAlts: ["old alt 1"],
    published: false,
    featured: false,
    producedAt: "2026-10-13",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

/** 저장소 흉내 — finalize 는 실제 구현처럼 "행을 다시 읽어 뒤에 붙인다" */
function fakeDeps(over = {}) {
  const calls = { claim: [], generate: [], upload: [], finalize: [], discard: [] };
  const rows = new Map();
  if (over.existing) rows.set(over.existing.id, over.existing);
  const deps = {
    siteUrl: "https://x",
    prepare: async (bytes) => {
      if (bytes.toString().includes("(2)") && over.secondBad) throw new Error("깨짐");
      return { vision: Buffer.from(`v:${bytes}`), prepared: `p:${bytes}` };
    },
    findDraft: async (ext) => {
      assert.equal(ext, intakeExternalId(CAT_KEY));
      return over.existing ?? null;
    },
    claimDraft: async (d) => {
      calls.claim.push(d);
      const row = over.claimReturns ?? d;
      rows.set(row.id, row);
      return row;
    },
    generate: async (input) => {
      calls.generate.push(input);
      if (over.generateFails) throw new Error("생성 실패");
      return generated(input.images.length);
    },
    upload: async (prepared, original) => {
      calls.upload.push({ prepared, original });
      if (over.uploadFails) throw new Error("업로드 실패");
      return `https://cdn/new${calls.upload.length}.jpg`;
    },
    finalize: async (id, patch) => {
      calls.finalize.push({ id, patch });
      const cur = rows.get(id);
      if (!cur) throw new Error("행 없음");
      const prevAlts = cur.images.map((_, i) => cur.imageAlts?.[i] ?? null);
      const saved = {
        ...cur,
        ...(patch.content ? { title: patch.content.title, description: patch.content.description, slug: "case-new" } : {}),
        images: [...cur.images, ...patch.images],
        imageAlts: [...prevAlts, ...patch.imageAlts],
        published: cur.published || patch.publish,
      };
      rows.set(id, saved);
      return saved;
    },
    discardDraft: async (id) => {
      calls.discard.push(id);
      rows.delete(id);
    },
    now: () => NOW,
    newId: () => "id-new",
  };
  return { deps, calls, rows };
}

test("흐름: 기존 초안이 없으면 자리 잡기 → 생성 → 업로드 → 글 포함 완성, 결과는 created", async () => {
  const { deps, calls } = fakeDeps();
  const r = await runIntakeFlow(CAT_FILES, {}, deps);
  assert.equal(r.groups.length, 1);
  const g = r.groups[0];
  assert.equal(g.action, "created");
  assert.equal(g.itemId, "id-new");
  assert.equal(g.title, "온더룩 고양이 페이퍼 마스크");
  assert.equal(g.published, false);
  assert.equal(g.adminUrl, "https://x/admin/portfolio/id-new/edit");
  assert.equal(g.publicUrl, "https://x/portfolio/case-new");
  assert.equal(calls.claim.length, 1);
  assert.equal(calls.claim[0].airtableId, intakeExternalId(CAT_KEY));
  assert.equal(calls.claim[0].images.length, 0);
  assert.equal(calls.generate.length, 1);
  assert.equal(calls.generate[0].existing, null);
  assert.equal(calls.upload.length, 2);
  assert.ok(calls.finalize[0].patch.content, "새 초안은 글까지 채운다");
  assert.deepEqual(calls.finalize[0].patch.images, ["https://cdn/new1.jpg", "https://cdn/new2.jpg"]);
  assert.deepEqual(calls.finalize[0].patch.imageAlts, ["alt1", "alt2"]);
  assert.equal(calls.discard.length, 0);
});

test("흐름: 기존 초안이 있으면 자리를 잡지 않고 사진·alt 만 뒤에 붙인다 (글은 그대로), 결과는 appended", async () => {
  const { deps, calls, rows } = fakeDeps({ existing: draft() });
  const r = await runIntakeFlow(CAT_FILES, {}, deps);
  const g = r.groups[0];
  assert.equal(g.action, "appended");
  assert.equal(g.itemId, "existing-id");
  assert.equal(g.title, "기존 제목", "제목은 운영자가 손본 것을 지킨다");
  assert.equal(calls.claim.length, 0);
  assert.deepEqual(calls.generate[0].existing, { title: "기존 제목", description: "기존 본문" });
  assert.equal(calls.finalize[0].patch.content, undefined);
  const saved = rows.get("existing-id");
  assert.deepEqual(saved.images, ["https://cdn/old1.jpg", "https://cdn/old2.jpg", "https://cdn/new1.jpg", "https://cdn/new2.jpg"]);
  assert.deepEqual(saved.imageAlts, ["old alt 1", null, "alt1", "alt2"], "기존 alt 가 짧아도 사진과 자리가 어긋나지 않는다");
});

test("흐름: 이미 공개된 사례에는 덧붙이지 않는다 — publish 를 명시하면 붙이고 공개 유지", async () => {
  const a = fakeDeps({ existing: draft({ published: true }) });
  const r1 = await runIntakeFlow(CAT_FILES, {}, a.deps);
  assert.equal(r1.groups[0].action, "failed");
  assert.equal(r1.groups[0].error, ALREADY_PUBLISHED_ERROR);
  assert.equal(a.calls.generate.length, 0);
  assert.equal(a.calls.upload.length, 0);

  const b = fakeDeps({ existing: draft({ published: true }) });
  const r2 = await runIntakeFlow(CAT_FILES, { publish: true }, b.deps);
  assert.equal(r2.groups[0].action, "appended");
  assert.equal(r2.groups[0].published, true);
  assert.equal(b.calls.finalize[0].patch.publish, true);
});

test("흐름: 생성이 실패하면 내가 잡은 빈 자리는 지우고 failed, 업로드는 하지 않는다", async () => {
  const { deps, calls } = fakeDeps({ generateFails: true });
  const r = await runIntakeFlow(CAT_FILES, {}, deps);
  assert.equal(r.groups[0].action, "failed");
  assert.match(r.groups[0].error, /생성 실패/);
  assert.deepEqual(calls.discard, ["id-new"]);
  assert.equal(calls.upload.length, 0);
});

test("흐름: 업로드가 실패해도 빈 자리를 지운다. 기존 초안에 덧붙이던 중이면 지우지 않는다", async () => {
  const a = fakeDeps({ uploadFails: true });
  await runIntakeFlow(CAT_FILES, {}, a.deps);
  assert.deepEqual(a.calls.discard, ["id-new"]);

  const b = fakeDeps({ existing: draft(), uploadFails: true });
  const r = await runIntakeFlow(CAT_FILES, {}, b.deps);
  assert.equal(r.groups[0].action, "failed");
  assert.equal(b.calls.discard.length, 0, "남의 초안은 지우지 않는다");
});

test("흐름: 동시에 다른 요청이 먼저 자리를 잡았으면(유니크 충돌) 그 빈 행에 글과 사진을 채운다", async () => {
  const other = draft({ id: "other-id", images: [], imageAlts: [], description: "", title: "온더룩 고양이탈" });
  const { deps, calls } = fakeDeps({ claimReturns: other });
  const r = await runIntakeFlow(CAT_FILES, {}, deps);
  assert.equal(r.groups[0].action, "appended");
  assert.equal(r.groups[0].itemId, "other-id");
  assert.ok(calls.finalize[0].patch.content, "빈 행이면 글도 채운다");
  assert.equal(calls.discard.length, 0);
});

test("흐름: dryRun 은 자리도 잡지 않고 업로드도 없이 생성 결과만 돌려준다", async () => {
  const { deps, calls } = fakeDeps();
  const r = await runIntakeFlow(CAT_FILES, { dryRun: true }, deps);
  assert.equal(r.groups[0].action, "dry-run");
  assert.equal(r.groups[0].generated.imageAlts.length, 2);
  assert.equal(calls.claim.length, 0);
  assert.equal(calls.upload.length, 0);
  assert.equal(calls.finalize.length, 0);
});

test("흐름: contentByKey 가 있으면 생성 호출 없이 그 내용(규격 정리 후)으로 등록한다", async () => {
  const { deps, calls } = fakeDeps();
  const r = await runIntakeFlow(
    CAT_FILES,
    { contentByKey: { [CAT_KEY]: { title: "직접 쓴 제목", description: "직접 쓴 본문", category: "엉뚱", imageAlts: ["a1"] } } },
    deps,
  );
  assert.equal(calls.generate.length, 0);
  assert.equal(r.groups[0].action, "created");
  assert.equal(r.groups[0].title, "직접 쓴 제목");
  assert.equal(r.groups[0].generated.category, "모자/마스크");
  assert.deepEqual(calls.finalize[0].patch.imageAlts, ["a1", null]);
});

test("흐름: 깨진 사진은 건너뛰고 나머지로 진행, 전부 깨지면 failed 이고 자리를 잡지 않는다", async () => {
  const a = fakeDeps({ secondBad: true });
  const r1 = await runIntakeFlow(CAT_FILES, {}, a.deps);
  assert.equal(r1.groups[0].action, "created");
  assert.equal(r1.groups[0].imageCount, 1);
  assert.deepEqual(r1.groups[0].skippedImages.map((s) => s.name), ["온더룩-261013-고양이탈 (2).jpg"]);
  assert.equal(a.calls.upload.length, 1);

  const b = fakeDeps();
  b.deps.prepare = async () => {
    throw new Error("깨짐");
  };
  const r2 = await runIntakeFlow(CAT_FILES, {}, b.deps);
  assert.equal(r2.groups[0].action, "failed");
  assert.match(r2.groups[0].error, /쓸 수 있는 사진이 없음/);
  assert.equal(b.calls.claim.length, 0);
});

test("흐름: 묶음 하나가 실패해도 다른 묶음은 계속 처리된다", async () => {
  const files = [...CAT_FILES, { name: "A-260101-B (1).jpg", bytes: Buffer.from("A") }];
  const { deps } = fakeDeps();
  const origFind = deps.findDraft;
  deps.findDraft = async (ext) => (ext.startsWith("intake:A|") ? Promise.reject(new Error("DB 다운")) : origFind(ext));
  const r = await runIntakeFlow(files, {}, deps);
  assert.deepEqual(r.groups.map((g) => g.action), ["created", "failed"]);
  assert.match(r.groups[1].error, /DB 다운/);
});

test("placeholderDraft / hasContent: 빈 자리는 비공개·사진 없음·힌트 제목, 글이나 사진이 생기면 내용 있음", () => {
  const p = placeholderDraft({ key: CAT_KEY, client: "온더룩", producedAt: "2026-10-13", title: "고양이탈" }, "id-1", NOW);
  assert.equal(p.published, false);
  assert.equal(p.title, "온더룩 고양이탈");
  assert.equal(p.category, "모자/마스크");
  assert.equal(p.airtableId, "intake:" + CAT_KEY);
  assert.equal(hasContent(p), false);
  assert.equal(hasContent({ ...p, description: "글" }), true);
  assert.equal(hasContent({ ...p, images: ["u"] }), true);
});

/* ── Slack ── */

function sign(secret, ts, body) {
  return `v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`;
}

test("verifySlackSignature: 맞는 서명만 통과, 5분 지난 요청·빈 값·길이 다른 값은 거부", () => {
  const secret = "8f742231b10e8888abcd99yyyzzz85a5";
  const body = '{"type":"event_callback"}';
  const ts = "1700000000";
  const nowMs = 1700000100 * 1000;
  assert.equal(verifySlackSignature({ signingSecret: secret, timestamp: ts, signature: sign(secret, ts, body), rawBody: body, nowMs }), true);
  assert.equal(verifySlackSignature({ signingSecret: secret, timestamp: ts, signature: sign("other", ts, body), rawBody: body, nowMs }), false);
  assert.equal(verifySlackSignature({ signingSecret: secret, timestamp: ts, signature: sign(secret, ts, body), rawBody: body, nowMs: (1700000000 + 301) * 1000 }), false);
  assert.equal(verifySlackSignature({ signingSecret: secret, timestamp: null, signature: sign(secret, ts, body), rawBody: body, nowMs }), false);
  assert.equal(verifySlackSignature({ signingSecret: secret, timestamp: ts, signature: "v0=short", rawBody: body, nowMs }), false);
  assert.equal(verifySlackSignature({ signingSecret: "", timestamp: ts, signature: sign("", ts, body), rawBody: body, nowMs }), false);
});

const FILE = { id: "F1", name: "온더룩-261013-고양이탈 (1).jpg", mimetype: "image/jpeg", url_private_download: "https://files.slack.com/x" };

test("pickPortfolioUpload: 사람이 올린 사진 메시지만, 채널을 주면 그 채널만", () => {
  const ev = { type: "message", subtype: "file_share", channel: "C1", ts: "1.2", user: "U1", files: [FILE] };
  assert.deepEqual(pickPortfolioUpload(ev, "C1"), { channel: "C1", ts: "1.2", threadTs: "1.2", user: "U1", files: [FILE] });
  assert.deepEqual(pickPortfolioUpload(ev, null).files, [FILE]);
  assert.equal(pickPortfolioUpload(ev, "C2"), null);
  assert.equal(pickPortfolioUpload({ ...ev, bot_id: "B1" }, "C1"), null);
  assert.equal(pickPortfolioUpload({ ...ev, subtype: "message_changed" }, "C1"), null);
  assert.equal(pickPortfolioUpload({ ...ev, files: [] }, "C1"), null);
  assert.equal(pickPortfolioUpload({ ...ev, files: [{ id: "F2", name: "a.pdf", mimetype: "application/pdf", url_private: "u" }] }, "C1"), null);
  assert.equal(pickPortfolioUpload({ type: "reaction_added", channel: "C1", ts: "1" }, "C1"), null);
  assert.equal(pickPortfolioUpload(null, "C1"), null);
});

test("pickPortfolioUpload: 스레드 안에서 올리면 답글은 부모 스레드로, 반응은 그 메시지에", () => {
  const ev = { type: "message", subtype: "file_share", channel: "C1", ts: "9.9", thread_ts: "1.2", files: [FILE] };
  const u = pickPortfolioUpload(ev);
  assert.equal(u.ts, "9.9");
  assert.equal(u.threadTs, "1.2");
});

test("pickPortfolioUpload: subtype 없는 메시지에 files 가 달려도 받고, 사진 아닌 파일·주소 없는 파일은 걸러낸다", () => {
  const ev = {
    type: "message",
    channel: "C1",
    ts: "1.2",
    files: [FILE, { id: "F3", name: "메모.txt", mimetype: "text/plain", url_private: "u" }, { id: "F4", name: "x.jpg", mimetype: "image/jpeg", mode: "hidden_by_limit" }],
  };
  assert.deepEqual(pickPortfolioUpload(ev).files, [FILE]);
});

test("isAllowedSlackFileUrl: https 의 slack.com 계열만", () => {
  assert.equal(isAllowedSlackFileUrl("https://files.slack.com/files-pri/T1-F1/download/a.jpg"), true);
  assert.equal(isAllowedSlackFileUrl("https://slack.com/x"), true);
  assert.equal(isAllowedSlackFileUrl("http://files.slack.com/x"), false);
  assert.equal(isAllowedSlackFileUrl("https://files.slack.com.evil.io/x"), false);
  assert.equal(isAllowedSlackFileUrl("https://evil.io/files.slack.com"), false);
  assert.equal(isAllowedSlackFileUrl("not a url"), false);
});

test("shouldIgnoreSlackRetry: 느려서 온 재전송만 버리고, 오류로 온 재전송은 처리한다", () => {
  assert.equal(shouldIgnoreSlackRetry(null, null), false);
  assert.equal(shouldIgnoreSlackRetry("1", "http_timeout"), true);
  assert.equal(shouldIgnoreSlackRetry("1", "http_error"), false);
  assert.equal(shouldIgnoreSlackRetry("2", null), false);
});

test("formatIntakeReply: 등록·추가·실패·건너뜀이 한 답글에 다 보인다", () => {
  const text = formatIntakeReply({
    groups: [
      { key: "k1", client: "온더룩", producedAt: "2026-10-13", titleHint: "고양이탈", imageCount: 2, action: "created", title: "온더룩 고양이 페이퍼 마스크", adminUrl: "https://x/admin/portfolio/1/edit", skippedImages: [] },
      { key: "k3", client: "온더룩", producedAt: "2026-10-13", titleHint: "고양이탈", imageCount: 1, action: "appended", title: "온더룩 고양이 페이퍼 마스크", adminUrl: "https://x/admin/portfolio/1/edit", skippedImages: [] },
      { key: "k2", client: "A", producedAt: "2026-01-01", titleHint: "B", imageCount: 0, action: "failed", error: "쓸 수 있는 사진이 없음", skippedImages: [{ name: "A-260101-B (1).jpg", reason: "깨짐" }] },
    ],
    skipped: [{ name: "IMG_1.jpg", reason: "형식 아님" }],
  });
  assert.match(text, /초안 2건/);
  assert.match(text, /온더룩 고양이 페이퍼 마스크 \(2장, 새 초안\) → https:\/\/x\/admin\/portfolio\/1\/edit/);
  assert.match(text, /\(1장, 기존 초안에 사진 추가\)/);
  assert.match(text, /실패 1건/);
  assert.match(text, /건너뜀 2장/);
  assert.match(text, /'공개' 를 켜면/);
  assert.match(formatIntakeReply({ groups: [], skipped: [] }), /처리할 사진이 없었습니다/);
});

/* ── 실제 sharp 처리 ── */

test("prepareIntakeImage: 3000 폭 사진 → 저장판 1920, 비전판 1280 안쪽, 둘 다 JPEG, EXIF 6(90도) 은 세워진다", async () => {
  const wide = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#c84" } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const r = await prepareIntakeImage(wide);
  const up = await sharp(r.upload).metadata();
  const vi = await sharp(r.vision).metadata();
  assert.equal(up.format, "jpeg");
  assert.equal(r.uploadContentType, "image/jpeg");
  // orientation 6 → 회전해서 세로(2000x3000)가 되고, 폭 제한 1920 으로 줄어든다
  assert.equal(up.width, 1920);
  assert.equal(up.height, 2880);
  assert.equal(up.orientation, undefined);
  assert.equal(vi.format, "jpeg");
  assert.ok(Math.max(vi.width, vi.height) <= VISION_MAX_EDGE);
  assert.equal(r.width, 2000);
  assert.equal(r.height, 3000);
});

test("prepareIntakeImage: PNG·WebP 는 형식과 투명도를 지키고 작은 사진은 키우지 않는다", async () => {
  const transparent = { create: { width: 800, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } };
  const png = await prepareIntakeImage(await sharp(transparent).png().toBuffer());
  const pngMeta = await sharp(png.upload).metadata();
  assert.equal(pngMeta.format, "png");
  assert.equal(png.uploadContentType, "image/png");
  assert.equal(pngMeta.width, 800);
  assert.equal(pngMeta.hasAlpha, true);
  assert.equal((await sharp(png.vision).metadata()).format, "jpeg");

  const webp = await prepareIntakeImage(await sharp(transparent).webp().toBuffer());
  const webpMeta = await sharp(webp.upload).metadata();
  assert.equal(webpMeta.format, "webp");
  assert.equal(webp.uploadContentType, "image/webp");
  assert.equal(webpMeta.hasAlpha, true);
});

test("prepareIntakeImage: 깨진 바이트는 이유 있는 예외", async () => {
  await assert.rejects(() => prepareIntakeImage(Buffer.from("not an image")), /읽을 수 없음/);
});

/* ── CLI ── */

test("CLI chunk: 요청 크기 한도 안에서 순서대로 나누고, 한 장이 한도를 넘어도 혼자 한 청크로 보낸다", () => {
  const files = ["a", "b", "c", "d"].map((n, i) => ({ name: n, base64: "x".repeat(i === 2 ? 50 : 10) }));
  assert.deepEqual(chunk(files, 25).map((c) => c.map((f) => f.name)), [["a", "b"], ["c"], ["d"]]);
  assert.deepEqual(chunk(files, 1000).map((c) => c.length), [4]);
  assert.deepEqual(chunk([], 10), []);
});

test("CLI contentForChunk: imageAlts 만 이번 청크 범위로 자르고 나머지 필드는 그대로", () => {
  const c = { title: "T", imageAlts: ["a1", "a2", "a3", "a4", "a5", "a6"] };
  assert.deepEqual(contentForChunk(c, 4, 2), { title: "T", imageAlts: ["a5", "a6"] });
  assert.deepEqual(contentForChunk({ title: "T" }, 4, 2), { title: "T" });
  assert.equal(contentForChunk(undefined, 0, 1), undefined);
});
