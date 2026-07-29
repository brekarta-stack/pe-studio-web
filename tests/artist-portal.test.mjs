/**
 * 아티스트 포털 로직 테스트 (node --test)
 *   node --test tests/artist-portal.test.mjs
 *
 * 화면으로 확인하기 어렵고 틀리면 조용히 사고가 나는 것들만 검증한다:
 *   · 누가 로그인할 수 있는가 (승인 + 아티스트 매칭)
 *   · 제안 상태 전이 가드 (누가 언제 수락/거절/작업할 수 있는가)
 *   · 아티스트에게 나가는 정산 요약에 매출·마진이 섞이지 않는가
 *   · 대시보드 집계가 거절·취소 건을 제외하는가
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFER_STATUSES,
  isOfferStatus,
  isVisibleToArtist,
  canRespondToOffer,
  canArtistWorkOn,
  artistPayout,
} from "../src/lib/assignment-types.ts";

import {
  canSignIn,
  isInviteValid,
  normalizeEmail,
  isValidEmail,
  signInErrorMessage,
} from "../src/lib/artist-account-types.ts";

import { summarize, partitionWorks } from "../src/lib/artist-portal-types.ts";

/* ── 테스트용 배정 만들기 — 기본은 "수락하고 작업중" ── */
function assignment(overrides = {}) {
  return {
    id: "a1",
    quoteId: "q1",
    artistId: "artist-01",
    status: "working",
    progress: 50,
    artistFee: 1_000_000,
    clientAmount: 2_500_000, // 아티스트에게 절대 나가면 안 되는 값
    feeTaxMode: "none",
    clientVat: false,
    depositAmount: null,
    depositPaidAt: null,
    balancePaidAt: null,
    payoutStatus: "unpaid",
    paidAt: null,
    dueDate: null,
    startedAt: null,
    memo: "",
    offerStatus: "accepted",
    offeredAt: null,
    respondedAt: null,
    declineReason: "",
    deliverables: [],
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

/* ── 포털 업무(ArtistWork) 만들기 — payout 은 실제 함수로 파생시킨다 ── */
function work(overrides = {}) {
  const a = assignment(overrides);
  return {
    id: a.id,
    offerStatus: a.offerStatus,
    offeredAt: a.offeredAt,
    respondedAt: a.respondedAt,
    declineReason: a.declineReason,
    status: a.status,
    progress: a.progress,
    dueDate: a.dueDate,
    startedAt: a.startedAt,
    memo: a.memo,
    deliverables: a.deliverables,
    payout: artistPayout(a),
    brief: { product: "papercraft", files: [] },
  };
}

/* ══ 제안 상태 ══════════════════════════════════════════════ */

test("isOfferStatus — 정의된 값만 통과시킨다", () => {
  for (const s of OFFER_STATUSES) assert.equal(isOfferStatus(s), true, s);
  assert.equal(isOfferStatus("pending"), false, "비슷해 보여도 정의에 없으면 거부");
  assert.equal(isOfferStatus(""), false);
  assert.equal(isOfferStatus(undefined), false);
  assert.equal(isOfferStatus(null), false);
});

test("isVisibleToArtist — draft 만 아티스트에게 숨긴다", () => {
  assert.equal(isVisibleToArtist("draft"), false, "관리자가 조건을 다듬는 중");
  assert.equal(isVisibleToArtist("offered"), true);
  assert.equal(isVisibleToArtist("accepted"), true);
  assert.equal(
    isVisibleToArtist("declined"),
    true,
    "거절한 건도 본인 이력으로 남아 보여야 한다"
  );
});

test("canRespondToOffer — 응답 대기 상태에서만 수락/거절할 수 있다", () => {
  assert.equal(canRespondToOffer("offered"), true);
  assert.equal(canRespondToOffer("draft"), false, "아직 제안되지 않았다");
  assert.equal(canRespondToOffer("accepted"), false, "두 번 수락은 없다");
  assert.equal(canRespondToOffer("declined"), false, "거절 뒤 번복은 관리자 재제안으로만");
});

test("canArtistWorkOn — 수락했고 취소되지 않은 업무만 진행률을 만질 수 있다", () => {
  assert.equal(canArtistWorkOn({ offerStatus: "accepted", status: "working" }), true);
  assert.equal(canArtistWorkOn({ offerStatus: "accepted", status: "review" }), true);
  assert.equal(canArtistWorkOn({ offerStatus: "accepted", status: "done" }), true);

  assert.equal(
    canArtistWorkOn({ offerStatus: "offered", status: "assigned" }),
    false,
    "응답 전에는 작업 정보를 바꿀 수 없다"
  );
  assert.equal(
    canArtistWorkOn({ offerStatus: "declined", status: "cancelled" }),
    false,
    "거절한 일은 진행할 수 없다"
  );
  assert.equal(
    canArtistWorkOn({ offerStatus: "accepted", status: "cancelled" }),
    false,
    "관리자가 취소한 건은 잠긴다"
  );
});

/* ══ 정산 노출 범위 ═════════════════════════════════════════ */

test("artistPayout — 매출·마진은 결과에 존재하지 않는다", () => {
  const p = artistPayout(assignment());
  const keys = Object.keys(p);

  assert.ok(!keys.includes("clientAmount"), "매출이 새어 나가면 안 된다");
  assert.ok(!keys.includes("margin"), "마진이 새어 나가면 안 된다");
  // 값으로도 흘러들지 않았는지 — 2,500,000 이 어디에도 없어야 한다
  assert.ok(
    !Object.values(p).includes(2_500_000),
    "매출 금액이 다른 필드에 실려 나가면 안 된다"
  );
  assert.equal(p.fee, 1_000_000);
});

test("artistPayout — 원천징수 3.3% 는 실지급액에서 공제된다", () => {
  const p = artistPayout(assignment({ feeTaxMode: "withholding" }));
  assert.equal(p.taxAmount, -33_000, "1,000,000 × 3.3% 를 공제");
  assert.equal(p.net, 967_000);
});

test("artistPayout — 사업자(+VAT)는 실지급액에 가산된다", () => {
  const p = artistPayout(assignment({ feeTaxMode: "vat" }));
  assert.equal(p.taxAmount, 100_000);
  assert.equal(p.net, 1_100_000);
});

test("artistPayout — 선금만 지급된 상태를 부분지급으로 읽는다", () => {
  const p = artistPayout(
    assignment({ depositAmount: 400_000, depositPaidAt: "2026-07-10" })
  );
  assert.equal(p.deposit, 400_000);
  assert.equal(p.balance, 600_000, "잔금 = 작업비 − 선금");
  assert.equal(p.paid, 400_000);
  assert.equal(p.unpaid, 600_000);
  assert.equal(p.payoutStatus, "partial");
});

/* ══ 대시보드 집계 ══════════════════════════════════════════ */

test("summarize — 거절·취소 건은 금액 집계에 넣지 않는다", () => {
  const s = summarize([
    work({ id: "w1", offerStatus: "accepted", artistFee: 1_000_000 }),
    work({
      id: "w2",
      offerStatus: "declined",
      status: "cancelled",
      artistFee: 9_000_000, // 거절한 건 — 어느 합계에도 들어가면 안 된다
    }),
    work({
      id: "w3",
      offerStatus: "accepted",
      status: "cancelled",
      artistFee: 5_000_000, // 관리자가 취소한 건도 제외
    }),
  ]);

  assert.equal(s.unpaidTotal, 1_000_000, "살아 있는 업무의 작업비만");
  assert.equal(s.paidTotal, 0);
  assert.equal(s.active, 1);
});

test("summarize — 응답 대기 건은 진행 중에 세지 않는다", () => {
  const s = summarize([
    work({ id: "w1", offerStatus: "offered", status: "assigned", artistFee: 800_000 }),
    work({ id: "w2", offerStatus: "accepted", status: "working", artistFee: 300_000 }),
  ]);

  assert.equal(s.pendingOffers, 1);
  assert.equal(s.active, 1, "수락한 것만 진행 중");
  assert.equal(
    s.unpaidTotal,
    300_000,
    "아직 수락하지 않은 800,000 은 받을 돈이 아니다 — 수락한 건만 센다"
  );
});

test("summarize — 지급 완료분은 paidTotal 로, 잔여는 unpaidTotal 로", () => {
  const s = summarize([
    work({
      id: "w1",
      artistFee: 1_000_000,
      depositAmount: 400_000,
      depositPaidAt: "2026-07-10",
    }),
  ]);
  assert.equal(s.paidTotal, 400_000);
  assert.equal(s.unpaidTotal, 600_000);
});

test("partitionWorks — 탭마다 정확히 한 번씩만 들어간다", () => {
  const works = [
    work({ id: "offer", offerStatus: "offered", status: "assigned" }),
    work({ id: "active", offerStatus: "accepted", status: "working" }),
    work({ id: "done", offerStatus: "accepted", status: "done" }),
    work({ id: "declined", offerStatus: "declined", status: "cancelled" }),
  ];
  const p = partitionWorks(works);

  assert.deepEqual(p.offers.map((w) => w.id), ["offer"]);
  assert.deepEqual(p.active.map((w) => w.id), ["active"]);
  assert.deepEqual(p.done.map((w) => w.id), ["done"]);
  assert.deepEqual(p.declined.map((w) => w.id), ["declined"]);

  const total = p.offers.length + p.active.length + p.done.length + p.declined.length;
  assert.equal(total, works.length, "중복 노출도 누락도 없어야 한다");
});

/* ══ 계정 / 로그인 ══════════════════════════════════════════ */

test("canSignIn — 승인 + 아티스트 매칭이 둘 다 있어야 통과", () => {
  assert.equal(canSignIn({ status: "approved", artistId: "artist-01" }), true);

  assert.equal(
    canSignIn({ status: "approved", artistId: null }),
    false,
    "매칭이 없으면 보여줄 업무를 정할 수 없다"
  );
  assert.equal(canSignIn({ status: "pending", artistId: "artist-01" }), false);
  assert.equal(canSignIn({ status: "rejected", artistId: "artist-01" }), false);
  assert.equal(canSignIn({ status: "disabled", artistId: "artist-01" }), false);
  assert.equal(canSignIn({ status: "invited", artistId: "artist-01" }), false);
  assert.equal(canSignIn(null), false);
  assert.equal(canSignIn(undefined), false);
});

test("isInviteValid — 상태·토큰·만료를 모두 본다", () => {
  const NOW = new Date("2026-08-02T00:00:00Z");

  assert.equal(
    isInviteValid(
      { status: "invited", inviteToken: "t", inviteExpiresAt: "2026-08-10T00:00:00Z" },
      NOW
    ),
    true
  );
  assert.equal(
    isInviteValid(
      { status: "invited", inviteToken: "t", inviteExpiresAt: "2026-08-01T00:00:00Z" },
      NOW
    ),
    false,
    "만료된 초대"
  );
  assert.equal(
    isInviteValid({ status: "invited", inviteToken: null, inviteExpiresAt: null }, NOW),
    false,
    "토큰이 소진된 초대"
  );
  assert.equal(
    isInviteValid(
      { status: "approved", inviteToken: "t", inviteExpiresAt: "2026-08-10T00:00:00Z" },
      NOW
    ),
    false,
    "이미 승인된 계정의 링크는 다시 쓸 수 없다"
  );
  assert.equal(isInviteValid(null, NOW), false);
});

test("normalizeEmail — 대소문자·공백 차이로 계정이 갈라지지 않는다", () => {
  assert.equal(normalizeEmail("  Artist@Gmail.COM "), "artist@gmail.com");
  assert.equal(normalizeEmail(null), "");
  assert.equal(normalizeEmail(undefined), "");
});

test("isValidEmail — 최소 형식만 거른다", () => {
  assert.equal(isValidEmail("a@b.kr"), true);
  assert.equal(isValidEmail("artist@gmail.com"), true);
  assert.equal(isValidEmail("no-at-sign"), false);
  assert.equal(isValidEmail("a@b"), false, "TLD 없음");
  assert.equal(isValidEmail("a b@c.com"), false, "공백 포함");
});

test("signInErrorMessage — 아는 코드는 안내로, 모르는 코드도 문구를 준다", () => {
  assert.match(signInErrorMessage("pending"), /승인/);
  assert.match(signInErrorMessage("not_registered"), /가입/);
  assert.equal(signInErrorMessage(null), null, "에러가 없으면 배너도 없다");
  assert.equal(typeof signInErrorMessage("wat"), "string", "모르는 코드도 빈손으로 두지 않는다");
});
