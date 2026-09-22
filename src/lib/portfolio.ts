import { supabaseAdmin } from "./supabase-admin";
import { randomUUID } from "crypto";
export type { Category, ClientType, PortfolioItem } from "./portfolio-types";
export { CATEGORIES, CLIENT_TYPES, SUGGESTED_TAGS } from "./portfolio-types";
import type { PortfolioItem } from "./portfolio-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toItem(row: any): PortfolioItem {
  return {
    id: row.id,
    airtableId: row.airtable_id ?? undefined,
    slug: row.slug ?? undefined,
    title: row.title,
    summary: row.summary ?? undefined,
    category: row.category,
    description: row.description,
    client: row.client,
    clientType: row.client_type ?? undefined,
    tags: Array.isArray(row.tags) ? row.tags : [],
    keywords: Array.isArray(row.keywords) ? row.keywords : [],
    images: row.images ?? [],
    imageAlts: Array.isArray(row.image_alts) ? row.image_alts : [],
    published: row.published,
    featured: row.featured ?? false,
    producedAt: row.produced_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 노출 순서 기준 시각 — 제작 시기(produced_at)가 있으면 그것, 없으면 등록일 */
function effectiveTime(item: PortfolioItem): number {
  const t = Date.parse(item.producedAt ?? item.createdAt);
  return Number.isNaN(t) ? 0 : t;
}

export async function getItems(): Promise<PortfolioItem[]> {
  const { data, error } = await supabaseAdmin
    .from("portfolio_items")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  // 제작 시기(없으면 등록일) 최신순 — produced_at 컬럼이 아직 없는 DB에서도 안전하도록
  // SQL 이 아닌 JS 에서 정렬한다.
  return (data ?? []).map(toItem).sort((a, b) => effectiveTime(b) - effectiveTime(a));
}

export async function getItemById(id: string): Promise<PortfolioItem | undefined> {
  const { data } = await supabaseAdmin
    .from("portfolio_items")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ? toItem(data) : undefined;
}

/**
 * Slug 로 항목 조회. slug 가 비어있는 레거시 항목은 case-{id 앞 8자} fallback 으로도 시도.
 */
export async function getItemBySlug(slug: string): Promise<PortfolioItem | undefined> {
  const { data: bySlug } = await supabaseAdmin
    .from("portfolio_items")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (bySlug) return toItem(bySlug);

  const m = slug.match(/^case-([a-f0-9]{8})$/i);
  if (m) {
    const idPrefix = m[1];
    // id 만 받아 찾은 뒤 그 한 줄만 읽는다 — 예전에는 전체 행(*)을 받아 JS 에서 찾았다 (전송량)
    const { data: ids } = await supabaseAdmin.from("portfolio_items").select("id");
    const hit = (ids ?? []).find((r: { id?: string }) => r.id?.startsWith(idPrefix));
    if (hit?.id) {
      const { data: row } = await supabaseAdmin.from("portfolio_items").select("*").eq("id", hit.id).maybeSingle();
      if (row) return toItem(row);
    }
  }
  return undefined;
}

export async function getItemByAirtableId(airtableId: string): Promise<PortfolioItem | undefined> {
  const { data } = await supabaseAdmin
    .from("portfolio_items")
    .select("*")
    .eq("airtable_id", airtableId)
    .maybeSingle();
  return data ? toItem(data) : undefined;
}

/**
 * slug 유니크 보장 — 다른 항목이 같은 slug 를 쓰고 있으면 -2, -3… 접미사를 붙인다.
 * portfolio_items_slug_unique 인덱스 위반으로 신규 저장이 통째로 실패하는 것을 방지.
 * selfId 가 같은(=자기 자신) 행이면 그대로 사용한다.
 */
export async function ensureUniqueSlug(base: string, selfId?: string): Promise<string> {
  const root = (base && base.trim()) || "case";
  let candidate = root;
  for (let n = 2; n <= 50; n++) {
    const { data } = await supabaseAdmin
      .from("portfolio_items")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data || data.id === selfId) return candidate;
    candidate = `${root}-${n}`;
  }
  // 극단적 충돌 시 무작위 접미사로 보장
  return `${root}-${randomUUID().slice(0, 6)}`;
}

export async function saveItem(item: PortfolioItem): Promise<void> {
  const row: Record<string, unknown> = {
    id: item.id,
    airtable_id: item.airtableId ?? null,
    slug: item.slug ?? null,
    title: item.title,
    summary: item.summary ?? null,
    category: item.category,
    description: item.description,
    client: item.client,
    client_type: item.clientType ?? null,
    tags: item.tags ?? [],
    keywords: item.keywords ?? [],
    images: item.images,
    image_alts: item.imageAlts ?? [],
    published: item.published,
    featured: item.featured ?? false,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
  // produced_at 마이그레이션 전 DB 에서도 일반 저장이 깨지지 않도록,
  // 값이 지정된 경우에만 컬럼을 포함한다 (null = 비우기).
  if (item.producedAt !== undefined) row.produced_at = item.producedAt;
  const { error } = await supabaseAdmin.from("portfolio_items").upsert(row);
  if (error) throw error;
}

export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from("portfolio_items").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteItemByAirtableId(airtableId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("portfolio_items")
    .delete()
    .eq("airtable_id", airtableId);
  if (error) throw error;
}
