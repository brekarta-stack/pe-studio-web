import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getAllArtists, getArtistById, saveArtist } from "@/lib/artists";
import { normalizeArtistBody, artistDbErrorMessage } from "@/lib/artist-normalize";
import { slugify } from "@/lib/portfolio-meta";
import type { Artist } from "@/lib/artist-types";
import { requireAdminApi, isAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** 목록 — 어드민 세션이면 전체(+source), 아니면 published 만 */
export async function GET() {
  const isAdmin = await isAdminSession();
  const { artists, source } = await getAllArtists();
  const visible = isAdmin ? artists : artists.filter((a) => a.published);
  return NextResponse.json({ artists: visible, source: isAdmin ? source : undefined });
}

/** 신규 등록 */
export async function POST(request: Request) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  const body = await request.json();
  const fields = normalizeArtistBody(body);
  if (!fields.name) return NextResponse.json({ error: "이름은 필수입니다." }, { status: 400 });

  // id: 영문명/이름 기반 슬러그, 충돌 시 suffix — 한글만이면 시간 기반
  const base = slugify(fields.englishName ?? fields.name) || `artist-${Date.now().toString(36)}`;
  let id = base;
  for (let i = 2; (await getArtistById(id)) && i < 10; i++) id = `${base}-${i}`;

  const now = new Date().toISOString();
  const artist: Artist = { ...fields, id, createdAt: now, updatedAt: now };

  try {
    await saveArtist(artist);
  } catch (e) {
    return NextResponse.json({ error: artistDbErrorMessage(e) }, { status: 500 });
  }

  revalidatePath("/about");
  return NextResponse.json(artist);
}
