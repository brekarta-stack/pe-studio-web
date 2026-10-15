/**
 * 원고 문자열 안의 표기 — `**굵게**`, 각주 `[^1]`, 빈칸 `[확인 필요: 무엇]` — 순수 파서.
 *
 * React 를 모르는 조각 배열을 돌려준다. 렌더러(BookPages)는 조각을 태그로 바꾸기만 하고,
 * 테스트는 조각을 그대로 비교한다. bin/proposal-book 의 md() 와 같은 규칙이다.
 */

import { pageOfPath, type PageId } from "./schema.ts";

export type InlineSegment =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "fn"; value: string }
  | { type: "tbd"; value: string };

/**
 * 빈칸 — 에이전트가 [확인필요], [확인 필요 : …] 처럼 흔들려 써도 잡는다.
 * 못 잡으면 형광펜 없이 지면에 실린다 (bin/proposal-book 의 TBD 와 같은 식).
 */
export const TBD_RE = /\[\s*확인\s*필요\s*(?::\s*([^\]]*))?\]/g;
/** 닫는 ] 가 빠진 것까지 — 세기·검사용 */
export const TBD_LOOSE_RE = /\[\s*확인\s*필요/g;

const TOKEN_RE = /\[\s*확인\s*필요\s*(?::\s*([^\]]*))?\]|\[\^(\d+)\]|\*\*(.+?)\*\*/g;
const TBD_ONLY_RE = /\[\s*확인\s*필요\s*(?::\s*([^\]]*))?\]/g;

function tbdLabel(what: string | undefined): string {
  const w = (what ?? "").trim();
  return w ? `확인 필요: ${w}` : "확인 필요";
}

function pushText(out: InlineSegment[], type: "text" | "bold", value: string) {
  if (!value) return;
  const last = out[out.length - 1];
  if (last && last.type === type) last.value += value;
  else out.push({ type, value });
}

/** 굵게 안에 빈칸이 있으면 bold / tbd / bold 로 편다 — 빈칸 형광펜이 굵게에 묻히지 않게 */
function splitBold(out: InlineSegment[], inner: string) {
  let last = 0;
  for (const m of inner.matchAll(TBD_ONLY_RE)) {
    pushText(out, "bold", inner.slice(last, m.index));
    out.push({ type: "tbd", value: tbdLabel(m[1]) });
    last = (m.index ?? 0) + m[0].length;
  }
  pushText(out, "bold", inner.slice(last));
}

export function renderInline(s: unknown): InlineSegment[] {
  const text = s == null ? "" : String(s);
  const out: InlineSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    pushText(out, "text", text.slice(last, idx));
    if (m[0].startsWith("**")) splitBold(out, m[3] ?? "");
    else if (m[2] !== undefined) out.push({ type: "fn", value: m[2] });
    else out.push({ type: "tbd", value: tbdLabel(m[1]) });
    last = idx + m[0].length;
  }
  pushText(out, "text", text.slice(last));
  return out;
}

/** 서식을 걷어 낸 글자만 (글자 수 세기·미리보기용) */
export function plainText(s: unknown): string {
  return renderInline(s)
    .map((seg) => (seg.type === "fn" ? "" : seg.type === "tbd" ? `[${seg.value}]` : seg.value))
    .join("");
}

/* ── 빈칸 세기 ─────────────────────────────────────────────── */

export interface TbdHit {
  /** 원고 안 경로 ("observation.body.0") */
  path: string;
  /** 빈칸 원문 그대로 ("[확인 필요: 출처]"). 닫는 ] 가 빠졌으면 그 문자열 끝까지 */
  text: string;
  /** 그 글이 실리는 쪽 */
  page: PageId | null;
}

function walk(v: unknown, path: string, visit: (path: string, s: string) => void) {
  if (typeof v === "string") visit(path, v);
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, path ? `${path}.${i}` : String(i), visit));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, path ? `${path}.${k}` : k, visit);
  }
}

/** 원고 전체의 빈칸 목록 (경로 순서). 닫는 ] 가 빠진 흔들린 표기도 잡는다 */
export function listTbd(content: unknown): TbdHit[] {
  const out: TbdHit[] = [];
  walk(content, "", (path, s) => {
    for (const m of s.matchAll(TBD_LOOSE_RE)) {
      const start = m.index ?? 0;
      const close = s.indexOf("]", start);
      // 다음 빈칸이 닫는 ] 보다 먼저 시작하면 이 빈칸은 닫히지 않은 것이다
      const nextOpen = s.slice(start + 1).search(/\[\s*확인\s*필요/);
      const nextAt = nextOpen < 0 ? -1 : start + 1 + nextOpen;
      const closed = close >= 0 && (nextAt < 0 || close < nextAt);
      const end = closed ? close + 1 : nextAt >= 0 ? nextAt : s.length;
      out.push({ path, text: s.slice(start, end), page: pageOfPath(path) });
    }
  });
  return out;
}

export function countTbd(content: unknown): number {
  return listTbd(content).length;
}
