import { redirect } from "next/navigation";
import Link from "next/link";
import { getArtistSession } from "@/lib/session";
import { listArtistWorks } from "@/lib/artist-portal";
import { partitionWorks, summarize } from "@/lib/artist-portal-types";
import { formatWon } from "@/lib/assignment-types";
import WorkCard from "@/components/artist/WorkCard";

export const dynamic = "force-dynamic";

function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warn" | "good";
}) {
  const tones = {
    default: "border-slate-200 bg-white",
    warn: "border-amber-200 bg-amber-50",
    good: "border-emerald-200 bg-emerald-50",
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-bold text-slate-700">
        {title} <span className="text-slate-400">{count}</span>
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export default async function ArtistDashboardPage() {
  const artist = await getArtistSession();
  // 관리자가 포털을 열어 본 경우도 여기로 온다 — 볼 업무가 없으므로 어드민으로 돌려보낸다
  if (!artist) redirect("/admin/works");

  const works = await listArtistWorks(artist.artistId);
  const summary = summarize(works);
  const { offers, active, done, declined } = partitionWorks(works);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="응답 대기"
          value={`${summary.pendingOffers}건`}
          hint={summary.pendingOffers > 0 ? "수락 여부를 골라주세요" : undefined}
          tone={summary.pendingOffers > 0 ? "warn" : "default"}
        />
        <Stat label="진행 중" value={`${summary.active}건`} />
        <Stat
          label="받을 작업비"
          value={`${formatWon(summary.unpaidTotal)}원`}
          hint="세전 기준"
          tone={summary.unpaidTotal > 0 ? "warn" : "default"}
        />
        <Stat
          label="지급 완료"
          value={`${formatWon(summary.paidTotal)}원`}
          hint="세전 기준"
          tone="good"
        />
      </div>

      {works.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-2xl" aria-hidden>
            📋
          </p>
          <p className="mt-2 font-bold text-slate-800">아직 배정된 업무가 없습니다</p>
          <p className="mt-1 text-sm text-slate-500">
            새 업무가 제안되면 이 화면에 나타납니다.
          </p>
        </div>
      ) : (
        <>
          <Section title="제안받은 업무" count={offers.length}>
            {offers.map((w) => (
              <WorkCard key={w.id} work={w} />
            ))}
          </Section>

          <Section title="진행 중" count={active.length}>
            {active.map((w) => (
              <WorkCard key={w.id} work={w} />
            ))}
          </Section>

          <Section title="완료" count={done.length}>
            {done.map((w) => (
              <WorkCard key={w.id} work={w} />
            ))}
          </Section>

          <Section title="거절 · 취소" count={declined.length}>
            {declined.map((w) => (
              <WorkCard key={w.id} work={w} />
            ))}
          </Section>
        </>
      )}

      <p className="mt-8 text-center text-sm text-slate-400">
        작업비 지급 내역은{" "}
        <Link href="/artist/settlements" className="underline hover:text-slate-600">
          정산 내역
        </Link>
        에서 한눈에 볼 수 있습니다.
      </p>
    </div>
  );
}
