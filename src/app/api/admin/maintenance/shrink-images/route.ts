import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  BACKUP_BUCKET,
  SHRINK_BUCKET,
  SHRUNK_MARK,
  TIME_BUDGET_MS,
  cacheSecondsOf,
  clampBatch,
  formatOf,
  isAlreadyExists,
  isOurShrunkCopy,
  planObject,
  worthReplacing,
} from "@/lib/image-shrink";
import { shrinkBuffer } from "@/lib/image-shrink-run";

/**
 * POST /api/admin/maintenance/shrink-images — 공개 이미지 원본 줄이기 (관리자 전용).
 *
 *   { mode: "dry-run" | "apply" | "restore", offset?: number, limit?: number, only?: string }
 *
 * 몇 개씩 처리하고 nextOffset 을 돌려준다(40초가 넘으면 거기서 끊는다). 화면(DB 셋업)이 이어서 부른다.
 *  - dry-run : 목록 정보(크기·형식)만으로 대상과 합계를 보여 준다. 아무것도 내려받지 않는다 — 전송량.
 *  - apply   : 원본을 uploads-originals 에 보관한 뒤 같은 경로에 줄인 파일을 덮어쓰고 표식을 남긴다.
 *  - restore : 보관본을 제자리로 되돌린다. 단, 지금 파일이 이 도구가 줄인 판일 때만 —
 *              그 뒤에 같은 이름으로 교체된 새 파일을 옛 보관본으로 덮지 않는다.
 *  - only    : 맨 위의 파일 하나만 (시험·개별 되돌리기용)
 * 규칙은 src/lib/image-shrink.ts.
 */
export const maxDuration = 60;

type Mode = "dry-run" | "apply" | "restore";

interface Row {
  name: string;
  before?: number;
  after?: number;
  action: "candidate" | "shrunk" | "restored" | "skip" | "error";
  reason?: string;
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function ensureBackupBucket() {
  const { data } = await supabaseAdmin.storage.getBucket(BACKUP_BUCKET);
  if (data) return;
  const { error } = await supabaseAdmin.storage.createBucket(BACKUP_BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw new Error(`보관 버킷 생성 실패: ${error.message}`);
}

async function download(bucket: string, name: string): Promise<{ buf: Buffer; type: string }> {
  const { data, error } = await supabaseAdmin.storage.from(bucket).download(name);
  if (error || !data) throw new Error(error?.message ?? `${bucket}/${name} 을 받지 못했습니다`);
  return { buf: Buffer.from(await data.arrayBuffer()), type: data.type };
}

type MarkState = "ours" | "restored" | "not-ours" | "missing" | "unknown";

/**
 * 지금 파일이 이 도구가 줄인 그 판인가 — 표식 + 줄일 때 적어 둔 크기로 본다(isOurShrunkCopy).
 * 저장소 응답의 메타데이터 칸 이름이 판마다 달라 둘 다 본다.
 */
async function markOf(name: string): Promise<MarkState> {
  const { data, error } = await supabaseAdmin.storage.from(SHRINK_BUCKET).info(name);
  if (error) {
    const e = error as { status?: unknown; statusCode?: unknown; message?: string };
    if (e.status === 404 || String(e.statusCode) === "404" || /not found/i.test(e.message ?? "")) return "missing";
    return "unknown";
  }
  const d = (data ?? {}) as {
    size?: number | null;
    metadata?: Record<string, unknown> | null;
    userMetadata?: Record<string, unknown> | null;
  };
  const size = typeof d.size === "number" ? d.size : null;
  if (isOurShrunkCopy(d.metadata, size) || isOurShrunkCopy(d.userMetadata, size)) return "ours";
  if (d.metadata?.restoredBy === SHRUNK_MARK || d.userMetadata?.restoredBy === SHRUNK_MARK) return "restored";
  return "not-ours";
}

interface Entry {
  name: string;
  id: string | null;
  size: number;
  contentType: string | null;
  /** 올릴 때 그대로 넘겨 원래 캐시 시간을 지킨다 — 같은 이름으로 교체하는 파일이 오래 옛 그림으로 남지 않게 */
  cacheSeconds: string;
}

async function listEntries(bucket: string, offset: number, limit: number, only?: string): Promise<Entry[] | { error: string }> {
  if (only) {
    const { data, error } = await supabaseAdmin.storage.from(bucket).list("", { limit: 20, search: only });
    if (error) return { error: error.message };
    const hit = (data ?? []).find((e) => e.name === only);
    return hit ? [toEntry(hit)] : [];
  }
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .list("", { limit, offset, sortBy: { column: "name", order: "asc" } });
  if (error) return { error: error.message };
  return (data ?? []).map(toEntry);
}

function toEntry(e: { name: string; id: string | null; metadata?: Record<string, unknown> | null }): Entry {
  return {
    name: e.name,
    id: e.id,
    size: Number(e.metadata?.size ?? 0),
    contentType: (e.metadata?.mimetype as string | undefined) ?? null,
    cacheSeconds: cacheSecondsOf(e.metadata?.cacheControl),
  };
}

export async function POST(req: Request) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  let body: { mode?: unknown; offset?: unknown; limit?: unknown; only?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const mode = body.mode as Mode;
  if (mode !== "dry-run" && mode !== "apply" && mode !== "restore") {
    return NextResponse.json({ error: "mode 는 dry-run | apply | restore 중 하나여야 합니다." }, { status: 400 });
  }
  const offset = typeof body.offset === "number" && body.offset >= 0 ? Math.floor(body.offset) : 0;
  // dry-run 은 내려받지 않으니 한 번에 많이
  const limit = mode === "dry-run" ? 100 : clampBatch(body.limit);
  const only = typeof body.only === "string" && body.only && !body.only.includes("/") ? body.only : undefined;
  const started = Date.now();

  const listed = await listEntries(mode === "restore" ? BACKUP_BUCKET : SHRINK_BUCKET, offset, limit, only);
  if ("error" in listed) {
    if (mode === "restore" && /not found/i.test(listed.error)) return NextResponse.json({ results: [], nextOffset: null });
    return NextResponse.json({ error: `목록을 읽지 못했습니다: ${listed.error}` }, { status: 502 });
  }

  const results: Row[] = [];
  let backupReady = false;
  let stoppedAt: number | null = null;

  for (let i = 0; i < listed.length; i++) {
    // 함수 상한 전에 끊고 다음 호출로 넘긴다 — 첫 파일은 반드시 처리한다(안 그러면 같은 자리를 끝없이 부른다)
    if (mode !== "dry-run" && i > 0 && Date.now() - started > TIME_BUDGET_MS) {
      stoppedAt = i;
      break;
    }
    const e = listed[i];
    // 폴더(quote/, deliverable/ 등)는 id 가 없다 — 들어가지 않는다
    if (!e.id) {
      results.push({ name: `${e.name}/`, action: "skip", reason: "폴더 — 다루지 않음" });
      continue;
    }

    try {
      if (mode === "restore") {
        const mark = await markOf(e.name);
        if (mark === "missing") {
          results.push({ name: e.name, action: "skip", reason: "원본 자리에 파일이 없음 — 지워진 파일은 되살리지 않음" });
          continue;
        }
        if (mark === "restored") {
          results.push({ name: e.name, action: "skip", reason: "이미 되돌림" });
          continue;
        }
        const { buf: original, type } = await download(BACKUP_BUCKET, e.name);
        let ours = mark === "ours";
        if (!ours) {
          // 표식·크기로 확인이 안 되면 내용으로 확인한다 — 보관본을 다시 줄인 결과(같은 입력이면 같은 출력)와
          // 지금 파일이 같으면 우리 판. 다르면 그 뒤에 교체된 새 파일이다.
          const fmt = formatOf(e.name, e.contentType ?? type);
          if (fmt) {
            const again = await shrinkBuffer(original, fmt);
            if ("out" in again) {
              const { buf: current } = await download(SHRINK_BUCKET, e.name);
              ours = sha256(again.out) === sha256(current);
            }
          }
        }
        if (!ours) {
          results.push({ name: e.name, action: "skip", reason: "지금 파일이 이 도구가 줄인 판이 아님(교체된 파일) — 되돌리지 않음" });
          continue;
        }
        const { error: upErr } = await supabaseAdmin.storage
          .from(SHRINK_BUCKET)
          .update(e.name, original, { contentType: e.contentType ?? type, cacheControl: e.cacheSeconds, metadata: { restoredBy: SHRUNK_MARK } });
        if (upErr) throw new Error(upErr.message);
        results.push({ name: e.name, after: original.length, action: "restored" });
        continue;
      }

      const plan = planObject({ name: e.name, size: e.size, contentType: e.contentType });
      if (plan.action === "skip") {
        results.push({ name: e.name, before: e.size, action: "skip", reason: plan.reason });
        continue;
      }
      if (mode === "dry-run") {
        results.push({ name: e.name, before: e.size, action: "candidate" });
        continue;
      }

      // apply — 이미 줄인 파일이면 내려받지도 않는다 (다시 돌려도 전송량을 쓰지 않게)
      if ((await markOf(e.name)) === "ours") {
        results.push({ name: e.name, before: e.size, action: "skip", reason: "이미 줄임" });
        continue;
      }
      const { buf, type } = await download(SHRINK_BUCKET, e.name);
      const res = await shrinkBuffer(buf, plan.format, e.size || undefined);
      if ("skip" in res) {
        results.push({ name: e.name, before: buf.length, action: "skip", reason: res.skip });
        continue;
      }
      if (!worthReplacing(buf.length, res.out.length)) {
        results.push({ name: e.name, before: buf.length, after: res.out.length, action: "skip", reason: "줄어드는 폭이 작음" });
        continue;
      }

      // 원본 보관이 먼저다. 보관에 실패하면 덮어쓰지 않는다.
      if (!backupReady) {
        await ensureBackupBucket();
        backupReady = true;
      }
      const contentType = e.contentType ?? type;
      // 캐시 시간도 원래 값으로 — 되돌릴 때 보관본의 값을 그대로 쓴다
      const { error: bkErr } = await supabaseAdmin.storage
        .from(BACKUP_BUCKET)
        .upload(e.name, buf, { contentType, upsert: false, cacheControl: e.cacheSeconds });
      if (bkErr) {
        if (!isAlreadyExists(bkErr)) throw new Error(`원본 보관 실패: ${bkErr.message}`);
        // 보관본이 이미 있다 — 지난번에 보관만 하고 덮어쓰기가 실패한 경우라면 내용이 같다.
        // 다르면 그 뒤에 같은 이름으로 교체된 새 파일이다: 보관 없이 덮으면 새 원본을 잃으므로 건드리지 않는다.
        const { buf: kept } = await download(BACKUP_BUCKET, e.name);
        if (sha256(kept) !== sha256(buf)) {
          results.push({ name: e.name, before: buf.length, action: "skip", reason: "보관본과 내용이 다른 파일(교체된 파일일 수 있음) — 건드리지 않음" });
          continue;
        }
      }

      const { error: upErr } = await supabaseAdmin.storage.from(SHRINK_BUCKET).update(e.name, res.out, {
        contentType,
        cacheControl: e.cacheSeconds,
        metadata: { shrunk: SHRUNK_MARK, originalBytes: buf.length, shrunkBytes: res.out.length },
      });
      if (upErr) throw new Error(`덮어쓰기 실패: ${upErr.message}`);
      results.push({ name: e.name, before: buf.length, after: res.out.length, action: "shrunk" });
    } catch (err) {
      results.push({ name: e.name, before: e.size || undefined, action: "error", reason: err instanceof Error ? err.message : String(err) });
    }
  }

  if (mode === "apply") {
    const done = results.filter((r) => r.action === "shrunk");
    if (done.length) console.info(`[shrink-images] ${done.length}개 줄임:`, done.map((r) => `${r.name} ${r.before}→${r.after}`).join(", "));
  }

  const nextOffset = only
    ? null
    : stoppedAt !== null
      ? offset + stoppedAt
      : listed.length === limit
        ? offset + limit
        : null;
  return NextResponse.json({ results, nextOffset });
}
