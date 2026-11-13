/**
 * 작업 공고(선착순 배정) 테스트 (node --test)
 *   node --test tests/job-board.test.mjs
 *
 * 틀리면 조용히 사고가 나는 것만 본다:
 *   · 공고 입력 검증 (작업비·마감일 필수, 지난 마감일 거부, 금액 표기)
 *   · 마감 알림 단계 (50·25·10%, 여러 단계를 한꺼번에 지났을 때 한 통만, 마감 후 침묵)
 *   · 작업자 화면에 고객 신원·견적가가 나갈 길이 없는가 (조회 컬럼·메일 본문)
 *   · 가져간 공고는 작업자에게 보이지 않는가
 *   · DB 제약·크론 설정이 코드와 맞는가
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  ADMIN_WORKER,
  JOB_STATUSES,
  WORKER_ROSTER,
  deadlineMs,
  dueAlertStage,
  formatRemaining,
  isIsoDate,
  isVisibleToWorkers,
  parseWon,
  validatePosting,
  workerEmail,
} from "../src/lib/job-board-types.ts";
import { dueAlertMail, loginLinkMail, newJobMail } from "../src/lib/job-mail-content.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/* ── 명단 ─────────────────────────────────────────────────── */

test("명단: 운영자가 준 세 사람과 메일 주소, 관리자 가져가기는 오세기", () => {
  const byName = Object.fromEntries(WORKER_ROSTER.map((w) => [w.name, w.email]));
  assert.deepEqual(byName, {
    오세기: "ask@papercraft.kr",
    김철호: "finalpaper@naver.com",
    박형미: "dinonabi@naver.com",
  });
  assert.equal(ADMIN_WORKER.name, "오세기");
  assert.equal(ADMIN_WORKER.artistId, "artist-04");
});

test("workerEmail: 명단이 우선, 없으면 포털 계정 이메일, 둘 다 없으면 null", () => {
  assert.equal(workerEmail("artist-01", "other@gmail.com"), "finalpaper@naver.com");
  assert.equal(workerEmail("artist-02", " moon@naver.com "), "moon@naver.com");
  assert.equal(workerEmail("artist-02", null), null);
  assert.equal(workerEmail("artist-02", ""), null);
});

/* ── 입력 검증 ────────────────────────────────────────────── */

test("parseWon: 쉼표·원·만 단위를 읽고, 이상한 값은 NaN", () => {
  assert.equal(parseWon("1,500,000"), 1_500_000);
  assert.equal(parseWon("150만"), 1_500_000);
  assert.equal(parseWon("1.5만"), 15_000);
  assert.equal(parseWon("38,000원"), 38_000);
  assert.equal(parseWon(""), null);
  assert.equal(parseWon("  "), null);
  assert.equal(parseWon(null), null);
  assert.ok(Number.isNaN(parseWon("12a")));
  assert.ok(Number.isNaN(parseWon("-100")));
});

test("isIsoDate: 존재하지 않는 날짜는 거부", () => {
  assert.ok(isIsoDate("2026-11-30"));
  assert.ok(!isIsoDate("2026-02-30"));
  assert.ok(!isIsoDate("2026-11-3"));
  assert.ok(!isIsoDate(""));
});

const TODAY = "2026-11-13";

test("validatePosting: 공고는 작업비·마감일이 있어야 하고, 지난 마감일은 거부", () => {
  const base = { clientAmount: "3,800,000", artistFee: "1,500,000", dueDate: "2026-11-20", memo: "  메모  " };
  const ok = validatePosting(base, { open: true, todayKst: TODAY });
  assert.deepEqual(ok, { ok: true, value: { clientAmount: 3_800_000, artistFee: 1_500_000, dueDate: "2026-11-20", memo: "메모" } });

  assert.equal(validatePosting({ ...base, artistFee: "" }, { open: true, todayKst: TODAY }).ok, false);
  assert.equal(validatePosting({ ...base, artistFee: "0" }, { open: true, todayKst: TODAY }).ok, false);
  assert.equal(validatePosting({ ...base, dueDate: "" }, { open: true, todayKst: TODAY }).ok, false);
  assert.equal(validatePosting({ ...base, dueDate: "2026-11-12" }, { open: true, todayKst: TODAY }).ok, false);
  // 오늘 마감은 허용 (그날 23:59 KST 까지)
  assert.equal(validatePosting({ ...base, dueDate: TODAY }, { open: true, todayKst: TODAY }).ok, true);
  // 견적가는 선택
  assert.equal(validatePosting({ ...base, clientAmount: "" }, { open: true, todayKst: TODAY }).ok, true);
});

test("validatePosting: 저장만(open=false)은 빈 칸을 허용하되 형식 오류는 막는다", () => {
  assert.equal(validatePosting({ clientAmount: "", artistFee: "", dueDate: "", memo: "" }, { open: false, todayKst: TODAY }).ok, true);
  assert.equal(validatePosting({ clientAmount: "abc", artistFee: "", dueDate: "", memo: "" }, { open: false, todayKst: TODAY }).ok, false);
  assert.equal(validatePosting({ clientAmount: "", artistFee: "", dueDate: "2026-13-01", memo: "" }, { open: false, todayKst: TODAY }).ok, false);
  assert.equal(validatePosting({ clientAmount: "", artistFee: "", dueDate: "", memo: "x".repeat(2001) }, { open: false, todayKst: TODAY }).ok, false);
  assert.equal(validatePosting({ clientAmount: "99999999999", artistFee: "", dueDate: "", memo: "" }, { open: false, todayKst: TODAY }).ok, false);
});

/* ── 마감 알림 ────────────────────────────────────────────── */

test("deadlineMs: 마감일 23:59:59 KST", () => {
  assert.equal(new Date(deadlineMs("2026-11-20")).toISOString(), "2026-11-20T14:59:59.000Z");
});

/** 가져간 시각과 마감 사이를 100 으로 나눈 시각 */
function at(claimedAt, dueDate, pctElapsed) {
  const s = Date.parse(claimedAt);
  return s + ((deadlineMs(dueDate) - s) * pctElapsed) / 100;
}

const claimed = { claimedAt: "2026-11-10T00:59:59.000Z", dueDate: "2026-11-20", alert50At: null, alert25At: null, alert10At: null };

test("dueAlertStage: 50% → 25% → 10% 를 차례로 한 번씩", () => {
  assert.equal(dueAlertStage(claimed, at(claimed.claimedAt, claimed.dueDate, 49)), null, "아직 절반이 안 지났다");
  assert.deepEqual(dueAlertStage(claimed, at(claimed.claimedAt, claimed.dueDate, 50)), { send: 50, skip: [] });

  const after50 = { ...claimed, alert50At: "x" };
  assert.equal(dueAlertStage(after50, at(claimed.claimedAt, claimed.dueDate, 60)), null, "50% 는 이미 보냈다");
  assert.deepEqual(dueAlertStage(after50, at(claimed.claimedAt, claimed.dueDate, 76)), { send: 25, skip: [] });

  const after25 = { ...after50, alert25At: "x" };
  assert.deepEqual(dueAlertStage(after25, at(claimed.claimedAt, claimed.dueDate, 91)), { send: 10, skip: [] });
  assert.equal(dueAlertStage({ ...after25, alert10At: "x" }, at(claimed.claimedAt, claimed.dueDate, 95)), null);
});

test("dueAlertStage: 점검 공백으로 여러 단계를 지났으면 가장 급한 한 통만, 나머지는 건너뜀", () => {
  assert.deepEqual(dueAlertStage(claimed, at(claimed.claimedAt, claimed.dueDate, 92)), { send: 10, skip: [50, 25] });
  assert.deepEqual(dueAlertStage(claimed, at(claimed.claimedAt, claimed.dueDate, 80)), { send: 25, skip: [50] });
});

test("dueAlertStage: 마감이 지났거나 기간이 없으면 보내지 않는다", () => {
  assert.equal(dueAlertStage(claimed, deadlineMs(claimed.dueDate) + 1), null);
  // 마감 시각 이후에 가져간 경우
  assert.equal(dueAlertStage({ ...claimed, claimedAt: "2026-11-21T00:00:00Z" }, Date.parse("2026-11-21T01:00:00Z")), null);
  assert.equal(dueAlertStage({ ...claimed, claimedAt: null }, Date.now()), null);
  assert.equal(dueAlertStage({ ...claimed, dueDate: null }, Date.now()), null);
});

test("dueAlertStage: 당일 마감도 비율대로 (오전 9시에 가져가 23:59 마감)", () => {
  const sameDay = { ...claimed, claimedAt: "2026-11-20T00:00:00Z", dueDate: "2026-11-20" }; // 09:00 KST
  // 15시간 구간의 절반 = 16:30 KST
  assert.equal(dueAlertStage(sameDay, Date.parse("2026-11-20T07:00:00Z")), null);
  assert.deepEqual(dueAlertStage(sameDay, Date.parse("2026-11-20T07:31:00Z")), { send: 50, skip: [] });
});

test("formatRemaining", () => {
  assert.equal(formatRemaining(0), "마감 지남");
  assert.equal(formatRemaining(40 * 60_000), "40분");
  assert.equal(formatRemaining(3 * 3600_000 + 5 * 60_000), "3시간");
  assert.equal(formatRemaining(2 * 86400_000 + 5 * 3600_000), "2일 5시간");
  assert.equal(formatRemaining(2 * 86400_000), "2일");
});

/* ── 작업자 노출 ──────────────────────────────────────────── */

test("isVisibleToWorkers: 공고 중 + 문의 진행 중 + 마감 전일 때만", () => {
  const open = { status: "open", artistFee: 100, dueDate: "2026-11-20" };
  const live = { active: true, dropped: false };
  const today = "2026-11-13";
  assert.ok(isVisibleToWorkers(open, live, today));
  assert.ok(isVisibleToWorkers(open, live, "2026-11-20"), "마감 당일은 아직 보인다");
  assert.ok(!isVisibleToWorkers(open, live, "2026-11-21"), "마감이 지난 공고는 숨긴다");
  assert.ok(!isVisibleToWorkers({ ...open, status: "claimed" }, live, today), "가져간 공고는 다른 작업자에게 안 보인다");
  assert.ok(!isVisibleToWorkers({ ...open, status: "draft" }, live, today));
  assert.ok(!isVisibleToWorkers({ ...open, artistFee: null }, live, today));
  assert.ok(!isVisibleToWorkers(open, { active: true, dropped: true }, today), "Drop 한 문의");
  assert.ok(!isVisibleToWorkers(open, { active: false, dropped: false }, today), "완료 단계로 옮긴 문의");
  assert.ok(!isVisibleToWorkers(open, null, today), "삭제된 문의");
});

test("가져가기: 회수된 같은 작업자 배정은 새로 넣지 않고 다시 쓴다(유니크 23505 회피), 연결은 캘린더보다 먼저", () => {
  const src = read("src/lib/job-board.ts");
  const claim = src.slice(src.indexOf("export async function claimPosting"), src.indexOf("/** 캘린더 일정 등록"));
  assert.match(claim, /existing\.find\(\(a\) => a\.artistId === artistId\)/);
  assert.ok(claim.indexOf("assignment_id: assignmentId") < claim.indexOf("recordCalendar("), "배정 연결이 캘린더 뒤에 있다");
  assert.match(claim, /\.eq\("claimed_by", artistId\)\s*\.select\("id"\)/);
});

test("이메일 로그인: 막힌 계정은 authorize 에서 null (상대 URL 거부 응답으로 버튼이 멈추지 않게)", () => {
  const src = read("src/lib/auth.ts");
  assert.match(src, /if \(!canSignIn\(account\)\) return null;/);
});

test("작업자 조회 컬럼에 고객 신원·견적가가 없다", () => {
  const src = read("src/lib/job-board.ts");
  const cols = (name) => {
    const m = new RegExp(`const ${name} =\\s*"([^"]+)"`).exec(src);
    assert.ok(m, `${name} 를 찾지 못했다`);
    return m[1].split(",").map((c) => c.trim());
  };
  const quoteCols = cols("QUOTE_JOB_COLUMNS");
  for (const banned of ["name", "email", "phone", "acquisition", "*"]) {
    assert.ok(!quoteCols.includes(banned), `quotes.${banned} 가 작업자 조회에 들어 있다`);
  }
  const postingCols = cols("POSTING_WORKER_COLUMNS");
  assert.ok(!postingCols.includes("client_amount"), "견적가가 작업자 조회에 들어 있다");
  assert.ok(!postingCols.includes("*"));
});

test("메일 본문: 작업자에게 가는 메일은 견적가를 인자로도 받지 않고, HTML 을 이스케이프한다", () => {
  const job = { product: "페이퍼토이", quantity: "500개", artistFee: 1_500_000, dueDate: "2026-11-20", memo: "<b>주의</b> 색상" };
  const m = newJobMail(job, "https://www.papercraft.kr/artist/jobs/abc");
  assert.match(m.subject, /새 작업 공고/);
  assert.match(m.text, /1,500,000원/);
  assert.ok(!m.html.includes("<b>주의</b>"), "메모 HTML 이 그대로 들어갔다");
  assert.ok(m.html.includes("&lt;b&gt;주의&lt;/b&gt;"));
  assert.ok(m.html.startsWith("<!doctype html><html><head><meta charset=\"utf-8\">"));
  assert.ok(!m.html.includes("₩"));

  const a = dueAlertMail({ ...job, workerName: "김철호" }, 25, 2 * 86400_000, "https://x/artist/works/1");
  assert.match(a.subject, /마감 25% 남음/);
  assert.match(a.text, /2일/);
  assert.match(a.text, /김철호/);

  const l = loginLinkMail("https://x/artist/login/verify?token=t", 15);
  assert.match(l.text, /15분/);
  assert.match(l.text, /verify\?token=t/);
});

/* ── 설정 정합성 ─────────────────────────────────────────── */

test("DB 상태 제약이 코드의 상태 목록과 같다", () => {
  const sql = read("supabase/migrations/20261113_job_board.sql");
  const m = /status IN \(([^)]+)\)/.exec(sql);
  assert.ok(m);
  const dbStatuses = m[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(dbStatuses, [...JOB_STATUSES]);
});

test("마이그레이션이 김철호·박형미 계정을 명단과 같은 아티스트로 넣는다", () => {
  // 줄맞춤 공백은 무시한다
  const sql = read("supabase/migrations/20261113_job_board.sql").replace(/,\s+/g, ", ");
  for (const w of WORKER_ROSTER.filter((x) => !x.admin)) {
    assert.ok(sql.includes(`('${w.email}', '${w.artistId}', '${w.name}')`), `${w.name} 계정 시드가 명단과 다르다`);
  }
});

test("vercel.json: 알림 크론은 하루 1회(Hobby 제한), 마이그레이션은 실행 허용 목록에 있다", () => {
  const { crons } = JSON.parse(read("vercel.json"));
  const cron = crons.find((c) => c.path === "/api/cron/job-alerts");
  assert.ok(cron, "job-alerts 크론이 없다");
  const [minute, hour] = cron.schedule.split(/\s+/);
  assert.match(minute, /^\d+$/);
  assert.match(hour, /^\d+$/);
  assert.ok(read("src/app/api/admin/migrate/route.ts").includes('"migrations/20261113_job_board.sql"'));
});

test("이메일 로그인 공급자는 관리자 이메일을 통과시키지 않는다", () => {
  const src = read("src/lib/auth.ts");
  const block = src.slice(src.indexOf('id: "email-link"'), src.indexOf('id: "email-link"') + 800);
  assert.match(block, /isAdminEmail\(email, ADMIN_EMAILS\)\) return null/);
});
