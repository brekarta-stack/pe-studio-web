/**
 * 제작 문의의 유입 배지 — 클라이언트/서버 공용 순수 로직.
 *
 * 원래 QuoteSheet.tsx 안에 있었는데, UTM·gclid 가 있을 때만 배지를 만드는 바람에
 * 구글·네이버 검색이나 외부 링크로 들어온 문의가 referrer 를 멀쩡히 저장해 놓고도
 * 화면에는 전부 "—" 로 보였다(실제로 뜬 건 링크에 utm_source 를 붙여 주는
 * chatgpt.com 정도뿐이었다). 조용히 틀리는 종류의 버그라 테스트가 붙도록
 * 여기로 꺼냈다.
 */

import { parseAcquisition } from "./analytics.ts";
import {
  MANUAL_CHANNEL_LABELS,
  MANUAL_SOURCE,
  isManualChannel,
  type QuoteAcquisition,
} from "./quote-types.ts";

/** 유입 매체 → 한글 라벨. 표가 좁아 짧게 쓴다 */
export const MEDIUM_LABELS: Record<string, string> = {
  cpc:      "광고",
  organic:  "검색",
  social:   "소셜",
  referral: "외부링크",
  direct:   "직접",
  internal: "내부이동",
  campaign: "캠페인",
};

/** 배지 톤 — 광고는 눈에 띄게, 직접 등록은 구분되게, 나머지는 차분하게 */
export type AcqTone = "ad" | "manual" | "plain";

export const ACQ_TONE_STYLE: Record<AcqTone, { background: string; color: string }> = {
  ad:     { background: "#FEE2E2", color: "#B91C1C" },
  manual: { background: "#EEF0FF", color: "#1E22B2" },
  plain:  { background: "#F1F5F9", color: "#475569" },
};

export interface AcqBadge {
  tone: AcqTone;
  text: string;
}

/**
 * 유입정보 → 배지. null 이면 "정보 없음"(유입 수집 이전에 접수된 문의)이고,
 * 이는 "직접 유입"과 구분해서 보여줘야 한다.
 *
 * @param siteHost 우리 사이트 호스트 — referrer 가 우리 사이트면 내부이동으로 걸러낸다
 */
export function acquisitionBadge(
  a: QuoteAcquisition | null | undefined,
  siteHost = ""
): AcqBadge | null {
  if (!a) return null;

  // 관리자가 직접 등록한 문의 — 접수 경로를 utmMedium 에 담아 둔다
  if (a.utmSource === MANUAL_SOURCE) {
    const ch = isManualChannel(a.utmMedium) ? MANUAL_CHANNEL_LABELS[a.utmMedium] : "기타";
    return { tone: "manual", text: `직접 등록 · ${ch}` };
  }

  const { source, medium } = parseAcquisition({
    referrer: a.referrer,
    utmSource: a.utmSource,
    utmMedium: a.utmMedium,
    gclid: a.gclid,
    adHint: a.adHint,
    siteHost,
  });

  // 직접 유입은 source 가 'direct' 라 "direct · 직접"이 되어 군더더기가 된다
  if (medium === "direct") return { tone: "plain", text: "직접 유입" };

  const base = `${source} · ${MEDIUM_LABELS[medium] ?? medium}`;
  return {
    tone: medium === "cpc" ? "ad" : "plain",
    text: a.utmCampaign ? `${base} · ${a.utmCampaign}` : base,
  };
}
