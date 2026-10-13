/**
 * 포트폴리오 인테이크 실행 — 서버 전용. 흐름은 portfolio-intake-flow.ts(순수), 여기서는 실제 구현을 꽂는다:
 * sharp(사진 준비) · Supabase(초안 조회/자리 잡기/부분 갱신/업로드) · Claude(글 생성).
 *
 * 공개는 기본으로 하지 않는다. 대외 노출은 사람이 어드민에서 확인한 뒤 켠다.
 */
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabase-admin";
import { deleteItem, ensureUniqueSlug, toItem, toRow } from "./portfolio";
import type { PortfolioItem } from "./portfolio-types";
import { deriveSlug } from "./portfolio-meta";
import { SITE_URL } from "./site";
import { SHRUNK_MARK } from "./image-shrink";
import { prepareIntakeImage, type PreparedIntakeImage } from "./portfolio-intake-images";
import {
  GENERATED_CONTENT_SCHEMA,
  INTAKE_SYSTEM_PROMPT,
  buildIntakeUserPrompt,
  normalizeGenerated,
  type GeneratedContent,
  type IntakeRunResult,
} from "./portfolio-intake";
import {
  runIntakeFlow,
  type IntakeDeps,
  type IntakeFinalizePatch,
  type IntakeGenerateInput,
  type IntakeInputFile,
  type IntakeRunOptions,
} from "./portfolio-intake-flow";

export type { IntakeInputFile, IntakeRunOptions } from "./portfolio-intake-flow";

/** 생성 모델 — 바꾸려면 Vercel env PORTFOLIO_INTAKE_MODEL */
export const INTAKE_MODEL = process.env.PORTFOLIO_INTAKE_MODEL || "claude-opus-5-5";

/**
 * 생성 한 번의 시간 상한. 라우트 maxDuration(300초) 안에서 묶음 여러 개가 순차로 돌므로
 * 재시도 없이 100초로 끊는다 — 함수가 먼저 죽으면 업로드만 되고 저장이 안 되는 반쪽 상태가 남는다.
 */
const GENERATE_TIMEOUT_MS = 100_000;

/** 사진을 보고 글을 쓴다. 실패는 예외로 — 호출자가 묶음 단위로 받는다 */
export async function generatePortfolioContent(input: IntakeGenerateInput): Promise<GeneratedContent> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY 가 설정되지 않아 글을 생성할 수 없습니다");
  }
  const anthropic = new Anthropic({ timeout: GENERATE_TIMEOUT_MS, maxRetries: 0 });
  const response = await anthropic.beta.messages.create({
    model: INTAKE_MODEL,
    // thinking 토큰까지 포함되는 상한 — 사진 20장·alt 20개 본문이면 8k 로는 끊길 수 있다
    max_tokens: 16000,
    // 안전 분류기가 거부하면 서버가 대체 모델로 다시 돌린다 — 제품 사진이라 거의 없지만 비용 없이 켤 수 있다
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      format: { type: "json_schema", schema: GENERATED_CONTENT_SCHEMA as unknown as Record<string, unknown> },
      effort: "medium",
    },
    // 고정 지시문은 캐시 — 사진·고객 정보만 매번 바뀐다
    system: [{ type: "text", text: INTAKE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          ...input.images.map((b) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: "image/jpeg" as const, data: b.toString("base64") },
          })),
          {
            type: "text" as const,
            text: buildIntakeUserPrompt({
              client: input.client,
              producedAt: input.producedAt,
              titleHint: input.titleHint,
              imageCount: input.images.length,
              existing: input.existing,
            }),
          },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    const details = (response as { stop_details?: { explanation?: string | null } | null }).stop_details;
    throw new Error(`모델이 생성을 거부함: ${details?.explanation ?? "사유 없음"}`);
  }
  if (response.stop_reason === "max_tokens") throw new Error("생성 결과가 길이 제한에 걸림");

  let text = "";
  for (const block of response.content) if (block.type === "text") text += block.text;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("생성 결과가 JSON 이 아님");
  }
  return normalizeGenerated(raw, { client: input.client, titleHint: input.titleHint, imageCount: input.images.length });
}

async function uploadToStorage(img: PreparedIntakeImage, originalBytes: number): Promise<string> {
  const ext = img.uploadContentType === "image/png" ? ".png" : img.uploadContentType === "image/webp" ? ".webp" : ".jpg";
  const name = `intake_${randomUUID()}${ext}`;
  const { error } = await supabaseAdmin.storage.from("uploads").upload(name, img.upload, {
    contentType: img.uploadContentType,
    upsert: false,
    cacheControl: "31536000",
    // 이미 줄인 판 — 유지보수 작업(shrink-images)이 다시 건드리지 않게 같은 표식을 남긴다
    metadata: { shrunk: SHRUNK_MARK, originalBytes, shrunkBytes: img.upload.length },
  });
  if (error) throw new Error(`이미지 업로드 실패: ${error.message}`);
  return supabaseAdmin.storage.from("uploads").getPublicUrl(name).data.publicUrl;
}

/** 외부 ID 로 초안 찾기 — 행이 둘 이상이어도(인덱스 전 중복) 가장 먼저 만든 것을 돌려준다 */
async function findDraft(externalId: string): Promise<PortfolioItem | null> {
  const { data, error } = await supabaseAdmin
    .from("portfolio_items")
    .select("*")
    .eq("airtable_id", externalId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`초안 조회 실패: ${error.message}`);
  return data?.[0] ? toItem(data[0]) : null;
}

async function claimDraft(draft: PortfolioItem): Promise<PortfolioItem> {
  const slug = await ensureUniqueSlug(
    deriveSlug({ id: draft.id, slug: "", client: draft.client, title: draft.title }),
    draft.id,
  );
  const withSlug = { ...draft, slug };
  const { error } = await supabaseAdmin.from("portfolio_items").insert(toRow(withSlug));
  if (error) {
    // 유니크 충돌 = 그 사이 다른 요청이 같은 묶음의 자리를 먼저 잡았다 → 그 행에 덧붙인다
    if (error.code === "23505" && draft.airtableId) {
      const other = await findDraft(draft.airtableId);
      if (other) return other;
    }
    throw new Error(`초안 자리 잡기 실패: ${error.message}`);
  }
  return withSlug;
}

/** 행을 다시 읽어 사진·alt 만 뒤에 붙인다 — 생성하는 1~2분 사이 어드민이 고친 내용을 덮어쓰지 않게 */
async function finalize(id: string, patch: IntakeFinalizePatch): Promise<PortfolioItem> {
  const { data, error } = await supabaseAdmin.from("portfolio_items").select("*").eq("id", id).maybeSingle();
  if (error || !data) throw new Error(`초안을 다시 읽을 수 없음: ${error?.message ?? "행 없음"}`);
  const current = toItem(data);
  const prevAlts = current.images.map((_, i) => current.imageAlts?.[i] ?? null);

  const update: Record<string, unknown> = {
    images: [...current.images, ...patch.images],
    image_alts: [...prevAlts, ...patch.imageAlts],
    published: current.published || patch.publish,
    updated_at: new Date().toISOString(),
  };
  if (patch.content) {
    const c = patch.content;
    Object.assign(update, {
      title: c.title,
      summary: c.summary || null,
      description: c.description,
      category: c.category,
      client_type: c.clientType ?? null,
      tags: c.tags,
      keywords: c.keywords,
      // 제목이 정해졌으니 슬러그도 다시 — 한글 제목은 어차피 case-… 라 바뀌지 않는다
      slug: await ensureUniqueSlug(deriveSlug({ id, slug: "", client: current.client, title: c.title }), id),
    });
  }

  const { data: saved, error: upErr } = await supabaseAdmin
    .from("portfolio_items")
    .update(update)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (upErr || !saved) throw new Error(`초안 저장 실패: ${upErr?.message ?? "행 없음"}`);
  return toItem(saved);
}

const deps: IntakeDeps<PreparedIntakeImage> = {
  siteUrl: SITE_URL.trim().replace(/\/$/, ""),
  prepare: async (bytes) => {
    const img = await prepareIntakeImage(bytes);
    return { vision: img.vision, prepared: img };
  },
  findDraft,
  claimDraft,
  generate: generatePortfolioContent,
  upload: uploadToStorage,
  finalize,
  discardDraft: deleteItem,
};

export async function runPortfolioIntake(
  files: IntakeInputFile[],
  opts: IntakeRunOptions = {},
): Promise<IntakeRunResult> {
  const result = await runIntakeFlow(files, opts, deps);
  for (const g of result.groups) {
    const tag = g.action === "failed" ? `failed: ${g.error}` : `${g.action} ${g.itemId ?? ""}`;
    console.log(`[portfolio-intake] ${tag} (${g.key}) from ${opts.source ?? "unknown"}`);
  }
  return result;
}
