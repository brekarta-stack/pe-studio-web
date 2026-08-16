import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 브랜드 마크(만세 인형)를 data URI 로 인라인한다.
 * Satori 는 외부 URL 을 못 받는 환경이 있어 파일을 직접 읽어 넣는다.
 * 이 파일이 서버리스 번들에 포함되도록 next.config.ts 의
 * outputFileTracingIncludes 에 "/opengraph-image" 항목이 있어야 한다.
 */
const MARK_SRC = `data:image/png;base64,${readFileSync(
  join(process.cwd(), "public/brand/pe-studio-mark-512.png")
).toString("base64")}`;

/**
 * 사이트 공통 OG 이미지 (1200×630).
 * app/opengraph-image 파일은 Next가 자동으로 모든 하위 라우트의
 * og:image / twitter:image 메타로 연결한다 (개별 페이지가 재정의하지 않는 한).
 *
 * Satori 기본 폰트(라틴)만 사용하므로 별도 폰트 임베드 불필요 →
 * 브랜드 영문 표기로 구성. (한글 임베드는 woff2 미지원으로 회피)
 */
export const alt = "PE Studio — Paper Engineering Studio";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #1E22B2 0%, #171AB0 60%, #0F1280 100%)",
          color: "white",
          position: "relative",
          // 오른쪽 마크(358px @ right:72px)와 글자가 겹치지 않도록 텍스트 폭을 제한
          paddingRight: "500px",
        }}
      >
        {/* 우측 브랜드 마크 — 만세 인형 */}
        <div
          style={{
            position: "absolute",
            right: "72px",
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
          }}
        >
          <img src={MARK_SRC} alt="" width={358} height={454} />
        </div>

        {/* 작은 라벨 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            fontSize: "26px",
            fontWeight: 600,
            color: "#9CA3FF",
            marginBottom: "28px",
          }}
        >
          <div style={{ width: "10px", height: "10px", borderRadius: "999px", background: "#F5C518", display: "flex" }} />
          papercraft.kr
        </div>

        {/* 메인 타이틀 */}
        <div style={{ display: "flex", fontSize: "104px", fontWeight: 800, letterSpacing: "-3px", lineHeight: 1 }}>
          PE Studio
        </div>

        {/* 서브 타이틀 */}
        <div style={{ display: "flex", fontSize: "44px", fontWeight: 700, marginTop: "16px", color: "#E8EAFF" }}>
          Paper Engineering Studio
        </div>

        {/* 태그라인 */}
        <div style={{ display: "flex", fontSize: "30px", marginTop: "28px", color: "#9CA3FF" }}>
          Korea&apos;s Only Paper Engineering Studio
        </div>
      </div>
    ),
    { ...size }
  );
}
