import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_SHORT, SITE_DESCRIPTION } from "@/lib/site";

/**
 * PWA 매니페스트 — 안드로이드 "홈 화면에 추가", 크롬 설치 배너에서 쓰인다.
 * 아이콘은 app/icon.png(512)·app/apple-icon.png(180)와 같은 만세 인형 마크.
 *
 * theme_color 는 브랜드 Primary Blue, background_color 는 로고 아이콘 배경인
 * Blueprint Teal 로 맞춰 스플래시가 아이콘과 이어지게 한다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_SHORT,
    description: SITE_DESCRIPTION,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#1E22B2",
    background_color: "#173F48",
    lang: "ko-KR",
    // app/icon.png 은 Next 가 해시 쿼리를 붙여 링크하므로, 매니페스트에서는
    // 경로가 고정된 public/brand 사본을 가리킨다.
    // 192·512 두 벌은 Lighthouse installable 요건이고, 두 아이콘 모두
    // 모서리까지 불투명하게 채운 풀블리드라 maskable 로도 그대로 쓸 수 있다
    // (인형이 캔버스 56% 크기라 안전영역 안에 들어온다).
    icons: [
      { src: "/brand/pe-studio-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/pe-studio-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/pe-studio-icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/brand/pe-studio-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
