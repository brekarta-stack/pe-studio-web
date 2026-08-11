"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import ImageExtension from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";

/**
 * 본문 이미지에 정렬(left/center/right) + 크기(small/medium/large/full) attribute 추가.
 * data-* 속성으로 보존되어 ReactMarkdown(rehype-raw) 미리보기·실제 발행 페이지에
 * 동일 className 형태로 그대로 전달됨.
 */
const ImageWithAttrs = ImageExtension.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: "center",
        parseHTML: (el) => el.getAttribute("data-align") || "center",
        renderHTML: (attrs) => ({
          "data-align": attrs.align,
          class: `img-align-${attrs.align} img-size-${attrs.size || "large"}`,
        }),
      },
      size: {
        default: "large",
        parseHTML: (el) => el.getAttribute("data-size") || "large",
        renderHTML: (attrs) => ({ "data-size": attrs.size }),
      },
    };
  },
});
import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { marked } from "marked";
import TurndownService from "turndown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import type { Post } from "@/lib/blog";
import { prepareImageForUpload } from "@/lib/image-resize";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

/**
 * 마크다운 전처리 — marked 가 헤딩으로 인식하도록 정규화.
 * 시드 글의 흔한 패턴: 한 줄 안에 ##/### 가 여러 개 흩어져 있음.
 *   "본문. ## 1. 헤딩... ## 2. 헤딩..."
 * → 빈 줄로 분리해서 marked 가 헤딩 처리 가능하도록.
 */
function preprocessMarkdown(raw: string): string {
  let s = raw;
  // 줄 시작 leading whitespace + #+ 정리
  s = s.replace(/^[ \t]+(#{1,6}\s)/gm, "$1");
  // 텍스트 중간의 #+ 헤딩을 빈 줄로 분리
  s = s.replace(/([^\n])\s+(#{1,6}\s+)/g, "$1\n\n$2");
  // 연속 3+ 줄바꿈 → 2개로
  s = s.replace(/\n{3,}/g, "\n\n");
  return s;
}

/**
 * 콘텐츠를 깨끗한 HTML 로 정규화 (round-trip + 전처리).
 * 1) preprocess: 줄 중간 ## 헤딩 분리
 * 2) marked: 마크다운→HTML (HTML 통과)
 * 3) turndown: HTML→마크다운 (텍스트 안 ##/** 추출)
 * 4) marked: 마크다운→HTML (모든 syntax 깨끗한 태그로)
 */
function ensureHtml(raw: string): string {
  if (!raw) return "";
  try {
    const pre   = preprocessMarkdown(raw);
    const html1 = marked.parse(pre, { async: false, gfm: true, breaks: false }) as string;
    const md    = turndown.turndown(html1);
    const html2 = marked.parse(md, { async: false, gfm: true, breaks: false }) as string;
    return html2 || raw;
  } catch {
    return raw;
  }
}

const TAGS = ["제작 과정", "교육", "이야기", "사례 연구", "소재", "디자인"];

/* ──────────────────────────────────────
 * 이미지 생성 규칙 (자동 적용)
 * 1. 한국인·한국 배경
 * 2. 실사 사진 스타일 (AI 일러스트 아님)
 * 3. 핵심 피사체 중앙 배치 (크롭 손실 최소화)
 * ────────────────────────────────────── */
const KOREA_PHOTO_RULES =
  "photorealistic DSLR photograph, South Korea Korean setting, Korean people, " +
  "candid natural lighting, sharp focus, professional photography, " +
  "subject centered in frame, not AI art not illustration not cartoon not digital painting";

function buildKoreanPhotoPrompt(userInput: string): string {
  return `${userInput.trim()}, ${KOREA_PHOTO_RULES}`;
}

function pollinationsUrl(prompt: string, w = 1200, h = 630, seed?: number): string {
  const params = new URLSearchParams({
    width: String(w),
    height: String(h),
    nologo: "true",
    model: "flux",
    ...(seed != null ? { seed: String(seed) } : {}),
  });
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;
}

/* ──────────────────────────────────────
 * 툴바 버튼
 * ────────────────────────────────────── */
function Btn({
  onClick, active, title, children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm transition-colors select-none ${
        active
          ? "bg-blue-100 text-[#1E22B2]"
          : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

/* ──────────────────────────────────────
 * 이미지 삽입 패널 (업로드 | AI 생성 | URL)
 * ────────────────────────────────────── */
function ImagePanel({
  onInsert,
  onClose,
  title = "이미지 삽입",
}: {
  onInsert: (url: string, alt?: string) => void;
  onClose: () => void;
  title?: string;
}) {
  const [tab, setTab] = useState<"upload" | "ai" | "url">("ai");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiSeed] = useState(() => Math.floor(Math.random() * 100000));
  const [previewUrl, setPreviewUrl] = useState("");
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState("");

  function generatePreview() {
    if (!aiPrompt.trim()) return;
    // 한국인·실사 규칙 자동 적용
    const fullPrompt = buildKoreanPhotoPrompt(aiPrompt.trim());
    const url = pollinationsUrl(fullPrompt, 1200, 630, aiSeed);
    setGenerating(true);
    setPreviewUrl(url);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      // 큰 사진은 클라이언트에서 자동 리사이즈 후 업로드
      const prepared = await prepareImageForUpload(file);
      const fd = new FormData();
      fd.append("file", prepared.file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        if (res.status === 413) {
          throw new Error("파일이 너무 큽니다. 더 작은 이미지를 사용해 주세요.");
        }
        throw new Error("업로드 실패");
      }
      const { url } = await res.json();
      onInsert(url, prepared.file.name);
    } catch (err) {
      alert(err instanceof Error ? err.message : "업로드 중 오류가 발생했습니다.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div className="absolute z-30 right-0 mt-1 bg-white rounded-2xl border border-slate-200 shadow-xl w-80 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 bg-slate-100 p-0.5 rounded-lg mb-4">
        {(["ai", "upload", "url"] as const).map((t) => (
          <button
            type="button"
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${
              tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t === "ai" ? "🤖 AI 생성" : t === "upload" ? "📁 업로드" : "🔗 URL"}
          </button>
        ))}
      </div>

      {/* AI 생성 탭 */}
      {tab === "ai" && (
        <div className="space-y-3">
          <div>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder={"예: 어린이들이 종이 팝업북 만드는 체험\n교실에서 학생들이 페이퍼토이 조립\n박물관 가족 체험 프로그램"}
              rows={3}
              className="w-full text-sm px-3 py-2 border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
              onKeyDown={(e) => { if (e.key === "Enter" && e.metaKey) generatePreview(); }}
            />
            <div className="mt-1.5 px-2 py-1.5 bg-blue-50 rounded-lg">
              <p className="text-[11px] text-blue-700 font-medium leading-relaxed">
                ✓ 한국인·한국 배경 자동 적용<br />
                ✓ 실사 사진 스타일 (AI 일러스트 아님)<br />
                ✓ 피사체 중앙 배치 (크롭 안전)
              </p>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">⌘Enter로 생성</p>
          </div>

          <button
            type="button"
            onClick={generatePreview}
            disabled={!aiPrompt.trim()}
            className="w-full py-2 text-sm font-semibold text-white rounded-xl disabled:opacity-40 transition-opacity hover:opacity-90"
            style={{ background: "#1E22B2" }}
          >
            이미지 생성
          </button>

          {previewUrl && (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="AI generated"
                className="w-full aspect-video object-cover rounded-xl border border-slate-200"
                onLoad={() => setGenerating(false)}
                onError={() => setGenerating(false)}
              />
              {generating && (
                <p className="text-xs text-slate-400 text-center">생성 중…</p>
              )}
              {!generating && (
                <button
                  type="button"
                  onClick={() => onInsert(previewUrl, aiPrompt)}
                  className="w-full py-2 text-sm font-semibold rounded-xl border border-blue-200 text-[#1E22B2] hover:bg-blue-50 transition-colors"
                >
                  이 이미지 사용
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* 업로드 탭 */}
      {tab === "upload" && (
        <label className="cursor-pointer block">
          <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center hover:border-blue-300 hover:bg-blue-50/30 transition-colors">
            {uploading ? (
              <div className="w-6 h-6 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin mx-auto" />
            ) : (
              <>
                <div className="text-2xl mb-2">📁</div>
                <p className="text-sm text-slate-600 font-medium">파일 선택</p>
                <p className="text-xs text-slate-400 mt-1">JPG, PNG, WebP · 최대 10MB</p>
              </>
            )}
          </div>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleUpload}
            disabled={uploading}
            className="hidden"
          />
        </label>
      )}

      {/* URL 탭 */}
      {tab === "url" && (
        <div className="space-y-3">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://..."
            className="w-full text-sm px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-300"
            onKeyDown={(e) => { if (e.key === "Enter" && urlInput) onInsert(urlInput); }}
          />
          <button
            type="button"
            onClick={() => urlInput && onInsert(urlInput)}
            disabled={!urlInput}
            className="w-full py-2 text-sm font-semibold text-white rounded-xl disabled:opacity-40 transition-opacity hover:opacity-90"
            style={{ background: "#1E22B2" }}
          >
            삽입
          </button>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────
 * 커버 이미지 영역
 * ────────────────────────────────────── */
function CoverImageSection({
  coverImage,
  onChange,
}: {
  coverImage: string;
  onChange: (url: string) => void;
}) {
  const [showPanel, setShowPanel] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-5">
      {coverImage ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={coverImage}
            alt="커버 이미지"
            className="w-full h-48 object-cover"
          />
          <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-end justify-end p-3 gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowPanel((v) => !v)}
                className="px-3 py-1.5 bg-white/90 hover:bg-white text-slate-700 text-xs font-semibold rounded-lg shadow transition-colors"
              >
                교체
              </button>
              {showPanel && (
                <ImagePanel
                  title="커버 이미지 교체"
                  onInsert={(url) => { onChange(url); setShowPanel(false); }}
                  onClose={() => setShowPanel(false)}
                />
              )}
            </div>
            <button
              type="button"
              onClick={() => onChange("")}
              className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold rounded-lg shadow transition-colors"
            >
              제거
            </button>
          </div>
        </div>
      ) : (
        <div className="p-4 flex items-center gap-3">
          <span className="text-sm font-medium text-slate-600">커버 이미지</span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowPanel((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 text-slate-600 hover:border-blue-300 hover:text-[#1E22B2] transition-colors"
            >
              <span>＋ 이미지 추가</span>
            </button>
            {showPanel && (
              <ImagePanel
                title="커버 이미지 설정"
                onInsert={(url) => { onChange(url); setShowPanel(false); }}
                onClose={() => setShowPanel(false)}
              />
            )}
          </div>
          <span className="text-xs text-slate-400">블로그 목록 및 포스트 상단에 표시됩니다</span>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────
 * 에디터 툴바
 * ────────────────────────────────────── */
function Toolbar({ editor }: { editor: Editor }) {
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [showImagePanel, setShowImagePanel] = useState(false);

  function applyLink() {
    if (linkUrl) editor.chain().focus().setLink({ href: linkUrl }).run();
    else editor.chain().focus().unsetLink().run();
    setLinkUrl("");
    setShowLinkInput(false);
  }

  function insertImage(url: string, alt?: string) {
    editor.chain().focus().setImage({ src: url, alt: alt ?? "" }).run();
    setShowImagePanel(false);
  }

  return (
    <div className="flex items-center gap-0.5 flex-wrap px-3 py-2 border-b border-slate-100 bg-slate-50/80 rounded-t-xl">
      {/* 제목 */}
      <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} title="제목2">
        <span className="font-bold text-xs">H2</span>
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} title="제목3">
        <span className="font-bold text-xs">H3</span>
      </Btn>

      <div className="w-px h-5 bg-slate-200 mx-1" />

      {/* 텍스트 서식 */}
      <Btn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="굵게 (Ctrl+B)">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M3.5 2h4a3 3 0 012 5.24A3.5 3.5 0 017.5 14H3.5a1 1 0 01-1-1V3a1 1 0 011-1zm1.5 5h2a1.5 1.5 0 000-3H5v3zm0 5h2.5a1.5 1.5 0 000-3H5v3z"/></svg>
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="기울임 (Ctrl+I)">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M6 2.75a.75.75 0 01.75-.75h5a.75.75 0 010 1.5H10.5l-3 8H9a.75.75 0 010 1.5H4a.75.75 0 010-1.5h1.5l3-8H7A.75.75 0 016 3a.75.75 0 010-.25z"/></svg>
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} title="밑줄 (Ctrl+U)">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M3 2a.75.75 0 01.75.75V7a3.25 3.25 0 006.5 0V2.75a.75.75 0 011.5 0V7a4.75 4.75 0 01-9.5 0V2.75A.75.75 0 013 2zm-1 11.5a.5.5 0 01.5-.5h11a.5.5 0 010 1h-11a.5.5 0 01-.5-.5z"/></svg>
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} title="취소선">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M2.5 8.75a.75.75 0 000 1.5h11a.75.75 0 000-1.5h-11zM6 4a2 2 0 013.41 1.41l.06.09H11a3.25 3.25 0 00-6.24-1.24L4.5 4a2 2 0 011.5-.97V4zM5.5 12a1.5 1.5 0 003 0H10a2.75 2.75 0 01-5 0H5.5z"/></svg>
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive("highlight")} title="형광펜">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M11.5 1.5l3 3-6.5 7-3.5.5.5-3.5 6.5-7zm-9 11h10a.5.5 0 010 1h-10a.5.5 0 010-1z"/></svg>
      </Btn>

      <div className="w-px h-5 bg-slate-200 mx-1" />

      {/* 블록 */}
      <Btn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} title="인용구">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M1.5 3h13a.5.5 0 010 1h-13a.5.5 0 010-1zm0 4h8a.5.5 0 010 1h-8a.5.5 0 010-1zm0 4h5a.5.5 0 010 1h-5a.5.5 0 010-1z"/></svg>
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="글머리 기호">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M2 4a1 1 0 100-2 1 1 0 000 2zm3-1.5h8a.5.5 0 010 1H5a.5.5 0 010-1zm0 5h8a.5.5 0 010 1H5a.5.5 0 010-1zM2 9a1 1 0 100-2 1 1 0 000 2zm3 3.5h8a.5.5 0 010 1H5a.5.5 0 010-1zm-3 .5a1 1 0 100-2 1 1 0 000 2z"/></svg>
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="번호 목록">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M1.5 3h.75V1.5H1.5a.5.5 0 000 1zm1.25.5a.5.5 0 000-1H1.5v1h1.25zM1 6h1.5a.5.5 0 000-1h-1a.5.5 0 000 1zm.5 4.5H1a.5.5 0 010-1h1a.5.5 0 010 1H1.5zM4.5 3h8a.5.5 0 000-1h-8a.5.5 0 000 1zm0 5h8a.5.5 0 000-1h-8a.5.5 0 000 1zm0 5h8a.5.5 0 000-1h-8a.5.5 0 000 1z"/></svg>
      </Btn>

      <div className="w-px h-5 bg-slate-200 mx-1" />

      {/* 코드 */}
      <Btn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")} title="인라인 코드">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M4.78 4.22a.75.75 0 010 1.06L2.56 7.5l2.22 2.22a.75.75 0 01-1.06 1.06l-2.75-2.75a.75.75 0 010-1.06L3.72 4.22a.75.75 0 011.06 0zm6.44 0a.75.75 0 011.06 0l2.75 2.75a.75.75 0 010 1.06l-2.75 2.75a.75.75 0 11-1.06-1.06L13.44 7.5l-2.22-2.22a.75.75 0 010-1.06zm-3.35 7.98l2-10a.75.75 0 011.47.3l-2 10a.75.75 0 11-1.47-.3z"/></svg>
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive("codeBlock")} title="코드 블록">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M1.5 3.5a.5.5 0 01.5-.5h12a.5.5 0 01.5.5v9a.5.5 0 01-.5.5H2a.5.5 0 01-.5-.5v-9zM2 4v8h12V4H2zm2.5 1.5a.5.5 0 01.707 0l2 2a.5.5 0 010 .707l-2 2a.5.5 0 01-.707-.707L6.293 7.5 4.5 5.707A.5.5 0 014.5 5zm4 3a.5.5 0 01.5-.5h2a.5.5 0 010 1h-2a.5.5 0 01-.5-.5z"/></svg>
      </Btn>

      <div className="w-px h-5 bg-slate-200 mx-1" />

      {/* 링크 */}
      {showLinkInput ? (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyLink();
              if (e.key === "Escape") { setShowLinkInput(false); setLinkUrl(""); }
            }}
            placeholder="https://"
            className="text-xs px-2 py-1 border border-slate-200 rounded-lg w-36 focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
          <button type="button" onMouseDown={applyLink} className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 font-medium">확인</button>
          <button type="button" onMouseDown={() => { setShowLinkInput(false); setLinkUrl(""); }} className="text-xs text-slate-400 hover:text-slate-600">취소</button>
        </div>
      ) : (
        <Btn
          onClick={() => {
            if (editor.isActive("link")) editor.chain().focus().unsetLink().run();
            else { setLinkUrl(editor.getAttributes("link").href ?? ""); setShowLinkInput(true); }
          }}
          active={editor.isActive("link")}
          title="링크"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M9.78 4.22a.75.75 0 010 1.06L7.56 7.5l2.22 2.22a.75.75 0 01-1.06 1.06l-2.75-2.75a.75.75 0 010-1.06L8.72 4.22a.75.75 0 011.06 0zM13.5 4a2.5 2.5 0 010 5h-2a.75.75 0 010-1.5h2a1 1 0 000-2H11a.75.75 0 010-1.5h2.5zM5 7.25H3a1 1 0 000 2h2a.75.75 0 010 1.5H3a2.5 2.5 0 010-5h2a.75.75 0 010 1.5z"/></svg>
        </Btn>
      )}

      {/* 이미지 */}
      <div className="relative">
        <Btn onClick={() => setShowImagePanel((v) => !v)} title="이미지 삽입" active={showImagePanel}>
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v9a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-9zM3.5 3a.5.5 0 00-.5.5v5.19l2.47-2.47a.75.75 0 011.06 0L8.5 8.19l1.47-1.47a.75.75 0 011.06 0L13 8.69V3.5a.5.5 0 00-.5-.5h-9zm-1 9.5a.5.5 0 00.5.5h9a.5.5 0 00.5-.5v-1.31l-2.5-2.5-1.47 1.47a.75.75 0 01-1.06 0L6 8.69 3.5 11.19V12.5zM6 6.5a.5.5 0 11-1 0 .5.5 0 011 0z"/></svg>
        </Btn>
        {showImagePanel && (
          <ImagePanel
            onInsert={insertImage}
            onClose={() => setShowImagePanel(false)}
          />
        )}
      </div>

      {/* 구분선 */}
      <Btn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="구분선">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M1.5 8a.5.5 0 01.5-.5h12a.5.5 0 010 1H2a.5.5 0 01-.5-.5z"/></svg>
      </Btn>
    </div>
  );
}

/* ──────────────────────────────────────
 * 이미지 BubbleMenu — 선택 시 위에 떠 있는 작은 툴바
 * 정렬(좌/중/우) · 크기(S/M/L/Full) · alt 편집 · 교체 · 삭제
 * ────────────────────────────────────── */
function ImageBubbleMenu({
  editor,
  onReplaceUpload,
}: {
  editor: Editor;
  onReplaceUpload: (editor: Editor, file: File, pos?: number) => void;
}) {
  const replaceInputRef = useRef<HTMLInputElement>(null);

  function setAlign(align: "left" | "center" | "right") {
    editor.chain().focus().updateAttributes("image", { align }).run();
  }
  function setSize(size: "small" | "medium" | "large" | "full") {
    editor.chain().focus().updateAttributes("image", { size }).run();
  }
  function editAlt() {
    const cur = (editor.getAttributes("image").alt as string) ?? "";
    const next = window.prompt("이미지 설명(alt) — SEO·접근성용", cur);
    if (next === null) return;
    editor.chain().focus().updateAttributes("image", { alt: next }).run();
  }
  function removeImage() {
    editor.chain().focus().deleteSelection().run();
  }

  const current = editor.getAttributes("image");
  const curAlign = (current.align as string) || "center";
  const curSize  = (current.size as string)  || "large";

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor }) => editor.isActive("image")}
    >
      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl shadow-xl p-1.5 text-sm">
        {/* 정렬 */}
        <div className="flex items-center gap-0.5 pr-1.5 border-r border-slate-200">
          {(["left", "center", "right"] as const).map((a) => (
            <button
              key={a}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); setAlign(a); }}
              title={`정렬: ${a === "left" ? "좌측" : a === "center" ? "가운데" : "우측"}`}
              className={`w-7 h-7 flex items-center justify-center rounded-md text-xs transition-colors ${
                curAlign === a ? "bg-blue-100 text-[#1E22B2]" : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              {a === "left" ? "◀" : a === "center" ? "▬" : "▶"}
            </button>
          ))}
        </div>
        {/* 크기 */}
        <div className="flex items-center gap-0.5 pr-1.5 border-r border-slate-200">
          {(["small", "medium", "large", "full"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); setSize(s); }}
              title={`크기: ${s === "small" ? "작게" : s === "medium" ? "보통" : s === "large" ? "크게" : "꽉 채우기"}`}
              className={`px-2 h-7 flex items-center justify-center rounded-md text-xs font-semibold transition-colors ${
                curSize === s ? "bg-blue-100 text-[#1E22B2]" : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              {s === "small" ? "S" : s === "medium" ? "M" : s === "large" ? "L" : "Full"}
            </button>
          ))}
        </div>
        {/* alt 편집 */}
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); editAlt(); }}
          title="이미지 설명(alt) 편집"
          className="px-2 h-7 flex items-center justify-center rounded-md text-xs text-slate-600 hover:bg-slate-100"
        >
          Alt
        </button>
        {/* 교체 */}
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); replaceInputRef.current?.click(); }}
          title="이미지 교체 (파일 선택)"
          className="px-2 h-7 flex items-center justify-center rounded-md text-xs text-slate-600 hover:bg-slate-100"
        >
          교체
        </button>
        <input
          ref={replaceInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              // 기존 이미지 삭제 후 새 이미지 삽입
              const pos = editor.state.selection.from;
              editor.chain().focus().deleteSelection().run();
              onReplaceUpload(editor, f, pos);
            }
            e.target.value = "";
          }}
        />
        {/* 삭제 */}
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); removeImage(); }}
          title="이미지 삭제"
          className="w-7 h-7 flex items-center justify-center rounded-md text-red-500 hover:bg-red-50"
        >
          🗑
        </button>
      </div>
    </BubbleMenu>
  );
}

/* ──────────────────────────────────────
 * 메인 BlogEditor
 * ────────────────────────────────────── */
interface Props { post?: Post; }

/** 실제 /blog/[slug] 페이지의 태그 색상 매핑과 일치 */
const PREVIEW_TAG_COLORS: Record<string, string> = {
  "제작 과정": "bg-orange-100 text-orange-700",
  "교육": "bg-blue-100 text-blue-700",
  "이야기": "bg-amber-100 text-amber-700",
  "사례 연구": "bg-purple-100 text-purple-700",
  "소재": "bg-green-100 text-green-700",
  "디자인": "bg-pink-100 text-pink-700",
};

/**
 * 실제 발행 페이지 구조를 그대로 미러링한 미리보기 컴포넌트.
 * /blog/[slug]/page.tsx 의 article 구조와 일치 — 커버/태그/날짜/h1/excerpt/본문.
 */
function BlogPreview({
  title, excerpt, tag, coverImage, contentHtml, createdAt,
}: {
  title: string;
  excerpt: string;
  tag: string;
  coverImage: string;
  contentHtml: string;
  createdAt: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col h-full">
      {/* 미리보기 헤더 바 */}
      <div className="bg-slate-50 px-4 py-2 text-xs text-slate-500 font-medium border-b border-slate-100 flex items-center gap-2 flex-shrink-0">
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        실시간 미리보기 — 실제 발행된 모습
      </div>
      <article className="px-6 py-8 flex-1">
        {coverImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverImage}
            alt={title || "커버"}
            className="w-full aspect-[16/7] object-cover rounded-2xl mb-6 pe-paper-shadow"
          />
        )}
        <div className="flex items-center gap-3 mb-4">
          {tag && (
            <span className={`px-3 py-1 text-xs font-semibold rounded-full ${PREVIEW_TAG_COLORS[tag] ?? "bg-slate-100 text-slate-600"}`}>
              {tag}
            </span>
          )}
          {createdAt && (
            <span className="text-xs text-slate-400">
              {new Date(createdAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })}
            </span>
          )}
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4 leading-tight">
          {title || <span className="text-slate-300">(제목 없음)</span>}
        </h1>
        {excerpt && (
          <p className="text-lg text-slate-500 leading-relaxed">{excerpt}</p>
        )}
        <div className="border-t border-slate-200 my-8" />
        <div className="prose prose-slate prose-lg max-w-none prose-headings:font-bold prose-a:text-orange-600 prose-img:rounded-xl">
          {contentHtml ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
              {contentHtml}
            </ReactMarkdown>
          ) : (
            <p style={{ color: "#94a3b8", fontStyle: "italic" }}>
              내용을 작성하면 여기에 실시간으로 표시됩니다…
            </p>
          )}
        </div>
      </article>
    </div>
  );
}

export default function BlogEditor({ post }: Props) {
  const router = useRouter();
  const [title, setTitle]       = useState(post?.title ?? "");
  const [excerpt, setExcerpt]   = useState(post?.excerpt ?? "");
  const [tag, setTag]           = useState(post?.tag ?? TAGS[0]);
  const [published, setPublished] = useState(post?.published ?? false);
  /** 자동 발행 대기열 — 비공개 글만 대상. 주간 크론이 화~목 14~16시 랜덤 슬롯에 순서대로 발행 */
  const [queued, setQueued] = useState(post?.queued ?? false);
  const [coverImage, setCoverImage] = useState(post?.coverImage ?? "");
  const [saving, setSaving]     = useState(false);
  /**
   * 초기 콘텐츠 — post.content 가 마크다운이면 HTML 로 변환해서 TipTap 에 주입.
   * 변환된 HTML 은 TipTap 에서 정상 편집되고, 저장 시에는 editor.getHTML() 으로
   * 다시 HTML 로 저장. 기존 마크다운 글은 한 번 편집·저장 시점에 HTML 로 마이그레이션됨.
   */
  const [initialContent] = useState(() => ensureHtml(post?.content ?? ""));
  /** 미리보기용 HTML — TipTap onUpdate 로 실시간 동기화 */
  const [contentHtml, setContentHtml] = useState(initialContent);
  /** 미리보기 날짜 — 신규 글은 마운트 시점 한 번 stamp (hydration mismatch 방지) */
  const [previewDate, setPreviewDate] = useState<string>(post?.createdAt ?? "");
  /** 게시일 (YYYY-MM-DD) — 블로그 목록 노출 순서 기준 (최신이 앞) */
  const initialPublishDate = (post?.createdAt ?? new Date().toISOString()).slice(0, 10);
  const [publishDate, setPublishDate] = useState<string>(initialPublishDate);
  useEffect(() => {
    if (!previewDate) setPreviewDate(new Date().toISOString());
  }, [previewDate]);

  /**
   * 본문 안 이미지 드래그앤드롭 / 클립보드 paste 업로드 핸들러.
   * 파일이 들어오면 클라이언트 리사이즈 → /api/upload → 성공 시 커서 위치에 이미지 삽입.
   */
  const handleFileInsert = useCallback(
    async (editor: Editor, file: File, pos?: number) => {
      try {
        const prepared = await prepareImageForUpload(file);
        const fd = new FormData();
        fd.append("file", prepared.file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        if (!res.ok) throw new Error("업로드 실패");
        const { url } = await res.json();
        const chain = editor.chain().focus();
        if (typeof pos === "number") chain.setTextSelection(pos);
        chain.setImage({ src: url, alt: prepared.file.name }).run();
      } catch (err) {
        alert(err instanceof Error ? err.message : "이미지 업로드 중 오류가 발생했습니다.");
      }
    },
    []
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      ImageWithAttrs.configure({ inline: false, allowBase64: false }),
      LinkExtension.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "내용을 여기에 작성하세요…" }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Highlight,
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: "tiptap-content focus:outline-none",
      },
      /**
       * 드래그앤드롭: 본문에 이미지 파일 떨어뜨리면 자동 업로드 후 삽입.
       * (URL/text drop 은 ProseMirror 기본 동작 그대로)
       */
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files || []).filter((f) =>
          f.type.startsWith("image/")
        );
        if (files.length === 0) return false;
        event.preventDefault();
        const coords = { left: event.clientX, top: event.clientY };
        const pos = view.posAtCoords(coords)?.pos;
        files.forEach((file) => {
          if (editor) handleFileInsert(editor, file, pos);
        });
        return true;
      },
      /**
       * 클립보드 paste: 이미지 데이터 있으면 업로드 후 삽입.
       */
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files || []).filter((f) =>
          f.type.startsWith("image/")
        );
        if (files.length === 0) return false;
        event.preventDefault();
        files.forEach((file) => {
          if (editor) handleFileInsert(editor, file);
        });
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      setContentHtml(editor.getHTML());
    },
  });

  /**
   * TipTap 의 content prop 은 mount 후 변경에 반응하지 않는 알려진 동작.
   * editor 인스턴스가 ready 된 후 명시적으로 setContent 를 호출해
   * 마크다운 → HTML 변환 결과가 확실히 반영되도록 보장.
   * `false` 2번째 인자 = onUpdate 트리거 안 함 (초기 주입은 사용자 편집 아님).
   */
  useEffect(() => {
    if (!editor || !initialContent) return;
    // 이미 같은 콘텐츠면 skip (re-mount 방지 + cursor reset 방지)
    const currentHtml = editor.getHTML();
    const normalize = (s: string) => s.replace(/\s+/g, "");
    if (normalize(currentHtml) === normalize(initialContent)) return;
    editor.commands.setContent(initialContent, { emitUpdate: false });
    setContentHtml(editor.getHTML());
  }, [editor, initialContent]);

  const handleSave = useCallback(
    async (pub?: boolean) => {
      if (!editor) return;
      setSaving(true);
      const isPublished = pub !== undefined ? pub : published;
      try {
        const body = {
          title,
          excerpt,
          content: editor.getHTML(),
          tag,
          emoji: "",               // 이모지 대신 커버 이미지 사용
          coverImage: coverImage || undefined,
          published: isPublished,
          queued: isPublished ? false : queued, // 공개된 글은 대기열 의미가 없음

          // 게시일 — 노출 순서 기준. 기존 글은 날짜를 바꾼 경우에만 전송해
          // 원래 게시 시각을 불필요하게 덮어쓰지 않는다.
          ...(publishDate && (!post || publishDate !== initialPublishDate)
            ? { createdAt: `${publishDate}T12:00:00.000Z` }
            : {}),
        };
        const res = post
          ? await fetch(`/api/blog/${post.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            })
          : await fetch("/api/blog", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
        if (!res.ok) throw new Error("저장 실패");
        router.push("/admin/blog");
        router.refresh();
      } catch {
        alert("저장 중 오류가 발생했습니다.");
      } finally {
        setSaving(false);
      }
    },
    [title, excerpt, tag, published, queued, coverImage, publishDate, initialPublishDate, editor, post, router]
  );

  return (
    <div className="max-w-3xl xl:max-w-[1600px] mx-auto px-4 py-10">
      {/* 헤더 — 좌우 컬럼 위 전체 폭 */}
      <div className="flex items-center justify-between mb-6">
        <button
          type="button"
          onClick={() => router.push("/admin/blog")}
          className="text-slate-500 hover:text-slate-700 text-sm"
        >
          ← 목록으로
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => handleSave(false)}
            disabled={saving}
            className="px-4 py-2 border border-slate-200 rounded-lg text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            임시저장
          </button>
          <button
            type="button"
            onClick={() => handleSave(true)}
            disabled={saving}
            className="px-5 py-2 text-white font-semibold rounded-lg text-sm transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "#1E22B2" }}
          >
            {saving ? "저장 중…" : "발행하기"}
          </button>
        </div>
      </div>

      {/* 커버 + 메타 — 풀폭 상단 (양 컬럼 위) */}
      <CoverImageSection coverImage={coverImage} onChange={setCoverImage} />

      {/* 메타 */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-5 space-y-4">
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1">제목</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="블로그 제목을 입력하세요"
            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 text-lg font-semibold"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1">요약</label>
          <textarea
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            placeholder="목록에 표시되는 짧은 설명 (1-2문장)"
            rows={2}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
          />
        </div>
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="text-sm font-medium text-slate-700 block mb-1">태그</label>
            <select
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              {TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">
              게시일 <span className="text-slate-400 font-normal">(노출 순서 기준)</span>
            </label>
            <input
              type="date"
              value={publishDate}
              onChange={(e) => {
                setPublishDate(e.target.value);
                if (e.target.value) setPreviewDate(`${e.target.value}T12:00:00.000Z`);
              }}
              title="블로그 목록 노출 순서 기준 — 최신 글이 앞에 노출됩니다"
              className="px-4 py-2.5 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer pb-2.5">
            <div
              onClick={() => setPublished((v) => !v)}
              className="w-10 h-6 rounded-full transition-colors relative cursor-pointer"
              style={{ background: published ? "#1E22B2" : "#e2e8f0" }}
            >
              <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm ${published ? "left-5" : "left-1"}`} />
            </div>
            <span className="text-sm text-slate-700 font-medium">공개</span>
          </label>
          {!published && (
            <label
              className="flex items-center gap-2 cursor-pointer pb-2.5"
              title="체크해 두면 주간 자동 발행(화~목 14~16시 랜덤)이 오래된 순서로 발행합니다"
            >
              <input
                type="checkbox"
                checked={queued}
                onChange={(e) => setQueued(e.target.checked)}
                className="w-4 h-4 accent-[#1E22B2]"
              />
              <span className="text-sm text-slate-700 font-medium">자동 발행 대기열</span>
            </label>
          )}
        </div>
      </div>

      {/* ── 에디터 + 미리보기 — 1:1 그리드 (xl 이상).
            본문이 길어지면 작성기 카드가 늘어나고 items-stretch 효과로 미리보기도 함께 늘어남.
            카드 내부에는 overflow 제한 없음 → 콘텐츠와 이미지가 잘리지 않고 모두 표시됨. ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 xl:gap-8 xl:items-stretch">
        {/* WYSIWYG 에디터 (좌) */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col">
          {editor && <Toolbar editor={editor} />}
          <div
            className="tiptap-editor flex-1"
            onClick={() => editor?.commands.focus()}
          >
            <EditorContent editor={editor} />
            {editor && <ImageBubbleMenu editor={editor} onReplaceUpload={handleFileInsert} />}
          </div>
        </div>

        {/* 미리보기 (우, xl 이상에서만 노출). h-full 로 작성기 높이만큼 stretch */}
        <aside className="hidden xl:block">
          <BlogPreview
            title={title}
            excerpt={excerpt}
            tag={tag}
            coverImage={coverImage}
            contentHtml={contentHtml}
            createdAt={previewDate || post?.createdAt || ""}
          />
        </aside>
      </div>

      <p className="text-xs text-slate-400 text-center mt-4" style={{ wordBreak: "keep-all" }}>
        Ctrl+B 굵게 · Ctrl+I 기울임 · Ctrl+Z 실행취소 · 이미지는 드래그&드롭 또는 툴바 버튼으로 삽입 ·
        본문 이미지는 <strong>클릭 후 Delete/Backspace</strong>로 삭제, 드래그로 위치 이동 가능합니다.
      </p>

      {/* ── Floating Save Bar — 우하단 앵커 (스크롤 위치 무관 항상 노출) ── */}
      <div className="fixed bottom-6 right-6 z-40 flex items-end gap-2">
        <button
          type="button"
          onClick={() => handleSave(false)}
          disabled={saving}
          className="px-4 py-2.5 bg-white border border-slate-200 shadow-lg rounded-xl text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          임시저장
        </button>
        <button
          type="button"
          onClick={() => handleSave(true)}
          disabled={saving}
          className="px-5 py-3 text-white font-semibold rounded-xl text-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ background: "#1E22B2", boxShadow: "0 10px 30px -10px rgba(30, 34, 178, 0.5)" }}
        >
          {saving ? "저장 중…" : "발행하기"}
        </button>
      </div>
    </div>
  );
}
