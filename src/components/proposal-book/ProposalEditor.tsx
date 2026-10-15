"use client";

/**
 * 제안서 편집기 — 틀은 고정, 칸 안에서만 고친다 (docs/proposal-editor-plan.md §4).
 *
 * 화면: 위 도구막대(저장 상태·되돌리기·서체·키컬러·빈칸·넘침·AI 다시 쓰기·PDF) /
 *       왼쪽 쪽 목록(숨김·순서·넘침·빈칸) / 가운데 지면(BookPages mode="edit") / 오른쪽 속성 패널.
 *
 * 상태는 {content, style, pages} 스냅샷 하나를 되돌리기 기록(editor-ops historyReducer)이 들고 있다.
 * 바뀐 판은 2초 뒤 자동 저장된다 — 저장은 rev 낙관적 잠금이라 다른 창이 먼저 저장했으면
 * 덮어쓰지 않고 멈춘 뒤 새로고침을 권한다.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import BookPages, { type FieldKind } from "./BookPages";
import "./editor.css";
import {
  conformContent,
  emptyContent,
  getAt,
  normalizeImage,
  normalizePages,
  normalizeStyle,
  pageDef,
  pageOfPath,
  setAt,
  type BookContent,
  type BookPage,
  type BookStyle,
  type ImageObject,
  type PageId,
} from "@/lib/proposal-book/schema";
import { BODY_FONTS, HEADING_FONTS, findFont, fontStack } from "@/lib/proposal-book/fonts";
import { listTbd } from "@/lib/proposal-book/markup";
import {
  addItem,
  canAdd,
  canMovePage,
  canRemove,
  dragFocal,
  fontRoleOfPath,
  hasImage,
  historyReducer,
  initHistory,
  isOverflowing,
  itemLabel,
  limitLabel,
  listLength,
  listsOfPath,
  moveItem,
  movePage,
  orderedTbd,
  patchImage,
  removeItem,
  setOverride,
  setPick,
  tbdCountByPage,
  togglePage,
  topListsOfPage,
  type ListDef,
  type Snapshot,
} from "@/lib/proposal-book/editor-ops";
import { prepareImageForUpload } from "@/lib/image-resize";
import type { ProposalDoc } from "@/lib/proposal-docs";
import { createFromFallback, resetToFallback, saveProposal } from "@/app/admin/outreach/[id]/proposal/actions";

const BRAND = "#1E22B2";
const KEY_PRESETS = ["#1E22B2", "#0F172A", "#B42318", "#0E7A5F", "#9A5B00", "#6D28D9"];
/** A4 가로 297mm 를 CSS px 로 (96dpi) */
const PAGE_W_PX = (297 * 96) / 25.4;
/** 대지 좌우 여백(.pb-root .page 의 margin 10mm) */
const SHEET_PAD_PX = (10 * 96) / 25.4;
const AUTOSAVE_MS = 2000;
const GENERATE_TIMEOUT_MS = 150_000;

export interface ProposalEditorLead {
  id: string;
  org: string;
}

type DocLike = Pick<ProposalDoc, "content" | "style" | "pages" | "rev" | "source"> & { repaired?: boolean };

/* ── 서버 응답 → 스냅샷 ─────────────────────────────────────── */

function snapOf(doc: DocLike, org: string): Snapshot {
  return {
    content: conformContent(doc.content, emptyContent(org)),
    style: normalizeStyle(doc.style),
    pages: normalizePages(doc.pages),
  };
}

type GenerateResult =
  | { ok: true; doc: DocLike; source: "ai" | "fallback"; notice?: string }
  | { ok: false; error: string; conflict?: boolean };

/** AI 초안 API (에이전트 C 의 /api/admin/proposals/{id}/generate). 최대 90초쯤 걸린다 */
async function callGenerate(quoteId: string, mode: "create" | "regenerate", expectedRev?: number): Promise<GenerateResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GENERATE_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/admin/proposals/${encodeURIComponent(quoteId)}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(mode === "regenerate" ? { mode, keepImages: true, expectedRev } : { mode }),
      signal: ctrl.signal,
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      return { ok: false, error: `초안 서버의 응답을 읽지 못했습니다 (HTTP ${res.status}).` };
    }
    const b = (body ?? {}) as { ok?: unknown; doc?: unknown; error?: unknown; source?: unknown; notice?: unknown };
    if (!res.ok || b.ok !== true || !b.doc || typeof b.doc !== "object") {
      const msg = typeof b.error === "string" && b.error ? b.error : `초안을 만들지 못했습니다 (HTTP ${res.status}).`;
      return { ok: false, error: msg, conflict: res.status === 409 };
    }
    return {
      ok: true,
      doc: b.doc as DocLike,
      source: b.source === "fallback" ? "fallback" : "ai",
      notice: typeof b.notice === "string" && b.notice ? b.notice : undefined,
    };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return { ok: false, error: "시간이 너무 오래 걸려 멈췄습니다. 잠시 뒤 다시 시도해 주세요." };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/* ── 맨 바깥: 문서가 없으면 초안부터 ──────────────────────────── */

export default function ProposalEditor({ lead, initialDoc }: { lead: ProposalEditorLead; initialDoc: ProposalDoc | null }) {
  const [loaded, setLoaded] = useState<{ doc: DocLike; notice: string | null } | null>(
    initialDoc ? { doc: initialDoc, notice: null } : null
  );
  if (!loaded) return <DraftScreen lead={lead} onReady={(doc, notice) => setLoaded({ doc, notice })} />;
  return <Editor lead={lead} initial={loaded.doc} initialNotice={loaded.notice} />;
}

function DraftScreen({ lead, onReady }: { lead: ProposalEditorLead; onReady: (doc: DocLike, notice: string | null) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const started = useRef(false);
  const mounted = useRef(true);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  const run = useCallback(async () => {
    const r = await callGenerate(lead.id, "create");
    if (!mounted.current) return;
    if (r.ok) onReadyRef.current(r.doc, r.notice ?? (r.source === "fallback" ? "AI 초안을 쓰지 못해 옛 본문으로 채웠습니다." : null));
    else {
      setError(r.error);
      setBusy(false);
    }
  }, [lead.id]);

  useEffect(() => {
    mounted.current = true;
    // 개발 모드의 이중 실행에서도 요청은 한 번만 (AI 초안은 비싸고 느리다)
    if (!started.current) {
      started.current = true;
      void run();
    }
    return () => {
      mounted.current = false;
    };
  }, [run]);

  const startFromFallback = async () => {
    setBusy(true);
    setError(null);
    const r = await createFromFallback(lead.id);
    if (!mounted.current) return;
    if (r.ok) onReadyRef.current(r.doc, "옛 본문으로 만든 초안입니다. 빈칸을 채운 뒤 보내 주세요.");
    else {
      setError(r.error);
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <div className="border-b border-slate-200 bg-white px-5 py-3">
        <Link href="/admin/outreach" className="text-sm text-slate-500 hover:text-slate-800">
          ← 제안 영업
        </Link>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-semibold text-slate-500">{lead.org || "제안서"}</p>
          {busy ? (
            <>
              <div
                className="mx-auto mt-5 h-9 w-9 animate-spin rounded-full border-4 border-slate-200"
                style={{ borderTopColor: BRAND }}
                aria-hidden
              />
              <p className="mt-5 font-bold text-slate-900" role="status">
                초안 작성 중
              </p>
              <p className="mt-1 text-sm text-slate-500">기관 정보를 바탕으로 AI가 원고를 쓰고 있습니다 (최대 1분)</p>
            </>
          ) : (
            <>
              <p className="mt-4 font-bold text-red-700">초안을 만들지 못했습니다</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-red-600" role="alert">
                {error}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setBusy(true);
                    setError(null);
                    void run();
                  }}
                  className="rounded-xl px-4 py-2.5 text-sm font-bold text-white"
                  style={{ background: BRAND }}
                >
                  다시 시도
                </button>
                <button
                  type="button"
                  onClick={() => void startFromFallback()}
                  className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  옛 초안으로 시작
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── 편집기 문맥 (지면 안의 칸이 읽는다) ──────────────────────── */

type Selection = { kind: "field"; path: string; inst: string | null } | { kind: "image"; path: string } | null;

interface UploadState {
  busy: boolean;
  error: string | null;
}

interface EdCtxValue {
  content: BookContent;
  selection: Selection;
  editing: { path: string; inst: string } | null;
  uploads: Record<string, UploadState>;
  startEdit: (path: string, inst: string, page: PageId | null) => void;
  commitText: (path: string, value: string) => void;
  cancelEdit: () => void;
  selectImage: (path: string, page: PageId | null) => void;
  updateImage: (path: string, img: ImageObject, key?: string) => void;
  uploadImage: (path: string, file: File) => void;
}

const EdCtx = createContext<EdCtxValue | null>(null);

function useEd(): EdCtxValue {
  const v = useContext(EdCtx);
  if (!v) throw new Error("EdCtx 밖에서 쓰였습니다");
  return v;
}

function pageOfEl(el: Element): PageId | null {
  const sec = el.closest("section[data-page]") as HTMLElement | null;
  return (sec?.dataset.page as PageId | undefined) ?? null;
}

/** 글 칸 하나 — 누르면 그 자리에서 원문(**·[확인 필요: …])을 고친다 */
function FieldSlot({ path, kind, node }: { path: string; kind: FieldKind; node: ReactNode }) {
  const inst = useId();
  const ed = useEd();
  const editing = ed.editing?.path === path && ed.editing.inst === inst;
  const selected = ed.selection?.kind === "field" && ed.selection.path === path;
  if (editing) {
    const raw = getAt(ed.content, path);
    return (
      <TextEditor
        initial={typeof raw === "string" ? raw : ""}
        multiline={kind === "multiline"}
        onCommit={(v) => ed.commitText(path, v)}
        onCancel={ed.cancelEdit}
      />
    );
  }
  const open = (el: Element) => ed.startEdit(path, inst, pageOfEl(el));
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label="글 고치기"
      className="pb-ed-field"
      data-selected={selected ? "" : undefined}
      onClick={(e) => {
        e.stopPropagation();
        open(e.currentTarget);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open(e.currentTarget);
        }
      }}
    >
      {node}
    </span>
  );
}

/** 서식 없는 글자만 받는 칸 안 편집기. Enter 확정 · Esc 취소 · 바깥 누르면 확정 */
function TextEditor({
  initial,
  multiline,
  onCommit,
  onCancel,
}: {
  initial: string;
  multiline: boolean;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const done = useRef(false);
  const initialRef = useRef(initial);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 내용은 React 가 아니라 여기서 한 번 넣는다 — 타이핑 중에 React 가 글자를 덮어쓰지 않게
    el.textContent = initialRef.current;
    el.focus();
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, []);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const raw = ref.current?.textContent ?? "";
    if (commit) onCommit(multiline ? raw : raw.replace(/\s*\r?\n\s*/g, " "));
    else onCancel();
  };

  const insertPlain = (text: string) => {
    // execCommand 는 낡았지만 contentEditable 에서 되돌리기 기록을 지키며 글자를 넣는 유일한 길이다
    if (!document.execCommand("insertText", false, text)) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLSpanElement>) => {
    // 한글 조합 중의 Enter·Esc 는 조합을 끝내는 키다
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (multiline && e.shiftKey) insertPlain("\n");
      else finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
  };

  return (
    <span
      ref={ref}
      className="pb-ed-editing"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-multiline={multiline}
      aria-label="칸 편집 — Enter 확정, Esc 취소"
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
      onPaste={(e) => {
        e.preventDefault();
        let text = e.clipboardData.getData("text/plain");
        if (!multiline) text = text.replace(/\s*\r?\n\s*/g, " ");
        insertPlain(text);
      }}
      onDrop={(e) => e.preventDefault()}
    />
  );
}

/** 이미지 칸 — 올리기·바꾸기, 끌어서 위치, 누르면 오른쪽 패널에 맞춤·확대 */
function ImageSlot({ path, value, hint }: { path: string; value: unknown; hint: string }) {
  const ed = useEd();
  const img = normalizeImage(value);
  const show = hasImage(value);
  const selected = ed.selection?.kind === "image" && ed.selection.path === path;
  const up = ed.uploads[path];
  const inputId = useId();
  const drag = useRef<{ x: number; y: number; w: number; h: number; start: ImageObject; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    drag.current = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height, start: img, moved: false };
    if (show) e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !show) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
    }
    ed.updateImage(path, dragFocal(d.start, dx / (d.w || 1), dy / (d.h || 1)), `drag:${path}`);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d && !d.moved) ed.selectImage(path, pageOfEl(e.currentTarget));
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) ed.uploadImage(path, f);
  };

  const pos = `${img.x}% ${img.y}%`;
  return (
    <div
      className="pb-ed-img"
      role="button"
      tabIndex={0}
      aria-label="이미지 칸 — 누르면 맞춤·확대, 끌면 위치 조정"
      data-selected={selected ? "" : undefined}
      data-empty={show ? undefined : ""}
      data-dragging={dragging ? "" : undefined}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          ed.selectImage(path, pageOfEl(e.currentTarget));
        }
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element -- 지면 미리보기라 next/image 변환이 필요 없다(인쇄 화면과 같은 이유)
        <img
          src={img.url}
          alt=""
          draggable={false}
          style={{
            objectFit: img.fit,
            objectPosition: pos,
            transform: img.zoom !== 1 ? `scale(${img.zoom})` : undefined,
            transformOrigin: pos,
          }}
        />
      ) : (
        <div className="slot">
          {hint}
          <code>{img.url ? `${img.url} (아직 없음)` : "비어 있음"}</code>
        </div>
      )}
      <div className="pb-ed-img-bar" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <label htmlFor={inputId} className="pb-ed-img-btn">
          {show ? "이미지 바꾸기" : "이미지 올리기"}
          <input id={inputId} type="file" accept="image/*" className="sr-only" onChange={onFile} disabled={up?.busy} />
        </label>
      </div>
      {up?.busy && <div className="pb-ed-img-busy">올리는 중…</div>}
      {up?.error && (
        <p className="pb-ed-img-err" role="alert">
          {up.error}
        </p>
      )}
    </div>
  );
}

/* ── 편집기 본체 ────────────────────────────────────────────── */

type SaveStatus = "idle" | "saving" | "error";

const FIELD_LABELS: Record<string, string> = {
  headline: "제목",
  lede: "리드",
  quote: "인용",
  title: "제목",
  subtitle: "부제",
  name: "라인명",
  use: "쓰임",
  spec: "사양",
  body: "본문",
  note: "설명",
  org: "기관명",
  org_display: "기관명(표지)",
  qty: "수량",
  desc: "구성",
  total: "총액",
  unit: "개당",
  when: "시기",
  label: "출처",
  url: "주소",
  dept: "수신 부서",
  email: "수신 이메일",
  includes: "포함 항목",
  notes: "유의 사항",
  next: "다음 단계",
  cover: "커버 이미지",
  image: "이미지",
  specs: "스펙",
};

function describePath(path: string): string {
  const segs = path.split(".");
  const named = segs.filter((s) => !/^\d+$/.test(s));
  const last = named[named.length - 1] ?? path;
  const pid = pageOfPath(path);
  const page = pid ? pageDef(pid).name : undefined;
  let label = FIELD_LABELS[last] ?? last;
  if (path.startsWith("glance.specs.")) label = segs[3] === "0" ? "스펙 이름" : "스펙 값";
  return page && page !== label ? `${page} · ${label}` : label;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function Editor({ lead, initial, initialNotice }: { lead: ProposalEditorLead; initial: DocLike; initialNotice: string | null }) {
  const org = lead.org;
  const [hist, dispatch] = useReducer(historyReducer, undefined, () => initHistory(snapOf(initial, org)));
  const present = hist.present;
  const { content, style, pages } = present;

  /* 저장 */
  const revRef = useRef(initial.rev);
  const [savedSnap, setSavedSnap] = useState<Snapshot>(hist.present);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [conflict, setConflict] = useState(false);
  const savingRef = useRef(false);
  const dirty = present !== savedSnap;
  // 비동기 흐름(저장 대기·AI 다시 쓰기)이 기다린 뒤에도 최신 판을 보게
  const presentRef = useRef(present);
  const savedRef = useRef(savedSnap);
  const conflictRef = useRef(false);
  useEffect(() => {
    presentRef.current = present;
  }, [present]);

  /* 화면 */
  const [selection, setSelection] = useState<Selection>(null);
  const [editing, setEditing] = useState<{ path: string; inst: string } | null>(null);
  const [currentPage, setCurrentPage] = useState<PageId>("cover");
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const [overflow, setOverflow] = useState<PageId[]>([]);
  const [notice, setNotice] = useState<string | null>(
    initialNotice ?? (initial.repaired ? "저장본 형식이 어긋나 틀에 맞춰 고쳐 읽었습니다. 고치면 정리된 판으로 저장됩니다." : null)
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [regen, setRegen] = useState<"idle" | "armed" | "running">("idle");
  const [resetArm, setResetArm] = useState<"idle" | "armed" | "running">("idle");
  const tbdCursor = useRef(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [bookH, setBookH] = useState(0);

  /** 사람이 고친 변경 — 저장이 실패해 멈춰 있었으면 자동 저장을 다시 켠다 */
  const commit = useCallback((fn: (s: Snapshot) => Snapshot | null, key?: string) => {
    dispatch({ type: "apply", fn, key, at: Date.now() });
    setSaveStatus((st) => (st === "error" ? "idle" : st));
  }, []);
  const undo = useCallback(() => {
    dispatch({ type: "undo" });
    setSaveStatus((st) => (st === "error" ? "idle" : st));
  }, []);
  const redo = useCallback(() => {
    dispatch({ type: "redo" });
    setSaveStatus((st) => (st === "error" ? "idle" : st));
  }, []);

  /* ── 저장 ── */

  const doSave = useCallback(
    async (snap: Snapshot): Promise<boolean> => {
      if (savingRef.current) return false;
      savingRef.current = true;
      setSaveStatus("saving");
      try {
        const r = await saveProposal(lead.id, snap, revRef.current);
        if (r.ok) {
          revRef.current = r.doc.rev;
          savedRef.current = snap;
          setSavedSnap(snap);
          setSavedAt(new Date());
          setSaveError(null);
          setSaveStatus("idle");
          return true;
        }
        if (r.conflict) {
          conflictRef.current = true;
          setConflict(true);
        }
        setSaveError(r.error);
        setSaveStatus("error");
        return false;
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e));
        setSaveStatus("error");
        return false;
      } finally {
        savingRef.current = false;
      }
    },
    [lead.id]
  );

  // 자동 저장 — 마지막 변경 2초 뒤. 저장 중에 또 바뀌면 저장이 끝난 뒤(savedSnap 이 바뀐 뒤) 다시 잰다
  useEffect(() => {
    if (conflict || !dirty || saveStatus === "saving") return;
    if (saveStatus === "error") return; // 실패하면 다음 변경이나 '다시 저장'까지 멈춘다
    const t = setTimeout(() => void doSave(present), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [present, dirty, conflict, saveStatus, doSave]);

  // 저장 안 된 변경이 있으면 창을 닫기 전에 묻는다
  useEffect(() => {
    if (!dirty && saveStatus !== "saving") return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty, saveStatus]);

  /** 저장 대기 중인 변경을 지금 저장한다 (PDF·AI 다시 쓰기 전에) */
  const flush = useCallback(async (): Promise<boolean> => {
    // 자동 저장이 도는 중이면 끝나기를 기다린다 (최대 15초)
    for (let i = 0; i < 150 && savingRef.current; i++) await new Promise((r) => setTimeout(r, 100));
    if (conflictRef.current || savingRef.current) return false;
    if (presentRef.current === savedRef.current) return true;
    return doSave(presentRef.current);
  }, [doSave]);

  /** 서버가 원고를 갈아 끼웠다 — 기록에 한 칸으로 넣고 저장된 판으로 친다 */
  const loadServerDoc = useCallback(
    (doc: DocLike) => {
      const snap = snapOf(doc, org);
      revRef.current = doc.rev;
      dispatch({ type: "commit", snap, at: Date.now() });
      presentRef.current = snap;
      savedRef.current = snap;
      setSavedSnap(snap);
      setSavedAt(new Date());
      setSaveStatus("idle");
      setSaveError(null);
      setSelection(null);
      setEditing(null);
    },
    [org]
  );

  /* ── 크기 맞춤 ── */

  useEffect(() => {
    const sc = scrollRef.current;
    const bk = bookRef.current;
    if (!sc || !bk) return;
    const measure = () => {
      const avail = sc.clientWidth - 32;
      const want = PAGE_W_PX + SHEET_PAD_PX * 2;
      setScale(Math.max(0.3, Math.min(1, avail / want)));
      setBookH(bk.offsetHeight);
    };
    // ResizeObserver 는 observe 직후 한 번 부른다 — 첫 측정도 거기서
    const ro = new ResizeObserver(measure);
    ro.observe(sc);
    ro.observe(bk);
    return () => ro.disconnect();
  }, []);

  /* ── 넘침 ── */

  const measureOverflow = useCallback(() => {
    const root = bookRef.current;
    if (!root) return;
    const over: PageId[] = [];
    root.querySelectorAll<HTMLElement>("section[data-page]").forEach((sec) => {
      const r = sec.getBoundingClientRect();
      const k = r.height ? sec.offsetHeight / r.height : 1;
      const bottoms: number[] = [];
      sec.querySelectorAll<HTMLElement>("*").forEach((el) => {
        // 이미지 칸 안(확대한 그림·편집 단추)은 칸이 잘라 주므로 세지 않는다
        if (el.parentElement?.closest(".img")) return;
        const cr = el.getBoundingClientRect();
        if (cr.height > 0) bottoms.push((cr.bottom - r.top) * k);
      });
      if (isOverflowing({ scrollHeight: sec.scrollHeight, clientHeight: sec.clientHeight, bottom: sec.offsetHeight }, bottoms)) {
        over.push(sec.dataset.page as PageId);
      }
    });
    setOverflow((prev) => (prev.join() === over.join() ? prev : over));
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(measureOverflow);
    return () => cancelAnimationFrame(id);
  }, [present, editing, scale, measureOverflow]);

  useEffect(() => {
    // 서체·그림이 늦게 실리면 지면 높이가 바뀐다
    const fonts = document.fonts;
    const onFonts = () => measureOverflow();
    fonts?.addEventListener?.("loadingdone", onFonts);
    void fonts?.ready.then(onFonts);
    const root = bookRef.current;
    const onLoad = () => measureOverflow();
    root?.addEventListener("load", onLoad, true);
    return () => {
      fonts?.removeEventListener?.("loadingdone", onFonts);
      root?.removeEventListener("load", onLoad, true);
    };
  }, [measureOverflow]);

  /* ── 단축키 ── */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && ((k === "z" && e.shiftKey) || (k === "y" && e.ctrlKey))) {
        e.preventDefault();
        redo();
      } else if (e.key === "Escape") {
        setSelection(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  /* ── 칸 조작 ── */

  const uploadImage = useCallback(
    async (path: string, file: File) => {
      setUploads((u) => ({ ...u, [path]: { busy: true, error: null } }));
      try {
        if (!file.type.startsWith("image/")) throw new Error("이미지 파일만 올릴 수 있습니다.");
        const prepared = await prepareImageForUpload(file);
        const fd = new FormData();
        fd.append("file", prepared.file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const body = (await res.json().catch(() => ({}))) as { url?: unknown; error?: unknown };
        if (!res.ok || typeof body.url !== "string") {
          const msg =
            typeof body.error === "string" && body.error
              ? body.error
              : res.status === 413
                ? "파일이 너무 큽니다."
                : `업로드하지 못했습니다 (HTTP ${res.status}).`;
          throw new Error(msg);
        }
        const url = body.url;
        commit((s) => ({ ...s, content: setAt(s.content, path, { url, fit: "cover", zoom: 1, x: 50, y: 50 }) }));
        setUploads((u) => ({ ...u, [path]: { busy: false, error: null } }));
      } catch (e) {
        setUploads((u) => ({ ...u, [path]: { busy: false, error: e instanceof Error ? e.message : String(e) } }));
      }
    },
    [commit]
  );

  const ctx: EdCtxValue = useMemo(
    () => ({
      content,
      selection,
      editing,
      uploads,
      startEdit: (path, inst, page) => {
        setSelection({ kind: "field", path, inst });
        setEditing({ path, inst });
        if (page) setCurrentPage(page);
      },
      commitText: (path, value) => {
        setEditing((cur) => (cur?.path === path ? null : cur));
        commit((s) => (getAt(s.content, path) === value ? null : { ...s, content: setAt(s.content, path, value) }));
      },
      cancelEdit: () => setEditing(null),
      selectImage: (path, page) => {
        setSelection({ kind: "image", path });
        setEditing(null);
        if (page) setCurrentPage(page);
      },
      updateImage: (path, img, key) => commit((s) => ({ ...s, content: setAt(s.content, path, img) }), key),
      uploadImage: (path, file) => void uploadImage(path, file),
    }),
    [content, selection, editing, uploads, commit, uploadImage]
  );

  const renderField = useCallback((path: string, kind: FieldKind, node: ReactNode) => <FieldSlot path={path} kind={kind} node={node} />, []);
  const renderImage = useCallback(
    (path: string, value: unknown, hint: string) => <ImageSlot path={path} value={value} hint={hint} />,
    []
  );

  /* ── 빈칸·넘침 ── */

  const tbdHits = useMemo(() => listTbd(content), [content]);
  const tbdOrdered = useMemo(() => orderedTbd(tbdHits, pages), [tbdHits, pages]);
  const tbdByPage = useMemo(() => tbdCountByPage(tbdHits), [tbdHits]);

  const scrollToPath = (path: string) => {
    const el = bookRef.current?.querySelector(`[data-path="${CSS.escape(path)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const scrollToPage = (id: PageId) => {
    setCurrentPage(id);
    bookRef.current?.querySelector(`section[data-page="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const nextTbd = () => {
    if (tbdOrdered.length === 0) return;
    const hit = tbdOrdered[tbdCursor.current % tbdOrdered.length];
    tbdCursor.current += 1;
    setEditing(null);
    setSelection({ kind: "field", path: hit.path, inst: null });
    if (hit.page) setCurrentPage(hit.page);
    scrollToPath(hit.path);
  };

  /* ── 목록 조작 ── */

  const listAdd = (listPath: string) => commit((s) => addItem(s, listPath));
  const listRemove = (listPath: string, index: number) => {
    setEditing(null);
    setSelection(null);
    commit((s) => removeItem(s, listPath, index));
  };
  const listMove = (listPath: string, index: number, dir: -1 | 1) => {
    setEditing(null);
    // 선택한 칸이 옮긴 항목 안이면 선택도 따라간다
    setSelection((sel) => {
      if (!sel) return sel;
      const prefix = `${listPath}.`;
      if (!sel.path.startsWith(prefix)) return sel;
      const m = /^(\d+)((?:\..*)?)$/.exec(sel.path.slice(prefix.length));
      if (!m) return sel;
      const i = Number(m[1]);
      const to = i === index ? index + dir : i === index + dir ? index : i;
      return { ...sel, path: `${prefix}${to}${m[2]}` } as Selection;
    });
    commit((s) => moveItem(s, listPath, index, dir));
  };

  /* ── 큰 조치 ── */

  const runRegenerate = async () => {
    setRegen("running");
    setActionError(null);
    setEditing(null);
    if (!(await flush())) {
      setRegen("idle");
      setActionError("저장되지 않은 변경이 있어 다시 쓰기를 멈췄습니다. 저장 상태를 확인해 주세요.");
      return;
    }
    const r = await callGenerate(lead.id, "regenerate", revRef.current);
    setRegen("idle");
    if (!r.ok) {
      if (r.conflict) {
        conflictRef.current = true;
        setConflict(true);
      }
      setActionError(r.error);
      return;
    }
    loadServerDoc(r.doc);
    setNotice(r.notice ?? (r.source === "fallback" ? "AI 초안을 쓰지 못해 옛 본문으로 채웠습니다." : "AI가 원고를 새로 썼습니다. 이미지는 그대로 두었습니다."));
  };

  const runReset = async () => {
    setResetArm("running");
    setActionError(null);
    setEditing(null);
    if (!(await flush())) {
      setResetArm("idle");
      setActionError("저장되지 않은 변경이 있어 멈췄습니다. 저장 상태를 확인해 주세요.");
      return;
    }
    const r = await resetToFallback(lead.id, revRef.current);
    setResetArm("idle");
    if (!r.ok) {
      if (r.conflict) {
        conflictRef.current = true;
        setConflict(true);
      }
      setActionError(r.error);
      return;
    }
    loadServerDoc(r.doc);
    setNotice("옛 본문으로 만든 초안으로 다시 채웠습니다. 되돌리기로 앞 판을 다시 불러올 수 있습니다.");
  };

  const openPdf = async () => {
    // 팝업 차단을 피하려고 창은 누른 순간 열고, 저장이 끝난 뒤 주소를 넣는다
    const w = window.open("", "_blank");
    const ok = await flush();
    const url = `/admin/outreach/${lead.id}/proposal/print`;
    if (!ok) {
      w?.close();
      setActionError("저장하지 못해 PDF를 열지 않았습니다. 저장 상태를 확인해 주세요.");
      return;
    }
    if (w) w.location.href = url;
    else window.open(url, "_blank");
  };

  /* ── 키컬러·서체 ── */

  const setStyle = (fn: (st: BookStyle) => BookStyle, key?: string) => commit((s) => ({ ...s, style: fn(s.style) }), key);
  const setPages = (fn: (p: BookPage[]) => BookPage[]) =>
    commit((s) => {
      const next = fn(s.pages);
      return next === s.pages ? null : { ...s, pages: next };
    });

  /* ── 저장 상태 표시 ── */

  let saveLabel: string;
  let saveTone: string;
  if (conflict) {
    saveLabel = "저장 안 됨 · 충돌";
    saveTone = "text-red-600";
  } else if (saveStatus === "saving") {
    saveLabel = "저장 중";
    saveTone = "text-slate-500";
  } else if (saveStatus === "error") {
    saveLabel = "저장 안 됨";
    saveTone = "text-red-600";
  } else if (dirty) {
    saveLabel = "저장 안 됨";
    saveTone = "text-amber-600";
  } else {
    saveLabel = savedAt ? `저장됨 · ${fmtTime(savedAt)}` : "저장됨";
    saveTone = "text-emerald-700";
  }

  const btn = "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1E22B2]";
  const sel = "rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1E22B2]";

  const busy = regen === "running" || resetArm === "running";

  return (
    <EdCtx.Provider value={ctx}>
      <div className="flex h-screen flex-col bg-slate-100 text-slate-900">
        {/* ── 도구막대 ── */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-4 py-2">
          <Link href="/admin/outreach" className="text-sm text-slate-500 hover:text-slate-800">
            ← 제안 영업
          </Link>
          <p className="max-w-[14rem] truncate text-sm font-bold" title={content.org}>
            {lead.org || content.org} 제안서
          </p>
          <span className={`text-xs font-semibold ${saveTone}`} role="status" aria-live="polite" title={saveError ?? undefined}>
            {saveLabel}
          </span>
          {saveStatus === "error" && !conflict && (
            <button type="button" className={btn} onClick={() => void doSave(present)}>
              다시 저장
            </button>
          )}

          <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
          <button type="button" className={btn} onClick={undo} disabled={hist.past.length === 0} title="되돌리기 (Ctrl+Z)">
            되돌리기
          </button>
          <button type="button" className={btn} onClick={redo} disabled={hist.future.length === 0} title="다시하기 (Ctrl+Shift+Z)">
            다시하기
          </button>

          <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            제목 서체
            <select className={sel} value={style.headingFont} onChange={(e) => { const v = e.target.value; setStyle((st) => ({ ...st, headingFont: v })); }}>
              {HEADING_FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            본문 서체
            <select className={sel} value={style.bodyFont} onChange={(e) => { const v = e.target.value; setStyle((st) => ({ ...st, bodyFont: v })); }}>
              {BODY_FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1" role="group" aria-label="키컬러">
            <span className="text-xs text-slate-500">키컬러</span>
            {KEY_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`키컬러 ${c}`}
                aria-pressed={style.keyColor.toLowerCase() === c.toLowerCase()}
                onClick={() => setStyle((st) => ({ ...st, keyColor: c }))}
                className="h-5 w-5 rounded-full border border-white ring-1 ring-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1E22B2] aria-pressed:ring-2 aria-pressed:ring-slate-900"
                style={{ background: c }}
              />
            ))}
            <label className="ml-0.5 flex items-center" title="직접 고르기">
              <span className="sr-only">키컬러 직접 고르기</span>
              <input
                type="color"
                value={style.keyColor}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^#[0-9a-fA-F]{6}$/.test(v)) setStyle((st) => ({ ...st, keyColor: v.toUpperCase() }), "keyColor");
                }}
                className="h-6 w-7 cursor-pointer rounded border border-slate-200 bg-white p-0.5"
              />
            </label>
          </div>

          <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
          <button
            type="button"
            className={`${btn} ${tbdOrdered.length ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100" : ""}`}
            onClick={nextTbd}
            disabled={tbdOrdered.length === 0}
            title="다음 빈칸으로"
          >
            빈칸 {tbdOrdered.length}개{tbdOrdered.length > 0 && " · 다음 빈칸"}
          </button>
          <button
            type="button"
            className={`${btn} ${overflow.length ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100" : ""}`}
            onClick={() => overflow[0] && scrollToPage(overflow[0])}
            disabled={overflow.length === 0}
            title="글이 지면을 넘친 쪽"
          >
            넘침 {overflow.length}쪽
          </button>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {resetArm === "armed" ? (
              <span className="flex items-center gap-1.5">
                <span className="text-xs text-red-600">지금 원고를 옛 본문 초안으로 바꿉니다</span>
                <button type="button" className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700" onClick={() => void runReset()}>
                  바꾸기
                </button>
                <button type="button" className={btn} onClick={() => setResetArm("idle")}>
                  취소
                </button>
              </span>
            ) : (
              <button type="button" className={btn} onClick={() => { setRegen("idle"); setResetArm("armed"); }} disabled={busy || conflict}>
                {resetArm === "running" ? "채우는 중…" : "옛 초안으로 채우기"}
              </button>
            )}
            {regen === "armed" ? (
              <span className="flex items-center gap-1.5">
                <span className="text-xs text-red-600">글을 새로 씁니다 (이미지는 유지)</span>
                <button type="button" className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700" onClick={() => void runRegenerate()}>
                  다시 쓰기
                </button>
                <button type="button" className={btn} onClick={() => setRegen("idle")}>
                  취소
                </button>
              </span>
            ) : (
              <button type="button" className={btn} onClick={() => { setResetArm("idle"); setRegen("armed"); }} disabled={busy || conflict}>
                AI로 다시 쓰기
              </button>
            )}
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-xs font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1E22B2] disabled:opacity-50"
              style={{ background: BRAND }}
              onClick={() => void openPdf()}
              disabled={busy || conflict}
            >
              PDF
            </button>
          </div>
        </div>

        {/* ── 알림 띠 ── */}
        {conflict && (
          <div className="flex flex-wrap items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">
            다른 창에서 저장된 판이 있습니다 — 새로고침하면 그 판을 불러옵니다
            <button type="button" className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white" onClick={() => window.location.reload()}>
              새로고침
            </button>
          </div>
        )}
        {actionError && (
          <div className="flex items-start gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">
            <span className="flex-1 whitespace-pre-wrap">{actionError}</span>
            <button type="button" className="text-xs font-semibold underline" onClick={() => setActionError(null)}>
              닫기
            </button>
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800" role="status">
            <span className="flex-1 whitespace-pre-wrap">{notice}</span>
            <button type="button" className="text-xs font-semibold underline" onClick={() => setNotice(null)}>
              닫기
            </button>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          {/* ── 쪽 목록 ── */}
          <nav className="w-56 flex-shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-2" aria-label="쪽 목록">
            <p className="px-2 pb-1 pt-1 text-[11px] font-semibold tracking-wide text-slate-400">쪽</p>
            <ol className="space-y-0.5">
              {pages.map((p, i) => {
                const def = pageDef(p.id);
                const tbd = tbdByPage[p.id] ?? 0;
                const over = overflow.includes(p.id);
                return (
                  <li
                    key={p.id}
                    className={`flex items-center gap-1 rounded-lg px-1.5 py-1 ${currentPage === p.id ? "bg-slate-100" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={!p.hidden}
                      disabled={def.fixed}
                      onChange={() => setPages((ps) => togglePage(ps, p.id))}
                      aria-label={`${def.name} 보이기`}
                      title={def.fixed ? "표지·뒤표지는 숨길 수 없습니다" : "보이기 / 숨기기"}
                      className="h-3.5 w-3.5 accent-[#1E22B2]"
                    />
                    <button
                      type="button"
                      onClick={() => scrollToPage(p.id)}
                      className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1E22B2] ${p.hidden ? "text-slate-400 line-through" : "text-slate-800"}`}
                    >
                      <span className="w-5 text-[11px] tabular-nums text-slate-400">{String(i + 1).padStart(2, "0")}</span>
                      <span className="truncate">{def.name}</span>
                      {over && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500" title="넘침" aria-label="넘침" />}
                      {tbd > 0 && (
                        <span className="flex-shrink-0 rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800" title={`빈칸 ${tbd}개`}>
                          {tbd}
                        </span>
                      )}
                    </button>
                    {!def.fixed && (
                      <span className="flex flex-shrink-0">
                        <button
                          type="button"
                          aria-label={`${def.name} 위로`}
                          disabled={!canMovePage(pages, p.id, -1)}
                          onClick={() => setPages((ps) => movePage(ps, p.id, -1))}
                          className="rounded px-1 text-xs text-slate-500 hover:bg-slate-200 disabled:opacity-25"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`${def.name} 아래로`}
                          disabled={!canMovePage(pages, p.id, 1)}
                          onClick={() => setPages((ps) => movePage(ps, p.id, 1))}
                          className="rounded px-1 text-xs text-slate-500 hover:bg-slate-200 disabled:opacity-25"
                        >
                          ↓
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
            <p className="mt-3 px-2 text-[11px] leading-relaxed text-slate-400">
              숨긴 쪽은 흐리게 보이고 PDF 에서 빠집니다. 표지·뒤표지는 고정입니다.
            </p>
          </nav>

          {/* ── 지면 ── */}
          <div
            ref={scrollRef}
            className="min-w-0 flex-1 overflow-auto bg-[#8A8E99]"
            onClick={(e) => {
              const page = pageOfEl(e.target as Element);
              if (page) setCurrentPage(page);
              setSelection(null);
              setEditing(null);
            }}
          >
            <div className="mx-auto" style={{ width: (PAGE_W_PX + SHEET_PAD_PX * 2) * scale, height: bookH * scale }}>
              <div
                ref={bookRef}
                style={{ width: PAGE_W_PX + SHEET_PAD_PX * 2, transform: `scale(${scale})`, transformOrigin: "top left" }}
              >
                {overflow.length > 0 && (
                  <style>{overflow.map((id) => `.pb-root section[data-page="${id}"]`).join(",") + "{outline:3px solid #EF4444;outline-offset:2px}"}</style>
                )}
                <BookPages content={content} style={style} pages={pages} mode="edit" renderField={renderField} renderImage={renderImage} />
              </div>
            </div>
          </div>

          {/* ── 속성 ── */}
          <aside className="w-72 flex-shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4" aria-label="속성">
            <Inspector
              content={content}
              style={style}
              selection={selection}
              currentPage={currentPage}
              uploads={uploads}
              btn={btn}
              sel={sel}
              onStyle={setStyle}
              onImage={(path, img, key) => commit((s) => ({ ...s, content: setAt(s.content, path, img) }), key)}
              onUpload={(path, f) => void uploadImage(path, f)}
              onPick={(i) => commit((s) => ({ ...s, content: setPick(s.content, i) }))}
              onAdd={listAdd}
              onRemove={listRemove}
              onMove={listMove}
            />
          </aside>
        </div>

        {busy && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80" role="status" aria-live="polite">
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg">
              <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-slate-200" style={{ borderTopColor: BRAND }} aria-hidden />
              <p className="mt-4 font-bold">{regen === "running" ? "AI가 원고를 다시 쓰고 있습니다" : "옛 초안으로 채우는 중입니다"}</p>
              <p className="mt-1 text-sm text-slate-500">{regen === "running" ? "최대 1분 30초쯤 걸립니다. 창을 닫지 마세요." : "잠시만 기다려 주세요."}</p>
            </div>
          </div>
        )}
      </div>
    </EdCtx.Provider>
  );
}

/* ── 오른쪽 속성 패널 ────────────────────────────────────────── */

function Inspector({
  content,
  style,
  selection,
  currentPage,
  uploads,
  btn,
  sel,
  onStyle,
  onImage,
  onUpload,
  onPick,
  onAdd,
  onRemove,
  onMove,
}: {
  content: BookContent;
  style: BookStyle;
  selection: Selection;
  currentPage: PageId;
  uploads: Record<string, UploadState>;
  btn: string;
  sel: string;
  onStyle: (fn: (st: BookStyle) => BookStyle, key?: string) => void;
  onImage: (path: string, img: ImageObject, key?: string) => void;
  onUpload: (path: string, f: File) => void;
  onPick: (i: number) => void;
  onAdd: (listPath: string) => void;
  onRemove: (listPath: string, index: number) => void;
  onMove: (listPath: string, index: number, dir: -1 | 1) => void;
}) {
  const h = "text-[11px] font-semibold tracking-wide text-slate-400";
  const pageLists = topListsOfPage(currentPage);

  return (
    <div className="space-y-6 text-sm">
      {!selection && <p className="text-slate-500">지면의 칸을 누르면 여기에서 서체·크기·항목을 고칩니다.</p>}

      {selection?.kind === "field" && (
        <FieldPanel
          key={selection.path}
          path={selection.path}
          content={content}
          style={style}
          btn={btn}
          sel={sel}
          onStyle={onStyle}
          onPick={onPick}
          onAdd={onAdd}
          onRemove={onRemove}
          onMove={onMove}
        />
      )}

      {selection?.kind === "image" && (
        <ImagePanel
          key={selection.path}
          path={selection.path}
          value={getAt(content, selection.path)}
          upload={uploads[selection.path]}
          btn={btn}
          onImage={onImage}
          onUpload={onUpload}
        />
      )}

      {pageLists.length > 0 && (
        <section className="space-y-4 border-t border-slate-100 pt-4">
          <p className={h}>이 쪽의 목록 · {pageDef(currentPage).name}</p>
          {pageLists.map((def) => (
            <ListBlock
              key={def.pattern}
              def={def}
              listPath={def.pattern}
              content={content}
              btn={btn}
              onPick={onPick}
              onAdd={onAdd}
              onRemove={onRemove}
              onMove={onMove}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function FieldPanel({
  path,
  content,
  style,
  btn,
  sel,
  onStyle,
  onPick,
  onAdd,
  onRemove,
  onMove,
}: {
  path: string;
  content: BookContent;
  style: BookStyle;
  btn: string;
  sel: string;
  onStyle: (fn: (st: BookStyle) => BookStyle, key?: string) => void;
  onPick: (i: number) => void;
  onAdd: (listPath: string) => void;
  onRemove: (listPath: string, index: number) => void;
  onMove: (listPath: string, index: number, dir: -1 | 1) => void;
}) {
  const role = fontRoleOfPath(path);
  const options = role === "heading" ? HEADING_FONTS : BODY_FONTS;
  const ov = style.overrides[path] ?? {};
  const pct = Math.round((ov.scale ?? 1) * 100);
  const base = role === "heading" ? style.headingFont : style.bodyFont;
  const baseLabel = findFont(base)?.label ?? "기본";
  // 덮어쓴 서체가 다른 목록(제목↔본문)의 것이면 목록에 끼워 보여 준다
  const extra = ov.font && !options.some((f) => f.id === ov.font) ? findFont(ov.font) : undefined;
  const fontId = useId();
  const sizeId = useId();
  const lists = listsOfPath(path);
  const tierMatch = /^pricing\.tiers\.(\d+)\./.exec(path);
  const tierIdx = tierMatch ? Number(tierMatch[1]) : -1;
  const h = "text-[11px] font-semibold tracking-wide text-slate-400";

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div>
          <p className={h}>선택한 칸</p>
          <p className="mt-0.5 font-semibold text-slate-900">{describePath(path)}</p>
          <p className="mt-0.5 text-xs text-slate-400">Enter 확정 · Esc 취소 · **굵게** · [확인 필요: …] 빈칸</p>
        </div>
        <div>
          <label htmlFor={fontId} className="text-xs text-slate-500">
            서체 ({role === "heading" ? "제목용" : "본문용"})
          </label>
          <select
            id={fontId}
            className={`${sel} mt-1 w-full`}
            value={ov.font ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              onStyle((st) => setOverride(st, path, { font: v || undefined }));
            }}
            style={{ fontFamily: fontStack(ov.font ?? base, role) }}
          >
            <option value="">전체 설정 따름 ({baseLabel})</option>
            {extra && <option value={extra.id}>{extra.label}</option>}
            {options.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label htmlFor={sizeId} className="text-xs text-slate-500">
              글자 크기
            </label>
            <output htmlFor={sizeId} className="text-xs font-semibold tabular-nums text-slate-700">
              {pct}%
            </output>
          </div>
          <input
            id={sizeId}
            type="range"
            min={70}
            max={140}
            step={5}
            value={pct}
            onChange={(e) => {
              const v = Number(e.target.value) / 100;
              onStyle((st) => setOverride(st, path, { scale: v }), `scale:${path}`);
            }}
            className="mt-1 w-full accent-[#1E22B2]"
          />
        </div>
        <button
          type="button"
          className={btn}
          disabled={!ov.font && ov.scale == null}
          onClick={() => onStyle((st) => setOverride(st, path, null))}
        >
          기본으로
        </button>
      </section>

      {tierIdx >= 0 && (
        <section className="space-y-2 border-t border-slate-100 pt-4">
          <p className={h}>견적 구간 {tierIdx + 1}</p>
          <button
            type="button"
            className={btn}
            disabled={!!content.pricing.tiers[tierIdx]?.pick}
            onClick={() => onPick(tierIdx)}
          >
            {content.pricing.tiers[tierIdx]?.pick ? "추천 구간입니다" : "추천 구간으로"}
          </button>
        </section>
      )}

      {lists.map((hit) => {
        const n = listLength(content, hit.listPath);
        return (
          <section key={hit.listPath} className="space-y-2 border-t border-slate-100 pt-4">
            <p className={h}>
              {hit.def.label} · {hit.index + 1}번째
            </p>
            <p className="text-xs text-slate-500">
              지금 {n}개 · 한도 {limitLabel(hit.def)}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={btn} disabled={hit.index === 0} onClick={() => onMove(hit.listPath, hit.index, -1)}>
                위로
              </button>
              <button type="button" className={btn} disabled={hit.index >= n - 1} onClick={() => onMove(hit.listPath, hit.index, 1)}>
                아래로
              </button>
              <button
                type="button"
                className={`${btn} text-red-600`}
                disabled={!canRemove(content, hit.listPath)}
                onClick={() => onRemove(hit.listPath, hit.index)}
              >
                이 항목 삭제
              </button>
              <button type="button" className={btn} disabled={!canAdd(content, hit.listPath)} onClick={() => onAdd(hit.listPath)}>
                항목 추가
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ListBlock({
  def,
  listPath,
  content,
  btn,
  onPick,
  onAdd,
  onRemove,
  onMove,
}: {
  def: ListDef;
  listPath: string;
  content: BookContent;
  btn: string;
  onPick: (i: number) => void;
  onAdd: (listPath: string) => void;
  onRemove: (listPath: string, index: number) => void;
  onMove: (listPath: string, index: number, dir: -1 | 1) => void;
}) {
  const arr = getAt(content, listPath);
  const items = Array.isArray(arr) ? arr : [];
  const removable = canRemove(content, listPath);
  const isTiers = listPath === "pricing.tiers";
  const mini = "rounded px-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1E22B2]";
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="font-semibold text-slate-800">{def.label}</p>
        <p className="text-[11px] text-slate-400">
          {items.length}개 · {limitLabel(def)}
        </p>
      </div>
      <ol className="mt-1 space-y-0.5">
        {items.map((it, i) => {
          const label = itemLabel(it);
          const picked = isTiers && !!(it as { pick?: boolean }).pick;
          return (
            <li key={i} className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-50">
              <span className="w-4 text-[11px] tabular-nums text-slate-400">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-700" title={label}>
                {label}
              </span>
              {isTiers && (
                <button
                  type="button"
                  className={`${mini} ${picked ? "font-bold text-[#1E22B2]" : ""}`}
                  aria-pressed={picked}
                  aria-label={`${i + 1}번 구간을 추천 구간으로`}
                  onClick={() => onPick(i)}
                  disabled={picked}
                >
                  {picked ? "추천" : "추천으로"}
                </button>
              )}
              <button type="button" className={mini} aria-label={`${i + 1}번 위로`} disabled={i === 0} onClick={() => onMove(listPath, i, -1)}>
                ↑
              </button>
              <button
                type="button"
                className={mini}
                aria-label={`${i + 1}번 아래로`}
                disabled={i === items.length - 1}
                onClick={() => onMove(listPath, i, 1)}
              >
                ↓
              </button>
              <button type="button" className={`${mini} text-red-500`} aria-label={`${i + 1}번 삭제`} disabled={!removable} onClick={() => onRemove(listPath, i)}>
                ✕
              </button>
            </li>
          );
        })}
      </ol>
      <button type="button" className={`${btn} mt-1.5`} disabled={!canAdd(content, listPath)} onClick={() => onAdd(listPath)}>
        + 항목 추가
      </button>
    </div>
  );
}

function ImagePanel({
  path,
  value,
  upload,
  btn,
  onImage,
  onUpload,
}: {
  path: string;
  value: unknown;
  upload: UploadState | undefined;
  btn: string;
  onImage: (path: string, img: ImageObject, key?: string) => void;
  onUpload: (path: string, f: File) => void;
}) {
  const img = normalizeImage(value);
  const show = hasImage(value);
  const fileId = useId();
  const zoomId = useId();
  const xId = useId();
  const yId = useId();
  const h = "text-[11px] font-semibold tracking-wide text-slate-400";
  const set = (patch: Partial<ImageObject>, key?: string) => onImage(path, patchImage(value, patch), key);

  return (
    <section className="space-y-4">
      <div>
        <p className={h}>선택한 이미지</p>
        <p className="mt-0.5 font-semibold text-slate-900">{describePath(path)}</p>
        {!show && <p className="mt-1 text-xs text-slate-500">{img.url ? `‘${img.url}’ 파일이 아직 없습니다.` : "비어 있습니다."}</p>}
      </div>
      <div>
        <label htmlFor={fileId} className={`${btn} inline-block cursor-pointer`}>
          {upload?.busy ? "올리는 중…" : show ? "이미지 바꾸기" : "이미지 올리기"}
        </label>
        <input
          id={fileId}
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={upload?.busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onUpload(path, f);
          }}
        />
        {upload?.error && (
          <p className="mt-1 text-xs text-red-600" role="alert">
            {upload.error}
          </p>
        )}
      </div>

      {show && (
        <>
          <fieldset>
            <legend className="text-xs text-slate-500">맞춤</legend>
            <div className="mt-1 flex gap-1.5">
              {(
                [
                  ["cover", "채우기"],
                  ["contain", "전체 보이기"],
                ] as const
              ).map(([fit, label]) => (
                <button
                  key={fit}
                  type="button"
                  aria-pressed={img.fit === fit}
                  className={`${btn} ${img.fit === fit ? "border-[#1E22B2] text-[#1E22B2]" : ""}`}
                  onClick={() => set({ fit })}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <Slider id={zoomId} label="확대" min={100} max={300} step={5} value={Math.round(img.zoom * 100)} unit="%" onChange={(v) => set({ zoom: v / 100 }, `zoom:${path}`)} />
          <Slider id={xId} label="위치 X" min={0} max={100} step={1} value={Math.round(img.x)} unit="%" onChange={(v) => set({ x: v }, `x:${path}`)} />
          <Slider id={yId} label="위치 Y" min={0} max={100} step={1} value={Math.round(img.y)} unit="%" onChange={(v) => set({ y: v }, `y:${path}`)} />
          <p className="text-xs text-slate-400">지면의 그림을 끌어도 위치가 바뀝니다.</p>
          <button type="button" className={`${btn} text-red-600`} onClick={() => onImage(path, { url: "", fit: "cover", zoom: 1, x: 50, y: 50 })}>
            지우기
          </button>
        </>
      )}
    </section>
  );
}

function Slider({
  id,
  label,
  min,
  max,
  step,
  value,
  unit,
  onChange,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-xs text-slate-500">
          {label}
        </label>
        <output htmlFor={id} className="text-xs font-semibold tabular-nums text-slate-700">
          {value}
          {unit}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-[#1E22B2]"
      />
    </div>
  );
}
