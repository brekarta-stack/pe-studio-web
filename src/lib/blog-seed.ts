/**
 * 블로그 시드 글 — DB(supabase) 가 비어 있을 때도 SEO 색인을 시작하기 위한
 * 코드 내장 콘텐츠. 각 글은 src/lib/blog.ts 의 getPosts() / getPostBySlug() 에서
 * Supabase 결과와 머지되며, 동일 slug 가 DB 에 들어오면 DB 가 우선.
 *
 * 각 글은 인라인 <figure><svg/></figure> 일러스트를 본문에 직접 포함.
 * (blog/[slug]/page.tsx 의 ReactMarkdown 이 rehype-raw 로 raw HTML 을 허용)
 *
 * 작성 시기: 2026-05 (초기 SEO 시드)
 */

import type { Post } from "./blog";

/**
 * 인라인 SVG figure를 한 줄로 정규화한다.
 * 마크다운(remark + rehype-raw) 렌더 시 raw HTML 블록은 "빈 줄"에서 종료되고,
 * 4칸 이상 들여쓴 줄은 "들여쓰기 코드 블록"으로 인식되어 SVG 소스가 그대로 노출된다.
 * 줄바꿈 + 뒤따르는 공백을 단일 공백으로 합쳐 두 문제를 모두 제거한다.
 * (SVG/HTML은 태그 사이 공백을 무시하므로 시각적 영향 없음)
 */
const oneLine = (s: string): string => s.replace(/\n\s*/g, " ").trim();

/* ──────────────────────────────────────────────
 * 재사용 가능한 인라인 일러스트 (markdown 본문 안에 들어감)
 * ────────────────────────────────────────────── */

// 페스티벌/축제 일러스트 (천막 + 캐릭터 페이퍼토이)
const FigFestival = oneLine(`<figure class="not-prose my-8 rounded-2xl overflow-hidden bg-gradient-to-br from-cyan-50 to-blue-50 border border-cyan-100">
<svg viewBox="0 0 720 320" class="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="tent1" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#06C6C8"/><stop offset="100%" stop-color="#1E22B2"/></linearGradient></defs>
  <!-- 지면 -->
  <rect x="0" y="270" width="720" height="50" fill="#E0F7F8"/>
  <!-- 가운데 축제 천막 -->
  <path d="M270 270 L360 130 L450 270 Z" fill="url(#tent1)"/>
  <path d="M285 270 L360 165 L435 270" stroke="white" stroke-width="2" fill="none" opacity="0.4"/>
  <rect x="345" y="200" width="30" height="70" fill="#1E22B2"/>
  <!-- 깃발 -->
  <line x1="360" y1="100" x2="360" y2="130" stroke="#1E22B2" stroke-width="2"/>
  <path d="M360 105 L390 115 L360 125 Z" fill="#F5C518"/>
  <!-- 좌측 페이퍼토이 캐릭터 -->
  <g transform="translate(140,170)">
    <path d="M-30 -10 L30 -10 L35 60 L-35 60 Z" fill="white" stroke="#1E22B2" stroke-width="1.5"/>
    <path d="M-30 -10 L-15 -35 L15 -35 L30 -10 Z" fill="#F5C518" stroke="#1E22B2" stroke-width="1.5"/>
    <circle cx="-10" cy="10" r="3" fill="#1E22B2"/><circle cx="10" cy="10" r="3" fill="#1E22B2"/>
    <path d="M-10 30 Q0 38 10 30" stroke="#1E22B2" stroke-width="2" fill="none" stroke-linecap="round"/>
    <rect x="-25" y="60" width="15" height="35" fill="white" stroke="#1E22B2" stroke-width="1.5"/>
    <rect x="10" y="60" width="15" height="35" fill="white" stroke="#1E22B2" stroke-width="1.5"/>
  </g>
  <!-- 우측 페이퍼토이 캐릭터 (다른 색상) -->
  <g transform="translate(580,170)">
    <path d="M-30 -10 L30 -10 L35 60 L-35 60 Z" fill="white" stroke="#1E22B2" stroke-width="1.5"/>
    <path d="M-30 -10 L-15 -35 L15 -35 L30 -10 Z" fill="#E91E8C" stroke="#1E22B2" stroke-width="1.5"/>
    <circle cx="-10" cy="10" r="3" fill="#1E22B2"/><circle cx="10" cy="10" r="3" fill="#1E22B2"/>
    <path d="M-10 30 Q0 38 10 30" stroke="#1E22B2" stroke-width="2" fill="none" stroke-linecap="round"/>
    <rect x="-25" y="60" width="15" height="35" fill="white" stroke="#1E22B2" stroke-width="1.5"/>
    <rect x="10" y="60" width="15" height="35" fill="white" stroke="#1E22B2" stroke-width="1.5"/>
  </g>
  <!-- 떠다니는 종이 조각들 -->
  <g opacity="0.6"><rect x="80" y="60" width="20" height="20" fill="#F5C518" transform="rotate(15 90 70)"/></g>
  <g opacity="0.6"><rect x="640" y="80" width="16" height="16" fill="#06C6C8" transform="rotate(-20 648 88)"/></g>
  <g opacity="0.6"><rect x="490" y="50" width="14" height="14" fill="#E91E8C" transform="rotate(30 497 57)"/></g>
</svg>
<figcaption class="text-xs text-slate-500 text-center py-2 bg-white/50">▲ 지역 캐릭터를 페이퍼토이로 만들면 축제 현장의 시각적 임팩트가 즉시 올라갑니다.</figcaption>
</figure>`);

// 비용 비교 차트
const FigCostCompare = oneLine(`<figure class="not-prose my-8 rounded-2xl overflow-hidden bg-white border border-slate-200">
<svg viewBox="0 0 720 280" class="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
  <text x="360" y="35" text-anchor="middle" font-family="Pretendard, sans-serif" font-size="16" font-weight="700" fill="#1E22B2">1,000개 제작 시 단가 비교 (예시)</text>
  <!-- Y축 라벨 -->
  <text x="80" y="80" font-family="Pretendard" font-size="13" fill="#475569">텀블러</text>
  <text x="80" y="130" font-family="Pretendard" font-size="13" fill="#475569">에코백</text>
  <text x="80" y="180" font-family="Pretendard" font-size="13" fill="#475569">아크릴 키링</text>
  <text x="80" y="230" font-family="Pretendard" font-size="13" font-weight="700" fill="#1E22B2">페이퍼토이</text>
  <!-- 막대 -->
  <rect x="170" y="65" width="380" height="22" rx="4" fill="#E2E8F0"/>
  <text x="560" y="81" font-family="Pretendard" font-size="13" fill="#475569">약 8,000원/개</text>
  <rect x="170" y="115" width="220" height="22" rx="4" fill="#E2E8F0"/>
  <text x="400" y="131" font-family="Pretendard" font-size="13" fill="#475569">약 4,500원/개</text>
  <rect x="170" y="165" width="180" height="22" rx="4" fill="#E2E8F0"/>
  <text x="360" y="181" font-family="Pretendard" font-size="13" fill="#475569">약 3,500원/개</text>
  <rect x="170" y="215" width="120" height="22" rx="4" fill="url(#barg)"/>
  <defs><linearGradient id="barg" x1="0%" x2="100%"><stop offset="0%" stop-color="#06C6C8"/><stop offset="100%" stop-color="#E91E8C"/></linearGradient></defs>
  <text x="300" y="231" font-family="Pretendard" font-size="13" font-weight="700" fill="#1E22B2">약 2,000~3,000원/개</text>
</svg>
<figcaption class="text-xs text-slate-500 text-center py-2 bg-slate-50">▲ 수량·옵션에 따라 다르나, 동일 예산으로 더 많은 수량 제작이 가능합니다.</figcaption>
</figure>`);

// 교실 + 학생 + 페이퍼토이 일러스트
const FigClassroom = oneLine(`<figure class="not-prose my-8 rounded-2xl overflow-hidden bg-gradient-to-br from-amber-50 to-yellow-50 border border-amber-100">
<svg viewBox="0 0 720 320" class="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
  <!-- 바닥 -->
  <rect x="0" y="260" width="720" height="60" fill="#FFF3D0"/>
  <!-- 칠판 -->
  <rect x="60" y="40" width="280" height="160" rx="6" fill="#1E22B2"/>
  <rect x="65" y="45" width="270" height="150" rx="4" fill="#171AB0"/>
  <text x="200" y="100" text-anchor="middle" font-family="Pretendard" font-size="20" font-weight="700" fill="white">STEAM</text>
  <text x="200" y="135" text-anchor="middle" font-family="Pretendard" font-size="14" fill="#F5C518">페이퍼 엔지니어링 교실</text>
  <!-- 도형 전개도 (작게) -->
  <g transform="translate(160 150) scale(0.5)" opacity="0.6">
    <rect x="20" y="0" width="30" height="30" stroke="white" stroke-width="1.5" fill="none"/>
    <rect x="0" y="30" width="80" height="30" stroke="white" stroke-width="1.5" fill="none"/>
    <rect x="20" y="60" width="30" height="30" stroke="white" stroke-width="1.5" fill="none"/>
  </g>
  <!-- 책상 -->
  <rect x="400" y="180" width="240" height="20" rx="3" fill="#8B5A3C"/>
  <rect x="420" y="200" width="10" height="60" fill="#8B5A3C"/>
  <rect x="610" y="200" width="10" height="60" fill="#8B5A3C"/>
  <!-- 책상 위 페이퍼토이 (움직이는 캐릭터) -->
  <g transform="translate(520,150)">
    <path d="M-25 -5 L25 -5 L28 35 L-28 35 Z" fill="white" stroke="#1E22B2" stroke-width="1.5"/>
    <path d="M-25 -5 L-12 -25 L12 -25 L25 -5 Z" fill="#06C6C8" stroke="#1E22B2" stroke-width="1.5"/>
    <circle cx="-7" cy="10" r="2.5" fill="#1E22B2"/><circle cx="7" cy="10" r="2.5" fill="#1E22B2"/>
    <path d="M-7 22 Q0 28 7 22" stroke="#1E22B2" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  </g>
  <!-- 학생 (실루엣) -->
  <g transform="translate(480,260)">
    <circle cx="0" cy="-50" r="14" fill="#1E22B2"/>
    <path d="M-15 -35 L15 -35 L20 0 L-20 0 Z" fill="#1E22B2"/>
  </g>
  <g transform="translate(560,260)">
    <circle cx="0" cy="-50" r="14" fill="#E91E8C"/>
    <path d="M-15 -35 L15 -35 L20 0 L-20 0 Z" fill="#E91E8C"/>
  </g>
  <!-- 떠다니는 종이 -->
  <g opacity="0.5"><rect x="380" y="70" width="18" height="18" fill="#F5C518" transform="rotate(20 389 79)"/></g>
  <g opacity="0.5"><rect x="660" y="100" width="14" height="14" fill="#06C6C8" transform="rotate(-15 667 107)"/></g>
</svg>
<figcaption class="text-xs text-slate-600 text-center py-2 bg-white/60">▲ 학교만의 오리지널 페이퍼 엔지니어링 교구는 정체성과 입소문 효과를 동시에 만듭니다.</figcaption>
</figure>`);

// SNS 확산 다이어그램
const FigSnsShare = oneLine(`<figure class="not-prose my-8 rounded-2xl overflow-hidden bg-gradient-to-br from-pink-50 to-rose-50 border border-pink-100">
<svg viewBox="0 0 720 280" class="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
  <!-- 가운데 페이퍼토이 -->
  <g transform="translate(360,140)">
    <path d="M-30 -10 L30 -10 L35 50 L-35 50 Z" fill="white" stroke="#1E22B2" stroke-width="2"/>
    <path d="M-30 -10 L-15 -35 L15 -35 L30 -10 Z" fill="#F5C518" stroke="#1E22B2" stroke-width="2"/>
    <circle cx="-10" cy="10" r="3.5" fill="#1E22B2"/><circle cx="10" cy="10" r="3.5" fill="#1E22B2"/>
    <path d="M-10 30 Q0 38 10 30" stroke="#1E22B2" stroke-width="2" fill="none" stroke-linecap="round"/>
  </g>
  <!-- 화살표 + 폰 4개 (사방으로 퍼지는 효과) -->
  ${[
    { x: 130, y: 70, label: "Instagram" },
    { x: 590, y: 70, label: "TikTok" },
    { x: 130, y: 210, label: "유튜브 쇼츠" },
    { x: 590, y: 210, label: "블로그" },
  ]
    .map(
      (p) =>
        `<g>
          <line x1="360" y1="140" x2="${p.x}" y2="${p.y}" stroke="#E91E8C" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.5"/>
          <rect x="${p.x - 25}" y="${p.y - 35}" width="50" height="70" rx="8" fill="white" stroke="#E91E8C" stroke-width="2"/>
          <rect x="${p.x - 20}" y="${p.y - 30}" width="40" height="55" rx="3" fill="#FFE8F0"/>
          <text x="${p.x}" y="${p.y + 55}" text-anchor="middle" font-family="Pretendard" font-size="11" font-weight="600" fill="#E91E8C">${p.label}</text>
        </g>`
    )
    .join("")}
</svg>
<figcaption class="text-xs text-slate-600 text-center py-2 bg-white/60">▲ 움직이는 종이는 정적 이미지보다 SNS 공유율이 압도적으로 높습니다.</figcaption>
</figure>`);

// 손과 종이 접기 (AI 시대 인지 효과)
const FigHandsPaper = oneLine(`<figure class="not-prose my-8 rounded-2xl overflow-hidden bg-gradient-to-br from-violet-50 to-blue-50 border border-violet-100">
<svg viewBox="0 0 720 320" class="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
  <!-- 좌: AI/컴퓨터 (납작한 회로) -->
  <g transform="translate(170,160)">
    <rect x="-60" y="-50" width="120" height="80" rx="6" fill="#E2E8F0" stroke="#94A3B8" stroke-width="2"/>
    <rect x="-50" y="-40" width="100" height="60" rx="3" fill="#475569"/>
    <text x="0" y="-5" text-anchor="middle" font-family="Pretendard" font-size="14" font-weight="700" fill="#06C6C8">AI</text>
    <text x="0" y="13" text-anchor="middle" font-family="Pretendard" font-size="10" fill="#94A3B8">자동 생성</text>
    <rect x="-30" y="30" width="60" height="6" fill="#94A3B8"/>
    <rect x="-15" y="36" width="30" height="14" fill="#94A3B8"/>
    <text x="0" y="80" text-anchor="middle" font-family="Pretendard" font-size="12" fill="#64748B">출력만 받는다</text>
  </g>
  <!-- VS -->
  <text x="360" y="170" text-anchor="middle" font-family="Pretendard" font-size="24" font-weight="800" fill="#1E22B2">VS</text>
  <!-- 우: 손이 종이 접는 모습 -->
  <g transform="translate(550,160)">
    <!-- 종이 (입체) -->
    <path d="M-40 -30 L40 -30 L45 30 L-45 30 Z" fill="white" stroke="#1E22B2" stroke-width="2"/>
    <path d="M-40 -30 L-20 -50 L20 -50 L40 -30 Z" fill="#F5C518" stroke="#1E22B2" stroke-width="2"/>
    <line x1="-40" y1="-30" x2="40" y2="-30" stroke="#1E22B2" stroke-width="1.5" stroke-dasharray="4 4"/>
    <!-- 손 (단순화) -->
    <g transform="translate(-30 35)">
      <path d="M0 0 Q-5 -10 0 -20 L20 -25 L30 -15 L25 5 Z" fill="#FFE5C2" stroke="#A08055" stroke-width="1.5"/>
    </g>
    <g transform="translate(30 35)">
      <path d="M0 0 Q5 -10 0 -20 L-20 -25 L-30 -15 L-25 5 Z" fill="#FFE5C2" stroke="#A08055" stroke-width="1.5"/>
    </g>
    <text x="0" y="80" text-anchor="middle" font-family="Pretendard" font-size="12" font-weight="700" fill="#1E22B2">직접 손으로 만든다</text>
  </g>
</svg>
<figcaption class="text-xs text-slate-600 text-center py-2 bg-white/60">▲ AI가 결과물을 만들수록, 인간의 인지·운동 발달은 직접 손을 쓸 때 일어납니다.</figcaption>
</figure>`);

// 기하학 변환 (평면 → 입체)
const FigGeometry = oneLine(`<figure class="not-prose my-8 rounded-2xl overflow-hidden bg-gradient-to-br from-cyan-50 to-sky-50 border border-cyan-100">
<svg viewBox="0 0 720 280" class="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
  <!-- 좌: 평면 전개도 -->
  <g transform="translate(160,140)">
    <rect x="-30" y="-60" width="60" height="40" stroke="#1E22B2" stroke-width="2" fill="white"/>
    <rect x="-70" y="-20" width="40" height="60" stroke="#1E22B2" stroke-width="2" fill="white"/>
    <rect x="-30" y="-20" width="60" height="60" stroke="#1E22B2" stroke-width="2" fill="#F0F2FF"/>
    <rect x="30" y="-20" width="40" height="60" stroke="#1E22B2" stroke-width="2" fill="white"/>
    <rect x="-30" y="40" width="60" height="40" stroke="#1E22B2" stroke-width="2" fill="white"/>
    <text x="0" y="120" text-anchor="middle" font-family="Pretendard" font-size="13" font-weight="600" fill="#1E22B2">평면 전개도</text>
  </g>
  <!-- 화살표 -->
  <g transform="translate(360,140)">
    <line x1="-50" y1="0" x2="50" y2="0" stroke="#E91E8C" stroke-width="3" marker-end="url(#arrow)"/>
    <text x="0" y="-15" text-anchor="middle" font-family="Pretendard" font-size="14" font-weight="700" fill="#E91E8C">접기</text>
    <text x="0" y="25" text-anchor="middle" font-family="Pretendard" font-size="11" fill="#64748B">기하학 사고</text>
  </g>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="#E91E8C"/></marker>
  </defs>
  <!-- 우: 입체 정육면체 -->
  <g transform="translate(560,140)">
    <path d="M-40 -20 L0 -50 L40 -20 L40 30 L0 60 L-40 30 Z" fill="white" stroke="#1E22B2" stroke-width="2"/>
    <path d="M-40 -20 L0 -50 L40 -20 L0 10 Z" fill="#06C6C8" opacity="0.4" stroke="#1E22B2" stroke-width="2"/>
    <path d="M0 10 L40 -20 L40 30 L0 60 Z" fill="#1E22B2" opacity="0.15"/>
    <path d="M-40 -20 L0 10 L0 60 L-40 30 Z" fill="#F5C518" opacity="0.3"/>
    <text x="0" y="105" text-anchor="middle" font-family="Pretendard" font-size="13" font-weight="600" fill="#1E22B2">입체 구조</text>
  </g>
</svg>
<figcaption class="text-xs text-slate-600 text-center py-2 bg-white/60">▲ 평면이 입체가 되는 과정 자체가 강력한 기하학·공간 인지 학습입니다.</figcaption>
</figure>`);

// 체크리스트 일러스트
const FigChecklist = oneLine(`<figure class="not-prose my-8 rounded-2xl overflow-hidden bg-gradient-to-br from-slate-50 to-blue-50 border border-slate-200">
<svg viewBox="0 0 720 320" class="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
  <!-- 종이 (체크리스트) -->
  <g transform="translate(360,160)">
    <rect x="-160" y="-120" width="320" height="240" rx="8" fill="white" stroke="#1E22B2" stroke-width="2"/>
    <path d="M140 -120 L160 -100 L160 -120 Z" fill="#F0F2FF"/>
    <text x="-130" y="-90" font-family="Pretendard" font-size="14" font-weight="700" fill="#1E22B2">외주 체크리스트</text>
    <line x1="-130" y1="-75" x2="130" y2="-75" stroke="#E2E8F0" stroke-width="1"/>
    <!-- 5개 체크 항목 -->
    ${[
      "최소 수량 및 단가 구조",
      "샘플 작업 비용 별도 여부",
      "디자인 IP 소유권",
      "납기 지연 시 페널티",
      "친환경 인증서 발급",
    ]
      .map(
        (label, i) =>
          `<g transform="translate(-120 ${-45 + i * 35})">
            <rect x="0" y="-8" width="16" height="16" rx="3" fill="white" stroke="#1E22B2" stroke-width="2"/>
            <path d="M2 0 L7 5 L14 -3" stroke="#06C6C8" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            <text x="28" y="4" font-family="Pretendard" font-size="13" fill="#1E22B2">${label}</text>
          </g>`
      )
      .join("")}
  </g>
</svg>
<figcaption class="text-xs text-slate-600 text-center py-2 bg-white/60">▲ 제작 문의 전 5가지만 확인해도 외주 실패를 크게 줄일 수 있습니다.</figcaption>
</figure>`);

// 인지 효과 3원
const FigCognitive = oneLine(`<figure class="not-prose my-8 rounded-2xl overflow-hidden bg-gradient-to-br from-fuchsia-50 to-pink-50 border border-fuchsia-100">
<svg viewBox="0 0 720 280" class="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
  ${[
    { x: 160, label: "기하학적 사고", desc: "평면 → 입체", color: "#06C6C8" },
    { x: 360, label: "소근육 발달", desc: "정교한 손놀림", color: "#F5C518" },
    { x: 560, label: "디자인 사고력", desc: "구조 설계 훈련", color: "#E91E8C" },
  ]
    .map(
      (b) => `<g transform="translate(${b.x},140)">
        <circle cx="0" cy="0" r="70" fill="white" stroke="${b.color}" stroke-width="3"/>
        <circle cx="0" cy="0" r="55" fill="${b.color}" opacity="0.12"/>
        <text x="0" y="-5" text-anchor="middle" font-family="Pretendard" font-size="15" font-weight="800" fill="#1E22B2">${b.label}</text>
        <text x="0" y="18" text-anchor="middle" font-family="Pretendard" font-size="11" fill="#64748B">${b.desc}</text>
      </g>`
    )
    .join("")}
</svg>
<figcaption class="text-xs text-slate-600 text-center py-2 bg-white/60">▲ 페이퍼 엔지니어링은 단일 학습이 아닌 다층적 인지 발달을 동시에 자극합니다.</figcaption>
</figure>`);

// 굿즈 트렌드 비교
const FigGoodsCompare = oneLine(`<figure class="not-prose my-8 rounded-2xl overflow-hidden bg-white border border-slate-200">
<svg viewBox="0 0 720 280" class="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
  <text x="360" y="35" text-anchor="middle" font-family="Pretendard" font-size="15" font-weight="700" fill="#1E22B2">SNS 공유율 & 폐기율 비교 (인하우스 추정)</text>
  ${[
    { y: 80,  label: "텀블러",     share: 80,  trash: 220, fill: "#94A3B8" },
    { y: 130, label: "에코백",     share: 100, trash: 200, fill: "#94A3B8" },
    { y: 180, label: "키링·뱃지", share: 130, trash: 160, fill: "#94A3B8" },
    { y: 230, label: "페이퍼토이", share: 300, trash: 60,  fill: "url(#g1)" },
  ]
    .map(
      (r) => `
        <text x="80" y="${r.y + 6}" font-family="Pretendard" font-size="12" fill="${r.label === "페이퍼토이" ? "#1E22B2" : "#475569"}" font-weight="${r.label === "페이퍼토이" ? "700" : "400"}">${r.label}</text>
        <rect x="160" y="${r.y - 8}" width="${r.share}" height="14" rx="3" fill="${r.fill}"/>
        <text x="${160 + r.share + 6}" y="${r.y + 4}" font-family="Pretendard" font-size="11" fill="#64748B">공유</text>
        <rect x="${300 + r.share}" y="${r.y - 8}" width="${r.trash}" height="14" rx="3" fill="#FECACA"/>
        <text x="${300 + r.share + r.trash + 6}" y="${r.y + 4}" font-family="Pretendard" font-size="11" fill="#B91C1C">폐기</text>
      `
    )
    .join("")}
  <defs><linearGradient id="g1" x1="0%" x2="100%"><stop offset="0%" stop-color="#06C6C8"/><stop offset="100%" stop-color="#E91E8C"/></linearGradient></defs>
</svg>
<figcaption class="text-xs text-slate-500 text-center py-2 bg-slate-50">▲ 페이퍼토이는 받는 사람이 직접 만드는 콘텐츠가 되어 SNS 공유율이 높고, 휴대성·소장성도 높습니다.</figcaption>
</figure>`);

/* ──────────────────────────────────────────────
 * 글 본문
 * ────────────────────────────────────────────── */

// 움직임 메커니즘 원리 다이어그램 (지기구조·탄성·기어/크랭크·캠/오토마타)
const FigMechanisms = oneLine(`<figure class="not-prose my-8 rounded-2xl overflow-hidden bg-gradient-to-br from-cyan-50 to-blue-50 border border-cyan-100">
<svg viewBox="0 0 720 220" class="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
  <text x="360" y="32" text-anchor="middle" font-family="Pretendard, sans-serif" font-size="15" font-weight="700" fill="#1E22B2">종이를 움직이는 원리들</text>
  <g transform="translate(90,70)">
    <line x1="-45" y1="80" x2="45" y2="80" stroke="#CBD5E1" stroke-width="2"/>
    <path d="M-30 80 L0 25 L30 80" fill="none" stroke="#06C6C8" stroke-width="3" stroke-linejoin="round"/>
    <line x1="0" y1="12" x2="0" y2="25" stroke="#1E22B2" stroke-width="2"/>
    <path d="M-8 8 L12 12 L-8 16 Z" fill="#F5C518"/>
    <text x="0" y="106" text-anchor="middle" font-family="Pretendard" font-size="12" fill="#475569">지기구조</text>
  </g>
  <g transform="translate(270,70)">
    <path d="M-30 75 L-15 38 L0 75 L15 38 L30 75" fill="none" stroke="#E91E8C" stroke-width="3" stroke-linejoin="round"/>
    <line x1="0" y1="28" x2="0" y2="8" stroke="#E91E8C" stroke-width="2"/>
    <path d="M-7 15 L0 5 L7 15" fill="none" stroke="#E91E8C" stroke-width="2"/>
    <text x="0" y="106" text-anchor="middle" font-family="Pretendard" font-size="12" fill="#475569">탄성</text>
  </g>
  <g transform="translate(450,70)">
    <circle cx="-12" cy="50" r="22" fill="none" stroke="#1E22B2" stroke-width="3"/>
    <circle cx="22" cy="50" r="13" fill="none" stroke="#06C6C8" stroke-width="3"/>
    <line x1="-12" y1="50" x2="-12" y2="22" stroke="#1E22B2" stroke-width="3"/>
    <circle cx="-12" cy="22" r="4" fill="#F5C518"/>
    <text x="0" y="106" text-anchor="middle" font-family="Pretendard" font-size="12" fill="#475569">기어·크랭크</text>
  </g>
  <g transform="translate(630,70)">
    <ellipse cx="0" cy="58" rx="22" ry="13" fill="none" stroke="#1E22B2" stroke-width="3"/>
    <line x1="0" y1="45" x2="0" y2="10" stroke="#06C6C8" stroke-width="3"/>
    <circle cx="0" cy="58" r="3" fill="#1E22B2"/>
    <path d="M-7 18 L0 8 L7 18" fill="none" stroke="#06C6C8" stroke-width="2"/>
    <text x="0" y="106" text-anchor="middle" font-family="Pretendard" font-size="12" fill="#475569">캠·오토마타</text>
  </g>
</svg>
<figcaption class="text-xs text-slate-600 text-center py-2 bg-white/60">▲ 종이의 움직임은 구조·탄성·기어·캠 같은 서로 다른 원리에서 나옵니다.</figcaption>
</figure>`);

export const SEED_POSTS: Post[] = [

  /* ══════════════ 2026-06 보강 · SEO·전문성 6편 (정의·기법·소재) ══════════════ */

  {
    id: "seed-what-is-paper-engineering",
    coverImage: "https://images.unsplash.com/photo-1661249134048-8f8328708fba?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "what-is-paper-engineering",
    title: "페이퍼 엔지니어링은 종이접기와 무엇이 다른가",
    excerpt:
      "종이접기, 페이퍼크래프트, 페이퍼 엔지니어링. 비슷해 보여도 만드는 사람 입장에서는 전혀 다른 세 갈래 길이다. 그 경계가 설계 난이도와 견적까지 가른다.",
    tag: "디자인",
    emoji: "",
    published: true,
    createdAt: "2026-03-10T05:33:00.000Z",
    updatedAt: "2026-03-10T05:33:00.000Z",
    content: `'페이퍼 엔지니어링'이라고 하면 종이접기를 떠올리는 분이 많다. 틀린 건 아니지만, 우리가 하는 일은 그보다 한 발 더 들어간 자리에 있다. 비슷한 세 가지를 나란히 놓으면 경계가 보인다.

## 접기, 만들기, 그리고 설계하기

종이접기(오리가미)는 한 장의 종이를 자르거나 붙이지 않고 접어 형태를 만든다. 접는 순서가 곧 전부다.

페이퍼크래프트는 도면을 오려 붙여 입체 모형을 완성한다. 결과물은 대개 가만히 있는 정적인 형태다.

페이퍼 엔지니어링은 여기에 '움직임'과 '구조'를 더한다. 평면이 스스로 일어서고, 손잡이를 당기면 팔이 올라가고, 책장을 펼치면 솟아오른다. 종이를 미술이 아니라 구조물로 다루는 일이다.

${FigGeometry}

## 왜 '엔지니어링'인가

움직이는 종이를 만들려면 계산이 필요하다. 어디에 접는 선을 둘지, 무게중심을 어디에 놓을지, 종이 두께가 접힘에 어떤 오차를 만들지. 이건 감각만으로는 안 되고, 구조 설계의 영역이다. 우리가 지기구조 설계로 특허 11종을 받은 것도 이 계산을 거듭 다듬은 결과다.

우리도 종이접기에서 시작해 여기까지 왔다. 움직이는 종이접기 도안을 그려 책으로 묶던 손이, 무게중심을 따지고 칼선을 앉히는 손이 되기까지 십수 년이 걸렸다. 그 사이의 거리를 메우는 말이 '엔지니어링'이다.

그래서 페이퍼 엔지니어링의 결과물은 팝업북, 오토마타(손잡이를 돌리면 톱니와 캠이 맞물려 인형이 움직이는 작은 기계 장치), 액션 페이퍼토이처럼 '움직이는 종이'로 모인다. 보기 좋은 모형을 넘어, 펼치고 당기고 세우는 동안 사람의 손과 대화하는 물건이다.

이 구분은 말장난이 아니다. 의뢰하는 쪽에서 보면 더 그렇다. 가만히 두고 보는 모형이 필요한지, 손으로 펼치고 당기며 노는 물건이 필요한지에 따라 설계의 난이도도, 단가도, 걸리는 시간도 달라진다. '종이로 뭔가 만들어 달라'는 한마디 안에는 사실 전혀 다른 세 갈래의 길이 들어 있다.

말은 거창하지만 출발은 단순하다. 종이 한 장이 어떻게 하면 스스로 설 수 있을까. 아직도 이 질문 앞에서는 매번 처음이다.`,
  },
  {
    id: "seed-five-ways-to-move-paper",
    coverImage: "https://images.unsplash.com/photo-1630170947523-1b7b61c442a2?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "five-ways-to-move-paper",
    title: "종이를 움직이는 다섯 가지 방법",
    excerpt:
      "무게중심, 탄성, 기어, 캠, 자석. 종이는 생각보다 여러 방식으로 움직인다. 어느 원리를 고르느냐에 따라 같은 캐릭터도 전혀 다르게 산다.",
    tag: "제작 과정",
    emoji: "",
    published: true,
    createdAt: "2026-01-20T02:49:00.000Z",
    updatedAt: "2026-01-20T02:49:00.000Z",
    content: `"종이가 어떻게 움직여요?"라는 질문을 자주 받는다. 답은 하나가 아니다. 움직임을 만드는 길이 여럿이고, 어느 길을 고르느냐에 따라 같은 캐릭터도 전혀 다르게 산다.

${FigMechanisms}

## 스스로 서는 힘 — 지기구조

가장 기본은 무게중심이다. 평면을 접어 무게의 균형을 잡으면, 누워 있던 종이가 손을 떼는 순간 스스로 일어선다. 우리가 특허로 다듬어 온 지기구조 설계의 출발점이다.

## 튕기는 힘 — 탄성

종이를 접거나 휘면 되돌아가려는 힘이 생긴다. 이 탄성을 잠시 가두었다 풀면 톡 튀어 오르거나 펼쳐진다. 팝업카드가 펼치는 순간 솟아오르는 것도 이 힘이다.

## 돌고 미는 힘 — 기어·크랭크·레버

손잡이를 돌리는 회전 운동을, 위아래나 앞뒤 운동으로 바꾸는 장치들이다. 기어가 맞물려 돌고, 크랭크가 회전을 왕복으로 바꾸고, 레버가 작은 힘을 큰 움직임으로 옮긴다.

## 복잡한 움직임 — 오토마타

여기에 캠(가장자리를 일부러 울퉁불퉁하게 깎은 부품. 회전을 들쭉날쭉한 위아래 운동으로 바꾼다)을 더하면 위아래·회전·흔들림이 한꺼번에 일어난다. 손잡이 한 번에 캐릭터가 고개를 젓고 팔을 드는, 작은 기계 같은 움직임이 만들어진다. 흔히 오토마타라 부른다.

마지막으로 자석을 쓰는 자기력까지 더하면, 종이로 만들 수 있는 움직임의 폭은 생각보다 넓다. 어떤 움직임이 어울릴지는 캐릭터와 쓰임에 따라 다르다.`,
  },
  {
    id: "seed-how-pop-up-books-work",
    coverImage: "https://images.unsplash.com/photo-1778967809341-599c49a47012?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "how-pop-up-books-work",
    title: "팝업북은 어떻게 펼쳐지는가",
    excerpt:
      "책장을 넘기는 순간 종이가 솟아오른다. 접는 각도 하나가 솟는 높이를 정하는, 작지만 정확한 기하학의 세계.",
    tag: "디자인",
    emoji: "",
    published: true,
    createdAt: "2025-11-25T03:06:00.000Z",
    updatedAt: "2025-11-25T03:06:00.000Z",
    content: `팝업북을 처음 펼친 아이는 잠깐 말을 잃는다. 평평하던 종이가 책장을 넘기는 순간 솟아오르는 그 짧은 장면이, 묘하게 사람을 멈춰 세운다. 그 안에는 접지의 기하학이 숨어 있다.

기하학이라고 하면 어렵게 들리지만, 점과 선과 면이 이루는 각도의 규칙을 다루는 수학일 뿐이다. 팝업에서는 그 규칙이 아주 구체적인 질문으로 바뀐다. 종이를 몇 도로 접고, 책장을 얼마나 펼치면, 그림이 어느 높이까지 솟아오르는가. 접는 각도 하나가 곧 솟는 높이를 정한다.

## 펼치는 각도가 구조를 정한다

팝업의 핵심은 종이가 접힌 골과 책장이 열리는 각도의 관계다. 가장 흔한 건 'V'자 접지다. 책장을 90도나 180도로 펼칠 때, V자로 접힌 종이가 그 움직임을 받아 입체로 일어선다. 접는 각을 어떻게 두느냐에 따라 솟는 높이와 방향이 달라진다.

${FigGeometry}

여기에 책장과 나란히 접는 평행 접지, 여러 층을 겹쳐 깊이를 만드는 다층 구조, 당기면 그림이 바뀌는 당김 장치가 더해진다. 하나하나는 단순하지만, 겹치면 한 장의 책장 안에 작은 무대가 만들어진다.

## 카드에서 무대까지

팝업은 책에만 쓰이지 않는다. 청첩장·연하장 같은 카드, 펼치면 메시지가 솟는 초대장, 전시용 입체 포스터까지 형태는 다양하다. 소량으로도 만들 수 있어 한 사람을 위한 선물에도 어울린다.

팝업북은 평면과 입체 사이를 오가는 장치다. 닫으면 한 장이고, 열면 무대가 된다. 그 전환의 순간을 설계하는 일이 우리 몫이다.`,
  },
  {
    id: "seed-foamboard-woodlock-structures",
    coverImage: "https://images.unsplash.com/photo-1509956563346-93a1179cea68?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "foamboard-woodlock-structures",
    title: "폼보드와 우드락 — 접착제 없이 끼워 세우는 입체",
    excerpt:
      "풀도 가위도 없이, 끼우기만 하면 입체가 선다. 빠르게 세우고 깔끔하게 거둬야 하는 전시장이 폼보드를 오래 찾는 이유가 있다.",
    tag: "제작 과정",
    emoji: "",
    published: true,
    createdAt: "2025-09-09T06:18:00.000Z",
    updatedAt: "2025-09-09T06:18:00.000Z",
    content: `폼보드로 만든 구조물의 매력은 단순함에 있다. 풀도, 복잡한 조립도 없다. 칼선을 따라 끼우기만 하면 입체가 선다. 우드락이라는 이름으로 더 익숙한 분도 많을 것이다.

## 끼움으로 버틴다

폼보드는 가운데에 가벼운 발포 심을 두고 양면을 종이로 감싼 판이다. 가볍지만 단단해서, 일정 크기 이상의 입체를 세우기에 알맞다.

비결은 접착이 아니라 끼움이다. 한쪽에 홈을 내고 다른 쪽을 끼워 맞추면, 두 판이 서로를 붙들며 선다. 십자로 끼운 두 판은 어느 방향으로도 잘 쓰러지지 않는다. 풀이 마르기를 기다릴 필요도, 손에 묻을 일도 없다.

## 누구나, 빠르게

이 단순함이 현장에서 힘을 발휘한다. 전시 부스의 대형 조형물, 행사장 포토존, 매장 진열 소품처럼 빠르게 세우고 거두어야 하는 자리에 어울린다. 아이도 어른도 설명서 없이 끼워 맞추니 체험 키트로도 좋다.

끼움 구조에는 숨은 장점이 하나 더 있다. 분해가 쉽다는 것이다. 행사가 끝나면 판을 빼서 납작하게 포개 두었다가, 다음에 다시 세울 수 있다. 한 번 쓰고 버리는 입체와, 접어 두었다 여러 번 세우는 입체의 갈림길이 바로 이 지점에 있다.

물론 종이만큼 정교한 움직임을 담기는 어렵다. 대신 크고 단단하게, 손쉽게 세우는 쪽에 강하다.`,
  },
  {
    id: "seed-paper-grammage-and-grain",
    coverImage: "https://images.unsplash.com/photo-1688310328604-89c221130049?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "paper-grammage-and-grain",
    title: "종이라고 다 같은 종이가 아니다",
    excerpt:
      "평량과 결을 잘못 고르면 아무리 좋은 설계도 무너진다. 완성도의 절반은 도면이 아니라 재료 선택에서 이미 정해진다.",
    tag: "소재",
    emoji: "",
    published: true,
    createdAt: "2025-07-22T01:41:00.000Z",
    updatedAt: "2025-07-22T01:41:00.000Z",
    content: `설계가 아무리 정교해도, 종이를 잘못 고르면 구조는 무너진다. 이 일을 하며 가장 자주 한 실수도, 가장 많이 배운 것도 재료였다.

## 평량 — 두께가 아니라 무게

종이의 굵기는 흔히 평량으로 말한다. 1제곱미터당 몇 그램인가를 뜻하는 단위(g/㎡)다. 얇은 내지가 80에서 120 사이라면, 스스로 서야 하는 구조물은 250에서 400을 넘나든다.

무겁다고 늘 좋은 건 아니다. 너무 두꺼우면 접는 선이 갈라지고, 너무 얇으면 제 무게를 못 견뎌 주저앉는다. 움직임을 담을 종이는 '접혀도 갈라지지 않고, 서도 휘지 않는' 그 사이 어딘가를 찾아야 한다.

## 결 — 종이에도 방향이 있다

종이에는 섬유가 흐르는 방향, 곧 결이 있다. 결을 따라 접으면 선이 매끈하게 잡히고, 결을 거슬러 접으면 자국이 거칠게 일어나거나 터진다. 같은 종이, 같은 도면이라도 결을 어느 쪽으로 두고 인쇄하느냐에 따라 완성도가 갈린다.

결을 확인하는 방법은 의외로 단순하다. 종이를 가로세로 양방향으로 살짝 휘어 보면, 더 매끄럽게 휘는 쪽이 결의 방향이다. 인쇄소에서 '세로결지'와 '가로결지'를 구분해 주문하는 것도 이 때문이다. 접는 선이 많은 구조물일수록 이 한 끗이 완성도를 가른다.

여기에 코팅의 유무, 친환경 인증지(책임 있게 관리된 숲에서 나온 종이임을 표시하는 FSC 같은 인증) 여부까지 더해지면 선택지는 더 늘어난다. 손님 눈에는 보이지 않는 결정이지만, 결과물의 수명은 대개 이 보이지 않는 자리에서 갈린다.`,
  },
  {
    id: "seed-the-net-flat-blueprint",
    coverImage: "https://images.unsplash.com/photo-1721244653652-268631ec049a?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "the-net-flat-blueprint-of-form",
    title: "전개도, 평면에 그리는 입체의 설계도",
    excerpt:
      "입체를 만들기 전에 먼저 평면에 푼다. 전개도는 종이 구조물의 설계도이자, 가장 오래된 기하 수업이기도 하다.",
    tag: "교육",
    emoji: "",
    published: true,
    createdAt: "2025-05-13T04:53:00.000Z",
    updatedAt: "2025-05-13T04:53:00.000Z",
    content: `종이로 입체를 만드는 일은, 역설적이게도 평면에서 시작한다. 완성될 입체를 머릿속에서 한 번 펼쳐, 평면 위에 풀어 놓는 것. 그 펼친 그림을 전개도라고 부른다.

## 입체를 펼쳐 놓은 그림

정육면체를 가위로 모서리만 잘라 바닥에 펼치면, 여섯 개의 면이 십자나 계단 모양으로 눕는다. 그게 전개도다. 거꾸로, 그 평면을 접는 선을 따라 접으면 다시 정육면체가 된다.

말은 간단하지만 실제 설계에서는 변수가 많다. 접는 선을 어디에 둘지, 붙이는 날개를 얼마나 남길지, 종이 두께가 접힘에 어떤 오차를 만들지. 이 계산이 어긋나면 아무리 예쁜 도안도 깔끔하게 서지 않는다.

${FigGeometry}

## 가장 오래된 기하 수업

전개도는 종이 구조의 설계도인 동시에, 좋은 교육 재료이기도 하다. 펼쳐진 그림을 보고 완성된 입체를 떠올리는 일은 그 자체로 공간 지각력을 기르는 훈련이다. 공간 지각력이란 머릿속에서 도형을 돌리고, 펼치고, 다시 접어 보는 능력을 말한다. 도형의 내각과 면의 관계를 머리가 아니라 손으로 만난다.

이런 '손으로 익히는 배움'은 교육학에서 오래 다뤄 온 주제다. 발달심리학자 장 피아제는 대략 일곱 살에서 열한 살 사이의 아이가 추상적인 기호보다 직접 만지고 조작할 수 있는 사물을 통해 더 잘 배운다고 보았다. 흔히 '구체적 조작기'라 부르는 시기다. 평면을 접어 입체를 세우는 일은 바로 그 '조작'에 해당한다. 머릿속으로 도형을 돌려 보는 공간 지각력이 훗날 수학·과학 학습과 이어진다는 점도, 교육·심리 분야에서 꾸준히 보고돼 온 이야기다.

그래서 우리가 만드는 교구의 절반은 전개도에 있다. 아이가 한 장의 평면을 접어 입체를 세우는 동안, 교과서가 말로만 설명하던 것을 손끝으로 먼저 안다.`,
  },

  /* ══════════════ 2026-06 추가 · 담백한 에세이 시리즈 15편 (5주제 × 3편) ══════════════ */

  /* ── 소재 ── */
  {
    id: "seed-why-paper-13-years",
    coverImage: "https://images.unsplash.com/photo-1691380302827-f7e4b96619c6?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "why-paper-13-years",
    title: "왜 하필 종이였을까",
    excerpt:
      "더 튼튼한 플라스틱도, 고급스러운 금속도 있다. 스튜디오를 열 때는 대답하지 못했던 질문에 이제야 조금 답해 본다.",
    tag: "소재",
    emoji: "",
    published: true,
    createdAt: "2025-03-25T02:37:00.000Z",
    updatedAt: "2025-03-25T02:37:00.000Z",
    content: `종이를 한 번 접으면 그 자리에 선이 남는다. 펴도 사라지지 않는다. 나는 그 선을 13년 동안 들여다보며 일해 왔다.

2013년에 스튜디오를 시작할 때, 왜 하필 종이냐는 질문을 자주 받았다. 더 튼튼한 플라스틱도 있고, 더 고급스러운 금속도 있는데 말이다. 그때는 제대로 대답하지 못했다. 지금은 조금 안다.

사실 종이는 내가 고른 재료라기보다, 내가 하던 일이 종이였다. 시작은 접는 도안이었다. 움직이는 종이접기를 그려 『합체! 전투기 종이접기』 같은 놀이책으로 묶던 시절이 있었다([길벗스쿨, 2020](https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=249775399)). 그 종이가 좋아서 손에서 놓지 못하다 보니 어느새 13년이 됐다.

## 만만해서, 그래서 어렵다

종이는 누구나 만질 수 있는 재료다. 아이도 접고, 노인도 접는다. 진입 장벽이 없다. 그런데 그 만만함이 설계자에게는 가장 어려운 조건이 된다.

평면 한 장이 스스로 일어서서 입체가 되고, 손잡이를 당기면 팔이 움직이게 만들려면 종이의 결과 두께, 접히는 각도를 전부 계산해야 한다. 우리가 지기구조 설계로 특허 11종을 받은 것도 이 단순한 재료를 끝까지 밀어붙인 결과였다. 쉬운 재료일수록 설계는 정직해야 한다.

${FigHandsPaper}

## 손에 남는 감각

종이에는 기억이 있다. 한 번 접힌 자리는 다음에 더 쉽게 접힌다. 종이를 다루다 보면 재료가 사람을 닮았다는 생각을 한다. 한 번 지나간 자리는 흔적으로 남고, 그 흔적을 따라 다음 움직임이 결정된다.

현대백화점, 경주박물관, 수원시 일을 하면서 650건이 넘는 작업을 거쳤지만, 매번 처음 종이를 접을 때의 감각은 비슷하다. 손끝에 닿는 저항, 접히는 소리. 화면 속에서는 끝내 느낄 수 없는 것들이다.

다른 재료를 안 써 본 것은 아니다. 아크릴도, 목재도, 3D 프린팅도 곁눈질해 봤다. 그때마다 종이로 돌아온 이유는 단순하다. 종이는 실수를 빨리 보여 준다. 접어 보면 그 자리에서 되는지 안 되는지 안다. 손과 재료 사이에 군더더기가 없다.

13년이 지나도 답은 거창하지 않다. 종이는 다루기 쉽고, 그래서 끝이 없다. 나는 아직 이 재료를 다 모른다. 그게 계속 종이 앞에 앉는 이유인 것 같다.`,
  },
  {
    id: "seed-plastic-goods-forgotten",
    coverImage: "https://images.unsplash.com/photo-1586162481176-7abc53f1f7c2?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "plastic-goods-forgotten-drawer",
    title: "플라스틱 굿즈가 서랍에서 잊히는 동안, 종이가 하는 일",
    excerpt:
      "받은 굿즈 대부분은 서랍 속에서 잊힌다. 그 사이 종이로 만든 물건은 조금 다른 자리에 놓인다. 오래 일하며 지켜본 작은 차이에 대해.",
    tag: "소재",
    emoji: "",
    published: true,
    createdAt: "2025-01-14T05:22:00.000Z",
    updatedAt: "2025-01-14T05:22:00.000Z",
    content: `행사장에서 받은 굿즈는 집에 오면 대개 서랍 어딘가로 들어간다. 다시 꺼내는 일은 드물다. 플라스틱 키링, 텀블러, 보조배터리. 버리기는 아깝고 쓰지는 않는 물건들이 서랍 한 칸을 차지한다.

나는 그 서랍을 자주 생각한다. 우리가 만드는 물건도 언젠가 그 안에 들어갈지 모른다는 두려움 때문이다.

## 만든 사람의 손이 한 번 더 닿는다

종이로 만든 물건은 받는 사람이 직접 조립해야 하는 경우가 많다. 번거로운 일이다. 그런데 그 번거로움이 묘한 일을 한다. 자기 손으로 세운 물건은 쉽게 버려지지 않는다.

행동경제학에는 이를 가리키는 말이 있다. '이케아 효과'다. 사람은 자기 손으로 조립한 물건에 실제 값어치보다 큰 애착을 느낀다는 것이다. 반제품 가구를 직접 조립하게 했더니, 같은 물건을 완제품으로 받은 사람보다 더 높은 값을 매기더라는 실험에서 나온 이름이다. 종이 굿즈가 슬그머니 노리는 자리도 비슷하다. 들인 수고만큼 정이 붙는다.

공주시 '고마곰' 작업을 납품했을 때, 시민들이 다 만든 페이퍼토이를 책상에 올려 두고 찍은 사진을 보내왔다. 완제품으로 받았다면 그러지 않았을 것이다. 손이 한 번 더 닿은 물건은 잊히기 전에 자리를 얻는다.

${FigGoodsCompare}

## 잊히지 않으려고 애쓰지 않아도 되는 물건

플라스틱 굿즈는 오래 남도록 만들어진다. 그래서 쓸모를 잃으면 처치 곤란이 된다. 종이는 반대다. 가볍게 왔다가 가볍게 사라진다. 역설적이게도 그 가벼움 때문에 부담 없이 곁에 둔다.

오래 가는 것과 오래 기억되는 것은 다르다. 단단한 물건이 서랍에서 잊히는 동안, 접었다 폈다 하던 종이 한 장이 책상 위에 더 오래 머무는 광경을 나는 여러 번 봤다.

우리가 종이를 고르는 이유는 그 작은 차이에 있다.`,
  },
  {
    id: "seed-instead-of-eco-friendly",
    coverImage: "https://images.unsplash.com/photo-1613269040024-d414b6ed7570?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "instead-of-eco-friendly-word",
    title: "친환경이라는 말을 아끼는 이유",
    excerpt:
      "친환경이라는 말은 너무 자주 쓰여서 닳아 버렸다. 그 말을 앞세우는 대신, 종이로 만든다는 일이 실제로 어떤 것인지 적어 본다.",
    tag: "소재",
    emoji: "",
    published: true,
    createdAt: "2024-11-26T01:59:00.000Z",
    updatedAt: "2024-11-26T01:59:00.000Z",
    content: `친환경이라는 말을 별로 좋아하지 않는다. 너무 자주 쓰여서 닳아 버린 말이다. 제안서마다 들어가고, 어디에 붙여도 그럴듯해 보인다. 그래서 오히려 아무것도 설명하지 못한다.

종이로 일한다고 하면 사람들은 으레 친환경을 떠올린다. 맞는 말이지만, 우리가 종이를 쓰는 이유를 그 한 단어에 담아 두기는 아깝다.

## 만들면서 미안하지 않은 재료

작업을 하다 보면 버리는 것이 늘 생긴다. 시안을 뽑고, 샘플을 만들고, 다시 잘라 낸다. 종이로 일할 때 좋은 점 하나는 그 과정에서 마음이 덜 무겁다는 것이다. 잘못 접은 한 장을 구겨 버릴 때, 그것이 수백 년 남을 쓰레기가 아니라는 사실이 작은 위안이 된다.

거창한 신념은 아니다. 그저 매일 재료를 만지는 사람의 감각에 가깝다. 손에 쥔 것이 언젠가 흙으로 돌아갈 수 있다는 감각.

종이의 주성분은 나무에서 온 셀룰로스다. 두꺼운 코팅을 입히지 않은 종이는 자연에서 비교적 빨리 분해되고, 분리배출하면 새 종이로 다시 태어나기도 한다. 수백 년을 남는 플라스틱과 갈라지는 지점이 여기다. 물론 종이도 만들고 버리는 데 나무와 물과 에너지가 든다. 그러니 '무해하다'고는 못 한다. 다만 '덜 미안하다'고는 말할 수 있다.

## 사라지는 것을 부끄러워하지 않기

오래 남는 물건이 늘 좋은 것은 아니다. 어떤 물건은 제 역할을 마치면 조용히 사라지는 편이 낫다. 종이는 그걸 부끄러워하지 않는다.

KAIST와 함께한 교구 작업에서, 아이들이 다 쓴 종이 구조물을 어떻게 정리하느냐는 질문을 받은 적이 있다. 답이 단순해서 좋았다. 그냥 종이로 버리면 된다. 만든 즐거움은 남고, 물건은 가볍게 떠난다.

친환경이라는 말을 앞세우는 대신 나는 이렇게 말하고 싶다. 우리는 종이로 만든다. 그게 어떤 의미인지는 한 번 손에 쥐어 보면 안다.`,
  },

  /* ── 제작 과정 ── */
  {
    id: "seed-how-paper-stands-up",
    coverImage: "https://images.unsplash.com/photo-1772340163600-ae81082b02df?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "how-paper-stands-up-self-structure",
    title: "종이는 어떻게 스스로 일어서는가",
    excerpt: "처음 설계한 종이 인형은 일어서지 못했다. 평면이 스스로 입체가 되는 일에 관한 기록.",
    tag: "제작 과정",
    emoji: "",
    published: true,
    createdAt: "2024-09-10T03:14:00.000Z",
    updatedAt: "2024-09-10T03:14:00.000Z",
    content: `처음 설계한 종이 인형은 일어서지 못했다. 도면 위에서는 분명 멀쩡했는데, 칼선을 따라 오려 책상에 세우면 앞으로 폭 고꾸라졌다. 종이를 탓하다가, 풀을 탓하다가, 결국 인정했다. 종이가 약한 게 아니라 내 설계가 약했다.

종이는 얇고 무르다. 그런데도 어떤 종이는 스스로 일어서서 제 무게를 견딘다. 비밀은 재료가 아니라 형태에 있다. 우리는 이걸 지기구조, 스스로 지탱하는 구조라고 부른다.

## 접으면 강해진다

평평한 종이 한 장은 손가락으로 누르면 휜다. 그런데 그 종이를 한 번 접으면, 접힌 선을 따라 갑자기 단단해진다. 골판지가 무거운 짐을 견디는 것도, 종이비행기 날개를 접으면 멀리 나는 것도 같은 원리다. 면은 약하지만 모서리는 강하다.

공학에서는 이를 형태가 만드는 강성이라고 한다. 재료를 더하지 않고도, 납작한 단면을 ㄱ자나 ㄷ자처럼 입체로 바꾸기만 하면 휘는 힘에 훨씬 잘 버틴다. 다리의 철골이 H 모양인 것도, 골판지 속을 물결 모양으로 채운 것도 뿌리가 같다. 종이를 접는 일은 곧 단면의 모양을 바꾸는 일이다.

${FigGeometry}

그래서 지기구조 설계는 종이를 두껍게 만드는 일이 아니다. 어디에 모서리를 만들지, 어느 방향으로 접을지를 정하는 일이다. 같은 한 장이라도 접는 선을 어디에 두느냐에 따라 무너지기도 하고 우뚝 서기도 한다.

## 무게는 숨길 수 없다

오래 하다 보니 알게 된 것이 있다. 종이는 정직하다. 무게중심이 받침에서 조금만 벗어나도 어김없이 쓰러진다. 화면 속 3D 모델은 중력을 무시하지만, 책상 위 종이는 그러지 못한다.

그래서 설계의 마지막은 늘 손이다. 도면이 아무리 그럴듯해도, 직접 오리고 접어 세워보기 전에는 선다고 말하지 않는다. **종이가 서야 설계가 끝난 것이다.** 모니터 앞이 아니라 책상 위에서.

지금도 새 구조를 그릴 때면 그 첫 번째 인형을 떠올린다. 고꾸라지던 종이가 알려준 건, 종이를 이기려 들지 말고 종이의 성질을 따라가라는 것이었다.`,
  },
  {
    id: "seed-design-is-subtraction",
    coverImage: "https://images.unsplash.com/photo-1771440047915-29e1655e27c3?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "design-is-subtraction-not-addition",
    title: "설계는 더하는 일이 아니라 빼는 일이다",
    excerpt: "초보 시절 도면에는 선이 너무 많았다. 좋은 구조일수록 부품이 적다는 것을 한참 뒤에 알았다.",
    tag: "제작 과정",
    emoji: "",
    published: true,
    createdAt: "2024-07-23T06:46:00.000Z",
    updatedAt: "2024-07-23T06:46:00.000Z",
    content: `초보 시절 내 도면에는 선이 너무 많았다. 팔을 움직이게 하려고 경첩을 덧대고, 흔들림을 막으려고 받침을 하나 더 붙이고, 그래도 불안해서 보강판을 끼웠다. 완성된 종이 모형은 부품이 많았고, 조립도 어려웠고, 이상하게 멋이 없었다.

지금은 도면을 그리다 막히면 더할 자리를 찾지 않는다. 뺄 곳을 찾는다.

## 부품이 적을수록 잘 움직인다

움직이는 종이를 만들다 보면 역설을 자주 만난다. 움직임을 더 자연스럽게 하려고 부품을 늘리면, 대개 더 뻑뻑해진다. 반대로 칼선 하나로 접힘을 대신하고 풀칠 두 군데를 없애면, 움직임이 도리어 매끄러워진다.

기계를 다루는 사람들 사이에는 '부품이 적을수록 고장도 적다'는 오래된 경험칙이 있다. 연결한 자리가 적으면 어긋날 자리도 적기 때문이다. 종이도 다르지 않다. 풀칠과 경첩이 줄면 실패할 지점이 함께 준다. 단순함은 미감이기 전에 신뢰성의 문제다.

${FigChecklist}

지기구조의 묘미가 여기에 있다. 잘 설계된 평면은 별도의 부품 없이 스스로 일어서고 스스로 움직인다. 경첩을 다는 대신 종이 한 장에 접는 선을 새기고, 받침을 붙이는 대신 도면 자체가 받침이 되게 한다. 좋은 설계일수록 도면이 단순해진다. 조립 설명서가 짧아진다.

## 만드는 사람의 손을 생각하며

PE Studio가 만드는 건 결국 누군가 받아서 직접 조립하는 물건이다. 박물관에서, 학교에서, 축제 부스에서 아이도 어른도 그것을 손으로 접는다. 풀칠이 한 군데 줄면 실패하는 사람이 줄고, 완성하는 기쁨이 그만큼 늘어난다.

그래서 나는 설계의 절반을 빼는 데 쓴다. 이 선이 꼭 필요한가, 이 부품 없이도 서는가. **덜어내고도 무너지지 않을 때, 비로소 구조라고 부를 수 있다.** 더하기는 쉽고 빼기는 어렵다. 그 어려운 쪽에 설계가 있다.`,
  },
  {
    id: "seed-what-eleven-patents-mean",
    coverImage: "https://images.unsplash.com/photo-1721244654392-9c912a6eb236?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "what-eleven-patents-actually-mean",
    title: "특허 11종이 실제로 뜻하는 것",
    excerpt: "특허는 자랑하려고 받은 게 아니다. 같은 실패를 두 번 하지 않으려고 적어둔 기록에 가깝다.",
    tag: "제작 과정",
    emoji: "",
    published: true,
    createdAt: "2024-05-08T01:08:00.000Z",
    updatedAt: "2024-05-08T01:08:00.000Z",
    content: `특허 11종을 보유하고 있다고 적어두면 대단해 보인다. 하지만 정작 그 숫자를 만든 건 대단한 순간이 아니라, 수없이 쓰러지고 찢어지고 뻑뻑하던 종이들이었다.

2013년에 스튜디오를 열고 '움직이는 종이'를 설계하기 시작한 뒤로, 특허는 자랑하려고 받은 게 아니다. 같은 실패를 두 번 하지 않으려고 적어둔 기록에 가깝다.

특허란 본디 발명을 세상에 공개하는 대신, 일정 기간 그 방식을 남이 함부로 베끼지 못하게 막아 주는 제도다. 말은 거창하지만 작은 스튜디오에는 다른 쓸모가 더 크다. 어렵게 찾아낸 구조를 잊지 않도록 글과 도면으로 묶어 두는 일. 자랑보다 보관에 가깝다.

## 한 번 푼 문제는 다시 풀지 않는다

종이를 어떤 각도로 접어야 평면이 스스로 일어서는지, 어디에 칼집을 내야 풀 없이도 팔이 움직이는지 — 이런 건 한 번 알아내기까지가 오래 걸린다. 며칠을 시험 모형으로 보내고서야 겨우 길을 찾는다.

${FigGeometry}

그렇게 찾은 해법을 특허로 정리해 두면, 다음 프로젝트에서 같은 자리를 헤매지 않는다. 11종이라는 숫자는 곧 열한 번, 처음부터 다시 고민하지 않아도 되는 지기구조의 사전이다. 새 캐릭터를 의뢰받으면 그 사전을 펼쳐 가장 알맞은 메커니즘을 골라 쓴다. 그래서 평균 3~4주 안에 설계가 끝난다.

## 빠름이 아니라 단단함

특허가 보장하는 건 속도라기보다 바닥이다. 현대백화점, KAIST, 경주박물관, 수원시, 국립기관까지 650건 넘게 납품해 오는 동안, 매번 새로 발명했다면 그 일정도 그 품질도 지키지 못했을 것이다. 검증된 구조 위에서 시작하니 무너질 자리가 줄어든다.

이 축적이 밖에서 어떻게 보였는지는 잘 모른다. 다만 2017년 전자신문은 우리를 '움직이는 페이퍼 토이'를 교육과 비즈니스로 끌어온 곳이라 소개했다([전자신문, 2017](https://m.etnews.com/20171219000432)). 바깥의 평가야 어떻든, 내게 먼저인 건 열한 번 막다른 길을 지나며 한 줄씩 적어 둔 그 구조의 목록이다.

물론 사전에 없는 문제는 늘 새로 나온다. 그럴 때는 또 며칠을 종이와 씨름하고, 운이 좋으면 사전에 한 줄이 더해진다. **특허 11종이 뜻하는 건, 11번의 막다른 길을 지나왔다는 것**이다. 그 길들이 다음 사람의 종이를 조금 더 잘 서게 한다면, 그걸로 충분하다.`,
  },

  /* ── 교육 ── */
  {
    id: "seed-time-of-assembly-remains",
    coverImage: "https://images.unsplash.com/photo-1714646793449-6967987cfcae?w=1200&h=630&fit=crop&crop=faces,center&auto=format&q=80",
    slug: "time-of-assembly-remains",
    title: "완성품보다 조립의 시간이 남는다",
    excerpt: "다 만든 종이 인형은 일주일을 못 넘기고 잊힌다. 정작 오래 기억되는 건 그것을 만들던 한 시간쯤의 어떤 표정이다.",
    tag: "교육",
    emoji: "",
    published: true,
    createdAt: "2024-03-26T04:31:00.000Z",
    updatedAt: "2024-03-26T04:31:00.000Z",
    content: `완성된 종이 인형은 대개 일주일을 못 넘긴다. 책상 위에 며칠 서 있다가, 어느 순간 책 사이에 눌리고, 어느 날 보면 없다. 처음엔 그게 좀 허무했다. 며칠을 설계한 구조물이 그렇게 쉽게 잊히는구나 싶어서.

그런데 부모들에게 가끔 연락이 온다. 아이가 그걸 만들던 저녁을 이야기한다. 종이가 자꾸 안 서서 끙끙대다가, 무게중심을 살짝 옮기니 거짓말처럼 일어서던 순간. 남는 건 인형이 아니라 그 한 시간이었다.

${FigHandsPaper}

## 손이 멈춰 있던 시간

조립에는 묘한 정적이 있다. 풀이 마르기를 기다리는 동안, 접은 자리가 자리를 잡기를 기다리는 동안, 아이의 손은 잠깐 멈춘다. 나는 이 멈춤이 꽤 중요하다고 생각한다.

요즘 아이들의 화면은 멈추는 법이 없다. 다음 영상이 곧장 시작되고, 손가락은 쉴 새 없이 위로 쓸어 올린다. 종이는 그렇지 않다. **기다려야 다음으로 넘어간다.** 그 기다림 속에서 아이는 자기가 무얼 하고 있는지 잠깐 들여다본다.

## 결과가 아니라 과정이 몸에 남는다

우리가 설계하는 구조는 한 번에 완성되도록 만들지 않는다. 일부러 그렇게 둔다. 한 번 접어 세워보고, 쓰러지면 어디가 문제인지 보고, 다시 접는다. 이 **관찰과 수정의 반복**이 손에 배는 것이 핵심이다.

교육철학자 존 듀이는 백 년 전에 이미 '행하면서 배운다'고 했다. 아이는 설명을 들어서가 아니라, 직접 해 보고 그 결과를 겪으면서 지식을 자기 것으로 만든다는 뜻이다. 종이를 세우다 쓰러뜨리고 다시 세우는 동안 벌어지는 일이 정확히 그것이다. 손이 먼저 겪고, 머리가 나중에 정리한다.

완성품은 사진 한 장으로 남지만, 그 과정은 몸으로 남는다. 십 년 넘게 이 일을 하며 확신하게 된 한 가지다. 종이는 결국 버려지더라도, 그것을 세우느라 애쓰던 시간은 아이 안에 오래 머문다.`,
  },
  {
    id: "seed-what-happens-when-a-child-folds-paper",
    coverImage: "https://images.unsplash.com/photo-1723473163257-80da3cc53432?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "what-happens-when-a-child-folds-paper",
    title: "아이가 종이를 접을 때, 머릿속에서 일어나는 일",
    excerpt: "종이 한 장을 접어 입체를 세우는 동안, 아이의 머릿속에서는 평면을 입체로 옮기는 작은 계산이 쉬지 않고 돌아간다.",
    tag: "교육",
    emoji: "",
    published: true,
    createdAt: "2024-01-16T02:23:00.000Z",
    updatedAt: "2024-01-16T02:23:00.000Z",
    content: `아이는 전개도를 한참 들여다본다. 십자 모양으로 펼쳐진 그림을 보며, 이게 접히면 어떤 모양이 될지 머릿속에서 미리 접어본다. 손은 아직 움직이지 않는데, 표정은 이미 무언가를 계산하고 있다. 나는 이 잠깐의 정적을 좋아한다.

겉으로는 그냥 종이를 만지는 일처럼 보인다. 그러나 그 안에서는 평면을 입체로 옮기는 작업이 쉬지 않고 돌아간다. 화면을 넘기는 일에는 없는 종류의 사고다.

${FigGeometry}

## 평면을 머릿속에서 세워보는 일

펼쳐진 그림을 보고 완성된 입체를 떠올리는 능력을, 흔히 공간 지각력이라 부른다. 거창한 말 같지만 실은 단순하다. **보이지 않는 모양을 미리 그려보는 힘**이다.

이건 영상을 보는 것으로는 잘 자라지 않는다. 직접 접어 세워보고, 어긋난 자리를 손으로 바로잡아 봐야 한다. 우리가 설계할 때 일부러 한 번에 안 맞게 두는 이유이기도 하다. 어긋남을 스스로 발견하는 순간에 그 힘이 자란다.

초등 시기의 배움은 시험 점수만을 위한 것이 아니라는 말을, 교육 현장에서 자주 듣는다. 머리만이 아니라 몸과 손과 감각을 고루 쓰는 경험, 이른바 전인교육이 그 또래에는 더 중요하다는 것이다. 종이를 접어 세우는 일은 작지만 그런 경험의 한 조각이다. 머릿속으로 그려 보고, 손으로 만들고, 눈으로 확인하는 일이 한자리에서 동시에 일어난다.

## 손끝이 곧 생각이다

손가락의 정교한 움직임이 뇌를 자극한다는 이야기는 발달 분야에서 오래된 상식이다. 접고, 붙이고, 정확한 자리에 끼우는 동작은 모두 그 자극을 만든다. **손끝은 생각의 가장 바깥쪽 끝**이라고, 나는 종종 그렇게 표현한다.

도형의 내각, 무게중심, 탄성력. 우리가 구조에 심어두는 원리들은 시험에 나오는 지식이 아니다. 아이가 종이를 세우려 애쓰는 동안 손으로 먼저 만나는 감각이다. 그 감각이 먼저고, 이름은 나중에 붙어도 늦지 않다.`,
  },
  {
    id: "seed-toys-that-allow-failure",
    coverImage: "https://images.unsplash.com/photo-1714646793450-1cbfc13910e7?w=1200&h=630&fit=crop&crop=faces,center&auto=format&q=80",
    slug: "toys-that-allow-failure",
    title: "실패가 허락되는 장난감에 대하여",
    excerpt: "쓰러져도 다시 세우면 되는 종이 앞에서, 아이는 처음으로 실패를 무서워하지 않는 얼굴을 한다.",
    tag: "교육",
    emoji: "",
    published: true,
    createdAt: "2023-11-07T05:57:00.000Z",
    updatedAt: "2023-11-07T05:57:00.000Z",
    content: `아이는 설명서를 먼저 버린다. 한참 자기 방식대로 접다가, 종이가 자꾸 쓰러지고 나서야 슬그머니 설명서를 다시 줍는다. 나는 이 장면을 수없이 봤다. 그리고 매번 조금 안심한다. 쓰러뜨려도 되는구나, 하고 아이가 몸으로 배우는 중이기 때문이다.

요즘 아이들이 만나는 것들은 대개 실패를 허락하지 않는다. 게임은 틀리면 즉시 다시 시작하고, 앱은 정답만 누르게 안내한다. 종이는 다르다. 잘못 접으면 자국이 남고, 그 자국을 안고 다시 세워야 한다.

${FigCognitive}

## 쓰러져도 되는 재료

종이의 미덕은 너그러움에 있다. 비싸지 않고, 다시 펼 수 있고, 한 장 더 있으면 처음부터 해볼 수도 있다. 그래서 아이는 **마음 놓고 틀린다.** 이 마음의 여유가 의외로 귀하다.

우리가 구조를 설계할 때 가장 신경 쓰는 지점이 여기다. 너무 쉬우면 한 번에 세워져 배울 게 없고, 너무 어려우면 포기한다. 그 사이 어딘가, **몇 번은 쓰러지되 끝내 세워지는 난이도**를 맞추는 것이 십 년 넘게 다듬어 온 감각이다.

## 다시 세우는 동안 자라는 것

쓰러진 인형을 다시 세우는 동안 아이는 작은 질문을 던진다. 어디가 무거웠지, 어느 각을 잘못 접었지. 이건 누가 가르쳐 준 게 아니라, 종이가 쓰러지며 스스로 물어온 질문이다.

심리학자 캐럴 드웩은 능력을 '타고나 고정된 것'이 아니라 '노력으로 자라는 것'으로 여기는 태도를 성장 마인드셋이라 불렀다. 틀린 것을 실력 부족의 증거가 아니라 다음 시도의 단서로 받아들이는 마음가짐이다. 쓰러진 종이를 다시 세우는 아이가 손으로 익히는 것이 바로 그 태도다.

실패가 벌이 아니라 정보가 되는 경험. 나는 이게 아이에게 줄 수 있는 가장 조용하고 단단한 선물 중 하나라고 생각한다. 정답을 빨리 맞히는 일보다, 틀린 뒤에 다시 손을 대는 일이 훨씬 오래 남는다.`,
  },

  /* ── 사례 연구 ── */
  {
    id: "seed-character-in-hand",
    coverImage: "https://images.unsplash.com/photo-1592194070650-f9b8be886683?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "character-in-hand-when-flat-becomes-form",
    title: "캐릭터를 손에 쥐여준다는 것",
    excerpt:
      "화면 속 캐릭터는 닫으면 사라진다. 손에 쥐는 순간 캐릭터는 다른 것이 된다. 평면이 입체가 되는 그 짧은 거리에 대해.",
    tag: "사례 연구",
    emoji: "",
    published: true,
    createdAt: "2023-09-26T01:44:00.000Z",
    updatedAt: "2023-09-26T01:44:00.000Z",
    content: `브랜드 회의실에는 대개 캐릭터가 벽에 걸려 있다. 잘 그려진 일러스트, 표정 가이드, 컬러 팔레트. 다들 그 앞에서 고개를 끄덕인다. 그런데 회의가 끝나면 캐릭터는 다시 파일 안으로 들어간다. 화면을 닫으면 사라지는 존재. 나는 그 장면을 오래 봐 왔다.

캐릭터는 누군가의 손에 들어가기 전까지는 도안일 뿐이다. 손에 쥐는 순간 비로소 다른 것이 된다.

${FigHandsPaper}

## 평면과 입체 사이의 짧은 거리

평면 일러스트와 입체 종이 사이의 거리는 생각보다 멀지 않다. 전개도를 접고, 몇 군데를 끼우면, 화면 안에만 있던 캐릭터가 책상 위에 선다. 그런데 그 짧은 거리를 건너고 나면 사람의 태도가 바뀐다. 보던 것에서 **가진 것**으로.

가진 것에는 자리가 생긴다. 모니터 옆, 책장 한 칸, 식탁 끝. 한번 자리를 잡은 물건은 매일 눈에 들어온다. 광고가 며칠을 가지 못하는 동안, 책상 위의 작은 종이 인형은 몇 달을 머문다. 2013년부터 움직이는 종이를 설계해 오며 확인한 것도 이 단순한 사실이었다.

심리학에는 '단순 노출 효과'라는 말이 있다. 특별한 이유 없이도, 자주 마주치는 대상에 사람은 점점 호감을 느낀다는 것이다. 책상 위에 놓인 작은 종이 인형은 그 효과를 매일 조금씩 쌓는다. 비싼 광고가 한 번 스쳐 사라지는 동안, 손바닥만 한 종이가 날마다 눈인사를 건네는 셈이다.

## 직접 접게 둔다는 선택

완성품을 건네는 것과 전개도를 건네는 것은 다르다. 전자는 받고 끝나지만, 후자는 받는 사람이 5분이든 10분이든 그 캐릭터와 시간을 보내게 만든다. 손끝으로 접는 동안 사람은 그 캐릭터를 조금 기억하게 된다.

수원시의 '수원이', 공주시의 '고마곰·공주'를 종이로 옮길 때 우리가 신경 쓴 것도 완성도보다 그 시간이었다. 시민이 직접 접어 세운 캐릭터는, 시청 홈페이지 속 이미지와는 다른 무게를 가진다. **만든 사람은 그것을 쉽게 버리지 못한다.**

평면을 입체로 바꾸는 일은 기술의 문제처럼 보이지만, 실은 거리의 문제다. 캐릭터와 사람 사이의 거리를 손 하나만큼 좁히는 일. 그 거리가 좁혀지면 나머지는 대개 알아서 따라온다.`,
  },
  {
    id: "seed-touched-once-more",
    coverImage: "https://images.unsplash.com/photo-1526071326860-5f7d9ba570df?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "the-thing-people-touch-once-more",
    title: "받는 사람이 한 번 더 만지는 물건",
    excerpt:
      "행사장에서 받은 굿즈는 대개 가방으로 들어간다. 그리고 잊힌다. 한 번 더 만지게 되는 물건은 무엇이 다른가.",
    tag: "사례 연구",
    emoji: "",
    published: true,
    createdAt: "2023-07-11T03:28:00.000Z",
    updatedAt: "2023-07-11T03:28:00.000Z",
    content: `행사장에서 사람들은 받은 굿즈를 대개 가방에 넣는다. 그리고 잊는다. 집에 와 가방을 비울 때 한 번 더 손에 닿지만, 그걸로 끝이다. 텀블러는 찬장으로, 에코백은 다른 에코백 위로 포개진다. 나는 부스 뒤에서 그 광경을 여러 번 지켜봤다. 정성껏 만든 물건이 받는 즉시 가방 속 어둠으로 사라지는 일.

그래서 언젠가부터 다른 질문을 하게 됐다. 어떻게 하면 한 번 더 만지게 될까.

${FigGoodsCompare}

## 한 번 더 만진다는 것의 의미

물건의 수명은 단가가 아니라 손이 닿는 횟수로 정해진다. 한 번 받고 마는 물건과, 받은 뒤 펼쳐서 접고 세워두는 물건은 같은 예산으로 만들어도 전혀 다른 시간을 산다.

페이퍼 엔지니어링이 하는 일은 이 지점에 개입하는 것이다. 받자마자 완성된 물건이 아니라, 받는 사람이 손을 대야 완성되는 물건. **완성의 마지막 단계를 받는 사람에게 넘긴다.** 그 한 단계 때문에 물건은 가방으로 직행하지 않고 책상 위에 머문다.

현대백화점 행사장에서도, 경주박물관 체험 부스에서도 같은 장면을 봤다. 다 접은 사람은 그것을 쉽게 내려놓지 못한다. 자기 손이 들어간 물건이기 때문이다.

## 잊히지 않는 쪽을 택한다

굿즈의 목적이 '나눠주는 것'이라면 단가 낮은 무엇이든 상관없다. 하지만 목적이 '기억되는 것'이라면 이야기가 달라진다. 잊히는 물건을 1만 개 뿌리는 것과, 책상 위에 남는 물건을 3천 개 건네는 것 중 무엇이 나은지는 한번 따져볼 만하다.

마케팅에서는 이를 도달과 잔존으로 나눠 말하기도 한다. 몇 사람에게 닿았는가와, 닿은 뒤 얼마나 오래 남았는가는 전혀 다른 문제다. 종이로 만든 물건은 도달이 좁아도 잔존이 길다. 어느 쪽이 더 필요한지는 굿즈를 만드는 목적이 정해 준다.

${FigCostCompare}

650건이 넘는 일을 거치며 배운 건, 사람들이 의외로 작은 종이 하나를 오래 간직한다는 사실이다. 자기가 접었기 때문에. 그 한 번의 손길이 물건의 운명을 바꾼다.`,
  },
  {
    id: "seed-paper-in-shortform",
    coverImage: "https://images.unsplash.com/photo-1563260797-cb5cd70254c8?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "why-moving-paper-survives-in-shortform",
    title: "움직이는 종이가 숏폼에서 살아남는 이유",
    excerpt:
      "타임라인을 넘기는 엄지손가락은 좀처럼 멈추지 않는다. 움직이는 종이 앞에서만 가끔 멈춘다. 그 1초는 어디서 오는 걸까.",
    tag: "사례 연구",
    emoji: "",
    published: true,
    createdAt: "2023-05-23T06:12:00.000Z",
    updatedAt: "2023-05-23T06:12:00.000Z",
    content: `숏폼을 넘기는 엄지손가락은 좀처럼 멈추지 않는다. 잘 만든 영상도 1초를 못 버티고 위로 밀려난다. 그런데 가끔, 누군가 종이를 접어 캐릭터의 팔을 움직이는 짧은 영상 앞에서 손가락이 멎는 걸 본다. 화려해서가 아니다. 그저 종이가 움직이는 게 어쩐지 낯설어서다.

나는 그 멈칫하는 1초가 어디서 오는지 오래 생각했다.

${FigSnsShare}

## 손이 들어간 영상은 다르다

화면 속 콘텐츠는 대개 완성된 채로 등장한다. 그래서 매끈하지만, 어딘가 남의 일처럼 보인다. 반면 누군가의 손이 종이를 접고 끼우는 장면에는 과정이 남아 있다. 보는 사람은 그 과정을 따라가며 무의식적으로 '나도 해볼 수 있겠다'고 느낀다. 그 작은 느낌이 손가락을 멈추게 한다.

움직임도 한몫한다. 정지한 사진은 한 컷이지만, 종이 인형이 고개를 까딱이는 3초는 그 자체로 짧은 이야기가 된다. **숏폼 알고리즘은 끝까지 보게 만드는 것을 좋아하고, 작은 움직임은 끝을 궁금하게 만든다.** 우리가 설계할 때 움직임의 마무리를 신경 쓰는 이유이기도 하다.

플랫폼이 영상을 추천할지 말지 정할 때 보는 핵심 지표 하나가 '얼마나 끝까지 보는가', 곧 시청 지속이다. 3초짜리 움직임이라도 그 끝이 궁금하면 사람은 끝까지 본다. 손가락이 멈추는 그 짧은 순간이 쌓여, 알고리즘에게는 '더 보여 줄 만한 영상'이라는 신호가 된다.

## 자랑이 아니라 기록으로 올라간다

사람들이 종이 인형을 찍어 올리는 건 광고를 대신해주려는 게 아니다. 자기가 만든 것을 남기고 싶어서다. 그 차이는 중요하다. 시키지 않아도 올라오는 콘텐츠는 광고처럼 보이지 않고, 그래서 더 멀리 간다.

KAIST 행사에서도, 지역 축제 부스에서도 우리는 같은 흐름을 봤다. 누군가 접고, 찍고, 올린다. 그 영상을 본 또 다른 누군가가 부스를 찾아온다. 종이 한 장이 만든 작은 순환이다.

${FigFestival}

움직이는 종이가 숏폼에서 살아남는 이유는 하나다. 사람의 손이 닿은 흔적이 남아 있기 때문이다.`,
  },

  /* ── 이야기 ── */
  {
    id: "seed-writing-one-quote",
    coverImage: "https://images.unsplash.com/photo-1542621334-a254cf47733d?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "writing-one-quote",
    title: "견적서 한 장을 쓰기까지",
    excerpt:
      "단가표가 없는 시장에서 견적서 한 장을 쓰는 일은 생각보다 오래 걸린다. 그 사흘 동안 내가 책상 앞에서 하는 일에 대해 적었다.",
    tag: "이야기",
    emoji: "",
    published: true,
    createdAt: "2023-03-14T01:36:00.000Z",
    updatedAt: "2023-03-14T01:36:00.000Z",
    content: `견적서 한 장을 쓰는 데 사흘이 걸릴 때가 있다.

처음 이 일을 시작했을 때는 그게 부끄러웠다. 다른 업종은 단가표를 펼쳐 칸을 채우면 끝나는데, 나는 왜 종이 한 장을 두고 사흘을 앉아 있나 싶었다. 지금은 그렇게 생각하지 않는다. 움직이는 종이에는 정가가 없다. 같은 캐릭터라도 팔을 들게 할지 고개를 끄덕이게 할지에 따라 접는 횟수가 달라지고, 그 한 번의 접힘이 단가를 바꾼다.

## 보이지 않는 것을 세는 일

견적을 낸다는 건 숫자를 부르는 일이 아니라, 아직 세상에 없는 물건을 머릿속에서 한 번 만들어보는 일이다.

의뢰가 들어오면 나는 먼저 그 종이가 누구의 손에 들어갈지를 떠올린다. 축제 부스에서 아이가 받을 것인지, 박물관 기념품 매대에 놓일 것인지. 받는 사람이 다르면 종이의 두께가 달라지고, 두께가 달라지면 칼선이 달라진다. 수량이 천 부인지 만 부인지에 따라 인쇄 방식이 바뀌고, 포장을 낱개로 할지 묶음으로 할지에 따라 또 견적이 출렁인다. **그 모든 변수를 한 번씩 손으로 짚어보고 나서야** 비로소 숫자를 적을 수 있다.

그래서 우리 견적서에는 남들 것에 없는 줄이 몇 개 있다. 시제품 제작비, 칼선 제작비, 조립 난이도에 따른 검수 시간 같은 것들이다. 눈에 잘 안 띄지만 실제로 돈과 시간이 드는 자리다. 이걸 처음부터 적어 두면, 나중에 '이건 왜 붙었느냐'는 이야기가 나오지 않는다. 정직한 견적은 대개 줄이 길다.

${FigGeometry}

그래서 나는 견적서를 쓰기 전에 늘 빈 종이를 한 장 접어본다. 팔리는 물건이 아니라, 그저 손이 기억하는 무게를 확인하기 위해서다.

## 정직한 숫자의 무게

단가표가 없다는 건 매번 처음부터 계산한다는 뜻이고, 그건 곧 거짓말을 하기 어렵다는 뜻이기도 하다.

칸을 채워 보내는 견적에는 마음이 담기지 않는다. 하지만 사흘을 들여 매겨낸 숫자에는, 그 물건이 실제로 어떻게 만들어질지에 대한 내 책임이 들어 있다. 그래서 나는 견적서의 맨 아랫줄을 적을 때마다 조금 긴장한다. 그 숫자가 곧 약속이기 때문이다.

손님은 그 사흘을 모른다. 알 필요도 없다. 다만 받아 든 견적서가 어쩐지 미덥다고 느낀다면, 그건 보이지 않는 곳에서 누군가 종이를 한 번 접어봤기 때문이라고, 나는 믿는다.`,
  },
  {
    id: "seed-sample-first-principle",
    coverImage: "https://images.unsplash.com/photo-1743243922847-2c94800238fe?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "sample-first-principle",
    title: "샘플을 먼저 만든다는 원칙",
    excerpt:
      "말로 설명하는 대신 샘플을 먼저 만들어 보냅니다. 손해처럼 보이는 이 순서를 바꾸지 않는 이유를 말씀드릴게요.",
    tag: "이야기",
    emoji: "",
    published: true,
    createdAt: "2023-01-25T04:49:00.000Z",
    updatedAt: "2023-01-25T04:49:00.000Z",
    content: `저희는 계약서보다 샘플을 먼저 만들어요.

말로 다 설명할 수 있다면 그렇게 했을 거예요. 그런데 움직이는 종이는 말로 옮겨지지 않습니다. 팔이 어떻게 올라가는지, 펼쳤을 때 어떤 소리가 나는지, 아이 손에서 몇 번을 견디는지 — 이런 건 글로 적으면 거짓말에 가까워져요. 그래서 설명을 줄이고, 진짜 종이를 깎아 우편으로 보내 드립니다.

## 손에 쥐어야 알 수 있는 것들이 있어요

샘플 하나를 만드는 데도 도면을 그리고, 칼선을 앉히고, 시제품을 몇 번이나 접었다 폅니다. 기간으로는 2주쯤, 비용으로는 100만 원 안팎이 드는 일이에요.

사실 손해에 가까운 과정입니다. 의뢰가 계약으로 이어지지 않으면 그 샘플은 그대로 비용이 되니까요. 그런데도 이 순서를 바꾸지 않는 이유는, 손님이 종이를 직접 쥐어 보는 순간에만 일어나는 일이 있기 때문이에요. 화면으로 볼 때는 "괜찮네요" 하시던 분이, 실물을 받고 나면 비로소 진짜 질문을 하세요. 여기를 조금 더 단단하게 할 수 없냐고, 이 부분이 아이에겐 어렵지 않겠냐고.

${FigHandsPaper}

그 질문들이 저는 반갑습니다. 그제야 같은 물건을 보며 이야기하게 되니까요. **샘플은 영업 도구가 아니라, 대화를 시작하는 공통의 언어예요.**

## 좋은 결과는 늘 좋은 샘플에서 나왔습니다

2013년에 시작해 650건 넘게 일하면서 배운 게 있다면 이거예요. 현대백화점이든 경주박물관이든, 처음 보낸 샘플이 시원찮으면 끝까지 어딘가 삐걱댔습니다. 반대로 첫 샘플에서 손님과 저희가 같은 그림을 그리게 되면, 그다음은 신기할 만큼 매끄러웠어요. 그래서 샘플 만드는 시간을 아끼지 않습니다. 가장 비싼 단계처럼 보여도, 지나고 보면 가장 싼 단계였어요.

먼저 만들어 보내 드립니다. 저희가 일을 시작하는 방식이에요.`,
  },
  {
    id: "seed-since-2013-paper-living",
    coverImage: "https://images.unsplash.com/photo-1559125148-869baf508c95?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "since-2013-paper-living",
    title: "Since 2013, 종이로 먹고산다는 것",
    excerpt:
      "움직이는 종이를 설계하며 13년을 보냈다. 종이로 먹고산다는 게 어떤 일인지, 담담히 돌아보며 적었다.",
    tag: "이야기",
    emoji: "",
    published: true,
    createdAt: "2022-11-08T02:07:00.000Z",
    updatedAt: "2022-11-08T02:07:00.000Z",
    content: `종이로 먹고산다고 하면, 사람들은 대개 한 번 더 묻는다.

2013년에 이 스튜디오를 열 때 나도 확신은 없었다. 종이를 접어 무언가를 움직이게 만드는 일이 직업이 될 수 있을지, 그걸로 십 년을 넘게 버틸 수 있을지. 다만 평면이 입체가 되는 그 순간이 좋았고, 그 좋음 하나로 여기까지 왔다. 지금 우리에겐 지기구조를 스스로 지탱하는 설계 특허가 열한 가지 있지만, 그 숫자보다 먼저 떠오르는 건 밤새 접었다 편 수많은 시제품들이다.

## 매번 처음부터

이 일에는 익숙해질 만하면 다시 처음이 되는 구석이 있다.

제품이 바뀌면 움직임이 바뀌고, 움직임이 바뀌면 구조를 새로 짜야 한다. 그래서 13년을 했어도 어제 풀던 문제와 오늘 풀 문제가 다르다. 누군가는 이걸 비효율이라 부를 것이다. 같은 걸 찍어내면 편할 텐데, 우리는 매번 새 도면 앞에 앉는다. 그런데 바로 그 점 때문에 나는 아직 이 일이 지겹지 않다. **반복되지 않는 일에는 늙지 않는 데가 있다.**

${FigFestival}

현대백화점의 행사장에서, KAIST의 강의실에서, 수원시의 축제 부스에서 우리 종이가 누군가의 손에 들리는 걸 본다. 그때마다 도면 위의 선이 사람의 손가락 끝에서 비로소 완성된다는 걸 느낀다.

## 종이접기에서 시작했다

처음부터 '페이퍼 엔지니어링'이라는 이름을 단 건 아니었다. 시작은 종이접기였다. 접어서 움직이는 도안을 그리고, 아이들이 그대로 따라 접을 수 있게 책으로 묶었다. 『합체! 전투기 종이접기』 같은 놀이책이 그 시절의 흔적이다([길벗스쿨, 2020](https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=249775399)). 종이 한 장이 어떻게 하면 더 잘 접히고 더 잘 움직일지를 도안 위에서 수없이 시험하던 시간이, 나중에 구조 설계의 바탕이 됐다.

도안을 그리면서도 머릿속으로는 늘 구조와 힘의 방향을 따졌다. 종이접기를 어느새 '엔지니어링'이라 부르게 된 것도 그래서였다.

회사 이름도 거기서 나왔다. 움직임을 뜻하는 '액션(action)'과 만들기를 뜻하는 '크래프트(craft)'를 붙여 액션크래프트라 지었다. 초기에는 울산에서 작은 팀으로 버텼다. 울산창조경제혁신센터의 지원을 받았고, 센터가 소개한 〈꿈을 쫓는 사람들〉에 '세상을 즐겁게 만드는 액션크래프트'로 실리기도 했다([울산창조경제혁신센터, 2016](https://www.facebook.com/usccei/posts/1522847528046133/)). 그 무렵 장생포 고래박물관의 생태체험교실을 맡아 운영하며, 종이가 전시장과 교실에서 실제로 어떻게 쓰이는지를 손으로 익혔다.

이듬해 전자신문은 우리를 '움직이는 페이퍼 토이'를 교육과 비즈니스로 끌고 온 곳이라 소개했다([전자신문, 2017](https://m.etnews.com/20171219000432)). 그 뒤로 일은 방과후 수업과 자유학기제 교실로, 서울역사박물관 같은 박물관 체험과 DDP 디자인놀이터로 넓어졌다. 자체 제품은 교보문고와 핫트랙스, 홈플러스·이마트·롯데마트·다이소 매대에도 놓였다.

돌아보면 전문성이라는 건 한 번에 생기지 않았다. 종이접기 도안 한 장, 쓰러진 시제품 하나, 납품한 교구 한 세트가 쌓여 만들어졌다. 특허 열한 가지도, 그사이 두 번 받은 문화체육관광부 장관상도 그 축적의 결과지 출발점이 아니었다. 상은 받으려고 한 일이 아니라, 종이로 여기까지 왔다는 작은 표지로 여기고 있다.

## 남는 것은 결국 태도

오래 한 일에 대해 자랑할 말은 별로 없다. 다만 지키려 한 것이 있다면, 매번 정직하게 견적을 내고, 먼저 샘플을 만들어 보내고, 납품한 물건이 손님의 손에서 부끄럽지 않게 하는 것 정도였다.

종이는 약한 재료다. 젖으면 무르고, 접으면 자국이 남는다. 그런데 그 약한 것으로 움직이는 구조를 세우는 일을 13년 하다 보니, 약함을 다루는 일에도 나름의 단단함이 필요하다는 걸 알게 됐다. 종이로 먹고산다는 건 그런 단단함을 매일 조금씩 쌓아가는 일이었다.

처음엔 종이가 약해서 불안했다. 지금은 그 약함이 오히려 마음에 든다. 약한 재료는 함부로 다루면 곧장 티가 난다. 그래서 정직해질 수밖에 없다. 튼튼한 재료 뒤에 숨을 수 없는 일을, 나는 13년째 하고 있는 셈이다.

여전히 우리는 작은 스튜디오다.`,
  },

  /* ─────────────── 글 1: 지자체 관광 담당자 ─────────────── */
  {
    id: "seed-local-government-paper-toy",
    slug: "local-government-paper-toy-promotion",
    title: "또 텀블러였다 — 지자체 굿즈가 닮아가는 이유",
    excerpt:
      "도시마다 캐릭터는 다른데, 굿즈는 어쩐지 다 비슷하다. 수원이와 고마곰을 종이로 옮기며 그 닮음의 이유를 다시 생각했다.",
    tag: "사례 연구",
    emoji: "",
    coverImage: "https://images.unsplash.com/photo-1603929832681-00d8f727063c?w=1200&h=630&fit=crop&crop=faces,center&auto=format&q=80",
    published: true,
    createdAt: "2022-09-20T05:34:00.000Z",
    updatedAt: "2022-09-20T05:34:00.000Z",
    content: `행사장을 몇 군데 돌다 보면 묘한 기시감이 든다. 도시마다 캐릭터는 분명 다른데, 나눠 주는 물건은 어쩐지 다 비슷하다. 텀블러, 에코백, 키링. 받는 사람도 안다. 아, 또 이거.

지역 캐릭터를 종이로 옮기는 일을 하면서 나는 이 닮음의 이유를 자주 생각했다. 캐릭터가 부족해서가 아니다. 캐릭터를 평면에 그대로 둔 채, 흔한 물건 위에 얹기 때문이다.

## 평면에 머무는 캐릭터

대부분의 지역 캐릭터는 도시 홈페이지와 현수막 속에만 산다. 잘 그려져 있지만 시민의 손에 닿는 일은 드물다. 평면 일러스트는 보는 것에서 멈춘다.

수원시 '수원이', 공주시 '고마곰·공주'를 종이로 옮길 때 우리가 한 일은 단순하다. 평면을 입체로 일으켜 세운 것뿐이다. 그런데 그 작은 차이가 캐릭터를 보는 것에서 가진 것으로 바꿔 놓는다. 가진 것에는 자리가 생기고, 자리를 얻은 물건은 매일 눈에 들어온다.

텀블러가 매번 선택되는 데도 이유는 있다. 조달이 쉽고, 실패할 일이 없고, 누구도 토를 달지 않는다. 무난함은 담당자에게 가장 안전한 선택이다. 다만 안전한 선택은 대개 기억되지 않는다. 도시가 굳이 캐릭터를 만든 이유가 '기억되기 위해서'였다면, 굿즈도 한 번쯤 그 목적을 따라가 볼 만하다.

${FigFestival}

## 같은 예산으로 더 멀리

행사 기념품의 현실적인 고민은 결국 단가다. 텀블러 천 개를 만들 예산이면 종이로는 그 몇 배를 만들 수 있다. 부스에서 직접 접어 가져가는 체험까지 얹히니, 받는 사람에게는 물건이 아니라 잠깐의 경험이 된다.

${FigCostCompare}

## 시민이 대신 찍어 올린다

종이는 받는 사람이 직접 접어야 완성된다. 그 번거로움이 묘한 일을 한다. 자기 손으로 세운 캐릭터를 책상에 올려 두고 사진을 찍는다. 시키지 않아도 올라온다. 정적인 컵 사진보다, 움직이는 종이 한 컷이 타임라인에서 훨씬 멀리 간다.

대단한 전략은 아니다. 다만 도시마다 똑같던 굿즈의 자리에, 시민이 한 번 더 만지는 물건을 놓아 보는 일이다.`,
  },

  /* ─────────────── 글 2: 교육 담당자 ─────────────── */
  {
    id: "seed-original-steam-paper-engineering-kit",
    slug: "original-steam-paper-engineering-kit-guide",
    title: "시판 교구에는 없는 것",
    excerpt:
      "교구는 어디서나 살 수 있어요. 그래서 어느 학교나 같은 수업을 하게 됩니다. 우리 학교만의 종이 교구가 만드는 차이를 이야기해 볼게요.",
    tag: "교육",
    emoji: "",
    coverImage: "https://images.unsplash.com/photo-1766932901295-d4185660341b?w=1200&h=630&fit=crop&crop=faces,center&auto=format&q=80",
    published: true,
    createdAt: "2022-07-05T01:19:00.000Z",
    updatedAt: "2022-07-05T01:19:00.000Z",
    content: `교구는 어디서나 살 수 있어요. 그래서 어느 학교나, 어느 학원이나 비슷한 키트로 비슷한 수업을 하게 됩니다. 나쁜 일은 아니에요. 다만 그 수업에는 '우리만의 것'이 빠져 있죠.

교육용 종이 작업을 오래 하면서 알게 된 건, 교구의 차이가 의외로 작은 데서 온다는 사실이에요. 학교의 마스코트, 동네의 이야기, 그 학년의 눈높이. 이런 게 종이 한 장에 들어가면 수업의 공기가 달라집니다.

## 우리 학교만의 것

학부모가 학교를 기억하는 방식은 대개 눈에 보이는 한 장면이에요. 시판 키트로 만든 결과물은 그런 장면이 되기 어렵습니다. 어디서나 똑같으니까요.

학교 마스코트로 만든 움직이는 종이 인형은 달라요. 첫 수업 한 번이면 아이가 집에 들고 가고, 그날 저녁 사진 한 장이 단톡방에 올라갑니다. 구조를 짤 때 저희가 신경 쓰는 건 화려함이 아니라, 도형의 내각과 무게중심 같은 원리를 아이가 손으로 먼저 만나게 하는 일이에요.

이런 수업을 요즘은 STEAM 교육이라고 불러요. 과학(Science)·기술(Technology)·공학(Engineering)·예술(Art)·수학(Mathematics)을 따로 떼어 가르치는 대신, 하나의 활동 안에서 함께 만나게 하자는 흐름이죠. 종이 한 장을 접어 캐릭터를 세우는 일에는 그 다섯이 자연스럽게 섞여 있습니다. 도형을 따지는 수학, 무게를 견디게 하는 공학, 캐릭터를 살리는 예술이 한 번의 접기 안에서 동시에 일어나요. 융합이라는 말을 따로 설명할 필요가 없습니다.

${FigClassroom}

## 움직이면 영상이 됩니다

교육에서 만든 것이 좀처럼 퍼지지 않는 이유는 결과물이 가만히 있기 때문이에요. 그런데 아이가 세운 종이가 그 자리에서 고개를 까딱이면, 부모는 영상을 찍습니다. 그 짧은 영상이 학교와 학원의 가장 정직한 광고가 돼요. 광고처럼 보이지 않아서 더 멀리 갑니다.

${FigSnsShare}

## 한 번 만들면 오래 씁니다

학교만의 교구는 한 번 설계해 두면 그 뒤로 오래 쓰여요. 방과 후 프로그램으로 이어지고, 재료만 다시 받아 반복할 수도 있습니다. 교사용 안내까지 함께 정리해 두면 선생님이 바뀌어도 수업은 남아요. 어린이 제품이라 KC 안전 인증도 챙겨야 하는데, 이 부분은 설계 단계에서 저희가 함께 봅니다.

거창한 교육 혁신을 말하려는 건 아니에요. '어디서나 같은 수업' 대신 '여기서만 하는 수업'을 하나 만들어 보자는 이야기입니다.`,
  },

  /* ─────────────── 글 3: AI 시대 인지 효과 ─────────────── */
  {
    id: "seed-ai-era-paper-engineering",
    slug: "ai-era-paper-engineering-cognitive-benefits",
    title: "AI가 다 해주는 시대에, 손으로 종이를 만진다는 것",
    excerpt:
      "그림도 글도 영상도 AI가 만들어 준다. 그럴수록 손으로 무언가를 세워 보는 시간이 드물어진다. 그 시간에 대해 적었다.",
    tag: "교육",
    emoji: "",
    coverImage: "https://images.unsplash.com/photo-1576616519640-692f49128a59?w=1200&h=630&fit=crop&crop=faces,center&auto=format&q=80",
    published: true,
    createdAt: "2022-05-24T03:55:00.000Z",
    updatedAt: "2022-05-24T03:55:00.000Z",
    content: `요즘 아이들은 숙제를 AI에게 묻는다. 그림도, 글도, 영상도 몇 초면 나온다. 부모와 교사가 같은 질문을 하는 것도 당연하다. 이런 시대에 아이는 대체 무엇을 길러야 하나.

답은 좀 역설적이다. AI가 잘하는 일이 늘어날수록, AI가 못 하는 일의 값이 오른다. 그중 하나가 손으로 직접 무언가를 세워 보는 경험이다. 나는 이걸 매일 종이를 다루며 확인한다.

## 평면을 머릿속에서 세우는 일

펼쳐진 전개도를 보고 완성된 입체를 미리 떠올리는 능력. 거창하게는 공간 지각력이라 부르지만, 실은 보이지 않는 모양을 미리 그려 보는 힘이다.

${FigGeometry}

이건 영상으로는 잘 자라지 않는다. 직접 접어 세우고, 어긋난 자리를 손으로 바로잡아야 몸에 밴다. 화면을 넘기는 손가락과 종이를 접는 손가락은 서로 다른 일을 한다.

## 손끝이 곧 생각이다

손의 정교한 움직임이 뇌를 깨운다는 건 발달 분야에서 오래된 상식이다. 접고, 붙이고, 정확한 자리에 끼우는 동작은 집중과 계획과 문제 해결을 함께 끌어올린다. 스마트폰이 손의 일을 단순한 쓸어넘김으로 줄여 놓은 시대라, 종이 작업의 값은 오히려 올라간다.

인지과학에는 '체화된 인지'라는 관점이 있다. 생각은 머릿속에서만 일어나는 게 아니라, 몸을 움직이고 사물을 다루는 과정과 한 몸으로 굴러간다는 것이다. 손으로 직접 종이를 접어 본 아이가 도형을 더 또렷이 이해하는 것도 같은 맥락이다. 머리와 손은 따로 노는 두 기관이 아니다.

${FigHandsPaper}

## 실패가 정보가 되는 경험

종이는 한 번에 서지 않는다. 쓰러지면 어디가 무거웠는지 들여다보고 다시 세운다. 이 관찰과 수정의 반복이야말로, AI에게 프롬프트만 던져서는 끝내 얻을 수 없는 것이다.

${FigCognitive}

결과물을 만드는 일이 흔해질수록, 그 결과물을 어떻게 세울지 생각하는 힘이 차이를 만든다. 그리고 그 힘은 종이든 블록이든, 물성을 손으로 다뤄 본 사람에게서 자란다. 거창한 결론은 아니다. 다만 화면 밖에서 종이 한 장을 세워 보는 저녁이, 생각보다 오래 남는다는 이야기다.`,
  },

  /* ─────────────── 글 4: 기업 굿즈 담당자 ─────────────── */
  {
    id: "seed-corporate-paper-goods",
    slug: "corporate-paper-goods-beyond-tumbler",
    title: "텀블러·에코백 다음을 고민하는 마케팅팀에게",
    excerpt:
      "공들여 만든 굿즈가 받는 즉시 가방 속으로 사라지는 걸 여러 번 봤어요. 그 흐름을 바꾸는 방법을 종이 쪽에서 찾아봤습니다.",
    tag: "사례 연구",
    emoji: "",
    coverImage: "https://images.unsplash.com/photo-1513885535751-8b9238bd345a?w=1200&h=630&fit=crop&crop=faces,center&auto=format&q=80",
    published: true,
    createdAt: "2022-03-08T06:27:00.000Z",
    updatedAt: "2022-03-08T06:27:00.000Z",
    content: `기업 굿즈의 운명은 대개 비슷해요. 환영 키트의 텀블러는 서랍으로, 컨퍼런스의 에코백은 옷장으로. 공들여 만들었는데 받는 즉시 어딘가로 사라집니다. 부스 뒤에서 그 광경을 여러 번 봤어요.

마케팅팀이 진짜 원하는 건 두 가지일 거예요. 받은 사람이 실제로 간직하는 것, 그리고 시키지 않아도 어딘가에 올라오는 것. 종이는 의외로 이 두 가지에 강합니다.

${FigGoodsCompare}

## 손이 한 번 들어간 물건은 다릅니다

종이 굿즈는 받는 사람이 직접 접어야 완성돼요. 번거롭죠. 그런데 그 번거로움이 물건의 운명을 바꿉니다. 자기 손이 들어간 것은 쉽게 버려지지 않아요. 책상 옆에 며칠, 길게는 몇 달을 남습니다. 2013년부터 현대백화점, KAIST 같은 곳들과 650건 넘게 일하면서 가장 자주 확인한 사실이에요.

처음 보는 형태라 신기하고, 직접 만들어 뿌듯하고, 움직이니 찍을 거리가 됩니다. 평범한 컵 사진과 달리 움직이는 종이는 짧은 영상이 되고, 그 영상은 알고리즘을 타고 멀리 가요.

마케팅에서는 이런 걸 사용자 생성 콘텐츠, 줄여서 UGC라고 부릅니다. 회사가 만든 광고가 아니라 받은 사람이 직접 찍어 올리는 콘텐츠예요. 만든 쪽의 자랑이 아니라 받은 쪽의 기록이라, 보는 사람도 그걸 광고로 여기지 않습니다. 한 사람이 접어 올린 종이 인형 한 컷이 잘 만든 배너 한 장보다 멀리 가는 이유가 여기에 있어요.

## 같은 예산, 다른 도달

굿즈 예산은 대개 정해져 있죠. 단단한 물건 천 개를 만들 돈이면, 종이로는 그 몇 배의 사람에게 닿을 수 있어요. 종이 굿즈의 생산비는 첫 1,000부가 가장 비싸고 그다음부터 1,000부당 단가가 내려가는 구조라, 참가자가 많은 행사일수록 유리해집니다. 포장을 넣어도 개당 500원(OPP 봉투)에서 2,000원(종이 박스) 사이에서 움직여요. 다 쓰면 종이로 분리배출하면 되니, 환경 보고서 앞에서도 떳떳합니다.

물론 모든 굿즈가 종이여야 하는 건 아니에요. 다만 '나눠 주고 끝'이 아니라 '기억에 남기'가 목적이라면 한 번 따져볼 만합니다. 잊히는 물건을 많이 뿌리는 것과, 남는 물건을 적당히 건네는 것 중 어느 쪽이 나은지요.`,
  },

  /* ─────────────── 글 5: 외주 체크리스트 ─────────────── */
  {
    id: "seed-outsourcing-checklist",
    slug: "paper-toy-outsourcing-checklist",
    title: "페이퍼토이 외주 견적, 왜 두세 배씩 차이가 날까요",
    excerpt:
      "같은 사양인데 업체마다 견적이 두세 배씩 벌어지는 시장이에요. 발주 전에 확인하면 좋을 것들을 만드는 사람 입장에서 알려 드립니다.",
    tag: "제작 과정",
    emoji: "",
    coverImage: "https://images.unsplash.com/photo-1581291518633-83b4ebd1d83e?w=1200&h=630&fit=crop&crop=faces,center&auto=format&q=80",
    published: true,
    createdAt: "2022-01-18T02:41:00.000Z",
    updatedAt: "2022-01-18T02:41:00.000Z",
    content: `페이퍼토이 외주는 표준 단가표가 거의 없는 시장이에요. 같은 사양인데 업체마다 견적이 두세 배씩 벌어지는 일이 흔합니다. 처음 맡기는 분이 당황하시는 것도 당연해요.

만드는 쪽에 오래 있다 보니, 어떤 질문이 오갈 때 좋은 거래가 되는지는 어느 정도 보입니다. 제가 발주자라면 먼저 물어보겠다 싶은 것들을 적어 둘게요.

${FigChecklist}

## 대략의 가격대부터 알고 시작하세요

저희 기준으로 말씀드리면, 도면 설계비는 구조 난이도에 따라 종당 100만 원대에서 300만 원대까지 벌어져요. 가만히 서 있는 단순한 구조인지, 당기면 팔이 움직이는 구조인지에 따라 설계 공수가 전혀 다르기 때문입니다. 인쇄·재단까지 맡기시면 첫 1,000부 생산에 400만 원 안팎이 더해지고, 수량이 늘수록 1,000부당 부담은 200만 원대로 내려갑니다. 업체마다 산식은 다르지만, 받아 든 견적이 이 범위에서 크게 벗어난다면 어느 항목 때문인지 물어보실 만해요.

## 단가는 구간으로 물어보세요

"천 부에 얼마예요?"라는 질문의 답에는 정보가 거의 없어요. 천 부·삼천 부·오천 부·만 부의 단가를 함께 달라고 해 보세요. 수량이 늘 때 단가가 크게 떨어지는 곳은 대개 제 생산 라인을 가진 업체이고, 거의 변하지 않는다면 외주를 다시 외주로 돌리는 곳일 수 있습니다.

## 샘플과 권리를 먼저 확인하세요

샘플 비용이 견적에 포함인지, 추가 샘플은 얼마인지 짚어 두세요. 샘플 단계에서 구조가 안 잡히면 본 생산은 더 어렵습니다. 샘플을 마다하지 않는 곳이 본 생산도 안정적이에요. 참고로 저희는 샘플링을 별도 단계로 두는데, 대략 100만 원 안팎에 2주쯤 잡습니다. 이 비용을 아까워하시는 분도 계시지만, 본 생산에서 사고가 나는 쪽이 훨씬 비쌉니다.

지자체·관공서라면 디자인 저작권이 어디로 귀속되는지도 미리 정하셔야 해요. 이걸 빼먹으면 이듬해 추가 제작 때 정작 그 디자인을 다른 곳에서 못 쓰는 일이 생깁니다.

## 일정과 인증은 계약서에서 보세요

축제나 런칭처럼 날짜가 고정된 일은 납기 지연이 치명적이에요. 약정일과 지연 시 책임을 계약서에 적어 두는 편이 서로 편합니다. 어린이가 만지는 교구라면 KC 안전 인증(어린이 제품이 유해 물질과 물리적 위험 기준을 통과했음을 국가가 확인해 주는 의무 인증)이 없으면 학교·교육청 납품 자체가 막히니, 견적 단계에서 미리 확인해 주세요.

복잡해 보여도 요점은 하나예요. 보이지 않는 조건을 처음에 꺼내 놓는 곳이 끝까지 덜 어긋납니다.`,
  },

  /* ─────────────── 2021 추가분 (시작기 회고·기술 노트 6편) ─────────────── */
  {
    id: "seed-paper-die-cutting-and-cut-lines",
    coverImage: "https://images.unsplash.com/photo-1693031630146-568e2f72db0e?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "paper-die-cutting-and-cut-lines",
    title: "도무송과 칼선 — 종이를 정확히 오린다는 것",
    excerpt:
      "가위로는 안 되는 정확한 오림은 '도무송'이 한다. 칼선과 접는 선이 완성도를 가르는 이야기.",
    tag: "제작 과정",
    emoji: "",
    published: true,
    createdAt: "2021-11-24T04:38:00.000Z",
    updatedAt: "2021-11-24T04:38:00.000Z",
    content: `종이를 정확히 오리는 일은 생각보다 어렵다. 가위로는 한계가 있고, 손으로 칼을 대면 매번 미세하게 달라진다. 그래서 일정 수량부터는 '도무송'을 쓴다.

## 칼 모양을 미리 만든다

도무송(Thomson)은 원하는 모양대로 칼날을 합판에 박아 만든 틀로, 종이를 한 번에 찍어 오리는 가공이다. 쿠키 커터로 반죽을 찍는 것과 같다. 틀을 한 번 만들어 두면 같은 모양을 수천 장 똑같이 오릴 수 있다.

곡선이 많은 캐릭터, 안쪽을 파내야 하는 창, 끼움용 홈처럼 가위로는 엄두가 안 나는 형태도 도무송이면 깔끔하게 떨어진다.

## 자르는 선과 접는 선은 다르다

도면에는 두 종류의 선이 있다. 완전히 잘리는 칼선과, 자르지 않고 눌러 자국만 내는 접는 선(오시)이다. 접는 선을 제대로 눌러 두지 않으면 종이가 엉뚱한 데서 접히거나, 두꺼운 종이는 접다가 갈라진다.

그래서 같은 도안이라도 칼선과 오시를 어디에 어떻게 넣느냐가 완성도를 가른다. 보이지 않는 이 설계가 손에 쥐었을 때의 느낌을 정한다.

소량일 때는 칼로, 많을 때는 도무송으로. 그 경계를 가늠하는 것도 오래 일하며 익힌 감각이다.`,
  },
  {
    id: "seed-mathematics-of-folding-paper",
    coverImage: "https://images.unsplash.com/photo-1768815210987-591340ed69fb?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "the-mathematics-of-folding-paper",
    title: "접기에도 공리가 있다",
    excerpt:
      "접는 행위 자체가 하나의 수학이다. 후지타 공리와 하가의 정리처럼, 종이접기에 숨은 기하 이야기.",
    tag: "교육",
    emoji: "",
    published: true,
    createdAt: "2021-09-07T01:52:00.000Z",
    updatedAt: "2021-09-07T01:52:00.000Z",
    content: `종이접기를 한참 하다 보면 묘한 사실을 만난다. 접는 행위 자체가 하나의 수학이라는 것.

## 접기로 그릴 수 있는 것

자와 컴퍼스로 그리는 작도가 있듯, 종이접기에도 '접기로 할 수 있는 일'을 정리한 규칙이 있다. 후지타-하지메 공리라 불리는 여섯(이후 일곱) 가지 기본 접기다. 두 점을 겹치게 접기, 한 점을 한 직선 위로 접기 같은 단순한 동작인데, 놀랍게도 이 접기들의 조합은 자·컴퍼스로는 풀 수 없는 문제(각의 삼등분 같은)까지 풀어낸다.

## 손으로 증명하는 정리

하가의 정리라는 것도 있다. 정사각형 종이의 한 꼭짓점을 반대편 변의 중점에 맞춰 접기만 하면, 변이 정확히 삼등분되는 점이 생긴다. 자로 재지 않고 접기 한 번으로 3분의 1을 찾는 것이다.

아이에게 이걸 설명으로 가르치긴 어렵다. 그런데 직접 접어 보면 "어, 정말 나뉘네" 하고 손이 먼저 안다. 우리가 교구를 설계할 때 이런 순간을 일부러 심어 두는 이유다.

${FigGeometry}

접기는 종이를 다루는 기술이기 전에, 평면과 각도를 다루는 가장 오래된 방법 중 하나다. 그 사실이 나는 여전히 신기하다.`,
  },
  {
    id: "seed-how-color-sits-on-paper",
    coverImage: "https://images.unsplash.com/photo-1642480532034-362360552ccb?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "how-color-sits-on-paper",
    title: "종이에 색이 입혀지는 자리",
    excerpt:
      "같은 빨강도 종이가 다르면 다른 빨강이 된다. 화면의 색이 종이 위에 앉는 과정에 대해.",
    tag: "소재",
    emoji: "",
    published: true,
    createdAt: "2021-07-27T06:03:00.000Z",
    updatedAt: "2021-07-27T06:03:00.000Z",
    content: `같은 빨강이라도 종이가 다르면 다른 빨강이 된다. 화면에서 고른 색과 인쇄된 색이 어긋나는 일은, 잘못이라기보다 종이의 성질이다.

## 종이가 색을 먹는다

코팅 안 된 종이(비도공지)는 잉크를 머금는다. 그래서 색이 살짝 가라앉고 부드러워진다. 반대로 코팅된 종이(도공지)는 잉크를 표면에 붙들어 색이 또렷하고 진하게 선다. 같은 데이터로 인쇄해도 종이에 따라 채도와 명도가 달라지는 이유다.

화면은 빛으로 색을 내고(RGB), 인쇄는 잉크로 색을 덮는다(CMYK). 빛의 색을 잉크의 색으로 옮기는 과정에서 일부 선명한 색은 재현 범위를 벗어나기도 한다.

## 그래서 미리 찍어 본다

그 간극을 줄이는 방법은 단순하다. 실제 쓸 종이에 미리 인쇄해 눈으로 보는 것. 색이 중요한 작업에서 색 교정쇄를 고집하는 것도 그래서다. 모니터의 약속보다 종이 위의 사실을 믿는다.

캐릭터의 인상은 형태만큼이나 색에서 온다. 그 색이 앉을 자리를 종이가 정한다는 것을, 일하면서 자주 떠올린다.`,
  },
  {
    id: "seed-paper-structures-in-exhibitions",
    coverImage: "https://images.unsplash.com/photo-1553644446-9f8f2762ea42?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "paper-structures-in-exhibitions",
    title: "전시장에 종이를 세운다는 것 — 가볍고 안전한 조형",
    excerpt:
      "전시장 조형물에서 먼저 따지는 건 무게와 안전이다. 설치·철거·폐기까지 놓고 보면 종이는 생각보다 유능한 재료다.",
    tag: "사례 연구",
    emoji: "",
    published: true,
    createdAt: "2021-05-11T02:16:00.000Z",
    updatedAt: "2021-05-11T02:16:00.000Z",
    content: `전시장에서 큰 조형물을 세울 때, 의외로 가장 먼저 따지는 건 무게와 안전이다. 머리 위로 무언가가 올라가거나 아이들이 드나드는 공간이라면 더 그렇다.

## 무거운 것이 늘 답은 아니다

금속이나 목재 조형물은 튼튼하지만 무겁고, 설치와 철거에 사람과 장비가 든다. 종이·폼보드 구조는 그 반대다. 가벼워서 한두 사람이 세우고, 행사가 끝나면 접거나 분해해 부피를 줄인다.

가볍다고 약한 것도 아니다. 접고 끼워 만든 면은 제 형태로 하중을 나눠 받기 때문에, 생각보다 큰 구조도 스스로 선다. 박물관·전시 일을 하며 이 점을 여러 번 확인했다.

${FigFestival}

## 끝난 뒤가 깔끔하다

전시는 늘 끝이 있다. 그 끝에서 종이는 다루기 쉽다. 부피를 줄여 보관하거나, 종이로 분리배출하면 된다. 다음 전시에 일부를 다시 쓰기도 한다.

화려한 한 철을 위해 오래 남을 폐기물을 만들지 않아도 된다는 것. 전시장에 종이를 세우는 일의 조용한 장점이다.`,
  },
  {
    id: "seed-why-minimum-one-thousand",
    coverImage: "https://images.unsplash.com/photo-1639383448535-0b2474a17cfa?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "why-minimum-one-thousand",
    title: "1,000부부터 받는 이유",
    excerpt:
      "'열 개만 만들 수 있나요?'라는 문의에 매번 마음이 무거워요. 소량 제작 단가가 왜 가파른지, 셈을 그대로 보여 드릴게요.",
    tag: "이야기",
    emoji: "",
    published: true,
    createdAt: "2021-03-23T05:47:00.000Z",
    updatedAt: "2021-03-23T05:47:00.000Z",
    content: `"열 개만 만들 수 있나요?"라는 문의를 종종 받아요. 마음 같아서는 해 드리고 싶은데, 대개는 어렵다고 답하게 됩니다. 죄송한 마음에 그 이유를 셈으로 한번 풀어 볼게요.

## 첫 한 장이 가장 비쌉니다

움직이는 종이 한 종을 만들려면 그 전에 도면을 그리고, 칼선을 앉히고, 도무송 틀을 만들고, 색을 맞춰야 해요. 이 준비 비용은 한 장을 찍든 천 장을 찍든 거의 같습니다. 저희 산식으로는 설계비만 해도 구조에 따라 종당 100만~300만 원대이고, 생산 준비까지 더하면 첫 1,000부에 400만 원 안팎이 들어요.

그래서 수량이 적으면 개당 단가가 가파르게 올라갑니다. 열 개를 만들면 그 준비 비용을 열 개가 다 짊어져야 하니, 한 개 값이 감당하기 어려워져요. 천 부쯤 되면 비용이 여러 장에 나뉘어 개당 가격이 비로소 합리적인 자리로 내려옵니다. 이후로는 1,000부 블록이 늘 때마다 블록당 부담이 200만 원대로 떨어져서, 수량이 많을수록 개당 단가는 계속 내려가요. '1,000부부터'라는 기준은 인심이 아니라 셈의 결과입니다.

${FigCostCompare}

## 적게, 잘 만드는 방법은 따로 있어요

물론 소량이 꼭 필요할 때도 있죠. 그럴 땐 도무송 대신 칼로 자르고, 공정을 단순하게 바꿉니다. 수량과 방식을 같이 설계하면 길이 생겨요.

견적은 '얼마예요'가 아니라 '몇 개를, 어떻게'에서 시작합니다. 그 질문을 먼저 나누는 편이 서로에게 정직해요.`,
  },
  {
    id: "seed-paper-lettering-that-stands",
    coverImage: "https://images.unsplash.com/photo-1597418895783-f7de85be2839?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    slug: "paper-lettering-that-stands",
    title: "오리고 접어 세우는 글자",
    excerpt:
      "글자도 오리고 접으면 그림자를 가진 입체가 된다. 읽히던 이름이 만져지는 물건이 되는 순간.",
    tag: "디자인",
    emoji: "",
    published: true,
    createdAt: "2021-01-12T01:24:00.000Z",
    updatedAt: "2021-01-12T01:24:00.000Z",
    content: `글자도 세울 수 있다. 평평한 활자를 오리고 접으면, 글자가 그림자를 가진 입체가 된다.

## 읽히면서 만져지는 글자

화면 속 타이포그래피는 아무리 멋져도 평면이다. 종이로 옮긴 글자는 다르다. 빛을 받는 면과 그늘이 지는 면이 생기고, 보는 각도에 따라 인상이 달라진다. 전시 타이틀, 행사 포토존, 브랜드 로고를 입체로 세울 때 종이 레터링이 쓰인다.

까다로운 건 획의 두께와 접는 선이다. 가는 획은 세우면 휘청이고, 굵은 획은 접는 자리에서 갈라진다. 글자의 인상을 지키면서 스스로 서게 하려면, 지기구조 설계의 원리를 글자에도 똑같이 적용해야 한다.

## 글자가 물건이 될 때

입체가 된 글자는 더 이상 배경이 아니라 물건이 된다. 사람들은 그 앞에서 사진을 찍고, 손으로 만져 본다. 평면이던 이름이 자리를 차지하는 순간이다.

종이로 글자를 세우는 일은 '읽는 것'을 '가지는 것'으로 바꾸는 작업이다. 우리가 캐릭터에서 해 온 일을, 글자에서 다시 하는 셈이다.`,
  },

  /* ─────────────── 글 33: 학생용 도면 도구 ─────────────── */
  {
    id: "seed-papercraft-studio-for-students",
    slug: "papercraft-tool-for-middle-schoolers",
    title: "아이가 포기하는 순간을 줄여 주는 도구",
    excerpt:
      "좋은 학습 도구는 기능이 많은 도구가 아니라, 아이가 포기하는 순간을 줄여 주는 도구다. 중학생이 쓰는 종이 도면 프로그램을 손보며 다시 배운 것.",
    tag: "교육",
    emoji: "",
    coverImage:
      "https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=1200&h=630&fit=crop&crop=entropy&auto=format&q=80",
    published: true,
    createdAt: "2026-05-19T01:27:00.000Z",
    updatedAt: "2026-05-19T01:27:00.000Z",
    content: `종이로 무언가를 만드는 수업에서 아이가 가장 자주 멈추는 자리는 의외로 '시작'과 '끝'이다. 무엇을 만들지 고르는 데서 한 번, 다 만든 도면이 막상 붙지 않을 때 또 한 번.

오래 종이 도면을 다루면서 알게 된 것이 하나 있다. 좋은 도구는 기능이 많은 도구가 아니라, 쓰는 사람이 포기하는 순간을 줄여 주는 도구라는 것. 그래서 중학생이 쓰는 도면 프로그램을 손볼 때, 우리는 화면에 무엇을 더할지보다 아이가 어디서 멈추는지를 먼저 봤다.

## 찾기 — 원하는 것에 닿는 길

아이에게 "무엇을 만들고 싶니"라고 물으면 대답은 대개 한 단어다. 강아지, 자동차, 공룡. 그런데 그 한 단어에 닿기까지 카테고리를 고르고 목록을 넘기는 길이 길면, 아이는 닿기도 전에 흥미를 잃는다.

그래서 검색을 가장 앞에 두었다. 떠오른 단어를 그대로 적으면 그 자리에서 후보가 나온다. 도구가 먼저 분류를 강요하지 않고, 아이의 말에서 시작하게 하는 일이다.

${FigClassroom}

## 도면화 — 어렵지 않게 시작하기

다음 벽은 '어느 단추를 눌러야 하는지 모르겠다'는 막막함이다. 처음 켠 화면이 비어 있으면 아이는 무엇을 해야 할지 묻는다. 그 물음이 나오기 전에 화면이 먼저 말해 주는 편이 낫다. 고르고, 난이도를 정하고, 만들기. 세 걸음으로.

난이도도 숫자가 아니라 표정으로 바꿨다. 쉬움과 보통과 어려움. 처음이라면 어디서 시작하면 좋은지를 도구가 슬쩍 권한다. 어딘가에서 막혔을 때 영어로 된 오류 대신 '무엇이 어긋났고 다음에 무엇을 하면 되는지'를 한 줄로 알려 주는 것도 같은 마음에서다. 막힘이 곧 포기가 되지 않도록.

## 끝 — 만들 수 있다는 약속

가장 공들인 곳은 끝이다. 종이 한 장에 번호만 있고 정작 풀칠해 붙일 자리가 없으면, 아이는 가위질을 다 끝낸 뒤에야 그 사실을 안다. 그 좌절은 다음 수업을 통째로 망친다.

그래서 도면을 만들 때마다 도구가 스스로 점검하게 했다. 모든 이음새에 붙일 날개가 있으면 '이대로 만들 수 있어요'라고 말하고, 너무 작아 빠진 날개가 있으면 어떻게 하면 되는지를 미리 일러 준다. 큰 부품이 종이에 맞춰 여러 조각으로 나뉘었다면, 같은 이름끼리 이어 붙이면 된다고 짚어 준다. 인쇄 버튼을 누르기 전에, 이 도면이 실제로 완성될 수 있는지를 먼저 약속하는 셈이다.

## 도구가 잘했다는 것

도구가 제 역할을 했다는 신호는 아이가 그것을 의식하지 않을 때다. 검색을 검색이라 느끼지 않고, 난이도를 고민이라 느끼지 않고, 다 만든 종이가 당연히 붙을 거라 믿을 때.

화려한 기능을 더 얹는 일은 언제든 할 수 있다. 그보다 먼저 한 일은, 아이가 멈추던 자리마다 작은 손잡이를 하나씩 놓아 둔 것이다. 손으로 무언가를 끝까지 만들어 본 경험은, 그 자체로 오래 남는다.`,
  },
];
