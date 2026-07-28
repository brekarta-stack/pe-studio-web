"use client";

/**
 * DB 셋업 페이지의 마이그레이션 실행 / SQL 복사 버튼.
 *
 * 자동 실행에는 Supabase Management API 가 필요하고, 그건 계정 단위
 * Personal Access Token(SUPABASE_ACCESS_TOKEN)을 요구한다.
 * 토큰이 없으면 "실행" 버튼을 아예 비활성화하고 복사 경로를 주 동선으로 삼는다 —
 * 눌러도 안 되는 버튼을 활성 상태로 두면 원인을 알 수 없다.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  /** 실행할 마이그레이션 파일 경로 (supabase/ 기준 상대경로) */
  files: string[];
  /** 복사 버튼이 클립보드에 넣을 SQL 전문 */
  sql: string;
  /** SUPABASE_ACCESS_TOKEN + 프로젝트 ref 가 모두 있어 자동 실행이 가능한지 */
  canAutoRun: boolean;
}

export default function MigrateButton({ files, sql, canAutoRun }: Props) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);
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
          setMessage({ kind: "warn", text: body.error ?? "자동 실행이 설정되지 않았습니다." });
          return;
        }
        if (!res.ok || !body.ok) {
          const detail =
            body.results?.filter((r) => !r.ok).map((r) => `${r.file}: ${r.error}`).join(" / ") ??
            body.error ??
            `HTTP ${res.status}`;
          setMessage({ kind: "err", text: `실행 실패 — ${detail}` });
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
      setMessage({
        kind: "err",
        text: "클립보드 복사에 실패했습니다. 아래 SQL 블록을 직접 선택해 복사하세요.",
      });
    }
  };

  const tone = {
    ok:   "border-emerald-200 bg-emerald-50 text-emerald-800",
    err:  "border-red-200 bg-red-50 text-red-700",
    warn: "border-amber-200 bg-amber-50 text-amber-800",
  };

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={run}
          disabled={!canAutoRun || isPending || files.length === 0}
          title={canAutoRun ? undefined : "SUPABASE_ACCESS_TOKEN 환경변수가 없어 자동 실행할 수 없습니다"}
          className="rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-slate-300"
          style={canAutoRun && !isPending && files.length > 0 ? { background: "#1E22B2" } : {}}
        >
          {isPending ? "실행 중…" : "마이그레이션 실행"}
        </button>

        <button
          onClick={copy}
          className={`rounded-xl px-4 py-2.5 text-sm font-bold transition-opacity hover:opacity-90 ${
            canAutoRun
              ? "border border-slate-200 text-slate-600 hover:bg-slate-50"
              : "text-white"
          }`}
          style={!canAutoRun ? { background: "#1E22B2" } : {}}
        >
          {copied ? "복사됨 ✓" : "SQL 복사"}
        </button>
      </div>

      {!canAutoRun && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-bold">자동 실행은 꺼져 있습니다 — 수동으로 적용하세요.</p>
          <ol className="mt-1.5 ml-4 list-decimal space-y-0.5 text-xs">
            <li><strong>SQL 복사</strong> 버튼을 누릅니다.</li>
            <li>
              아래 <strong>Supabase SQL Editor 열기</strong> → 이 사이트의 프로젝트 선택 →
              {" "}<strong>SQL Editor</strong> → <strong>New query</strong>
            </li>
            <li>붙여넣고 <strong>Run</strong>. 이 페이지를 새로고침하면 ✅ 로 바뀝니다.</li>
          </ol>
          <p className="mt-2 text-xs">
            버튼 한 번으로 끝내려면 Supabase Dashboard → Account → Access Tokens 에서 토큰을 발급해
            Vercel 환경변수 <code className="font-mono">SUPABASE_ACCESS_TOKEN</code> 에 넣고 재배포하세요.
            (supabase-js 로는 <code className="font-mono">CREATE TABLE</code> 같은 DDL 을 실행할 수 없어
            Management API 가 필요합니다)
          </p>
        </div>
      )}

      {message && (
        <div className={`mt-3 rounded-xl border p-3 text-sm ${tone[message.kind]}`}>{message.text}</div>
      )}
    </div>
  );
}
