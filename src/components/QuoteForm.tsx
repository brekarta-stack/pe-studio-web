"use client";

/**
 * 제작 문의 폼 — 3단계 (제품 선택 → 디자인·제작 옵션 → 연락처)
 *
 * UX 원칙:
 * - 필수 입력은 연락처(이름·이메일·전화)뿐. 나머지는 아는 만큼만 입력해도 진행 가능.
 *   (비워둔 항목은 서버에서 기본값 처리 — product 는 제출 시 'unsure' 로 매핑)
 * - '담당자와 상의' 는 우측에 항상 떠 있는 플로팅 버튼 — 어느 단계·스크롤에서든 연락처로 직행.
 * - /products 에서 넘어올 때 URL 파라미터로 컨텍스트 전달받아 중복 입력 제거:
 *     ?product=papercraft|action|popup|foamboard|education|promotion|hobby → 제품 프리필 + Step 2 시작
 *     ?ptype=blueprint|production → 주문 형태를 메모에 자동 기록
 *     ?consult=finished(완제품)|1 → 연락처 단계로 직행 (완제품은 메모 자동 기록)
 *   (/quote 는 정적 페이지라 useSearchParams 대신 window.location 사용 — Suspense 멈춤 회피)
 */

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  ORDER_TYPES,
  ORDER_TYPE_SPECS,
  QUANTITY_STEP,
  estimateLeadWeeks,
  estimateQuote,
  formatFrom,
  formatKrw,
  formatWeeks,
  isOrderType,
  type DesignLine,
  type OrderType,
  type QuoteEstimate,
} from "@/lib/quote-pricing";
import { prepareImageForUpload } from "@/lib/image-resize";
import {
  PaperToyIcon,
  GearIcon,
  BoxIcon,
  PencilIcon,
  SparkleIcon,
  EducationIcon,
  CheckIcon,
  ArrowRightIcon,
  type IconKey,
} from "@/components/icons";
import { PaperNetBg } from "@/components/paper-art";
import { getStoredAcquisition } from "@/lib/acquisition-client";
import type { QuoteFile } from "@/lib/quote-types";

/** 최대 첨부파일 개수 */
const MAX_FILES = 5;

type ProductType =
  | "papercraft"
  | "action"
  | "popup"
  | "foamboard"
  | "unsure"
  | "education"
  | "promotion"
  | "hobby"
  | "";

type StyleType = "osegi" | "cheolho" | "jaeho" | "recommend" | "";
type PackagingType = "paper-box" | "opp" | "bulk" | "";

interface FormState {
  product: ProductType;
  quantity: string;
  deliveryDate: string;
  purpose: string;
  /** 선호 작가 — 오세기 / 김철호 / 문재호 / 추천받기 */
  styleType: StyleType;
  /** 주문 형태 — 도면만 / 제품 생산 / 완제품. 견적 구조를 통째로 정한다 */
  orderType: OrderType;
  /** 제작 희망 디자인 목록 — 종류·총수량·개략 견적의 근거 */
  designs: DesignLine[];
  /** 제품에 삽입할 문구 (회사명·슬로건 등) */
  productText: string;
  colorRequest: string;
  notes: string;
  name: string;
  email: string;
  phone: string;
  /** 참고 자료 첨부파일 (최대 5개) — 업로드 성공한 것만 담긴다 */
  files: QuoteFile[];
  /** 회사 로고 파일명 (선택) */
  logoFileName: string;
  /** 회사 로고 파일 공개 URL (선택) */
  logoFileUrl: string;
  /** 샘플링 희망 — B2B 기업 주문 시 권장 */
  sampling: boolean;
  /** 샘플링을 보고 디자인 개선 희망 */
  samplingImprove: boolean;
  /** 생산 시 감리 진행 희망 */
  supervision: boolean;
  /** 별도 가공·고급 소재 사용 희망 */
  premiumFinish: boolean;
  /** 제품 이용 연령 — 복수 선택 */
  ageGroups: string[];
  /** 만드는 방식 — 목공풀 / 끼워 만들기 / PE 스튜디오 추천 */
  assemblyMethod: string;
  /** 디자인 설계 스타일 — 폴리곤 / 파츠 결합 / PE STUDIO 권장 */
  designStyle: string;
  /** 최대한 빠르게 제작 — 납품 희망일 선택 해제 */
  rushed: boolean;
  /** 포장 방식 — 종이 박스 / OPP 필름 / 벌크 납품 */
  packaging: PackagingType;
}

/** /products 페이지(ProductCatalogTabs)와 동일한 대표 이미지 — 시각적 일관성 유지 */
const SUPA_IMG = "https://syrfoqwvsciicfbeemqv.supabase.co/storage/v1/object/public/uploads";

const PRODUCTS: { id: ProductType; icon: IconKey; name: string; desc: string; image?: string }[] = [
  { id: "papercraft", icon: "paperToy", name: "페이퍼 크래프트",    desc: "기본적인 종이 모형에서 정교한 설계까지", image: `${SUPA_IMG}/1780305681024.png` },
  { id: "action",     icon: "gear",     name: "액션 페이퍼 토이",   desc: "특허 기반 움직임 메커니즘 적용",          image: `${SUPA_IMG}/action%20craft.png` },
  { id: "popup",      icon: "sparkle",  name: "팝업북",              desc: "3D 팝업 카드 및 북 제작",                 image: `${SUPA_IMG}/23213213.jpeg` },
  { id: "foamboard",  icon: "box",      name: "폼보드(우드락)",     desc: "끼워 만드는 입체 구조",                   image: `${SUPA_IMG}/444444.png` },
];

const USAGES: { id: ProductType; icon: IconKey; name: string; desc: string; image?: string }[] = [
  { id: "education", icon: "education", name: "교육/교구용", desc: "체험존·교구·STEAM 학습 도구",     image: `${SUPA_IMG}/5555555.png` },
  { id: "promotion", icon: "sparkle",   name: "홍보용",      desc: "브랜드 굿즈·캠페인·전시 부스",     image: `${SUPA_IMG}/66666.png` },
  { id: "hobby",     icon: "pencil",    name: "취미용",      desc: "가족·동호회·개인 만들기 키트",     image: `${SUPA_IMG}/7777777777.jpg` },
];

/** 사용 목적 — 실제로 들어오는 문의 유형에 맞춰 3가지로 (한 줄에 들어간다) */
const PURPOSES = ["행사/배포", "전시/판매", "체험교실 운영"];

/** 제품 이용 연령 — 복수 선택. 저장값 = 라벨 그대로 (purpose 와 같은 방식) */
const AGE_GROUPS = [
  "6세~7세 (유치원생)",
  "8~10세 (초등학교 저학년)",
  "11세 이상 (초등학교 고학년 및 중·고등학생)",
  "성인, 전문가용",
];

/** 만드는 방식 — 저장값 = 라벨 그대로 */
const ASSEMBLY_OPTIONS: { value: string; desc: string }[] = [
  { value: "목공풀 사용", desc: "더 튼튼하게 조립되며, 액션 페이퍼 토이는 목공풀만 가능" },
  { value: "끼워 만들기", desc: "풀이 필요 없으며, 우드락 및 단순한 디자인에 적용 가능" },
  { value: "PE 스튜디오 추천대로 작업", desc: "" },
];

/** 디자인 설계 스타일 — 저장값 = 라벨 그대로 */
const DESIGN_STYLES = ["폴리곤 방식", "파츠 결합 방식", "PE STUDIO의 권장 방식"];

const STEP_LABELS = ["제품 선택", "디자인·제작 옵션", "연락처"];
const TOTAL_STEPS = STEP_LABELS.length;

const INITIAL_FORM: FormState = {
  product: "",
  quantity: "",
  deliveryDate: "",
  purpose: "",
  styleType: "",
  productText: "",
  colorRequest: "",
  notes: "",
  name: "",
  email: "",
  phone: "",
  files: [],
  // 기본은 제품 생산 — 문의의 대부분이 여기에 해당한다
  orderType: "production",
  /* 첫 줄은 폼을 열 때 채운다(초안 복원 effect). 모듈 상수라 여기서 id 를
     만들면 매번 같은 값이 되어 초안과 충돌한다. */
  designs: [],
  logoFileName: "",
  logoFileUrl: "",
  sampling: false,
  samplingImprove: false,
  supervision: false,
  premiumFinish: false,
  ageGroups: [],
  assemblyMethod: "",
  designStyle: "",
  rushed: false,
  packaging: "",
};

/** 선호 작가 — 값은 quote-labels.ts 의 STYLE_LABELS 와 일치해야 한다 */
const STYLE_OPTIONS: { value: StyleType; label: string; desc: string }[] = [
  { value: "osegi",     label: "오세기",   desc: "액션 페이퍼 토이 · 움직이는 기믹 구조 설계" },
  { value: "cheolho",   label: "김철호",   desc: "페이퍼크래프트 설계 · 정교한 전개도와 리얼리즘" },
  { value: "jaeho",     label: "문재호",   desc: "미니어처 전문 · 작은 스케일의 정밀 디테일" },
  { value: "recommend", label: "추천받기", desc: "의뢰 내용에 맞는 작가를 PE Studio가 배정합니다" },
];

const PACKAGING_OPTIONS: { value: PackagingType; label: string; desc: string }[] = [
  { value: "paper-box", label: "종이 박스", desc: "제품을 종이 박스로 패키징합니다. 고급 제품에 적합합니다." },
  { value: "opp",       label: "OPP 필름",  desc: "제품을 비닐 필름에 넣어 포장합니다. 일반 제품에 적합합니다." },
  { value: "bulk",      label: "벌크 납품", desc: "포장비를 아껴 저렴하게 제작합니다. 교육 행사 진행에 적합합니다." },
];

const STORAGE_KEY = "pe-quote-form-draft";
/**
 * 초안 스키마 버전.
 *   v2 — 3단계 구조
 *   v3 — 선호 작가·사용 목적 선택지 교체 + 디자인 라인 도입.
 *        v2 초안의 styleType/purpose 는 지금 선택지에 없는 값이라 그대로 복원하면
 *        아무것도 선택되지 않은 것처럼 보인다 → 구버전 초안은 이어쓰기 대상에서 뺀다.
 */
const DRAFT_VERSION = 3;

const VALID_PRODUCTS: ProductType[] = [
  "papercraft", "action", "popup", "foamboard", "unsure", "education", "promotion", "hobby",
];

/** 아이콘 색상 — 카드 활성/비활성 통일 */
function ProductIconRender({ name }: { name: IconKey }) {
  switch (name) {
    case "paperToy":  return <PaperToyIcon size={28} />;
    case "gear":      return <GearIcon size={28} />;
    case "sparkle":   return <SparkleIcon size={28} />;
    case "box":       return <BoxIcon size={28} />;
    case "pencil":    return <PencilIcon size={28} />;
    case "education": return <EducationIcon size={28} />;
    default:          return <PaperToyIcon size={28} />;
  }
}

/** 어떤 모드의 선택지인지 판별 */
const USAGE_IDS: ProductType[] = ["education", "promotion", "hobby"];
function isUsageId(id: ProductType): boolean {
  return USAGE_IDS.includes(id);
}

/** 초안에 무엇이 들어 있는지 한 줄 요약 — 이어쓸지 판단할 근거를 준다 */
function draftSummary(f: FormState): string {
  const parts: string[] = [];
  const product = [...PRODUCTS, ...USAGES].find((x) => x.id === f.product);
  if (product) parts.push(product.name);
  if (f.designs.length > 0) parts.push(`디자인 ${f.designs.length}종`);
  if (f.purpose) parts.push(f.purpose);
  if (f.files.length > 0) parts.push(`첨부 ${f.files.length}개`);
  if (f.name) parts.push(f.name);
  return parts.length > 0 ? parts.join(" · ") : "작성 중이던 내용";
}

/**
 * 예상 견적 패널 — 데스크톱에서는 우측에 스티키로 붙고, 모바일에서는 하단에 고정된다.
 *
 * 폼이 길어 아래로 내려가면 금액이 시야에서 사라진다. 라인을 추가할 때마다
 * 범위가 어떻게 변하는지 보이는 게 이 화면의 핵심이라 항상 붙어 있게 했다.
 */
function EstimatePanel({
  estimate,
  packagingLabel,
  compact = false,
  onConsult,
}: {
  estimate: QuoteEstimate;
  packagingLabel: string;
  compact?: boolean;
  /** '담당자와 상의' — 연락처 단계로 직행. 견적 아래에 버튼으로 노출 */
  onConsult?: () => void;
}) {
  const spec = ORDER_TYPE_SPECS[estimate.orderType];

  const consultButton = onConsult && (
    <button
      type="button"
      onClick={onConsult}
      className="mt-4 w-full rounded-xl py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90"
      style={{ background: "#1E22B2" }}
      title="입력을 건너뛰고 연락처만 남기기 — 담당자가 직접 상담해 드립니다"
    >
      💬 담당자와 상의
    </button>
  );

  // 라인이 없으면 금액 대신 안내 — "0원 ~ 0원" 은 무료로 읽힌다
  if (estimate.designCount === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-5 text-center">
        <p className="text-sm font-semibold text-slate-700">예상 견적</p>
        <p className="mt-1 text-xs text-slate-500" style={{ wordBreak: "keep-all" }}>
          제작 희망 디자인을 추가하면 대략적인 금액을 보여드립니다.
        </p>
        {consultButton}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-bold text-slate-900">예상 견적</span>
        <span className="text-xs text-slate-500 tabular-nums">
          {spec.label} · {estimate.designCount}종
          {spec.hasQuantity && ` · ${estimate.totalQuantity.toLocaleString("ko-KR")}부`}
        </span>
      </div>

      <p className="mt-1.5 text-2xl font-bold tracking-tight" style={{ color: "#1E22B2" }}>
        {formatFrom(estimate.totalMin)}
      </p>

      {!compact && (
        <>
          <dl className="mt-3 space-y-1 text-xs text-slate-600">
            <div className="flex justify-between gap-2">
              <dt>{estimate.costLabel} · {estimate.designCount}종</dt>
              <dd className="tabular-nums whitespace-nowrap">
                {formatFrom(estimate.designMin)}
              </dd>
            </div>
            {spec.hasProduction && estimate.productionMin > 0 && (
              <div className="flex justify-between gap-2">
                <dt>생산비 · {estimate.designCount}종</dt>
                <dd className="tabular-nums whitespace-nowrap">
                  {formatKrw(estimate.productionMin)}
                </dd>
              </div>
            )}
            {spec.hasPackaging && estimate.packagingCost > 0 && (
              <div className="flex justify-between gap-2">
                <dt>
                  포장비 · {packagingLabel}
                  <span className="text-slate-400">
                    {" "}(개당 {estimate.packagingUnitCost.toLocaleString("ko-KR")}원)
                  </span>
                </dt>
                <dd className="tabular-nums whitespace-nowrap">
                  {formatKrw(estimate.packagingCost)}
                </dd>
              </div>
            )}
            {estimate.samplingCost > 0 && (
              <div className="flex justify-between gap-2">
                <dt>샘플링</dt>
                <dd className="tabular-nums whitespace-nowrap">{formatKrw(estimate.samplingCost)}</dd>
              </div>
            )}
            {estimate.samplingImproveCost > 0 && (
              <div className="flex justify-between gap-2">
                <dt>디자인 개선</dt>
                <dd className="tabular-nums whitespace-nowrap">{formatKrw(estimate.samplingImproveCost)}</dd>
              </div>
            )}
            {estimate.supervisionCost > 0 && (
              <div className="flex justify-between gap-2">
                <dt>생산 감리</dt>
                <dd className="tabular-nums whitespace-nowrap">{formatKrw(estimate.supervisionCost)}</dd>
              </div>
            )}
          </dl>

          {estimate.quantityMissing && (
            <p className="mt-2 text-xs text-amber-700">
              수량을 입력하면 포장비까지 포함한 금액을 보여드립니다.
            </p>
          )}

          <p className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-500" style={{ wordBreak: "keep-all" }}>
            본 견적은 임의로 산정된 금액으로, 정확한 견적은 상담을 통해 안내 가능합니다.
          </p>
        </>
      )}
      {consultButton}
    </div>
  );
}

/** 제작 희망 디자인은 최대 20종까지 */
const MAX_DESIGNS = 20;

/** 디자인 라인 식별자 — crypto.randomUUID 가 없는 브라우저도 있어 폴백을 둔다 */
function newLineId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* noop */
  }
  return "d-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

/**
 * 초안에 "이어서 쓸 만한 내용"이 있는가.
 *
 * 폼을 열기만 해도 초안은 저장된다(자동 저장). 그래서 저장 여부가 아니라
 * 실제로 뭔가 채워졌는지를 봐야 한다 — 안 그러면 아무것도 안 쓰고 나갔다
 * 다시 들어와도 "이어서 작성하시겠습니까?"가 뜬다.
 * 제품 선택만 있는 경우도 제외한다 (링크로 프리필된 것일 수 있다).
 */
function hasDraftContent(f: FormState): boolean {
  const filled = [
    f.quantity, f.deliveryDate, f.purpose, f.styleType, f.productText,
    f.colorRequest, f.notes, f.name, f.email, f.phone, f.packaging,
    f.assemblyMethod, f.designStyle,
  ].some((v) => String(v ?? "").trim() !== "");
  /* 디자인 줄은 폼을 열 때 빈 줄 하나가 기본으로 생긴다 —
     그걸 "작성 중이던 내용"으로 세면 매번 이어쓰기를 묻게 된다. */
  const designsFilled = f.designs.some((d) => d.name.trim() !== "" || d.file);
  return (
    filled || f.files.length > 0 || designsFilled || f.sampling ||
    f.samplingImprove || f.supervision || f.premiumFinish ||
    f.ageGroups.length > 0 || !!f.logoFileUrl
  );
}

/** 옵션 서브섹션 헤더 (디자인 / 제작) */
function SubsectionHeader({ color, en, ko }: { color: string; en: string; ko: string }) {
  return (
    <div className="flex items-center gap-2.5 pt-2">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} aria-hidden />
      <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color }}>{en}</span>
      <span className="text-sm font-bold text-slate-900">{ko}</span>
      <span className="flex-1 h-px bg-slate-100" aria-hidden />
    </div>
  );
}

export default function QuoteForm() {
  const [step, setStepRaw] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [hydrated, setHydrated] = useState(false);
  /** 남아 있는 초안 — 값이 있으면 '이어서 작성하시겠습니까?' 를 묻는 중 */
  const [draftPrompt, setDraftPrompt] = useState<{ form: FormState; step: number } | null>(null);
  /** Step 1 선택 모드 — 제품 종류별 / 용도별 토글 */
  const [step1Mode, setStep1Mode] = useState<"product" | "usage">("product");
  /** 첨부파일 업로드 진행/오류 상태 (참고자료 file / 로고 logo) */
  const [uploading, setUploading] = useState({ file: false, logo: false });
  const [uploadErr, setUploadErr] = useState({ file: "", logo: "" });
  /** 연락처 단계 미입력 항목 하이라이트 (제출 시도 후에만) */
  const [contactTouched, setContactTouched] = useState(false);

  /** 스텝 전환 시 폼 상단으로 스크롤하기 위한 앵커 */
  const formTopRef = useRef<HTMLDivElement>(null);
  const prevStepRef = useRef(1);

  /** 스텝 변경 + 폼 상단 스크롤 (긴 옵션 화면에서 다음 단계가 중간에 걸리는 문제 방지) */
  const setStep = (next: number | ((s: number) => number)) => {
    setStepRaw((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      return Math.min(Math.max(value, 1), TOTAL_STEPS);
    });
  };

  useEffect(() => {
    if (!hydrated) {
      prevStepRef.current = step;
      return;
    }
    if (prevStepRef.current !== step) {
      prevStepRef.current = step;
      formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [step, hydrated]);

  /* ── 초안 복원 ──
   *
   * 예전에는 남아 있던 초안을 말없이 복원했다. 그래서 지난번에 쓰다 만 내용이
   * 그대로 떠 있는데 사용자는 이유를 모르고, 새로 쓰려면 일일이 지워야 했다.
   * 이제 초안이 있으면 물어보고, 답을 듣기 전까지는 초안을 덮어쓰지 않는다.
   *
   * URL 파라미터(제품 프리필 등)는 초안보다 우선한다 — 방금 누른 링크가
   * 지난번에 고르던 것보다 명확한 의도다. */
  useEffect(() => {
    if (typeof window === "undefined") return;

    /* URL 로 전달된 컨텍스트를 폼에 얹는다. 초안을 쓰든 새로 시작하든 동일하게 적용 */
    const applyUrlContext = (base: FormState, baseStep: number): { form: FormState; step: number } => {
      let next = base;
      let step = baseStep;
      try {
        const params = new URLSearchParams(window.location.search);

        // 제품 프리필 → 제품 선택 단계 건너뛰고 옵션부터 (중복 입력 제거)
        const productParam = params.get("product") as ProductType | null;
        if (productParam && VALID_PRODUCTS.includes(productParam)) {
          next = { ...next, product: productParam };
          step = Math.max(step, 2);
        }

        // 주문 형태 — /products 에서 넘어온 값을 폼 선택지에 그대로 반영한다
        const ptype = params.get("ptype");
        if (isOrderType(ptype)) next = { ...next, orderType: ptype };

        // 상담 직행 — 완제품 의뢰 등은 연락처 단계로 바로
        const consult = params.get("consult");
        if (consult) {
          if (consult === "finished") next = { ...next, orderType: "finished" };
          if (!next.product) next = { ...next, product: "unsure" };
          step = TOTAL_STEPS;
        }
      } catch {
        // URL 파싱 실패는 무시
      }

      /* 제품이 이미 정해졌으면 제품 선택 단계에 머물 이유가 없다 */
      if (next.product && step === 1) step = 2;
      return { form: next, step: Math.min(Math.max(step, 1), TOTAL_STEPS) };
    };

    /* 저장된 초안 읽기 — 스키마 버전이 다르면 버린다.
       선택지가 바뀐 구버전 초안을 복원하면 아무것도 안 고른 것처럼 보인다. */
    let draft: { form: FormState; step: number } | null = null;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.v === DRAFT_VERSION && parsed.form) {
          let f: FormState = { ...INITIAL_FORM, ...parsed.form };
          // 업로드가 끝나기 전(URL 미확보)에 저장된 파일명은 무효 — 링크 없는 파일 제출 방지
          f = {
            ...f,
            files: Array.isArray(f.files)
              ? f.files.filter((x) => x && typeof x.url === "string" && x.url).slice(0, MAX_FILES)
              : [],
            designs: Array.isArray(f.designs) ? f.designs : [],
            ageGroups: Array.isArray(f.ageGroups)
              ? f.ageGroups.filter((a) => AGE_GROUPS.includes(a))
              : [],
          };
          if (f.logoFileName && !f.logoFileUrl) f = { ...f, logoFileName: "" };
          const st = typeof parsed.step === "number" ? parsed.step : 1;
          draft = { form: f, step: Math.min(Math.max(st, 1), TOTAL_STEPS) };
        } else {
          // 구버전 초안은 조용히 폐기 — 남겨 두면 다음 방문에도 계속 물어본다
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch {
      // ignore parse errors
    }

    /** 디자인 줄이 없으면 빈 줄 하나를 열어 둔다 — 무엇을 적는 곳인지 바로 보이게 */
    const withFirstLine = (f: FormState): FormState =>
      f.designs.length > 0
        ? f
        : {
            ...f,
            designs: [
              {
                id: newLineId(),
                name: "",
                quantity: ORDER_TYPE_SPECS[f.orderType].hasQuantity
                  ? String(ORDER_TYPE_SPECS[f.orderType].defaultQuantity)
                  : "",
                file: null,
              },
            ],
          };

    const freshBase = applyUrlContext(INITIAL_FORM, 1);
    const fresh = { form: withFirstLine(freshBase.form), step: freshBase.step };

    if (draft && hasDraftContent(draft.form)) {
      // 물어보는 동안에는 빈 폼을 보여주되, 초안은 아직 덮어쓰지 않는다
      setForm(fresh.form);
      setStepRaw(fresh.step);
      if (isUsageId(fresh.form.product)) setStep1Mode("usage");
      const restored = applyUrlContext(draft.form, draft.step);
      setDraftPrompt({ form: withFirstLine(restored.form), step: restored.step });
    } else {
      setForm(fresh.form);
      setStepRaw(fresh.step);
      if (isUsageId(fresh.form.product)) setStep1Mode("usage");
    }
    setHydrated(true);
  }, []);

  /** 이어서 작성 — 초안을 그대로 얹는다 */
  const resumeDraft = () => {
    if (!draftPrompt) return;
    setForm(draftPrompt.form);
    setStepRaw(draftPrompt.step);
    if (isUsageId(draftPrompt.form.product)) setStep1Mode("usage");
    setDraftPrompt(null);
  };

  /** 처음부터 — 초안을 버린다 */
  const discardDraft = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* 삭제 실패는 무시 — 아래 자동 저장이 곧 덮어쓴다 */
    }
    setDraftPrompt(null);
  };

  // 변경 시마다 저장 — 단, 이어쓰기 여부를 묻는 동안에는 저장하지 않는다.
  // (물어보는 사이에 빈 폼을 저장해 버리면 되살릴 초안이 사라진다)
  useEffect(() => {
    if (!hydrated || draftPrompt) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: DRAFT_VERSION, form, step }));
    } catch {
      // ignore quota errors
    }
  }, [form, step, hydrated, draftPrompt]);

  const update = (key: keyof FormState, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  /** 제품 이용 연령 — 복수 선택 토글 (표시 순서는 AGE_GROUPS 순서를 따른다) */
  const toggleAgeGroup = (age: string) => {
    setForm((prev) => ({
      ...prev,
      ageGroups: prev.ageGroups.includes(age)
        ? prev.ageGroups.filter((a) => a !== age)
        : AGE_GROUPS.filter((a) => prev.ageGroups.includes(a) || a === age),
    }));
  };

  /* ── 제작 희망 디자인 라인 ──
     한 줄 = { 이름, 수량, 참고 자료 1개 }. 종류·총수량·개략 견적이 여기서 나온다. */

  const addDesign = () =>
    setForm((prev) =>
      prev.designs.length >= MAX_DESIGNS
        ? prev
        : {
            ...prev,
            designs: [
              ...prev.designs,
              {
                id: newLineId(),
                name: "",
                quantity: ORDER_TYPE_SPECS[prev.orderType].hasQuantity
                  ? String(ORDER_TYPE_SPECS[prev.orderType].defaultQuantity)
                  : "",
                file: null,
              },
            ],
          }
    );

  const removeDesign = (id: string) =>
    setForm((prev) => ({ ...prev, designs: prev.designs.filter((d) => d.id !== id) }));

  const patchDesign = (id: string, patch: Partial<DesignLine>) =>
    setForm((prev) => ({
      ...prev,
      designs: prev.designs.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    }));

  /** 라인별 참고 자료 업로드 — 업로드 중인 라인 id 를 들고 있어야 그 줄에만 표시된다 */
  const [designUploading, setDesignUploading] = useState<string | null>(null);

  const handleDesignFilePick = async (id: string, e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    setDesignUploading(id);
    setUploadErr((prev) => ({ ...prev, file: "" }));
    try {
      const uploaded = await uploadOne(picked);
      patchDesign(id, { file: uploaded });
    } catch (err) {
      setUploadErr((prev) => ({
        ...prev,
        file: err instanceof Error ? err.message : "업로드에 실패했습니다.",
      }));
    } finally {
      setDesignUploading(null);
    }
  };

  /** 개략 견적 — 라인·포장·제작 옵션이 바뀔 때만 다시 계산 */
  const estimate = useMemo(
    () =>
      estimateQuote(form.orderType, form.designs, form.packaging, {
        sampling: form.sampling,
        samplingImprove: form.samplingImprove,
        supervision: form.supervision,
      }),
    [form.orderType, form.designs, form.packaging, form.sampling, form.samplingImprove, form.supervision]
  );

  /** 현재 주문 형태의 사양 — 수량을 받는지, 포장이 의미 있는지 */
  const orderSpec = ORDER_TYPE_SPECS[form.orderType];

  /**
   * 주문 형태 변경. 직접 적어 둔 수량은 살리고, 기본값 그대로인 줄만 갈아끼운다 —
   * 생산(1,000부)에서 완제품(1개)으로 바꿨는데 1,000부가 남으면 견적이 엉뚱해진다.
   */
  const changeOrderType = (next: OrderType) => {
    setForm((prev) => {
      if (prev.orderType === next) return prev;
      const prevDefault = String(ORDER_TYPE_SPECS[prev.orderType].defaultQuantity);
      const nextSpec = ORDER_TYPE_SPECS[next];
      const nextDefault = nextSpec.hasQuantity ? String(nextSpec.defaultQuantity) : "";
      return {
        ...prev,
        orderType: next,
        designs: prev.designs.map((d) =>
          d.quantity === prevDefault || d.quantity === "" ? { ...d, quantity: nextDefault } : d
        ),
        // 도면만 의뢰는 포장 개념이 없다 — 남겨 두면 견적에 유령처럼 남는다
        packaging: nextSpec.hasPackaging ? prev.packaging : "",
      };
    });
  };

  /** 단일 파일 업로드 → 공개 URL 반환 (실패 시 throw) */
  const uploadOne = async (f: File): Promise<QuoteFile> => {
    const prepared = await prepareImageForUpload(f);
    const fd = new FormData();
    fd.append("file", prepared.file, prepared.file.name);
    const res = await fetch("/api/quote/upload", { method: "POST", body: fd });
    const json = (await res.json().catch(() => ({}))) as { url?: string; name?: string; error?: string };
    if (!res.ok || !json.url) throw new Error(json.error || "업로드에 실패했습니다.");
    return { name: json.name || f.name, url: json.url };
  };


  /** 회사 로고 — 단일 파일 업로드 */
  const handleLogoPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setUploadErr((s) => ({ ...s, logo: "" }));
    setForm((prev) => ({ ...prev, logoFileName: f.name, logoFileUrl: "" }));
    setUploading((s) => ({ ...s, logo: true }));
    try {
      const uploaded = await uploadOne(f);
      setForm((prev) => ({ ...prev, logoFileName: uploaded.name, logoFileUrl: uploaded.url }));
    } catch (err) {
      setUploadErr((s) => ({ ...s, logo: err instanceof Error ? err.message : "업로드에 실패했습니다." }));
      setForm((prev) => ({ ...prev, logoFileName: "", logoFileUrl: "" }));
    } finally {
      setUploading((s) => ({ ...s, logo: false }));
    }
  };

  /** 연락처 유효성 — 유일한 필수 게이트 (이메일은 형식까지 — 서버 400 을 미리 차단) */
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const contactValid = form.name.trim() !== "" && emailValid && form.phone.trim() !== "";

  /** '담당자와 상의' — 어느 단계에서든 연락처로 직행 (선택해 둔 제품은 보존) */
  const jumpToConsult = () => {
    setForm((prev) => (prev.product ? prev : { ...prev, product: "unsure" }));
    setStep(TOTAL_STEPS);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!contactValid) {
      setContactTouched(true);
      return;
    }
    if (uploading.file || uploading.logo) return; // 업로드 완료 후 제출
    setSaving(true);
    const acquisition = getStoredAcquisition();
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 제품 미선택은 '미정(담당자 상의)' 으로 접수 — 서버 스키마는 빈 값을 받지 않음
        body: JSON.stringify({
          ...form,
          product: form.product || "unsure",
          // 수량은 디자인 라인 합계 — 화면에 보여준 값과 접수 값이 어긋나지 않게
          quantity: estimate.totalQuantity > 0 ? String(estimate.totalQuantity) : form.quantity,
          acquisition,
        }),
      });
      if (!res.ok) throw new Error("제출 실패");
      setSubmitted(true);
      localStorage.removeItem(STORAGE_KEY);
      /* 광고 전환 신호 — 외부 픽셀 없이 1st-party 로 '견적 제출 완료' 전환을 /admin/analytics 에 기록 */
      try {
        const beacon = JSON.stringify({
          type: "click",
          path: "/quote",
          label: "견적 제출 완료",
          referrer: acquisition?.referrer ?? "",
          utmSource: acquisition?.utmSource ?? "",
          utmMedium: acquisition?.utmMedium ?? "",
          utmCampaign: acquisition?.utmCampaign ?? "",
          gclid: acquisition?.gclid ?? "",
          adHint: acquisition?.adHint ?? "",
        });
        navigator.sendBeacon?.("/api/track", new Blob([beacon], { type: "application/json" }));
      } catch {
        /* 전환 신호 실패는 무시 */
      }
    } catch {
      alert("제출 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setSubmitted(false);
    setStep(1);
    setForm(INITIAL_FORM);
    setContactTouched(false);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  };

  const selectedProduct =
    PRODUCTS.find((p) => p.id === form.product) ?? USAGES.find((u) => u.id === form.product);
  const productDisplayName =
    form.product === "unsure" || form.product === ""
      ? "미정 — 담당자와 상의"
      : selectedProduct?.name ?? "미정";

  /* ────────── 제출 완료 화면 ────────── */
  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-12">
        <div className="max-w-md w-full bg-white rounded-3xl pe-paper-shadow-lg p-10 text-center border border-slate-100">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 text-white pe-paper-shadow"
            style={{ background: "linear-gradient(135deg, #06C6C8, #E91E8C)" }}
            aria-hidden
          >
            <CheckIcon size={32} strokeWidth={2.5} />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-3 tracking-tight">
            제작 문의가 접수됐습니다
          </h2>
          <p className="text-slate-500 mb-8" style={{ wordBreak: "keep-all" }}>
            담당자가 <strong className="text-slate-900">3영업일 이내</strong>에 회신 드립니다.
            접수 확인 메일을 입력하신 이메일로 보내드렸습니다.
            <br />
            추가 문의는 <strong className="text-slate-900">ask@papercraft.kr</strong> 로 보내주세요.
          </p>
          <div className="bg-slate-50 rounded-xl p-4 text-left mb-6 space-y-2.5 text-sm border border-slate-100">
            <div className="flex justify-between">
              <span className="text-slate-500">제품</span>
              <span className="text-slate-900 font-medium">{productDisplayName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">수량</span>
              <span className="text-slate-900 font-medium pe-num">
                {estimate.totalQuantity > 0
                  ? `${estimate.totalQuantity.toLocaleString("ko-KR")}부`
                  : "상담 후 결정"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">납기 희망일</span>
              <span className="text-slate-900 font-medium">
                {form.rushed ? "최대한 빠르게" : form.deliveryDate || "상담 후 결정"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">담당자</span>
              <span className="text-slate-900 font-medium">{form.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">이메일</span>
              <span className="text-slate-900 font-medium text-xs">{form.email}</span>
            </div>
          </div>
          <button
            onClick={resetForm}
            className="w-full py-3 font-semibold rounded-xl text-white transition-opacity hover:opacity-90"
            style={{ background: "linear-gradient(135deg, #06C6C8, #E91E8C)" }}
          >
            새 제작 문의하기
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ── Hero (파란색) — /portfolio · /blog 와 동일 톤 ── */}
      <section className="relative py-20 md:py-28 overflow-hidden" style={{ background: "#1E22B2" }}>
        <div className="absolute inset-0 pointer-events-none opacity-25">
          <div className="absolute -right-32 top-1/4 w-[70%] max-w-3xl rotate-6">
            <PaperNetBg className="w-full h-auto" />
          </div>
        </div>
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full mb-6 bg-white/10 text-white border border-white/15">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            1분이면 충분합니다
          </span>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-6 tracking-tight leading-[1.1]">
            <span className="pe-gradient-text">제작 문의</span>
          </h1>
          <p className="text-blue-200 text-lg max-w-2xl mx-auto" style={{ wordBreak: "keep-all" }}>
            아는 만큼만 입력하셔도 됩니다.
            연락처만 남기시면 3영업일 이내 맞춤 견적을 보내드립니다.
          </p>
        </div>
      </section>

      {/* ── 본문 (회색 배경) ── */}
      <div className="bg-slate-50 py-16 md:py-20 px-4">
        {/* 견적 레일은 카드 **바깥** 오른쪽에 둔다. 카드 안에 넣으면 폼이 좁아져
            기존 레이아웃이 무너진다. 레일을 놓을 자리가 없는 화면에서는
            2열을 포기하고(단일 컬럼) 하단 고정 바로 대신한다. */}
        <div
          className={
            step === 2
              ? "mx-auto max-w-3xl xl:max-w-[70rem] xl:grid xl:grid-cols-[minmax(0,48rem)_18rem] xl:gap-8 xl:items-start"
              : "max-w-3xl mx-auto"
          }
        >
        <div className="min-w-0">
          {/* 스텝 전환 스크롤 앵커 */}
          <div ref={formTopRef} className="scroll-mt-24" aria-hidden />

          {/* Progress Bar */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-2 text-xs">
            <span className="font-semibold text-slate-700">
              <span className="pe-num">{step}</span> / <span className="pe-num">{TOTAL_STEPS}</span>단계 ·{" "}
              <span style={{ color: "#1E22B2" }}>{STEP_LABELS[step - 1]}</span>
            </span>
            <span className="text-slate-400 pe-num">{Math.round((step / TOTAL_STEPS) * 100)}%</span>
          </div>
          <div className="h-2 bg-slate-200 rounded-full overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((step / TOTAL_STEPS) * 100)}>
            <div
              className="h-full transition-all duration-500 ease-out"
              style={{
                width: `${Math.round((step / TOTAL_STEPS) * 100)}%`,
                background: "linear-gradient(90deg, #06C6C8, #F5C518, #E91E8C)",
              }}
            />
          </div>
          {/* Step dots — 필수 게이트가 없으므로 어느 단계로든 이동 가능 */}
          <div className="flex justify-between mt-3">
            {STEP_LABELS.map((label, i) => {
              const stepNum = i + 1;
              const isActive = step === stepNum;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => !isActive && setStep(stepNum)}
                  disabled={isActive}
                  className={`text-xs flex-1 text-center transition-colors ${
                    isActive
                      ? "font-bold"
                      : "text-slate-500 hover:text-slate-900 cursor-pointer"
                  }`}
                  style={isActive ? { color: "#1E22B2" } : {}}
                  aria-label={`${label} 단계${isActive ? " (현재)" : ""}`}
                >
                  <span className="hidden sm:inline">{label}</span>
                  <span className="sm:hidden">{stepNum}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-3xl pe-paper-shadow border border-slate-100 p-8 md:p-12">
          <form onSubmit={handleSubmit}>
            {/* ───────── Step 1: 제품 선택 ───────── */}
            {step === 1 && (
              <div>
                <div className="mb-4">
                  <h2 className="text-xl font-bold text-slate-900 mb-1 tracking-tight">
                    어떤 제품을 원하시나요?
                  </h2>
                  <p className="text-slate-500 text-sm" style={{ wordBreak: "keep-all" }}>
                    제품 종류를 알고 계시면 종류별로, 잘 모르시면 용도별로 선택하세요.
                    아직 정하지 못했다면 그냥 다음으로 넘어가셔도 됩니다.
                  </p>
                </div>

                {/* 선택 모드 토글 */}
                <div className="inline-flex p-1 bg-slate-100 rounded-xl mb-5">
                  <button
                    type="button"
                    onClick={() => setStep1Mode("product")}
                    className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-all ${
                      step1Mode === "product"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    제품 종류별
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep1Mode("usage")}
                    className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-all ${
                      step1Mode === "usage"
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    용도별
                  </button>
                </div>

                {step1Mode === "product" ? (
                  /* 2 × 2 제품 종류 — 상단 대표 이미지 (aspect-[2/1] object-cover) */
                  <div className="grid grid-cols-2 gap-5">
                    {PRODUCTS.map((product) => {
                      const isActive = form.product === product.id;
                      return (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => update("product", product.id)}
                          aria-pressed={isActive}
                          className={`group rounded-2xl border-2 overflow-hidden text-center transition-all pe-paper-lift bg-white ${
                            isActive
                              ? "border-[#1E22B2] ring-2 ring-[#1E22B2]/15"
                              : "border-slate-200 hover:border-blue-200"
                          }`}
                        >
                          {/* 상단 이미지 영역 */}
                          <div className="aspect-[2/1] relative overflow-hidden bg-slate-50">
                            {product.image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={product.image}
                                alt={`${product.name} 대표 이미지`}
                                className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                                loading="lazy"
                              />
                            ) : (
                              <div className="absolute inset-0 flex items-center justify-center text-slate-300" aria-hidden>
                                <ProductIconRender name={product.icon} />
                              </div>
                            )}
                          </div>
                          {/* 텍스트 영역 */}
                          <div className={`p-4 ${isActive ? "bg-blue-50" : ""}`}>
                            <div className="font-semibold text-slate-900 text-sm">{product.name}</div>
                            <div className="text-xs text-slate-500 mt-0.5" style={{ wordBreak: "keep-all" }}>
                              {product.desc}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  /* 1 × 3 용도별 — 정사각형 이미지 (object-contain, 흰 배경 보존) */
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                    {USAGES.map((usage) => {
                      const isActive = form.product === usage.id;
                      return (
                        <button
                          key={usage.id}
                          type="button"
                          onClick={() => update("product", usage.id)}
                          aria-pressed={isActive}
                          className={`group rounded-2xl border-2 overflow-hidden text-center transition-all pe-paper-lift bg-white ${
                            isActive
                              ? "border-[#06C6C8] ring-2 ring-[#06C6C8]/15"
                              : "border-slate-200 hover:border-cyan-200"
                          }`}
                        >
                          {/* 상단 정사각형 이미지 영역 — object-contain + 흰 배경 */}
                          <div className="aspect-square relative overflow-hidden bg-white">
                            {usage.image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={usage.image}
                                alt={`${usage.name} 대표 이미지`}
                                className="absolute inset-0 w-full h-full object-contain p-3 transition-transform duration-500 group-hover:scale-[1.04]"
                                loading="lazy"
                              />
                            ) : (
                              <div className="absolute inset-0 flex items-center justify-center text-slate-300" aria-hidden>
                                <ProductIconRender name={usage.icon} />
                              </div>
                            )}
                          </div>
                          {/* 텍스트 영역 */}
                          <div className={`p-4 ${isActive ? "bg-cyan-50" : ""}`}>
                            <div className="font-semibold text-slate-900 text-sm">{usage.name}</div>
                            <div className="text-xs text-slate-500 mt-0.5" style={{ wordBreak: "keep-all" }}>
                              {usage.desc}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* "잘 모르겠어요" 옵션 — 두 모드 공통 */}
                <button
                  type="button"
                  onClick={() => update("product", "unsure")}
                  aria-pressed={form.product === "unsure"}
                  className={`mt-3 w-full p-3 rounded-xl border-2 text-sm font-medium transition-colors ${
                    form.product === "unsure"
                      ? "border-[#1E22B2] bg-blue-50 text-[#1E22B2]"
                      : "border-dashed border-slate-300 text-slate-500 hover:border-slate-400"
                  }`}
                >
                  잘 모르겠어요 — 담당자와 상의하고 싶어요
                </button>
              </div>
            )}

            {/* ───────── Step 2: 디자인·제작 옵션 (통합) ───────── */}
            {step === 2 && (() => {
              /* 평균 납기 = 주문 형태 기본값 + 포장·샘플링·디자인 개선·감리·별도 가공 가산 */
              const leadWeeks = estimateLeadWeeks(form.orderType, form.packaging, {
                sampling: form.sampling,
                samplingImprove: form.samplingImprove,
                supervision: form.supervision,
                premiumFinish: form.premiumFinish,
              });
              // 권장 납품 가능일 = 오늘 + leadWeeks * 7일 (로컬 타임존 기준 — UTC 변환 시 KST 오전에 하루 이르게 표시되는 버그 방지)
              const recommended = new Date();
              recommended.setDate(recommended.getDate() + Math.ceil(leadWeeks * 7));
              const minDateISO = [
                recommended.getFullYear(),
                String(recommended.getMonth() + 1).padStart(2, "0"),
                String(recommended.getDate()).padStart(2, "0"),
              ].join("-");
              return (
                  <div className="space-y-12">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 mb-1 tracking-tight">
                      디자인·제작 옵션을 알려주세요
                    </h2>
                    <p className="text-slate-500 text-sm" style={{ wordBreak: "keep-all" }}>
                      모두 선택 사항입니다. 아는 것만 채우셔도 되고,
                      비워둔 항목은 담당자가 상담으로 함께 정해드립니다.
                    </p>
                    {/* 선택 제품 컨텍스트 칩 — /products 프리필로 Step 1 을 건너뛴 경우의 확인·수정 장치 */}
                    <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-full text-xs">
                      <span className="text-slate-400">선택 제품</span>
                      <strong className="text-slate-800">{productDisplayName}</strong>
                      <button
                        type="button"
                        onClick={() => setStep(1)}
                        className="text-[#1E22B2] font-semibold hover:underline underline-offset-2"
                      >
                        변경
                      </button>
                    </div>
                  </div>


                  <SubsectionHeader color="#0EA5E9" en="Order" ko="주문 형태" />

                  {/* 주문 형태 — 무엇을 받을 것인지. 견적 구성이 여기서 갈린다 */}
                  <div>
                    <p className="text-xs text-slate-500 mb-3" style={{ wordBreak: "keep-all" }}>
                      어떤 형태로 받으실지에 따라 견적 구성과 입력 항목이 달라집니다.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {ORDER_TYPES.map((t) => {
                        const o = ORDER_TYPE_SPECS[t];
                        const isActive = form.orderType === t;
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => changeOrderType(t)}
                            aria-pressed={isActive}
                            className={`p-4 rounded-2xl border-2 text-left transition-all pe-paper-lift ${
                              isActive ? "border-[#1E22B2] bg-blue-50" : "border-slate-200 hover:border-blue-200"
                            }`}
                          >
                            <div className="font-semibold text-slate-900 text-sm mb-1">{o.label}</div>
                            <div className="text-xs text-slate-500" style={{ wordBreak: "keep-all" }}>{o.desc}</div>
                            <div className="mt-2 text-[11px] font-semibold" style={{ color: "#1E22B2" }}>
                              {o.costLabel} {formatKrw(o.costMin)}~ / 종
                              {o.hasProduction && " + 생산비"}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <SubsectionHeader color="#06C6C8" en="Purpose" ko="제품 사용 방식" />

                  {/* 사용 목적 */}
                  <div>
                    <span className="block text-sm font-semibold text-slate-700 mb-1">사용 목적</span>
                    <p className="text-xs text-slate-500 mb-3" style={{ wordBreak: "keep-all" }}>
                      사용 목적에 맞춰 더 나은 제품 생산 방식을 제안드립니다.
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {PURPOSES.map((p) => {
                        const isActive = form.purpose === p;
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => update("purpose", isActive ? "" : p)}
                            aria-pressed={isActive}
                            className={`py-2.5 px-3 text-sm rounded-xl border-2 transition-colors ${
                              isActive
                                ? "border-[#1E22B2] bg-blue-50 text-[#1E22B2] font-semibold"
                                : "border-slate-200 text-slate-600 hover:border-blue-200"
                            }`}
                          >
                            {p}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 제품 이용 연령 — 복수 선택 */}
                  <div>
                    <span className="block text-sm font-semibold text-slate-700 mb-1">
                      제품 이용 연령
                      <span className="ml-2 text-xs font-medium text-slate-400">복수 선택 가능</span>
                    </span>
                    <p className="text-xs text-slate-500 mb-3" style={{ wordBreak: "keep-all" }}>
                      이용 연령에 맞춰 난이도·용지·안전 기준을 조정해 제안드립니다.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {AGE_GROUPS.map((age) => {
                        const isActive = form.ageGroups.includes(age);
                        return (
                          <label
                            key={age}
                            className={`flex items-center gap-2.5 py-2.5 px-3 text-sm rounded-xl border-2 cursor-pointer transition-colors ${
                              isActive
                                ? "border-[#1E22B2] bg-blue-50 text-[#1E22B2] font-semibold"
                                : "border-slate-200 text-slate-600 hover:border-blue-200"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isActive}
                              onChange={() => toggleAgeGroup(age)}
                              className="w-4 h-4 rounded border-slate-300 text-[#1E22B2] focus:ring-2 focus:ring-[#1E22B2]/30"
                            />
                            <span style={{ wordBreak: "keep-all" }}>{age}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* 만드는 방식 — 목공풀 / 끼워 만들기 / PE 스튜디오 추천 */}
                  <div>
                    <span className="block text-sm font-semibold text-slate-700 mb-3">만드는 방식</span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {ASSEMBLY_OPTIONS.map((opt) => {
                        const isActive = form.assemblyMethod === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => update("assemblyMethod", isActive ? "" : opt.value)}
                            aria-pressed={isActive}
                            className={`p-4 rounded-2xl border-2 text-left transition-all pe-paper-lift ${
                              isActive ? "border-[#1E22B2] bg-blue-50" : "border-slate-200 hover:border-blue-200"
                            }`}
                          >
                            <div className="font-semibold text-slate-900 text-sm">{opt.value}</div>
                            {opt.desc && (
                              <div className="text-xs text-slate-500 mt-1" style={{ wordBreak: "keep-all" }}>
                                {opt.desc}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>


                  <SubsectionHeader color="#1E22B2" en="Artist" ko="선호 작가" />

                  {/* 선호 작가 */}
                  <div>
                    <span className="block text-sm font-semibold text-slate-700 mb-1">선호 작가</span>
                    <p className="text-xs text-slate-500 mb-3" style={{ wordBreak: "keep-all" }}>
                      작가에 따라 결과물의 인상이 달라집니다. 잘 모르겠다면 <b>추천받기</b>를 골라 주세요.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {STYLE_OPTIONS.map((opt) => {
                        const isActive = form.styleType === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => update("styleType", isActive ? "" : (opt.value as string))}
                            aria-pressed={isActive}
                            className={`p-4 rounded-2xl border-2 text-left transition-all pe-paper-lift ${
                              isActive ? "border-[#1E22B2] bg-blue-50" : "border-slate-200 hover:border-blue-200"
                            }`}
                          >
                            <div className="font-semibold text-slate-900 text-sm mb-1">{opt.label}</div>
                            <div className="text-xs text-slate-500" style={{ wordBreak: "keep-all" }}>{opt.desc}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <SubsectionHeader color="#E91E8C" en="Production" ko="제작" />

                  {/* B2B 제작 옵션 — 샘플링·디자인 개선·감리·별도 가공 */}
                  <div className="p-4 rounded-2xl border-2 border-slate-200 bg-slate-50/50">
                    {/* 헤드 메시지 — B2B 권장 안내를 박스 상단으로 */}
                    <p className="text-xs font-bold" style={{ color: "#E91E8C" }}>
                      B2B 기업 주문 시 권장
                    </p>
                    <p className="text-xs text-slate-500 mt-1 mb-4" style={{ wordBreak: "keep-all" }}>
                      기업 맞춤형 컨시어지 서비스입니다. 원하시는 최고의 퀄리티를 약속드립니다.
                    </p>
                    {(
                      [
                        {
                          key: "sampling" as const,
                          checked: form.sampling,
                          label: "샘플링을 희망합니다",
                          desc: "생산 전 완제품을 수제작하여 샘플로 보내드립니다.",
                          badge: "+2주",
                        },
                        {
                          key: "samplingImprove" as const,
                          checked: form.samplingImprove,
                          label: "샘플링을 보고 디자인 개선을 희망합니다.",
                          desc: "샘플 제작 후 디자인 변경 및 형태 수정이 가능합니다.",
                          badge: "+2주",
                        },
                        {
                          key: "supervision" as const,
                          checked: form.supervision,
                          label: "생산 시 감리 진행을 희망합니다.",
                          desc: "공장과의 조율 및 감리 작업을 통해 정확한 발색을 맞춰 드립니다.",
                          badge: "+1.5주",
                        },
                        {
                          key: "premiumFinish" as const,
                          checked: form.premiumFinish,
                          label: "별도 가공, 고급화된 소재를 사용하고 싶습니다.",
                          desc: "수입지, 특수지 등의 사용 또는 형압, 에폭시, 레이저 커팅 등 특수 가공이 가능합니다.",
                          badge: "+1주",
                        },
                      ]
                    ).map((opt, i) => (
                      <label key={opt.key} className={`flex items-start gap-3 cursor-pointer ${i > 0 ? "mt-4" : ""}`}>
                        <input
                          type="checkbox"
                          checked={opt.checked}
                          onChange={(e) => update(opt.key, e.target.checked)}
                          className="mt-0.5 w-5 h-5 rounded border-slate-300 text-[#1E22B2] focus:ring-2 focus:ring-[#1E22B2]/30"
                        />
                        <div className="flex-1">
                          <div className="font-semibold text-slate-900 text-sm">
                            {opt.label}
                            <span className="ml-2 inline-block rounded-full bg-pink-50 px-2 py-0.5 text-[11px] font-bold text-[#E91E8C] align-middle">
                              {opt.badge}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-1" style={{ wordBreak: "keep-all" }}>
                            {opt.desc}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>


                  {/* 제작 희망 디자인 — 라인마다 수량과 참고 자료 */}
                  <div>
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-sm font-semibold text-slate-700">제작 희망 디자인 종 수</span>
                      <span className="text-[11px] text-slate-400 tabular-nums">{form.designs.length}/{MAX_DESIGNS}종</span>
                    </div>
                    <p className="text-xs text-slate-500 mb-3" style={{ wordBreak: "keep-all" }}>
                      만들고 싶은 디자인을 종류별로 추가해 주세요. 종류 수와 총 수량이 자동으로 계산됩니다.
                      메인 캐릭터 및 디자인을 1종으로 계산합니다.
                    </p>

                    {form.designs.length > 0 && (
                      <ul className="space-y-2 mb-3">
                        {form.designs.map((d, i) => (
                          <li key={d.id} className="rounded-xl border border-slate-200 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="w-6 flex-shrink-0 text-xs font-bold text-slate-400 tabular-nums">{i + 1}</span>
                              <input
                                type="text"
                                value={d.name}
                                onChange={(e) => patchDesign(d.id, { name: e.target.value })}
                                placeholder="캐릭터 이름을 입력해주세요"
                                aria-label={`디자인 ${i + 1} 이름`}
                                className="min-w-[8rem] flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#1E22B2]"
                              />
                              {orderSpec.hasQuantity && (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  min={0}
                                  step={QUANTITY_STEP}
                                  value={d.quantity}
                                  onChange={(e) => patchDesign(d.id, { quantity: e.target.value })}
                                  placeholder={String(QUANTITY_STEP)}
                                  aria-label={`디자인 ${i + 1} 수량`}
                                  className="w-24 px-3 py-2 border border-slate-200 rounded-lg text-sm text-right pe-num focus:outline-none focus:border-[#1E22B2]"
                                />
                                <span className="text-xs text-slate-400">부</span>
                              </div>
                              )}

                              {/* 라인별 참고 자료 — 같은 줄에서 바로 첨부 */}
                              {d.file ? (
                                <span className="flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-800 max-w-[12rem]">
                                  <span className="truncate" title={d.file.name}>✓ {d.file.name}</span>
                                  <button
                                    type="button"
                                    onClick={() => patchDesign(d.id, { file: null })}
                                    className="flex-shrink-0 text-emerald-600 hover:text-rose-600"
                                    aria-label={`디자인 ${i + 1} 첨부 삭제`}
                                  >
                                    ✕
                                  </button>
                                </span>
                              ) : (
                                <label
                                  className={`cursor-pointer rounded-lg border border-dashed px-3 py-2 text-xs whitespace-nowrap ${
                                    designUploading === d.id
                                      ? "border-[#1E22B2] bg-blue-50 text-[#1E22B2] cursor-wait"
                                      : "border-slate-300 text-slate-500 hover:border-[#1E22B2] hover:bg-blue-50"
                                  }`}
                                >
                                  {designUploading === d.id ? "업로드 중…" : "＋ 참고 자료"}
                                  <input
                                    type="file"
                                    className="hidden"
                                    accept=".pdf,.ai,.png,.jpg,.jpeg,.webp,.gif,.zip"
                                    disabled={designUploading !== null}
                                    onChange={(e) => handleDesignFilePick(d.id, e)}
                                  />
                                </label>
                              )}

                              <button
                                type="button"
                                onClick={() => removeDesign(d.id)}
                                className="flex-shrink-0 px-2 text-slate-300 hover:text-rose-600"
                                aria-label={`디자인 ${i + 1} 삭제`}
                              >
                                ✕
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}

                    {form.designs.length < MAX_DESIGNS && (
                      <button
                        type="button"
                        onClick={addDesign}
                        className="w-full py-3 rounded-xl border-2 border-dashed border-slate-300 text-sm font-semibold text-slate-600 hover:border-[#1E22B2] hover:bg-blue-50 hover:text-[#1E22B2] transition-colors"
                      >
                        ＋ 제작 희망 디자인 추가
                      </button>
                    )}

                    {estimate.quantityMissing && (
                      <p className="text-xs text-amber-700 mt-2">수량을 입력하면 포장비까지 포함한 금액을 보여드립니다.</p>
                    )}
                  </div>

                  {/* 포장 방식 — 실물이 있는 주문에서만 */}
                  {orderSpec.hasPackaging && (
                  <div>
                    <span className="block text-sm font-semibold text-slate-700 mb-3">포장 방식</span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {PACKAGING_OPTIONS.map((opt) => {
                        const isActive = form.packaging === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => update("packaging", isActive ? "" : (opt.value as string))}
                            aria-pressed={isActive}
                            className={`p-4 rounded-2xl border-2 text-left transition-all pe-paper-lift ${
                              isActive
                                ? "border-[#1E22B2] bg-blue-50"
                                : "border-slate-200 hover:border-blue-200"
                            }`}
                          >
                            <div className="font-semibold text-slate-900 text-sm mb-1">{opt.label}</div>
                            <div className="text-xs text-slate-500" style={{ wordBreak: "keep-all" }}>
                              {opt.desc}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  )}


                  {/* 납품 희망일 + 빠른 제작 체크박스 */}
                  <div>
                    <label htmlFor="due" className="block text-sm font-semibold text-slate-700 mb-2">
                      납품 희망일
                      <span className="ml-2 text-xs font-medium text-slate-500">
                        선택 옵션 기준 평균 납기: {formatWeeks(leadWeeks)}
                      </span>
                    </label>
                    <input
                      id="due"
                      type="date"
                      value={form.rushed ? "" : form.deliveryDate}
                      onChange={(e) => {
                        update("deliveryDate", e.target.value);
                        if (e.target.value) update("rushed", false);
                      }}
                      min={minDateISO}
                      disabled={form.rushed}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E22B2]/30 focus:border-[#1E22B2] text-slate-900 disabled:bg-slate-100 disabled:text-slate-400"
                    />
                    <p className="text-xs text-slate-400 mt-1.5">
                      최소 납품 가능일: <span className="pe-num">{minDateISO}</span>
                    </p>
                    <label className="mt-2 inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.rushed}
                        onChange={(e) => {
                          update("rushed", e.target.checked);
                          if (e.target.checked) update("deliveryDate", "");
                        }}
                        className="w-4 h-4 rounded border-slate-300 text-[#E91E8C] focus:ring-2 focus:ring-[#E91E8C]/30"
                      />
                      <span className="text-sm text-slate-700">최대한 빠르게 제작</span>
                    </label>
                  </div>


                  <SubsectionHeader color="#7C3AED" en="Details" ko="추가 정보" />

                  {/* 디자인 설계 스타일 — 폴리곤 / 파츠 결합 / PE STUDIO 권장 */}
                  <div>
                    <span className="block text-sm font-semibold text-slate-700 mb-3">디자인 설계 스타일</span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {DESIGN_STYLES.map((s) => {
                        const isActive = form.designStyle === s;
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => update("designStyle", isActive ? "" : s)}
                            aria-pressed={isActive}
                            className={`py-2.5 px-3 text-sm rounded-xl border-2 transition-colors ${
                              isActive
                                ? "border-[#1E22B2] bg-blue-50 text-[#1E22B2] font-semibold"
                                : "border-slate-200 text-slate-600 hover:border-blue-200"
                            }`}
                          >
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 제품에 삽입할 문구 */}
                  <div>
                    <label htmlFor="productText" className="block text-sm font-semibold text-slate-700 mb-2">
                      제품에 삽입할 문구
                    </label>
                    <input
                      id="productText"
                      type="text"
                      placeholder="예: 회사명·슬로건·이벤트명·QR 코드 옆 문구"
                      value={form.productText}
                      onChange={(e) => update("productText", e.target.value)}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E22B2]/30 focus:border-[#1E22B2] text-slate-900"
                    />
                  </div>


                  {/* 색상 / 디자인 요청사항 */}
                  <div>
                    <label htmlFor="color" className="block text-sm font-semibold text-slate-700 mb-2">
                      색상 / 디자인 요청사항
                    </label>
                    <textarea
                      id="color"
                      rows={2}
                      placeholder="예: 회사 브랜드 컬러(파란색 계열)로 제작, 로고 삽입 원함"
                      value={form.colorRequest}
                      onChange={(e) => update("colorRequest", e.target.value)}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E22B2]/30 focus:border-[#1E22B2] text-slate-900 resize-none"
                    />
                  </div>


                  {/* 회사 로고 업로드 */}
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      회사 로고 업로드
                    </label>
                    {/* 한 줄짜리 컴팩트 업로더 — 큰 드롭존만큼 자리를 차지하지 않게 */}
                    <label
                      className={`flex items-center justify-between gap-3 w-full px-4 py-2.5 border-2 border-dashed rounded-xl transition-colors ${
                        uploading.logo
                          ? "border-[#1E22B2] bg-blue-50 cursor-wait"
                          : form.logoFileUrl
                            ? "border-emerald-400 bg-emerald-50 cursor-pointer"
                            : "border-slate-300 cursor-pointer hover:border-[#1E22B2] hover:bg-blue-50"
                      }`}
                    >
                      <span className="text-sm text-slate-600 truncate" style={{ wordBreak: "keep-all" }}>
                        {uploading.logo
                          ? `업로드 중… ${form.logoFileName}`
                          : form.logoFileUrl
                            ? `✓ ${form.logoFileName} — 첨부 완료`
                            : form.logoFileName || "로고 파일 첨부 (SVG·PNG·AI 권장)"}
                      </span>
                      <span className="flex-shrink-0 text-xs font-semibold" style={{ color: "#1E22B2" }}>
                        파일 선택
                      </span>
                      <input
                        type="file"
                        className="hidden"
                        accept=".svg,.png,.ai,.pdf,.jpg,.jpeg"
                        disabled={uploading.logo}
                        onChange={handleLogoPick}
                      />
                    </label>
                    {uploadErr.logo && (
                      <p className="text-xs text-rose-600 mt-2" style={{ wordBreak: "keep-all" }}>
                        ⚠ {uploadErr.logo} — 다시 시도해 주세요.
                      </p>
                    )}
                  </div>


                  {/* 추가 메모 */}
                  <div>
                    <label htmlFor="notes" className="block text-sm font-semibold text-slate-700 mb-2">
                      추가 메모
                    </label>
                    <textarea
                      id="notes"
                      rows={2}
                      placeholder="기타 요청사항을 자유롭게 입력해 주세요."
                      value={form.notes}
                      onChange={(e) => update("notes", e.target.value)}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E22B2]/30 focus:border-[#1E22B2] text-slate-900 resize-none"
                    />
                  </div>


                  </div>
              );
            })()}

            {/* ───────── Step 3: 연락처 (유일한 필수 단계) ───────── */}
            {step === 3 && (
              <div className="space-y-8">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 mb-1 tracking-tight">
                    연락처를 입력해 주세요
                  </h2>
                  <p className="text-slate-500 text-sm" style={{ wordBreak: "keep-all" }}>
                    견적서를 보내드릴 연락처만 있으면 접수됩니다.
                    비워둔 옵션은 담당자가 상담으로 함께 정해드립니다.
                  </p>
                </div>

                {/* 입력 요약 — 무엇이 채워졌고 무엇이 비었는지 한눈에 */}
                <div className="bg-slate-50 rounded-2xl border border-slate-100 p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold text-slate-900">입력 내용 요약</span>
                    <span className="text-[11px] text-slate-400">비워둔 항목은 상담으로 결정</span>
                  </div>
                  <dl className="space-y-2 text-sm">
                    {[
                      { label: "제품", value: productDisplayName, edit: 1 },
                      { label: "주문 형태", value: ORDER_TYPE_SPECS[form.orderType]?.label ?? "", edit: 2 },
                      { label: "선호 작가", value: STYLE_OPTIONS.find((s) => s.value === form.styleType)?.label ?? "", edit: 2 },
                      { label: "참고 자료", value: form.files.length > 0 ? `✓ ${form.files.length}개 첨부` : "", edit: 2 },
                      /* 수량은 디자인 라인에서 자동 계산된다 — 따로 입력받지 않는다 */
                      {
                        label: "디자인",
                        value: estimate.designCount > 0 ? `${estimate.designCount}종` : "",
                        edit: 2,
                      },
                      {
                        label: "총 수량",
                        value:
                          estimate.totalQuantity > 0
                            ? `${estimate.totalQuantity.toLocaleString("ko-KR")}부`
                            : "",
                        edit: 2,
                      },
                      { label: "납기", value: form.rushed ? "최대한 빠르게" : form.deliveryDate, edit: 2 },
                      { label: "포장", value: PACKAGING_OPTIONS.find((p) => p.value === form.packaging)?.label ?? "", edit: 2 },
                    ].map((row) => (
                      <div key={row.label} className="flex items-center gap-2">
                        <dt className="w-24 flex-shrink-0 text-slate-500">{row.label}</dt>
                        <dd className={`flex-1 truncate ${row.value ? "text-slate-900 font-medium" : "text-slate-400"}`}>
                          {row.value || "—"}
                        </dd>
                        <button
                          type="button"
                          onClick={() => setStep(row.edit)}
                          className="text-xs text-[#1E22B2] font-semibold hover:underline underline-offset-2 flex-shrink-0"
                        >
                          수정
                        </button>
                      </div>
                    ))}
                  </dl>
                </div>

                <div>
                  <label htmlFor="name" className="block text-sm font-semibold text-slate-700 mb-2">
                    이름 / 담당자명 <span style={{ color: "#E91E8C" }}>*</span>
                  </label>
                  <input
                    id="name"
                    type="text"
                    autoComplete="name"
                    placeholder="홍길동"
                    value={form.name}
                    onChange={(e) => update("name", e.target.value)}
                    className={`w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E22B2]/30 focus:border-[#1E22B2] text-slate-900 ${
                      contactTouched && !form.name.trim() ? "border-rose-300 bg-rose-50" : "border-slate-200"
                    }`}
                  />
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-semibold text-slate-700 mb-2">
                    이메일 <span style={{ color: "#E91E8C" }}>*</span>
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    placeholder="example@company.com"
                    value={form.email}
                    onChange={(e) => update("email", e.target.value)}
                    className={`w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E22B2]/30 focus:border-[#1E22B2] text-slate-900 ${
                      contactTouched && !emailValid ? "border-rose-300 bg-rose-50" : "border-slate-200"
                    }`}
                  />
                </div>
                <div>
                  <label htmlFor="phone" className="block text-sm font-semibold text-slate-700 mb-2">
                    연락처 <span style={{ color: "#E91E8C" }}>*</span>
                  </label>
                  <input
                    id="phone"
                    type="tel"
                    autoComplete="tel"
                    inputMode="tel"
                    placeholder="010-0000-0000"
                    value={form.phone}
                    onChange={(e) => update("phone", e.target.value)}
                    className={`w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E22B2]/30 focus:border-[#1E22B2] text-slate-900 pe-num ${
                      contactTouched && !form.phone.trim() ? "border-rose-300 bg-rose-50" : "border-slate-200"
                    }`}
                  />
                </div>
                {contactTouched && !contactValid && (
                  <p className="text-xs text-rose-600" style={{ wordBreak: "keep-all" }}>
                    ⚠ {form.email.trim() && !emailValid
                      ? "이메일 형식을 확인해 주세요. (예: example@company.com)"
                      : "이름·이메일·연락처는 견적 회신을 위해 꼭 필요합니다."}
                  </p>
                )}
                <p className="text-slate-400 text-xs" style={{ wordBreak: "keep-all" }}>
                  즉시 연락은 홈페이지 하단 정보를 참조해 주세요.
                </p>
              </div>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-100">
              {step > 1 ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => s - 1)}
                  className="px-5 py-2.5 text-slate-600 hover:text-slate-900 font-medium rounded-xl hover:bg-slate-100 transition-colors text-sm sm:text-base"
                >
                  ← 이전
                </button>
              ) : (
                <div />
              )}
              {step < TOTAL_STEPS ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => s + 1)}
                  className="inline-flex items-center gap-1.5 px-7 py-3 font-semibold rounded-xl transition-all text-white shadow-lg shadow-pink-500/20 hover:-translate-y-0.5"
                  style={{ background: "linear-gradient(135deg, #06C6C8, #E91E8C)" }}
                >
                  다음
                  <ArrowRightIcon size={18} />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={saving || uploading.file || uploading.logo}
                  className={`inline-flex items-center gap-1.5 px-7 py-3 font-semibold rounded-xl transition-all ${
                    !saving && !uploading.file && !uploading.logo
                      ? "text-white shadow-lg shadow-pink-500/25 hover:-translate-y-0.5"
                      : "bg-slate-200 text-slate-400 cursor-not-allowed"
                  }`}
                  style={
                    !saving && !uploading.file && !uploading.logo
                      ? { background: "linear-gradient(135deg, #06C6C8, #E91E8C)" }
                      : {}
                  }
                >
                  {saving ? "제출 중…" : uploading.file || uploading.logo ? "파일 업로드 중…" : "제작 문의 제출"}
                  {!saving && <ArrowRightIcon size={18} />}
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Info */}
        <div className="mt-6 p-4 bg-blue-50 rounded-xl flex gap-3 text-sm text-blue-900 border border-blue-100">
          <CheckIcon size={18} className="flex-shrink-0 mt-0.5 text-blue-700" />
          <span style={{ wordBreak: "keep-all" }}>
            필수 입력은 <strong>연락처뿐</strong>입니다. 제출 즉시 접수 확인 메일이 발송되고,
            <strong> 3영업일 이내</strong> 담당자가 견적서를 이메일로 회신합니다.
            중간에 페이지를 벗어나도 작성 내용은 자동 저장됩니다.
          </span>
        </div>

        {/* 좁은 화면 — 옆에 둘 자리가 없어 하단에 붙인다 (금액만 축약) */}
        {step === 2 && (
          <div className="xl:hidden sticky bottom-4 z-20 mt-6 drop-shadow-lg">
            <EstimatePanel
              estimate={estimate}
              packagingLabel={PACKAGING_OPTIONS.find((o) => o.value === form.packaging)?.label ?? ""}
              compact
              onConsult={jumpToConsult}
            />
          </div>
        )}
        </div>

        {/* 넓은 화면 — 카드 오른쪽에서 스크롤을 따라온다 */}
        {step === 2 && (
          <aside className="hidden xl:block xl:sticky xl:top-24">
            <EstimatePanel
              estimate={estimate}
              packagingLabel={PACKAGING_OPTIONS.find((o) => o.value === form.packaging)?.label ?? ""}
              onConsult={jumpToConsult}
            />
          </aside>
        )}
        </div>
      </div>

      {/* 이어쓰기 확인 — 답을 들을 때까지 초안을 덮어쓰지 않는다 (저장 effect 가 draftPrompt 를 본다) */}
      {draftPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="draft-title"
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
          >
            <h2 id="draft-title" className="text-lg font-bold text-slate-900">
              이어서 작성하시겠습니까?
            </h2>
            <p className="mt-1.5 text-sm text-slate-500" style={{ wordBreak: "keep-all" }}>
              이전에 작성하던 내용이 남아 있습니다. 이어서 쓰거나, 처음부터 새로 작성할 수 있습니다.
            </p>

            <div className="mt-4 rounded-xl bg-slate-50 border border-slate-100 p-3 text-xs text-slate-600">
              {draftSummary(draftPrompt.form)}
            </div>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={discardDraft}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                처음부터
              </button>
              <button
                type="button"
                onClick={resumeDraft}
                className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white hover:opacity-90"
                style={{ background: "#1E22B2" }}
              >
                이어서 작성
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
