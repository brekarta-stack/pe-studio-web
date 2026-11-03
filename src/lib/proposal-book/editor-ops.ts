/**
 * 제안서 편집기의 순수 로직 — 되돌리기 기록, 목록 항목 더하기·빼기·옮기기(한도 안에서),
 * 쪽 숨김·순서, 칸별 서체 역할, 빈칸 순서, 넘침 판정, 이미지 값 고치기.
 *
 * React·DOM 을 모른다. ProposalEditor 는 이 함수들을 부르기만 하고, 테스트는 결과를 그대로 비교한다
 * (tests/proposal-editor.test.mjs).
 */

import {
  LIMITS,
  getAt,
  normalizeImage,
  setAt,
  splitPath,
  type BookContent,
  type BookPage,
  type BookStyle,
  type FieldOverride,
  type ImageObject,
  type PageId,
} from "./schema.ts";
import { plainText, type TbdHit } from "./markup.ts";

/* ── 되돌리기 기록 ──────────────────────────────────────────── */

export interface Snapshot {
  content: BookContent;
  style: BookStyle;
  pages: BookPage[];
}

export interface HistoryState {
  past: Snapshot[];
  present: Snapshot;
  future: Snapshot[];
  /** 같은 key 로 연달아 들어온 변경(슬라이더·끌기)은 한 번의 되돌리기로 묶는다 */
  lastKey: string | null;
  lastAt: number;
}

export const HISTORY_CAP = 100;
/** 같은 key 의 변경이 이 간격 안에 이어지면 기록 한 칸으로 묶는다 */
export const COALESCE_MS = 800;

export type HistoryAction =
  | { type: "commit"; snap: Snapshot; key?: string; at?: number }
  /** 지금 판에서 다음 판을 계산한다 — 비동기 작업(업로드) 뒤에도 최신 판 위에 얹으려고. null 이면 무시 */
  | { type: "apply"; fn: (s: Snapshot) => Snapshot | null; key?: string; at?: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; snap: Snapshot };

export function initHistory(snap: Snapshot): HistoryState {
  return { past: [], present: snap, future: [], lastKey: null, lastAt: 0 };
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "commit": {
      if (action.snap === state.present) return state;
      const at = action.at ?? 0;
      if (action.key && action.key === state.lastKey && at - state.lastAt < COALESCE_MS) {
        return { ...state, present: action.snap, future: [], lastAt: at };
      }
      const past = [...state.past, state.present];
      if (past.length > HISTORY_CAP) past.splice(0, past.length - HISTORY_CAP);
      return { past, present: action.snap, future: [], lastKey: action.key ?? null, lastAt: at };
    }
    case "apply": {
      const snap = action.fn(state.present);
      if (!snap) return state;
      return historyReducer(state, { type: "commit", snap, key: action.key, at: action.at });
    }
    case "undo": {
      if (state.past.length === 0) return state;
      const prev = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        present: prev,
        future: [state.present, ...state.future],
        lastKey: null,
        lastAt: 0,
      };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return { past: [...state.past, state.present], present: next, future: rest, lastKey: null, lastAt: 0 };
    }
    case "reset":
      return initHistory(action.snap);
    default:
      return state;
  }
}

/* ── 목록 ───────────────────────────────────────────────────── */

export interface ListDef {
  /** 숫자 인덱스를 * 로 적은 목록 경로 */
  pattern: string;
  /** 편집기에 보이는 이름 */
  label: string;
  min: number;
  max: number;
  /** 새 항목 */
  blank: () => unknown;
}

const C = LIMITS.counts;

export const LIST_DEFS: readonly ListDef[] = [
  { pattern: "glance.specs", label: "한눈에 · 스펙", ...C["glance.specs"], blank: () => ["새 항목", ""] },
  { pattern: "observation.body", label: "관찰 · 본문 문단", ...C["observation.body"], blank: () => "" },
  { pattern: "observation.sources", label: "관찰 · 출처", ...C["observation.sources"], blank: () => ({ label: "", url: "" }) },
  { pattern: "offer.lines", label: "제안 · 라인업", ...C["offer.lines"], blank: () => ({ use: "", name: "새 라인", body: [""], spec: "" }) },
  { pattern: "offer.lines.*.body", label: "라인 · 본문 문장", min: 1, max: LIMITS.offerBodyLines, blank: () => "" },
  { pattern: "designs.items", label: "시안", ...C["designs.items"], blank: () => ({ key: "", image: "", title: "", note: "" }) },
  { pattern: "scenes.items", label: "활용 장면", ...C["scenes.items"], blank: () => ({ title: "", body: "" }) },
  { pattern: "cases.items", label: "사례", ...C["cases.items"], blank: () => ({ org: "", title: "", note: "", image: "" }) },
  { pattern: "pricing.tiers", label: "견적 구간", ...C["pricing.tiers"], blank: () => ({ qty: "", desc: "", total: "", unit: "" }) },
  { pattern: "pricing.includes", label: "견적 · 포함 항목", ...C["pricing.includes"], blank: () => "" },
  { pattern: "pricing.notes", label: "견적 · 유의 사항", ...C["pricing.notes"], blank: () => "" },
  { pattern: "plan.steps", label: "일정 · 단계", ...C["plan.steps"], blank: () => ({ when: "", title: "", body: "" }) },
  { pattern: "closing.next", label: "다음 단계", ...C["closing.next"], blank: () => "" },
];

const isIdx = (s: string) => /^\d+$/.test(s);

/** "offer.lines.0.body" → "offer.lines.*.body" */
export function toPattern(path: string): string {
  return splitPath(path)
    .map((s) => (isIdx(s) ? "*" : s))
    .join(".");
}

export function listDefOf(listPath: string): ListDef | undefined {
  const pat = toPattern(listPath);
  return LIST_DEFS.find((d) => d.pattern === pat);
}

export interface ListHit {
  listPath: string;
  index: number;
  def: ListDef;
}

/** 칸 경로가 속한 목록들 — 바깥 목록부터. "offer.lines.1.body.0" → [offer.lines #1, offer.lines.1.body #0] */
export function listsOfPath(path: string): ListHit[] {
  const segs = splitPath(path);
  const out: ListHit[] = [];
  for (let k = 1; k < segs.length; k++) {
    if (!isIdx(segs[k])) continue;
    const listPath = segs.slice(0, k).join(".");
    const def = listDefOf(listPath);
    if (def) out.push({ listPath, index: Number(segs[k]), def });
  }
  return out;
}

/** 이 쪽에 있는 최상위 목록(중첩 목록 제외) */
export function topListsOfPage(page: PageId): ListDef[] {
  const firstKey: Record<string, PageId> = {
    glance: "glance",
    observation: "observation",
    offer: "offer",
    designs: "designs",
    scenes: "scenes",
    cases: "cases",
    pricing: "pricing",
    plan: "plan",
    closing: "back",
  };
  return LIST_DEFS.filter((d) => !d.pattern.includes("*") && firstKey[d.pattern.split(".")[0]] === page);
}

export function listLength(content: BookContent, listPath: string): number {
  const v = getAt(content, listPath);
  return Array.isArray(v) ? v.length : 0;
}

export function canAdd(content: BookContent, listPath: string): boolean {
  const def = listDefOf(listPath);
  return !!def && listLength(content, listPath) < def.max;
}

export function canRemove(content: BookContent, listPath: string): boolean {
  const def = listDefOf(listPath);
  return !!def && listLength(content, listPath) > def.min;
}

/** 한도 표기 — "2~3개" / "3개 고정" */
export function limitLabel(def: Pick<ListDef, "min" | "max">): string {
  return def.min === def.max ? `${def.min}개 고정` : `${def.min}~${def.max}개`;
}

/**
 * 칸별 서체·크기 덮어쓰기의 키는 칸 경로라, 항목을 지우거나 옮기면 인덱스를 따라 옮겨야 한다
 * (안 옮기면 지운 항목의 크기가 다음 항목에 붙는다). map 이 null 을 돌려주면 그 항목의 덮어쓰기는 버린다.
 */
export function remapOverrides(
  overrides: Record<string, FieldOverride>,
  listPath: string,
  map: (i: number) => number | null
): Record<string, FieldOverride> {
  const prefix = `${listPath}.`;
  const out: Record<string, FieldOverride> = {};
  let changed = false;
  for (const [key, val] of Object.entries(overrides)) {
    if (!key.startsWith(prefix)) {
      out[key] = val;
      continue;
    }
    const m = /^(\d+)((?:\..*)?)$/.exec(key.slice(prefix.length));
    if (!m) {
      out[key] = val;
      continue;
    }
    const to = map(Number(m[1]));
    changed = true;
    if (to == null) continue;
    out[`${prefix}${to}${m[2]}`] = val;
  }
  return changed ? out : overrides;
}

function withList(snap: Snapshot, listPath: string, next: unknown[], map?: (i: number) => number | null): Snapshot {
  const content = setAt(snap.content, listPath, next);
  const overrides = map ? remapOverrides(snap.style.overrides, listPath, map) : snap.style.overrides;
  const style = overrides === snap.style.overrides ? snap.style : { ...snap.style, overrides };
  return { ...snap, content, style };
}

/** 끝에 빈 항목을 붙인다. 한도에 닿았으면 null */
export function addItem(snap: Snapshot, listPath: string): Snapshot | null {
  const def = listDefOf(listPath);
  const arr = getAt(snap.content, listPath);
  if (!def || !Array.isArray(arr) || arr.length >= def.max) return null;
  return withList(snap, listPath, [...arr, def.blank()]);
}

/** 항목 하나를 지운다. 최소 개수면 null */
export function removeItem(snap: Snapshot, listPath: string, index: number): Snapshot | null {
  const def = listDefOf(listPath);
  const arr = getAt(snap.content, listPath);
  if (!def || !Array.isArray(arr) || arr.length <= def.min || index < 0 || index >= arr.length) return null;
  const next = arr.filter((_, i) => i !== index);
  return withList(snap, listPath, next, (i) => (i === index ? null : i > index ? i - 1 : i));
}

/** 항목을 한 칸 옮긴다(dir -1 위로, +1 아래로). 끝이면 null */
export function moveItem(snap: Snapshot, listPath: string, index: number, dir: -1 | 1): Snapshot | null {
  const arr = getAt(snap.content, listPath);
  if (!listDefOf(listPath) || !Array.isArray(arr)) return null;
  const to = index + dir;
  if (index < 0 || index >= arr.length || to < 0 || to >= arr.length) return null;
  const next = arr.slice();
  [next[index], next[to]] = [next[to], next[index]];
  // 시안 글자(A·B·C)는 자리의 이름이다 — 내용만 옮기고 글자는 자리에 남긴다
  if (listPath === "designs.items") {
    const a = next[index] as { key?: unknown };
    const b = next[to] as { key?: unknown };
    next[index] = { ...a, key: (arr[index] as { key?: unknown }).key };
    next[to] = { ...b, key: (arr[to] as { key?: unknown }).key };
  }
  return withList(snap, listPath, next, (i) => (i === index ? to : i === to ? index : i));
}

/** 추천 견적 구간을 정확히 하나로 */
export function setPick(content: BookContent, index: number): BookContent {
  const tiers = content.pricing.tiers.map((t, i) => {
    const base = { qty: t.qty, desc: t.desc, total: t.total, unit: t.unit };
    return i === index ? { ...base, pick: true } : base;
  });
  return { ...content, pricing: { ...content.pricing, tiers } };
}

/** 목록 항목을 한 줄로 부를 이름 — 첫 글자 있는 문자열 */
export function itemLabel(item: unknown, max = 18): string {
  const first = (v: unknown): string => {
    if (typeof v === "string") return plainText(v).trim();
    if (Array.isArray(v)) {
      for (const x of v) {
        const s = first(x);
        if (s) return s;
      }
      return "";
    }
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (k === "image" || k === "url" || k === "key") continue;
        const s = first(x);
        if (s) return s;
      }
    }
    return "";
  };
  const s = first(item);
  if (!s) return "(비어 있음)";
  const chars = Array.from(s);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : s;
}

/* ── 쪽 ─────────────────────────────────────────────────────── */

const FIXED: ReadonlySet<PageId> = new Set<PageId>(["cover", "back"]);

export function togglePage(pages: BookPage[], id: PageId): BookPage[] {
  if (FIXED.has(id)) return pages;
  return pages.map((p) => (p.id === id ? { ...p, hidden: !p.hidden } : p));
}

/** 쪽 순서 바꾸기 — 표지는 맨 앞, 뒤표지는 맨 끝에 묶여 있다 */
export function movePage(pages: BookPage[], id: PageId, dir: -1 | 1): BookPage[] {
  const i = pages.findIndex((p) => p.id === id);
  const j = i + dir;
  if (i < 0 || FIXED.has(id) || j < 0 || j >= pages.length || FIXED.has(pages[j].id)) return pages;
  const next = pages.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function canMovePage(pages: BookPage[], id: PageId, dir: -1 | 1): boolean {
  return movePage(pages, id, dir) !== pages;
}

/* ── 서체·크기 덮어쓰기 ─────────────────────────────────────── */

const HEADING_KEYS = new Set(["headline", "title", "quote", "name", "org", "org_display"]);

/** 칸 경로 → 제목용/본문용 서체 목록 중 어느 것을 보여 줄지 */
export function fontRoleOfPath(path: string): "heading" | "body" {
  const segs = splitPath(path).filter((s) => !isIdx(s));
  const last = segs[segs.length - 1] ?? "";
  return HEADING_KEYS.has(last) ? "heading" : "body";
}

export const SCALE_MIN = 0.7;
export const SCALE_MAX = 1.4;

/** 덮어쓰기 하나를 고친다. 빈 덮어쓰기(서체 없음·크기 100%)는 키째 지운다 */
export function setOverride(style: BookStyle, path: string, patch: Partial<FieldOverride> | null): BookStyle {
  const cur = style.overrides[path] ?? {};
  const merged: FieldOverride = patch === null ? {} : { ...cur, ...patch };
  const clean: FieldOverride = {};
  if (merged.font) clean.font = merged.font;
  if (merged.scale != null && Number.isFinite(merged.scale)) {
    const s = Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, merged.scale)) * 100) / 100;
    if (s !== 1) clean.scale = s;
  }
  const overrides = { ...style.overrides };
  if (clean.font || clean.scale != null) overrides[path] = clean;
  else delete overrides[path];
  return { ...style, overrides };
}

/* ── 빈칸 ───────────────────────────────────────────────────── */

/** 숨긴 쪽을 뺀 빈칸을 지금 쪽 순서대로 (같은 쪽 안에서는 원래 순서) */
export function orderedTbd(hits: TbdHit[], pages: BookPage[]): TbdHit[] {
  const order = new Map<PageId, number>();
  pages.forEach((p, i) => order.set(p.id, i));
  const hidden = new Set(pages.filter((p) => p.hidden).map((p) => p.id));
  return hits
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => !h.page || !hidden.has(h.page))
    .sort((a, b) => {
      const pa = a.h.page ? order.get(a.h.page) ?? 99 : 99;
      const pb = b.h.page ? order.get(b.h.page) ?? 99 : 99;
      return pa - pb || a.i - b.i;
    })
    .map(({ h }) => h);
}

export function tbdCountByPage(hits: TbdHit[]): Partial<Record<PageId, number>> {
  const out: Partial<Record<PageId, number>> = {};
  for (const h of hits) if (h.page) out[h.page] = (out[h.page] ?? 0) + 1;
  return out;
}

/* ── 넘침 ───────────────────────────────────────────────────── */

/**
 * 지면 하나가 넘쳤는가 — 스크롤 높이가 상자보다 크거나, 어느 칸의 아래 끝이 지면 아래 끝을 넘는다.
 * (지면이 overflow:hidden 이라 넘친 글은 잘려서 안 보인다 — 눈으로는 못 찾는다)
 */
export function isOverflowing(
  box: { scrollHeight: number; clientHeight: number; bottom: number },
  childBottoms: number[],
  tol = 1
): boolean {
  if (box.scrollHeight > box.clientHeight + tol) return true;
  return childBottoms.some((b) => b > box.bottom + tol);
}

/* ── 이미지 ─────────────────────────────────────────────────── */

/** 지금 보여 줄 수 있는 주소인가 — data.json 의 상대 파일명(cover.jpg)은 빈 칸으로 친다 */
export function isShowableImageUrl(url: string): boolean {
  return /^(https?:\/\/|\/|data:image\/|blob:)/i.test(url);
}

export function hasImage(v: unknown): boolean {
  return isShowableImageUrl(normalizeImage(v).url);
}

/** 이미지 값을 고친다 — 범위는 normalizeImage 가 잘라 준다 */
export function patchImage(v: unknown, patch: Partial<ImageObject>): ImageObject {
  return normalizeImage({ ...normalizeImage(v), ...patch });
}

/** 칸 안에서 끌어 위치를 옮긴다. dx·dy 는 칸 크기에 대한 비율(-1~1). 끄는 방향으로 그림이 따라온다 */
export function dragFocal(start: ImageObject, dxFrac: number, dyFrac: number): ImageObject {
  const r = (n: number) => Math.round(n * 10) / 10;
  return patchImage(start, { x: r(start.x - dxFrac * 100), y: r(start.y - dyFrac * 100) });
}

/** 사례 하나를 알아보는 열쇠 — 기관+사례명, 공백은 하나로 접고 앞뒤는 걷는다. 둘 중 하나라도 비었거나 빈칸 표기면 null */
export function caseKey(it: { org?: unknown; title?: unknown }): string | null {
  const n = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const org = n(it.org);
  const title = n(it.title);
  // 빈칸 표기([확인 필요: 기관])끼리는 같은 사례가 아니다
  if (!org || !title || /확인\s*필요/.test(org + title)) return null;
  return `${org}\u0000${title}`;
}

/**
 * AI 로 다시 쓴 새 원고에 옛 원고의 이미지를 옮긴다 — 같은 자리(인덱스)끼리, 보여 줄 수 있는 것만.
 * 사례(cases)만은 자리가 아니라 기관+사례명이 같은 사례로 옮긴다 — 새 원고가 다른 사례를 골랐는데 자리 번호로
 * 옮기면 엉뚱한 사례에 다른 제품 사진이 붙는다. 짝이 없으면 새 원고의 사진(작업자가 고른 라이브러리 사진)을 둔다.
 * "있다"의 기준은 편집기 지면과 같은 hasImage 다: data.json 의 상대 파일명(cover.jpg)은 빈 칸이다.
 * 기준이 다르면 다시 쓰기가 빈 칸(상대 파일명)을 새 원고 위에 덮어 "이미지는 유지" 약속과 어긋난다.
 * (generate API 의 regenerate·keepImages 가 쓴다)
 */
export function carryImages(next: BookContent, prev: BookContent): BookContent {
  const out: BookContent = {
    ...next,
    designs: { ...next.designs, items: next.designs.items.map((x) => ({ ...x })) },
    scenes: { ...next.scenes },
    cases: { ...next.cases, items: next.cases.items.map((x) => ({ ...x })) },
  };
  if (hasImage(prev.cover)) out.cover = prev.cover;
  if (hasImage(prev.scenes.image)) out.scenes.image = prev.scenes.image;
  out.designs.items.forEach((it, i) => {
    const old = prev.designs.items[i]?.image;
    if (hasImage(old)) it.image = old;
  });
  const oldCases = new Map<string, BookContent["cases"]["items"][number]["image"]>();
  for (const it of prev.cases.items) {
    const k = caseKey(it);
    if (k && hasImage(it.image) && !oldCases.has(k)) oldCases.set(k, it.image);
  }
  out.cases.items.forEach((it) => {
    const k = caseKey(it);
    const old = k ? oldCases.get(k) : undefined;
    if (old !== undefined) it.image = old;
  });
  return out;
}
