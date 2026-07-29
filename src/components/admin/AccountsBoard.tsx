"use client";

/**
 * 아티스트 계정 보드 — 포털에 누가 들어올 수 있는지를 관리한다.
 *
 * 두 갈래를 한 화면에서 다룬다:
 *   · 초대 발급 — 아티스트를 지목해 링크를 만들고 전달한다(가장 흔한 경로)
 *   · 신청 승인 — /artist/apply 로 들어온 신청을 아티스트에 매칭하고 승인한다
 *
 * 승인은 반드시 아티스트 매칭과 함께 일어난다. 매칭 없는 승인은 서버 액션이
 * 거부한다 — 누구의 업무를 보여줄지 정해지지 않은 계정이기 때문.
 */

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  ACCOUNT_STATUS_COLORS,
  ACCOUNT_STATUS_LABELS,
  type ArtistAccountView,
} from "@/lib/artist-account-types";
import {
  approveAccount,
  issueInvite,
  removeAccount,
  setAccountArtist,
  setAccountNote,
  setAccountStatus,
} from "@/app/admin/accounts/actions";

export interface ArtistOption {
  id: string;
  name: string;
}

interface Props {
  accounts: ArtistAccountView[];
  artists: ArtistOption[];
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone}`}>
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900">{value}명</p>
    </div>
  );
}

/** 계정 한 줄 */
function AccountRow({
  account,
  artists,
  onError,
}: {
  account: ArtistAccountView;
  artists: ArtistOption[];
  onError: (msg: string | null) => void;
}) {
  const [artistId, setArtistId] = useState(account.artistId ?? "");
  const [note, setNote] = useState(account.note);
  const [noteOpen, setNoteOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    onError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) onError(result.error ?? "처리에 실패했습니다.");
    });
  }

  const isApproved = account.status === "approved";

  return (
    <div className="border-b border-slate-100 p-4 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                ACCOUNT_STATUS_COLORS[account.status]
              }`}
            >
              {ACCOUNT_STATUS_LABELS[account.status]}
            </span>
            {account.lastLoginAt && (
              <span className="text-[11px] text-slate-400">
                최근 로그인 {account.lastLoginAt.slice(0, 10)}
              </span>
            )}
          </div>
          <p className="mt-1.5 font-bold text-slate-900">
            {account.displayName || account.artistName || "(이름 없음)"}
          </p>
          <p className="text-sm text-slate-500">
            {account.email ?? <span className="text-slate-400">이메일 미등록 (초대 대기)</span>}
            {account.phone && ` · ${account.phone}`}
          </p>
          {account.note && (
            <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-xs text-slate-500">
              {account.note}
            </p>
          )}
        </div>

        <div className="flex flex-shrink-0 flex-col items-end gap-2">
          {/* 아티스트 매칭 */}
          <select
            value={artistId}
            onChange={(e) => {
              const next = e.target.value;
              setArtistId(next);
              run(() => setAccountArtist(account.id, next || null));
            }}
            disabled={pending}
            aria-label={`${account.displayName || account.email} 연결 아티스트`}
            className="w-44 cursor-pointer rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-[#1E22B2] disabled:opacity-50"
          >
            <option value="">아티스트 연결 안 함</option>
            {artists.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <div className="flex flex-wrap justify-end gap-1.5">
            {!isApproved && (
              <button
                onClick={() => run(() => approveAccount(account.id, artistId))}
                disabled={pending || !artistId || !account.email}
                title={
                  !account.email
                    ? "이메일이 등록되지 않아 승인할 수 없습니다"
                    : !artistId
                      ? "아티스트를 먼저 연결하세요"
                      : undefined
                }
                className="rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: "#1E22B2" }}
              >
                승인
              </button>
            )}
            {isApproved && (
              <button
                onClick={() => run(() => setAccountStatus(account.id, "disabled"))}
                disabled={pending}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                사용 중지
              </button>
            )}
            {account.status === "pending" && (
              <button
                onClick={() => run(() => setAccountStatus(account.id, "rejected"))}
                disabled={pending}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
              >
                거절
              </button>
            )}
            <button
              onClick={() => setNoteOpen((v) => !v)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-50"
            >
              메모
            </button>
            <button
              onClick={() => run(() => removeAccount(account.id))}
              disabled={pending}
              className="rounded-lg px-2 py-1.5 text-xs text-slate-300 transition-colors hover:text-red-500 disabled:opacity-50"
              aria-label="계정 삭제"
            >
              삭제
            </button>
          </div>
        </div>
      </div>

      {noteOpen && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="관리자 메모 (아티스트에게는 보이지 않습니다)"
            className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#1E22B2]"
          />
          <button
            onClick={() =>
              run(async () => {
                const r = await setAccountNote(account.id, note);
                if (r.ok) setNoteOpen(false);
                return r;
              })
            }
            disabled={pending}
            className="mt-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          >
            메모 저장
          </button>
        </div>
      )}
    </div>
  );
}

export default function AccountsBoard({ accounts, artists }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [inviteArtist, setInviteArtist] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const counts = useMemo(
    () => ({
      pending: accounts.filter((a) => a.status === "pending").length,
      approved: accounts.filter((a) => a.status === "approved").length,
      invited: accounts.filter((a) => a.status === "invited").length,
    }),
    [accounts]
  );

  /** 이미 계정(초대 포함)이 있는 아티스트는 초대 대상에서 뺀다 — 중복 발급 방지 */
  const invitable = useMemo(() => {
    const taken = new Set(accounts.map((a) => a.artistId).filter(Boolean));
    return artists.filter((a) => !taken.has(a.id));
  }, [accounts, artists]);

  function invite() {
    setError(null);
    setInviteUrl(null);
    setCopied(false);
    const artist = artists.find((a) => a.id === inviteArtist);
    if (!artist) {
      setError("아티스트를 선택하세요.");
      return;
    }
    startTransition(async () => {
      const result = await issueInvite(artist.id, artist.name);
      if (result.ok) setInviteUrl(result.url);
      else setError(result.error);
    });
  }

  async function copy() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setError("클립보드 복사에 실패했습니다. 링크를 직접 선택해 복사해 주세요.");
    }
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="승인 대기"
          value={counts.pending}
          tone={counts.pending > 0 ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}
        />
        <StatCard label="초대 발송" value={counts.invited} tone="border-slate-200 bg-white" />
        <StatCard
          label="이용 중"
          value={counts.approved}
          tone="border-emerald-200 bg-emerald-50"
        />
      </div>

      {/* 초대 링크 발급 */}
      <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-bold text-slate-700">초대 링크 발급</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          아티스트를 지정해 링크를 만들고 전달하세요. 아티스트가 링크에서 구글 이메일을
          등록하면 별도 승인 없이 바로 이용할 수 있습니다. (유효기간 14일)
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <select
            value={inviteArtist}
            onChange={(e) => setInviteArtist(e.target.value)}
            aria-label="초대할 아티스트"
            className="min-w-[12rem] flex-1 cursor-pointer rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#1E22B2]"
          >
            <option value="">아티스트 선택…</option>
            {invitable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button
            onClick={invite}
            disabled={pending || !inviteArtist}
            className="rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: "#1E22B2" }}
          >
            {pending ? "발급 중…" : "링크 발급"}
          </button>
        </div>

        {invitable.length === 0 && artists.length > 0 && (
          <p className="mt-2 text-xs text-slate-400">
            모든 아티스트에게 이미 계정이나 초대가 있습니다.
          </p>
        )}

        {inviteUrl && (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-xs font-semibold text-emerald-800">
              링크가 생성되었습니다 — 아티스트에게 전달하세요
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-white px-3 py-2 font-mono text-xs text-slate-700">
                {inviteUrl}
              </code>
              <button
                onClick={copy}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white"
              >
                {copied ? "복사됨" : "복사"}
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {/* 계정 목록 */}
      <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-bold text-slate-700">
            계정 <span className="font-medium text-slate-400">{accounts.length}</span>
          </h2>
        </div>

        {accounts.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-slate-500">아직 등록된 계정이 없습니다.</p>
            <p className="mt-1 text-xs text-slate-400">
              위에서 초대 링크를 발급하거나, 아티스트가{" "}
              <Link href="/artist/apply" target="_blank" className="underline">
                가입 신청
              </Link>
              하면 여기에 나타납니다.
            </p>
          </div>
        ) : (
          accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              artists={artists}
              onError={setError}
            />
          ))
        )}
      </div>
    </div>
  );
}
