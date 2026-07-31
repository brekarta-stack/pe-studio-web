"use client";

import type { QuoteAcquisition } from "./quote-types";

/**
 * 광고 유입정보(gclid·UTM)를 견적 제출에 첨부하기 위한 클라이언트 헬퍼.
 *
 * instrumentation-client.ts 가 세션 첫 진입 때 sessionStorage(키: "pc_acq")에
 * { referrer, utmSource, utmMedium, utmCampaign, gclid, adHint } 형태로 저장해 둔다.
 * 여기서는 그 값을 그대로 읽어 /api/quote 제출 본문에 실어 보낸다.
 *
 * ⚠️ 키 "pc_acq" 는 instrumentation-client.ts 의 ACQ_KEY 와 반드시 동일해야 한다.
 */
const ACQ_KEY = "pc_acq";

/** 값이 하나도 없는 유입정보 = 직접 유입(북마크·주소 직접입력·앱 등) */
const EMPTY: QuoteAcquisition = {
  referrer: "",
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
  gclid: "",
  adHint: "",
};

/**
 * 값이 전부 비어 있어도 **객체를 그대로 돌려준다**.
 *
 * 예전에는 빈 객체를 null 로 바꿔 아예 저장하지 않았다. 그래서 어드민 유입 열에서
 * "직접 유입으로 들어온 문의"와 "유입 수집 이전에 접수돼 정보가 없는 문의"가
 * 똑같이 "—" 로 보여 구분할 수 없었다.
 *
 * 이제 신규 문의는 항상 유입정보를 남긴다 → acquisition 이 NULL 인 건
 * "수집 이전 데이터"라는 뜻으로만 남는다.
 */
export function getStoredAcquisition(): QuoteAcquisition {
  try {
    const cached = sessionStorage.getItem(ACQ_KEY);
    if (!cached) return EMPTY;
    const a = JSON.parse(cached) as Partial<QuoteAcquisition>;
    return {
      referrer: a.referrer ?? "",
      utmSource: a.utmSource ?? "",
      utmMedium: a.utmMedium ?? "",
      utmCampaign: a.utmCampaign ?? "",
      gclid: a.gclid ?? "",
      adHint: a.adHint ?? "",
    };
  } catch {
    return EMPTY;
  }
}
