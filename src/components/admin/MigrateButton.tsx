"use client";

/**
 * DB 셋업 페이지의 "마이그레이션 실행" 버튼.
 *
 * /api/admin/migrate 가 Supabase Management API 로 SQL 을 실행한다.
 * 토큰이 설정돼 있지 않으면 501 이 오고, 그때는 아래 SQL 복사 안내로 넘어가면 된다.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  /** 실행할 마이그레이션 파일 경로 (레포 기준 상대경로) */
  files: string[];
  /** 복사 버튼이 클립보드에 넣을 SQL 전문 */
  sql: string;
}

export default function MigrateButton({ files, sql }: Props) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  const run = () => {
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/migrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files }),
        });
        const body = (await res.json()) as {
          ok?: boolean;
          error?: string;
          results?: { file: string; ok: boolean; error?: string }[];
        };

        if (res.status === 501) {
          setMessage({ kind: "info", text: body.error ?? "자동 실행이 설정되지 않았습니다." });
          return;
        }
        if (!res.ok || !body.ok) {
          const detail =
            body.results?.filter((r) => !r.ok).map((r) => `${r.file}: ${r.error}`).join(" / ") ??
            body.error ??
            "알 수 없는 오류";
          setMessage({ kind: "err", text: detail });
          return;
        }
        setMessage({ kind: "ok", text: "마이그레이션을 적용했습니다. 상태를 다시 확인합니다…" });
        router.refresh();
      } catch (e) {
        setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
      }
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage({ kind: "err", text: "클립보드 복사에 실패했습니다. SQL 을 직접 선택해 복사하세요." });
    }
  };

  const tone = {
    ok:   "border-emerald-200 bg-emerald-50 text-emerald-800",
    err:  "border-red-200 bg-red-50 text-red-700",
    info: "border-slate-200 bg-slate-50 text-slate-600",
  };

  return (
    <div className="mb-6">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={run}
          disabled={isPending || files.length === 0}
          className="rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-slate-200"
          style={!isPending && files.length > 0 ? { background: "#1E22B2" } : {}}
        >
          {isPending ? "실행 중…" : "마이그레이션 실행"}
        </button>
        <button
          onClick={copy}
          className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          {copied ? "복사됨 ✓" : "SQL 복사"}
        </button>
      </div>

      {message && (
        <div className={`mt-3 rounded-xl border p-3 text-sm ${tone[message.kind]}`}>{message.text}</div>
      )}
    </div>
  );
}
