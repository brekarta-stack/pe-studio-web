"use client";

/**
 * 견적서 목록 상단 — 구글 드라이브 연결 상태와 도장 이미지.
 *
 * 연결은 전체 페이지 이동이어야 한다(구글 동의 화면으로 갔다 돌아온다) — Link 가 아니라 a.
 * 연결 해제는 되돌릴 수는 있지만(다시 연결) 진행 중인 견적서의 시트 작업이 막히므로 두 번 누르게 한다.
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { disconnectGoogle, uploadSealImage } from "@/app/admin/estimates/actions";

interface Props {
  connection: { email: string; connectedAt: string; lastError: string | null } | null;
  hasSeal: boolean;
  redirectUri: string;
}

export default function GoogleDriveCard({ connection, hasSeal, redirectUri }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const disconnect = () => {
    setArmed(false);
    setError(null);
    startTransition(async () => {
      const res = await disconnectGoogle();
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  };

  const upload = () => {
    const f = fileRef.current?.files?.[0];
    if (!f) {
      setError("도장 이미지 파일을 고르세요.");
      return;
    }
    setError(null);
    setNotice(null);
    const fd = new FormData();
    fd.set("file", f);
    startTransition(async () => {
      const res = await uploadSealImage(fd);
      if (!res.ok) setError(res.error);
      else {
        setNotice(res.warning ?? "도장 이미지를 저장했습니다.");
        if (fileRef.current) fileRef.current.value = "";
      }
      router.refresh();
    });
  };

  const healthy = connection && !connection.lastError;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${healthy ? "bg-emerald-500" : connection ? "bg-amber-500" : "bg-slate-300"}`} />
          <h2 className="text-sm font-bold text-slate-900">구글 드라이브</h2>
        </div>
        {connection ? (
          <>
            <p className="text-sm text-slate-700">
              <b>{connection.email || "(이메일 확인 안 됨)"}</b> 에 연결됨
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              시트는 이 계정 드라이브의 <b>견적서/페이퍼크래프트</b>, <b>견적서/우드락</b> 폴더에 쌓입니다.
            </p>
            {connection.lastError && <p className="mt-2 text-xs font-bold text-amber-700">{connection.lastError}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a href="/api/admin/google/connect" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-slate-500">
                {connection.lastError ? "다시 연결" : "다른 계정으로 바꾸기"}
              </a>
              {armed ? (
                <>
                  <button type="button" onClick={disconnect} disabled={isPending} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white">
                    정말 연결 해제
                  </button>
                  <button type="button" onClick={() => setArmed(false)} className="text-xs text-slate-500 underline">
                    그만두기
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setArmed(true)} className="text-xs text-slate-500 underline hover:text-red-600">
                  연결 해제
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              견적서 시트를 만들 구글 계정을 연결하세요. 앱이 만든 파일만 다루는 권한(drive.file)만 요청합니다.
            </p>
            <a href="/api/admin/google/connect" className="mt-3 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800">
              구글 드라이브 연결
            </a>
            <p className="mt-2 break-all text-[11px] text-slate-400">
              처음 한 번: 구글 클라우드 콘솔 OAuth 클라이언트의 승인된 리디렉션 URI 에 <code>{redirectUri}</code> 를 추가하고,
              Google Sheets API · Google Drive API 를 사용 설정해야 합니다.
            </p>
          </>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${hasSeal ? "bg-emerald-500" : "bg-slate-300"}`} />
          <h2 className="text-sm font-bold text-slate-900">도장 이미지</h2>
        </div>
        <p className="text-sm text-slate-600">
          {hasSeal
            ? "등록됨 — 새로 만드는 시트의 '주식회사 스테이지' 옆에 찍힙니다."
            : "없음 — 시트에는 '주식회사 스테이지 (인)' 글자만 들어갑니다."}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          공개 폴더가 아닌 비공개 저장소에 두고, 시트만 받아 갈 수 있는 주소로 내보냅니다. PNG·JPG, 800KB 이하.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="max-w-full text-xs" />
          <button type="button" onClick={upload} disabled={isPending} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-slate-500 disabled:opacity-50">
            {hasSeal ? "교체" : "올리기"}
          </button>
        </div>
      </div>

      {(error || notice) && (
        <div className={`md:col-span-2 rounded-xl border p-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          {error ?? notice}
        </div>
      )}
    </div>
  );
}
