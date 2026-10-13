/**
 * 포트폴리오 인테이크 흐름 — 순수 오케스트레이션. 바깥 세계(DB·저장소·모델·sharp)는 deps 로 주입한다.
 * 그래서 node --test 로 전체 흐름을 돌려 볼 수 있고, 서버(portfolio-intake-run.ts)는 실제 구현만 꽂는다.
 *
 *   준비 ─▶ 기존 초안 조회 ─▶ (공개된 항목이면 거부) ─▶ 자리 먼저 잡기(claim)
 *        ─▶ 글 생성 ─▶ 업로드 ─▶ 완성(finalize: 행을 다시 읽어 사진·alt 를 뒤에 붙이는 부분 갱신)
 *   생성·업로드가 실패하면 내가 잡은 빈 자리는 지운다.
 *
 * "자리 먼저 잡기"가 있는 이유: 모바일 Slack 은 사진 한 장을 메시지 하나로 연달아 올린다. 메시지마다
 * 함수가 따로 뜨므로, 생성(수십 초)이 끝난 뒤에 저장하면 전부 "기존 없음"을 보고 초안을 N 개 만든다.
 * 조회 직후 빈 행을 먼저 넣어 두면 뒤따르는 요청은 그 행에 사진을 덧붙인다. DB 유니크 인덱스
 * (supabase/migrations/20261013_portfolio_intake_unique.sql)까지 적용되면 남은 틈도 막힌다.
 *
 * 공개된 사례에는 덧붙이지 않는다. 사람이 보지 않은 사진·alt 가 사이트에 바로 노출되기 때문이다.
 */
import { randomUUID } from "node:crypto";
import type { PortfolioItem } from "./portfolio-types.ts";
import {
  groupIntakeFiles,
  inferCategory,
  intakeExternalId,
  normalizeGenerated,
  type GeneratedContent,
  type IntakeGroup,
  type IntakeGroupResult,
  type IntakeRunResult,
  type SkippedFile,
} from "./portfolio-intake.ts";

export interface IntakeInputFile {
  name: string;
  bytes: Buffer;
}

export interface IntakeRunOptions {
  /** true 면 등록 즉시 공개. 기본은 비공개 초안 */
  publish?: boolean;
  /** true 면 업로드·저장 없이 글만 생성해 돌려준다 */
  dryRun?: boolean;
  /** 키별로 미리 쓴 내용 — 있으면 생성 호출을 건너뛴다 (시험 운전·수동 등록용) */
  contentByKey?: Record<string, Partial<GeneratedContent>>;
  /** 어디서 왔는지 (로그용) — "slack:C123/1700000000.000100", "cli" … */
  source?: string;
}

export interface IntakeGenerateInput {
  client: string;
  producedAt: string;
  titleHint: string;
  /** 비전판(JPEG) — 첨부 순서가 alt 순서 */
  images: Buffer[];
  existing: { title: string; description: string } | null;
}

export interface IntakeFinalizePatch {
  /** 새로 만든 초안이면 생성한 글 전체. 덧붙이는 중이면 생략(제목·본문은 건드리지 않는다) */
  content?: GeneratedContent;
  /** 뒤에 붙일 사진 URL 과 alt (같은 길이) */
  images: string[];
  imageAlts: (string | null)[];
  /** true 면 공개로 올린다. false 면 기존 공개 상태를 유지한다 */
  publish: boolean;
}

export interface IntakeDeps<P = unknown> {
  siteUrl: string;
  /** 사진 한 장 → 비전판 + 업로드에 쓸 준비물. 실패는 예외 */
  prepare(bytes: Buffer): Promise<{ vision: Buffer; prepared: P }>;
  /** 외부 ID(intake:…)로 기존 초안 찾기. 없으면 null */
  findDraft(externalId: string): Promise<PortfolioItem | null>;
  /** 빈 초안을 넣는다. 그 사이 다른 요청이 먼저 넣었으면(유니크 충돌) 그 행을 돌려준다 */
  claimDraft(draft: PortfolioItem): Promise<PortfolioItem>;
  generate(input: IntakeGenerateInput): Promise<GeneratedContent>;
  /** 저장소 업로드 → 공개 URL */
  upload(prepared: P, originalBytes: number): Promise<string>;
  /** 행을 다시 읽어 사진·alt 를 뒤에 붙이고(content 가 있으면 글도 채우고) 저장한다. 저장된 행을 돌려준다 */
  finalize(id: string, patch: IntakeFinalizePatch): Promise<PortfolioItem>;
  /** 생성·업로드 실패 시 내가 잡은 빈 자리 지우기 */
  discardDraft(id: string): Promise<void>;
  now?: () => string;
  newId?: () => string;
}

export const ALREADY_PUBLISHED_ERROR =
  "이미 공개된 사례입니다 — 사진을 더하려면 어드민에서 직접 올리거나 publish 를 명시하세요";

/** 자리만 잡는 빈 초안 — 제목은 파일명 힌트, 사진 없음, 비공개 */
export function placeholderDraft(
  g: Pick<IntakeGroup<unknown>, "key" | "client" | "producedAt" | "title">,
  id: string,
  now: string,
): PortfolioItem {
  return {
    id,
    airtableId: intakeExternalId(g.key),
    title: `${g.client} ${g.title}`.trim(),
    category: inferCategory(g.title),
    description: "",
    client: g.client,
    tags: [],
    keywords: [],
    images: [],
    imageAlts: [],
    published: false,
    featured: false,
    producedAt: g.producedAt,
    createdAt: now,
    updatedAt: now,
  };
}

/** 사람이 보거나 모델이 쓴 글이 있는 행인가 — 자리만 잡힌 빈 행과 구분 */
export function hasContent(item: PortfolioItem): boolean {
  return item.images.length > 0 || item.description.trim().length > 0;
}

function textOf(item: PortfolioItem): Partial<GeneratedContent> {
  return {
    title: item.title,
    summary: item.summary,
    description: item.description,
    category: item.category,
    clientType: item.clientType,
    tags: item.tags,
    keywords: item.keywords,
  };
}

async function processGroup<P>(
  g: IntakeGroup<IntakeInputFile>,
  opts: IntakeRunOptions,
  deps: IntakeDeps<P>,
): Promise<IntakeGroupResult> {
  const base = {
    key: g.key,
    client: g.client,
    producedAt: g.producedAt,
    titleHint: g.title,
    imageCount: 0,
    skippedImages: [] as SkippedFile[],
  };
  const fail = (error: string): IntakeGroupResult => ({ ...base, action: "failed", error });

  try {
    /* 1. 사진 준비 — 한 장이 깨져도 나머지는 간다 */
    const prepared: Array<{ name: string; original: number; vision: Buffer; prepared: P }> = [];
    for (const { file } of g.files) {
      try {
        const r = await deps.prepare(file.bytes);
        prepared.push({ name: file.name, original: file.bytes.length, vision: r.vision, prepared: r.prepared });
      } catch (e) {
        base.skippedImages.push({ name: file.name, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    base.imageCount = prepared.length;
    if (!prepared.length) return fail("쓸 수 있는 사진이 없음");

    /* 2. 기존 초안 */
    const existing = await deps.findDraft(intakeExternalId(g.key));
    if (existing?.published && !opts.publish) return fail(ALREADY_PUBLISHED_ERROR);

    const ctx = { client: g.client, titleHint: g.title, imageCount: prepared.length };
    const override = opts.contentByKey?.[g.key];
    const generateFor = (row: PortfolioItem | null): Promise<GeneratedContent> => {
      const prior = row && hasContent(row) ? row : null;
      if (override) return Promise.resolve(normalizeGenerated({ ...(prior ? textOf(prior) : {}), ...override }, ctx));
      return deps.generate({
        client: g.client,
        producedAt: g.producedAt,
        titleHint: g.title,
        images: prepared.map((p) => p.vision),
        existing: prior ? { title: prior.title, description: prior.description } : null,
      });
    };

    /* 3. 미리 보기 — 자리도 잡지 않는다 */
    if (opts.dryRun) {
      const generated = await generateFor(existing);
      return { ...base, action: "dry-run", generated, title: generated.title };
    }

    /* 4. 자리 먼저 잡기 */
    const now = (deps.now ?? (() => new Date().toISOString()))();
    const id = (deps.newId ?? randomUUID)();
    let row = existing;
    let claimed = false;
    if (!row) {
      row = await deps.claimDraft(placeholderDraft(g, id, now));
      claimed = row.id === id;
      if (!claimed && row.published && !opts.publish) return fail(ALREADY_PUBLISHED_ERROR);
    }
    // 내가 잡은 자리이거나, 남이 잡았지만 아직 비어 있으면 글을 채운다. 글이 있으면 사진만 덧붙인다.
    const fillText = claimed || !hasContent(row);

    /* 5. 생성·업로드·완성 — 실패하면 내가 잡은 빈 자리는 지운다 */
    try {
      const generated = await generateFor(fillText ? null : row);
      const urls: string[] = [];
      for (const p of prepared) urls.push(await deps.upload(p.prepared, p.original));
      const saved = await deps.finalize(row.id, {
        content: fillText ? generated : undefined,
        images: urls,
        imageAlts: generated.imageAlts,
        publish: opts.publish === true,
      });
      return {
        ...base,
        action: claimed ? "created" : "appended",
        itemId: saved.id,
        slug: saved.slug,
        title: saved.title,
        published: saved.published,
        adminUrl: `${deps.siteUrl}/admin/portfolio/${saved.id}/edit`,
        publicUrl: `${deps.siteUrl}/portfolio/${saved.slug ?? saved.id}`,
        generated,
      };
    } catch (e) {
      if (claimed) await deps.discardDraft(id).catch(() => undefined);
      throw e;
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/** 묶음 단위로 처리한다. 한 묶음이 실패해도 다른 묶음은 계속 간다. */
export async function runIntakeFlow<P>(
  files: IntakeInputFile[],
  opts: IntakeRunOptions,
  deps: IntakeDeps<P>,
): Promise<IntakeRunResult> {
  const { groups, skipped } = groupIntakeFiles(files);
  const results: IntakeGroupResult[] = [];
  for (const g of groups) results.push(await processGroup(g, opts, deps));
  return { groups: results, skipped };
}
