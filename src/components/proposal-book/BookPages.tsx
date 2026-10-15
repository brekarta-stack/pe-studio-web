/**
 * 제안서 10쪽 렌더러 — agents-bd `bin/proposal-book` 의 지면 마크업을 React 로 옮겼다.
 * 태그·클래스 이름은 그 파일과 같게 둔다(디자인 정본 book.css 가 그 이름에 걸려 있다).
 *
 * 훅을 쓰지 않는 공용 컴포넌트다("use client" 없음). 인쇄 화면(서버)에서도, 편집기(클라이언트)에서도
 * 그대로 쓴다. 편집기는 아래 두 갈고리로 칸을 바꿔 끼운다.
 *  - renderField(path, kind, node): 글 칸의 '안쪽'을 바꾼다. 칸 요소(h2·p·li…)와 data-path·
 *    data-kind·서체 덮어쓰기는 여기서 붙이고, node 는 서식을 입힌 기본 내용이다.
 *  - renderImage(path, value, hint): 이미지 칸(.img)의 '안쪽'을 바꾼다. 칸 크기는 틀이 정하므로
 *    .img 상자 자체는 여기서 그린다.
 * 같은 경로가 두 번 나올 수 있다 — 견적 구간(pricing.tiers.*)은 2쪽 한눈에와 8쪽 견적에 함께 실린다.
 */

import { Fragment, type CSSProperties, type ReactNode } from "react";
import "./book.css";
import { renderInline } from "@/lib/proposal-book/markup";
import {
  normalizeImage,
  pageDef,
  type BookContent,
  type BookPage,
  type BookStyle,
  type PageId,
} from "@/lib/proposal-book/schema";
import { fontStack } from "@/lib/proposal-book/fonts";
import { STUDIO } from "@/lib/proposal-book/studio";

export type FieldKind = "text" | "multiline" | "list-item";
export type BookMode = "view" | "print" | "edit";

export interface BookPagesProps {
  content: BookContent;
  style: BookStyle;
  pages: BookPage[];
  mode: BookMode;
  renderField?: (path: string, kind: FieldKind, node: ReactNode) => ReactNode;
  renderImage?: (path: string, value: unknown, hint: string) => ReactNode;
  /** 각 쪽 오른쪽 위에 "초안 — 발송 불가" 띠 */
  draftBanner?: boolean;
}

/* ── 서식 ─────────────────────────────────────────────────── */

/** 원고 표기(**굵게**·[^1]·[확인 필요: …]) → React 노드 */
export function Inline({ text }: { text: unknown }): ReactNode {
  const segs = renderInline(text);
  return segs.map((s, i) => {
    if (s.type === "bold") return <strong key={i}>{s.value}</strong>;
    if (s.type === "fn") return <sup key={i} className="fn">{s.value}</sup>;
    if (s.type === "tbd") return <mark key={i} className="tbd">{s.value}</mark>;
    return <Fragment key={i}>{s.value}</Fragment>;
  });
}

/** 표지 기관명처럼 \n 으로 줄을 끊는 칸 */
function Lines({ text }: { text: string }): ReactNode {
  const parts = text.split("\n");
  return parts.map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      <Inline text={line.trim()} />
    </Fragment>
  ));
}

/** 지금 보여 줄 수 있는 이미지 주소인가 — data.json 의 상대 파일명(cover.jpg)은 백오피스에 없는 파일이다 */
function isShowableUrl(url: string): boolean {
  return /^(https?:\/\/|\/|data:image\/|blob:)/i.test(url);
}

/* ── 렌더러 ───────────────────────────────────────────────── */

type FieldTag = "h1" | "h2" | "h3" | "p" | "span" | "li" | "blockquote" | "dt" | "dd" | "td";

export default function BookPages({ content: d, style, pages, mode, renderField, renderImage, draftBanner }: BookPagesProps) {
  const editing = mode === "edit";
  const visible = pages.filter((p) => editing || !p.hidden);
  // 쪽번호는 보이는 순서대로 — 숨긴 쪽은 번호를 먹지 않는다(표지가 01)
  const folioNo = new Map<PageId, number>();
  pages.filter((p) => !p.hidden).forEach((p, i) => folioNo.set(p.id, i + 1));

  /** 칸별 서체·크기 덮어쓰기 */
  const override = (path: string): { style?: CSSProperties; scale: number } => {
    const o = style.overrides?.[path];
    if (!o) return { scale: 1 };
    return {
      style: o.font ? { fontFamily: fontStack(o.font, "body") } : undefined,
      scale: o.scale && o.scale !== 1 ? o.scale : 1,
    };
  };

  /** 글 칸 하나. data-path/data-kind 는 편집기가 칸을 찾는 손잡이다 */
  const field = (
    Tag: FieldTag,
    path: string,
    value: unknown,
    opts: { className?: string; kind?: FieldKind; multiline?: boolean; prefix?: ReactNode; suffix?: ReactNode } = {}
  ): ReactNode => {
    const kind: FieldKind = opts.kind ?? (opts.multiline ? "multiline" : "text");
    const text = typeof value === "string" ? value : value == null ? "" : String(value);
    let node: ReactNode = opts.multiline ? <Lines text={text} /> : <Inline text={text} />;
    const ov = override(path);
    // 크기는 안쪽 span 의 em 배율로 — 칸마다 기준 크기(25pt·10pt…)가 달라 절대값을 줄 수 없다
    if (ov.scale !== 1) node = <span style={{ fontSize: `${ov.scale}em` }}>{node}</span>;
    const inner = renderField ? renderField(path, kind, node) : node;
    return (
      <Tag className={opts.className} data-path={path} data-kind={kind} style={ov.style}>
        {opts.prefix}
        {inner}
        {opts.suffix}
      </Tag>
    );
  };

  const image = (path: string, value: unknown, hint: string, cls = ""): ReactNode => {
    const img = normalizeImage(value);
    const className = `img${cls ? ` ${cls}` : ""}${img.fit === "contain" ? " contain" : ""}`;
    let inner: ReactNode;
    if (renderImage) {
      inner = renderImage(path, value, hint);
    } else if (img.url && isShowableUrl(img.url)) {
      const pos = `${img.x}% ${img.y}%`;
      inner = (
        // eslint-disable-next-line @next/next/no-img-element -- 인쇄 지면이라 next/image 의 반응형 변환이 오히려 해가 된다
        <img
          src={img.url}
          alt=""
          style={{
            objectFit: img.fit,
            objectPosition: pos,
            transform: img.zoom !== 1 ? `scale(${img.zoom})` : undefined,
            transformOrigin: pos,
          }}
        />
      );
    } else {
      inner = (
        <div className="slot">
          {hint}
          <code>{img.url || "파일명 미지정"}</code>
        </div>
      );
    }
    return (
      <div className={className} data-path={path} data-kind="image">
        {inner}
      </div>
    );
  };

  const kicker = (id: PageId): ReactNode => {
    const def = pageDef(id);
    return (
      <div className="kicker">
        <span className="sec">{def.sec}</span>
        <span className="ko">
          <Inline text={d.org} /> · {def.ko}
        </span>
      </div>
    );
  };

  const folio = (id: PageId): ReactNode => {
    const no = folioNo.get(id);
    return (
      <div className="folio">
        <span>
          {STUDIO.name} — <Inline text={d.org} /> 제안 · {d.issue}
        </span>
        <span className="no">{no ? String(no).padStart(2, "0") : "—"}</span>
      </div>
    );
  };

  const flag = draftBanner ? <span className="draft-flag">초안 — 발송 불가</span> : null;

  /* ── 지면 ─────────────────────────────────────────────── */

  const cover = (): ReactNode => {
    const usesDisplay = !!(d.org_display && d.org_display.trim());
    const disp = usesDisplay ? d.org_display! : d.org;
    // 가장 긴 줄의 글자 수로 크기를 고른다 — 44pt 로는 7자부터 칸을 넘는다
    const longest = Math.max(0, ...disp.split("\n").map((x) => Array.from(x.trim()).length));
    const size = longest <= 6 ? "" : longest <= 10 ? " org-m" : " org-l";
    return (
      <>
        <div className="text">
          <div className="mast">
            <span>{STUDIO.name.toUpperCase()}</span>
            <span>PROPOSAL {d.issue}</span>
          </div>
          {field("p", "contact.dept", d.contact.dept, { className: "for", suffix: " 귀중" })}
          {field("h1", usesDisplay ? "org_display" : "org", disp, { className: `h-display org${size}`, multiline: usesDisplay })}
          {field("p", "title", d.title, { className: "title" })}
          {field("p", "subtitle", d.subtitle, { className: "lede sub" })}
          <dl className="meta">
            <dt>제안</dt>
            <dd>{STUDIO.tagline}</dd>
            <dt>문의</dt>
            <dd>
              {STUDIO.contact.email} · {STUDIO.contact.phone}
            </dd>
          </dl>
        </div>
        {image("cover", d.cover, "커버 이미지 — 운영자가 넣는다")}
      </>
    );
  };

  const glance = (): ReactNode => {
    const g = d.glance;
    return (
      <>
        {kicker("glance")}
        <div className="head">
          {field("h2", "glance.headline", g.headline, { className: "h1" })}
          {field("p", "glance.lede", g.lede, { className: "lede" })}
        </div>
        <div className="specs">
          <dl>
            {g.specs.map(([k, v], i) => (
              <Fragment key={i}>
                {field("dt", `glance.specs.${i}.0`, k)}
                {field("dd", `glance.specs.${i}.1`, v)}
              </Fragment>
            ))}
          </dl>
        </div>
        <div className="tiers">
          <p className="label">수량별 금액 · VAT 별도</p>
          {d.pricing.tiers.slice(0, 3).map((t, i) => (
            <div key={i} className={`tier${t.pick ? " pick" : ""}`}>
              {field("span", `pricing.tiers.${i}.qty`, t.qty, { className: "q" })}
              {field("span", `pricing.tiers.${i}.total`, t.total, { className: "num total" })}
              {field("span", `pricing.tiers.${i}.unit`, t.unit, { className: "unit" })}
            </div>
          ))}
        </div>
      </>
    );
  };

  const observation = (): ReactNode => {
    const f = d.observation;
    return (
      <>
        {kicker("observation")}
        <div className="head">{field("h2", "observation.headline", f.headline, { className: "h1" })}</div>
        {field("blockquote", "observation.quote", f.quote, { className: "quote" })}
        <div className="body">
          {f.body.map((p, i) => (
            <Fragment key={i}>
              {field("p", `observation.body.${i}`, p, { kind: "list-item" })}
            </Fragment>
          ))}
        </div>
        <div className="sources caption">
          <ol>
            {f.sources.map((s, i) => (
              <li key={i}>
                {field("span", `observation.sources.${i}.label`, s.label)}
                {(s.url || editing) && (
                  <>
                    {" — "}
                    {field("span", `observation.sources.${i}.url`, s.url)}
                  </>
                )}
              </li>
            ))}
          </ol>
        </div>
      </>
    );
  };

  const offer = (): ReactNode => {
    const o = d.offer;
    return (
      <>
        {kicker("offer")}
        <div className="head">
          {field("h2", "offer.headline", o.headline, { className: "h1" })}
          {field("p", "offer.lede", o.lede, { className: "lede" })}
        </div>
        <div className="lines" style={{ "--n": Math.max(1, o.lines.length) } as CSSProperties}>
          {o.lines.map((l, i) => (
            <div key={i} className="line">
              {field("span", `offer.lines.${i}.use`, l.use, { className: "use" })}
              {field("h3", `offer.lines.${i}.name`, l.name, { className: "h2" })}
              <div className="body">
                {l.body.map((p, j) => (
                  <Fragment key={j}>
                    {field("p", `offer.lines.${i}.body.${j}`, p, { kind: "list-item" })}
                  </Fragment>
                ))}
              </div>
              {field("span", `offer.lines.${i}.spec`, l.spec, { className: "specs-inline" })}
            </div>
          ))}
        </div>
      </>
    );
  };

  const designs = (): ReactNode => {
    const ds = d.designs;
    const items = ds.items.length ? ds.items : ["A", "B", "C"].map((key) => ({ key, image: "", title: "", note: "" }));
    return (
      <>
        {kicker("designs")}
        <div className="head">
          {field("h2", "designs.headline", ds.headline || "세 가지 방향 중 하나를 고르시면 디벨롭합니다", { className: "h1" })}
          {field("p", "designs.note", ds.note || "시안은 방향 확인용입니다. 선택하신 안을 기준으로 수정 2회까지 반영합니다.", {
            className: "caption",
          })}
        </div>
        <div className="grid">
          {items.slice(0, 3).map((it, i) => (
            <div key={i} className="design">
              {image(`designs.items.${i}.image`, it.image, `시안 ${it.key || "?"} — 운영자가 넣는다`)}
              <div className="cap">
                <span className="letter">{it.key || "?"}</span>
                <div>
                  {field("h3", `designs.items.${i}.title`, it.title || "[확인 필요: 시안 제목]", { className: "h3" })}
                  {field("p", `designs.items.${i}.note`, it.note)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </>
    );
  };

  const scenes = (): ReactNode => {
    const s = d.scenes;
    return (
      <>
        {kicker("scenes")}
        <div className="head">{field("h2", "scenes.headline", s.headline, { className: "h1" })}</div>
        {image("scenes.image", s.image, "활용 장면 사진 — 사례 사진 또는 목업")}
        <div className="list">
          {s.items.map((x, i) => (
            <div key={i} className="scene">
              {field("h3", `scenes.items.${i}.title`, x.title, { className: "h3" })}
              {field("p", `scenes.items.${i}.body`, x.body)}
            </div>
          ))}
        </div>
      </>
    );
  };

  const cases = (): ReactNode => {
    const c = d.cases;
    const items = c.items.slice(0, 3);
    return (
      <>
        {kicker("cases")}
        <div className="head">{field("h2", "cases.headline", c.headline, { className: "h1" })}</div>
        <div className="grid" style={{ "--n": Math.max(1, items.length) } as CSSProperties}>
          {items.map((x, i) => (
            <div key={i} className="case">
              {image(`cases.items.${i}.image`, x.image, "사례 사진")}
              {field("span", `cases.items.${i}.org`, x.org, { className: "who" })}
              {field("h3", `cases.items.${i}.title`, x.title, { className: "h3" })}
              {field("p", `cases.items.${i}.note`, x.note)}
            </div>
          ))}
        </div>
      </>
    );
  };

  const pricing = (): ReactNode => {
    const p = d.pricing;
    return (
      <>
        {kicker("pricing")}
        <div className="head">
          {field("h2", "pricing.headline", p.headline, { className: "h1" })}
          {field("p", "pricing.lede", p.lede, { className: "lede" })}
        </div>
        <div className="table">
          <table>
            <thead>
              <tr>
                <th>수량</th>
                <th>구성</th>
                <th className="r">총액 (VAT 별도)</th>
                <th className="r">개당</th>
              </tr>
            </thead>
            <tbody>
              {p.tiers.map((t, i) => (
                <tr key={i} className={t.pick ? "pick" : ""}>
                  {field("td", `pricing.tiers.${i}.qty`, t.qty, { className: "qty" })}
                  {field("td", `pricing.tiers.${i}.desc`, t.desc)}
                  {field("td", `pricing.tiers.${i}.total`, t.total, { className: "r num total" })}
                  {field("td", `pricing.tiers.${i}.unit`, t.unit, { className: "r" })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="includes">
          <p className="label">포함 항목</p>
          <ul>
            {p.includes.map((x, i) => (
              <Fragment key={i}>
                {field("li", `pricing.includes.${i}`, x, { kind: "list-item" })}
              </Fragment>
            ))}
          </ul>
        </div>
        <ul className="notes">
          {p.notes.map((x, i) => (
            <Fragment key={i}>
              {field("li", `pricing.notes.${i}`, x, { kind: "list-item" })}
            </Fragment>
          ))}
        </ul>
      </>
    );
  };

  const plan = (): ReactNode => {
    const pl = d.plan;
    return (
      <>
        {kicker("plan")}
        <div className="head">{field("h2", "plan.headline", pl.headline, { className: "h1" })}</div>
        <div className="steps" style={{ "--n": Math.max(1, pl.steps.length) } as CSSProperties}>
          {pl.steps.map((x, i) => (
            <div key={i} className="step">
              {field("p", `plan.steps.${i}.when`, x.when, { className: "when" })}
              {field("h3", `plan.steps.${i}.title`, x.title, { className: "h3" })}
              {field("p", `plan.steps.${i}.body`, x.body)}
            </div>
          ))}
        </div>
        <div className="studio">
          {STUDIO.stats.map((x) => (
            <div key={x.label} className="stat">
              <span className="num">{x.num}</span>
              <span>{x.label}</span>
            </div>
          ))}
          <p className="clients">{STUDIO.clients}</p>
        </div>
      </>
    );
  };

  const back = (): ReactNode => {
    const b = d.closing;
    const c = d.contact;
    const sc = STUDIO.contact;
    return (
      <>
        {kicker("back")}
        <div className="head">
          {field("h2", "closing.headline", b.headline, { className: "h1" })}
          {field("p", "closing.lede", b.lede, { className: "lede" })}
        </div>
        <ol className="next">
          {b.next.map((x, i) => (
            <Fragment key={i}>
              {field("li", `closing.next.${i}`, x, { kind: "list-item", prefix: <span>{i + 1}</span> })}
            </Fragment>
          ))}
        </ol>
        <dl className="contact">
          <p className="h2">{STUDIO.name}</p>
          <dt>담당</dt>
          <dd>
            {sc.person} · {sc.email} · {sc.phone}
          </dd>
          <dt>주소</dt>
          <dd>{sc.address}</dd>
          <dt>수신</dt>
          <dd>
            {field("span", "contact.dept", c.dept)}
            {(c.email || editing) && (
              <>
                {" · "}
                {field("span", "contact.email", c.email)}
              </>
            )}
          </dd>
        </dl>
      </>
    );
  };

  const RENDER: Record<PageId, { cls: string; body: () => ReactNode; folio: boolean }> = {
    cover: { cls: "cover", body: cover, folio: false },
    glance: { cls: "glance", body: glance, folio: true },
    observation: { cls: "feature", body: observation, folio: true },
    offer: { cls: "offer", body: offer, folio: true },
    designs: { cls: "designs", body: designs, folio: true },
    scenes: { cls: "scenes", body: scenes, folio: true },
    cases: { cls: "cases", body: cases, folio: true },
    pricing: { cls: "price", body: pricing, folio: true },
    plan: { cls: "plan", body: plan, folio: true },
    back: { cls: "back", body: back, folio: true },
  };

  const rootStyle = {
    "--key": style.keyColor,
    "--serif": fontStack(style.headingFont, "heading"),
    "--sans": fontStack(style.bodyFont, "body"),
  } as CSSProperties;

  return (
    <div className={`pb-root pb-${mode}`} style={rootStyle} data-mode={mode}>
      {visible.map((p) => {
        const r = RENDER[p.id];
        if (!r) return null;
        return (
          <section
            key={p.id}
            className={`page ${r.cls}${p.hidden ? " pb-hidden" : ""}`}
            data-page={p.id}
            data-hidden={p.hidden ? "true" : undefined}
          >
            {flag}
            {r.body()}
            {r.folio && folio(p.id)}
          </section>
        );
      })}
    </div>
  );
}
