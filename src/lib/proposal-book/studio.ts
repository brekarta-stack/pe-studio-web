/**
 * 스튜디오 고정 정보 — 표지 문의처, 9쪽 실적 숫자, 뒤표지 연락처.
 * 정본은 agents-bd `reference/proposals/editorial/studio.json` 이다. 전화번호·실적이 바뀌면 두 곳을 같이 고친다
 * (원고에 넣지 않는 이유: 기관마다 원고를 새로 쓰는데, 연락처를 원고마다 들고 다니면 하나만 낡는다).
 */

export interface StudioInfo {
  name: string;
  tagline: string;
  contact: { person: string; email: string; phone: string; address: string };
  stats: { num: string; label: string }[];
  clients: string;
}

export const STUDIO: StudioInfo = {
  name: "papercraft.kr",
  tagline: "papercraft.kr 페이퍼 엔지니어링 스튜디오",
  contact: {
    person: "오세기",
    email: "ask@papercraft.kr",
    phone: "010-4075-2661",
    address: "서울 강남구 언주로 563",
  },
  stats: [
    { num: "11건", label: "구조설계 특허" },
    { num: "650+", label: "누적 프로젝트" },
    { num: "4주", label: "평균 납기" },
    { num: "1,000", label: "최소 수량(개)" },
  ],
  clients:
    "경찰청, KAIST, 현대자동차, KBS, 이노션, 라움미술관, 공주시 외. 2차원 전개도를 잘라 조립하는 입체 종이모형을 설계·생산합니다.",
};
