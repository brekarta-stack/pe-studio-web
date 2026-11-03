/**
 * 사이트 공용 머리말·꼬리말 숨김 — 제안서 편집기·인쇄 화면 전용.
 *
 * 머리말·꼬리말은 루트 레이아웃이 모든 화면에 그리고, AdminShell 은 이 경로에서 사이드바를 그리지 않는다.
 * 그래서 정상 화면뿐 아니라 안내(표 없음·문서 없음·404) 화면에서도 같이 숨겨야 화면 모양이 갈리지 않는다.
 * 인라인 style 이라 이 화면을 떠나면 함께 사라진다.
 */
export default function HideSiteChrome() {
  return <style>{`body > header, body > footer { display: none !important; }`}</style>;
}
