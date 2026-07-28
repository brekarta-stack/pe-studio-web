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

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
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

type StyleType = "realism" | "characterize" | "expert" | "";
type PackagingType = "paper-box" | "opp" | "bulk" | "";

interface FormState {
  product: ProductType;
  quantity: string;
  deliveryDate: string;
  purpose: string;
  /** 디자인 스타일 — 리얼리즘 / 캐릭터라이즈 / 전문가 위임 */
  styleType: StyleType;
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
  /** 샘플링 희망 — B2B 기업 주문 시 필수 */
  sampling: boolean;
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

const PURPOSES = ["마케팅/홍보", "교육", "선물", "전시", "행사", "기타"];

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
  logoFileName: "",
  logoFileUrl: "",
  sampling: false,
  rushed: false,
  packaging: "",
};

const STYLE_OPTIONS: { value: StyleType; label: string; desc: string }[] = [
  { value: "realism",      label: "리얼리즘",     desc: "현실적 스타일로, 사진과 같은 형태로 구현" },
  { value: "characterize", label: "캐릭터라이즈", desc: "캐릭터 원안의 모습을 최대한 살려 구현" },
  { value: "expert",       label: "전문가 위임",  desc: "PE Studio가 적절하게 해석하여 적용" },
];

const PACKAGING_OPTIONS: { value: PackagingType; label: string; desc: string }[] = [
  { value: "paper-box", label: "종이 박스", desc: "제품을 종이 박스로 패키징합니다. 고급 제품에 적합합니다." },
  { value: "opp",       label: "OPP 필름",  desc: "제품을 비닐 필름에 넣어 포장합니다. 일반 제품에 적합합니다." },
  { value: "bulk",      label: "벌크 납품", desc: "포장비를 아껴 저렴하게 제작합니다. 교육 행사 진행에 적합합니다." },
];

/** 제품별 최소 수량 + 최소 납기 (주 단위) — 제작 옵션 동적 안내용 */
const PRODUCT_SPECS: Record<string, { minQty: number; leadWeeks: number; qtyLabel: string; leadLabel: string }> = {
  papercraft: { minQty: 1000, leadWeeks: 6, qtyLabel: "최소 1,000부", leadLabel: "6주 이상" },
  action:     { minQty: 500,  leadWeeks: 4, qtyLabel: "최소 500부",   leadLabel: "약 4주" },
  popup:      { minQty: 1,    leadWeeks: 3, qtyLabel: "최소 1부 ~",   leadLabel: "약 3주" },
  foamboard:  { minQty: 1000, leadWeeks: 6, qtyLabel: "최소 1,000부", leadLabel: "6주 이상" },
  // 용도별 / 미정 — 안내 텍스트만 다르게
  unsure:     { minQty: 1000, leadWeeks: 4, qtyLabel: "1,000부 권장", leadLabel: "약 4주" },
  education:  { minQty: 100,  leadWeeks: 3, qtyLabel: "최소 100부~",  leadLabel: "약 3주" },
  promotion:  { minQty: 500,  leadWeeks: 4, qtyLabel: "최소 500부~",  leadLabel: "약 4주" },
  hobby:      { minQty: 1,    leadWeeks: 3, qtyLabel: "최소 1부~",    leadLabel: "약 3주" },
};

const STORAGE_KEY = "pe-quote-form-draft";
/** 초안 스키마 버전 — v2: 3단계 구조. 구버전(4단계) 초안은 step 을 매핑해 복원 */
const DRAFT_VERSION = 2;

/** 구버전(4단계) step → 신버전(3단계) step 매핑 */
function migrateLegacyStep(oldStep: number): number {
  if (oldStep >= 4) return 3; // 연락처
  if (oldStep === 3) return 2; // 제작 옵션 → 통합 옵션
  return Math.max(1, oldStep); // 1→1, 2→2
}

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

  // localStorage 초안 복원 → URL 파라미터 반영 (명시적 의도가 초안보다 우선)
  useEffect(() => {
    if (typeof window === "undefined") return;

    let restoredForm: FormState = INITIAL_FORM;
    let restoredStep = 1;

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // 구버전 초안엔 없는 키가 있을 수 있으므로 기본값과 병합(누락 키 방지)
        if (parsed.form) restoredForm = { ...INITIAL_FORM, ...parsed.form };
        // 업로드가 끝나기 전(URL 미확보)에 저장된 파일명은 무효 — 링크 없는 파일 제출 방지
        restoredForm = {
          ...restoredForm,
          files: Array.isArray(restoredForm.files)
            ? restoredForm.files.filter((f) => f && typeof f.url === "string" && f.url).slice(0, MAX_FILES)
            : [],
        };
        if (restoredForm.logoFileName && !restoredForm.logoFileUrl) restoredForm = { ...restoredForm, logoFileName: "" };
        if (typeof parsed.step === "number") {
          restoredStep =
            parsed.v === DRAFT_VERSION
              ? Math.min(Math.max(parsed.step, 1), TOTAL_STEPS)
              : migrateLegacyStep(parsed.step);
        }
      }
    } catch {
      // ignore parse errors
    }

    /* ── URL 파라미터 — /products 등에서 전달된 컨텍스트 ── */
    try {
      const params = new URLSearchParams(window.location.search);

      // 제품 프리필 → 제품 선택 단계 건너뛰고 옵션부터 (중복 입력 제거)
      const productParam = params.get("product") as ProductType | null;
      if (productParam && VALID_PRODUCTS.includes(productParam)) {
        restoredForm = { ...restoredForm, product: productParam };
        restoredStep = Math.max(restoredStep, 2);
      }

      // 주문 형태 (도면만/제품 생산) — 메모에 자동 기록해 담당자에게 전달
      const ptype = params.get("ptype");
      const ptypeLabel = ptype === "blueprint" ? "도면만 의뢰" : ptype === "production" ? "제품 생산" : "";
      if (ptypeLabel && !restoredForm.notes.includes("[주문 형태")) {
        restoredForm = {
          ...restoredForm,
          notes: `[주문 형태: ${ptypeLabel}]${restoredForm.notes ? `\n${restoredForm.notes}` : ""}`,
        };
      }

      // 상담 직행 — 완제품 의뢰 등은 연락처 단계로 바로
      const consult = params.get("consult");
      if (consult) {
        if (consult === "finished" && !restoredForm.notes.includes("[완제품 의뢰]")) {
          restoredForm = {
            ...restoredForm,
            notes: `[완제품 의뢰] 조립·설치 포함 완성품 상담 희망${restoredForm.notes ? `\n${restoredForm.notes}` : ""}`,
          };
        }
        if (!restoredForm.product) restoredForm = { ...restoredForm, product: "unsure" };
        restoredStep = TOTAL_STEPS; // 연락처
      }
    } catch {
      // URL 파싱 실패는 무시
    }

    // 제품이 이미 정해졌으면(URL 프리필·초안·상담) 제품 선택 단계(1)에 머물 이유가 없다.
    // Step 1 은 '제품을 고르는' 단계이므로, 이미 고른 상태면 옵션 단계(2)부터 시작한다.
    // → /products 카드 CTA 는 물론, 상단/하단 '제작 문의' 링크나 남은 초안으로 들어와도
    //   "어떤 제품을 원하시나요?"를 다시 보여주는 중복이 사라진다.
    if (restoredForm.product && restoredStep === 1) {
      restoredStep = 2;
    }

    setForm(restoredForm);
    setStepRaw(Math.min(Math.max(restoredStep, 1), TOTAL_STEPS));
    if (isUsageId(restoredForm.product)) setStep1Mode("usage");
    setHydrated(true);
  }, []);

  // 변경 시마다 저장
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: DRAFT_VERSION, form, step }));
    } catch {
      // ignore quota errors
    }
  }, [form, step, hydrated]);

  const update = (key: keyof FormState, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
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

  /** 참고 자료 — 여러 파일 선택 → 순차 업로드 후 form.files 에 추가 (최대 5개) */
  const handleFilesPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ""; // 같은 파일 재선택 허용
    if (picked.length === 0) return;
    setUploadErr((s) => ({ ...s, file: "" }));

    const room = MAX_FILES - form.files.length;
    if (room <= 0) {
      setUploadErr((s) => ({ ...s, file: `첨부는 최대 ${MAX_FILES}개까지 가능합니다.` }));
      return;
    }
    const toUpload = picked.slice(0, room);
    if (picked.length > room) {
      setUploadErr((s) => ({ ...s, file: `최대 ${MAX_FILES}개까지만 첨부됩니다 (${picked.length - room}개 제외).` }));
    }

    setUploading((s) => ({ ...s, file: true }));
    try {
      for (const f of toUpload) {
        try {
          const uploaded = await uploadOne(f);
          setForm((prev) =>
            prev.files.length >= MAX_FILES ? prev : { ...prev, files: [...prev.files, uploaded] },
          );
        } catch (err) {
          setUploadErr((s) => ({
            ...s,
            file: `${f.name}: ${err instanceof Error ? err.message : "업로드 실패"}`,
          }));
        }
      }
    } finally {
      setUploading((s) => ({ ...s, file: false }));
    }
  };

  const removeFile = (idx: number) => {
    setForm((prev) => ({ ...prev, files: prev.files.filter((_, i) => i !== idx) }));
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
        body: JSON.stringify({ ...form, product: form.product || "unsure", acquisition }),
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
                {form.quantity ? `${form.quantity}개` : "상담 후 결정"}
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
      {/* ── 플로팅 '담당자와 상의' — 스크롤 위치와 무관하게 우측에 상시 노출 ── */}
      {step !== TOTAL_STEPS && (
        <button
          type="button"
          onClick={jumpToConsult}
          className="fixed right-0 top-1/2 -translate-y-1/2 z-40 px-2.5 py-4 rounded-l-xl text-white text-sm font-bold shadow-xl shadow-blue-900/30 hover:pr-4 transition-all"
          style={{ background: "#1E22B2", writingMode: "vertical-rl" }}
          title="입력을 건너뛰고 연락처만 남기기 — 담당자가 직접 상담해 드립니다"
        >
          💬 담당자와 상의
        </button>
      )}

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
        <div className="max-w-3xl mx-auto">
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
              const spec = PRODUCT_SPECS[form.product] ?? PRODUCT_SPECS.unsure;
              // 권장 납품 가능일 = 오늘 + leadWeeks * 7일 (로컬 타임존 기준 — UTC 변환 시 KST 오전에 하루 이르게 표시되는 버그 방지)
              const recommended = new Date();
              recommended.setDate(recommended.getDate() + spec.leadWeeks * 7);
              const minDateISO = [
                recommended.getFullYear(),
                String(recommended.getMonth() + 1).padStart(2, "0"),
                String(recommended.getDate()).padStart(2, "0"),
              ].join("-");
              return (
                <div className="space-y-8">
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

                  {/* ── 디자인 ── */}
                  <SubsectionHeader color="#06C6C8" en="Design" ko="디자인" />

                  {/* 참고 자료 업로드 — 권장, 최대 5개 */}
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      참고 자료 업로드
                      <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-700 font-semibold align-middle">권장</span>
                      <span className="ml-2 text-[11px] text-slate-400 font-medium align-middle tabular-nums">
                        {form.files.length}/{MAX_FILES}
                      </span>
                    </label>

                    {/* 첨부된 파일 목록 */}
                    {form.files.length > 0 && (
                      <ul className="mb-2 space-y-1.5">
                        {form.files.map((f, i) => (
                          <li
                            key={f.url}
                            className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2"
                          >
                            <BoxIcon size={16} className="text-emerald-500 flex-shrink-0" />
                            <span className="flex-1 truncate text-sm text-slate-700" title={f.name}>
                              ✓ {f.name}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeFile(i)}
                              className="flex-shrink-0 text-slate-400 hover:text-rose-600"
                              aria-label={`${f.name} 첨부 삭제`}
                            >
                              ✕
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* 드롭존 — 5개 미만일 때만 노출 */}
                    {form.files.length < MAX_FILES && (
                      <label
                        className={`flex flex-col items-center justify-center w-full h-28 border-2 border-dashed rounded-xl transition-colors ${
                          uploading.file
                            ? "border-[#1E22B2] bg-blue-50 cursor-wait"
                            : "border-slate-300 cursor-pointer hover:border-[#1E22B2] hover:bg-blue-50"
                        }`}
                      >
                        <BoxIcon size={28} className="text-slate-400 mb-1" />
                        <span className="text-sm text-slate-700 font-medium" style={{ wordBreak: "keep-all" }}>
                          {uploading.file ? "업로드 중…" : "파일을 클릭하거나 드래그하여 첨부 (여러 개 가능)"}
                        </span>
                        <span className="text-xs text-slate-400 mt-1">PNG · JPG · PDF · AI · ZIP (이미지 자동 축소 · 문서 4MB 이하)</span>
                        <input
                          type="file"
                          multiple
                          className="hidden"
                          accept=".pdf,.ai,.png,.jpg,.jpeg,.webp,.gif,.zip"
                          disabled={uploading.file}
                          onChange={handleFilesPick}
                        />
                      </label>
                    )}
                    {uploadErr.file && (
                      <p className="text-xs text-rose-600 mt-2" style={{ wordBreak: "keep-all" }}>
                        ⚠ {uploadErr.file}
                      </p>
                    )}
                    <p className="text-xs text-slate-500 mt-2" style={{ wordBreak: "keep-all" }}>
                      만들고자 하는 대상/캐릭터의 이미지·ai 파일·참고 문서가 있으면 견적이 훨씬 정확해집니다. (최대 {MAX_FILES}개)
                    </p>
                  </div>

                  {/* 디자인 스타일 */}
                  <div>
                    <span className="block text-sm font-semibold text-slate-700 mb-3">디자인 스타일</span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {STYLE_OPTIONS.map((opt) => {
                        const isActive = form.styleType === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => update("styleType", isActive ? "" : (opt.value as string))}
                            aria-pressed={isActive}
                            className={`p-4 rounded-2xl border-2 text-left transition-all pe-paper-lift ${
                              isActive
                                ? "border-[#1E22B2] bg-blue-50"
                                : "border-slate-200 hover:border-blue-200"
                            }`}
                          >
                            <div className="font-semibold text-slate-900 text-sm mb-1">{opt.label}</div>
                            <div className="text-xs text-slate-500" style={{ wordBreak: "keep-all" }}>{opt.desc}</div>
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
                    <label
                      className={`flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-xl transition-colors ${
                        uploading.logo
                          ? "border-[#1E22B2] bg-blue-50 cursor-wait"
                          : form.logoFileUrl
                            ? "border-emerald-400 bg-emerald-50 cursor-pointer"
                            : "border-slate-300 cursor-pointer hover:border-[#1E22B2] hover:bg-blue-50"
                      }`}
                    >
                      <span className="text-sm text-slate-600" style={{ wordBreak: "keep-all" }}>
                        {uploading.logo
                          ? `업로드 중… ${form.logoFileName}`
                          : form.logoFileUrl
                            ? `✓ ${form.logoFileName} — 첨부 완료`
                            : form.logoFileName || "로고 파일 첨부 (SVG·PNG·AI 권장)"}
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

                  {/* ── 제작 ── */}
                  <SubsectionHeader color="#E91E8C" en="Production" ko="제작" />

                  {/* 주문 수량 */}
                  <div>
                    <label htmlFor="qty" className="block text-sm font-semibold text-slate-700 mb-2">
                      주문 수량
                      <span className="ml-2 text-xs font-medium text-slate-500">
                        선택한 제품 기준: {spec.qtyLabel}
                      </span>
                    </label>
                    <input
                      id="qty"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      maxLength={20}
                      max={99999999}
                      placeholder={`예: ${spec.minQty.toLocaleString()}`}
                      value={form.quantity}
                      onChange={(e) => update("quantity", e.target.value)}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E22B2]/30 focus:border-[#1E22B2] text-slate-900 pe-num"
                    />
                    <p className="text-xs text-slate-400 mt-1.5">단위: 개 (세트형은 세트 수 기준)</p>
                  </div>

                  {/* 납품 희망일 + 빠른 제작 체크박스 */}
                  <div>
                    <label htmlFor="due" className="block text-sm font-semibold text-slate-700 mb-2">
                      납품 희망일
                      <span className="ml-2 text-xs font-medium text-slate-500">
                        평균 납기: {spec.leadLabel}
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

                  {/* 포장 방식 */}
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

                  {/* 샘플링 체크박스 */}
                  <div className="p-4 rounded-2xl border-2 border-slate-200 bg-slate-50/50">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.sampling}
                        onChange={(e) => update("sampling", e.target.checked)}
                        className="mt-0.5 w-5 h-5 rounded border-slate-300 text-[#1E22B2] focus:ring-2 focus:ring-[#1E22B2]/30"
                      />
                      <div className="flex-1">
                        <div className="font-semibold text-slate-900 text-sm">
                          샘플링을 희망합니다
                          <span className="ml-2 text-xs font-medium" style={{ color: "#E91E8C" }}>
                            B2B 기업 주문 시 권장
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1" style={{ wordBreak: "keep-all" }}>
                          생산 전 완제품을 수제작하여 샘플로 보내드립니다. (회당 추가 비용 및 일정 증가)
                        </p>
                      </div>
                    </label>
                  </div>

                  {/* 사용 목적 */}
                  <div>
                    <span className="block text-sm font-semibold text-slate-700 mb-2">사용 목적</span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
                      { label: "디자인 스타일", value: STYLE_OPTIONS.find((s) => s.value === form.styleType)?.label ?? "", edit: 2 },
                      { label: "참고 자료", value: form.files.length > 0 ? `✓ ${form.files.length}개 첨부` : "", edit: 2 },
                      { label: "수량", value: form.quantity ? `${form.quantity}개` : "", edit: 2 },
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
        </div>
      </div>
    </>
  );
}
