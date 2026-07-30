import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getArtistById, saveArtist, deleteArtist } from "@/lib/artists";
import { normalizeArtistBody, artistDbErrorMessage } from "@/lib/artist-normalize";
import { requireAdminApi, isAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const isAdmin = await isAdminSession();
  const { id } = await params;
  const artist = await getArtistById(id);
  if (!artist) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!artist.published && !isAdmin) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(artist);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  const { id } = await params;
  const existing = await getArtistById(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  const fields = normalizeArtistBody(body);
  if (!fields.name) return NextResponse.json({ error: "이름은 필수입니다." }, { status: 400 });

  const updated = {
    ...existing,
    ...fields,
    id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };

  try {
    await saveArtist(updated);
  } catch (e) {
    return NextResponse.json({ error: artistDbErrorMessage(e) }, { status: 500 });
  }

  revalidatePath("/about");
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  const { id } = await params;
  try {
    await deleteArtist(id);
  } catch (e) {
    return NextResponse.json({ error: artistDbErrorMessage(e) }, { status: 500 });
  }

  revalidatePath("/about");
  return NextResponse.json({ ok: true });
}
