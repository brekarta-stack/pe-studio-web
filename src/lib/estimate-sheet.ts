/**
 * 견적서 → 구글 시트 batchUpdate 요청 목록 (순수 함수).
 *
 * 기존 견적서 시트(ask@papercraft.kr 의 CREATIVE 13 건)를 칸 단위로 옮긴 것이다.
 * 템플릿 파일을 복사하지 않고 매번 코드로 그리는 이유: 앱이 받는 드라이브 권한이
 * drive.file(앱이 만든 파일만)이라 사람이 만든 템플릿은 열 수조차 없다.
 * 대신 양식이 코드에 있으니 행 수가 품목 수에 따라 늘고 줄어도 수식이 어긋나지 않는다.
 *
 * 금액 칸은 값이 아니라 수식이다 (금액 = 수량 × 단가, 합계 = SUM, 부가세 = 절사).
 * 시트에서 직접 수량·단가를 고쳐도 합계가 맞게 따라간다. 확인 단계에서 앱이 읽는
 * 합계는 이름 있는 범위(EST_SUPPLY 등)로 찾는다 — 행을 끼워 넣어도 위치가 따라간다.
 */

import {
  formatKoreanDate,
  type EstimateItem,
} from "./estimate-types.ts";

/** 공급자(우리 회사) 정보 — 기존 양식 그대로 */
export const SUPPLIER = {
  bizNumber: "310-86-00726",
  company: "(주) 스테이지",
  ceo: "오 세 기",
  address: "경기 수원시 권선구 서둔로 166  GUPO 오피스 102",
  web: "WWW.PAPERCRAFT.KR",
  webUrl: "https://www.papercraft.kr/",
  bizType: "디자인업",
  bizItem: "제조, 서비스",
  phone: "031-778-7944",
  fax: "0303-3444-0120",
  managerName: "오세기",
  managerPhone: "010-4075-2661",
  managerEmail: "ask@papercraft.kr",
  sealName: "주식회사 스테이지",
} as const;

export const ESTIMATE_NOTES = [
  "※ 생산 수량 증가/ 재생산 시 할인된 단가 제공",
  "※ 본 견적은 견적일로부터 7일간 유효",
  "※ 진행 내용 변경시, 부속합의서를 통해 추가 금액 청구.",
] as const;

export const NAMED_RANGES = {
  supply: "EST_SUPPLY",
  vat: "EST_VAT",
  total: "EST_TOTAL",
} as const;

export const SHEET_TITLE = "견적서";

export interface SheetInput {
  clientCompany: string;
  clientContact: string;
  issuedOn: string;
  docNumber: string;
  deliveryTerm: string;
  deliveryPlace: string;
  paymentTerm: string;
  items: EstimateItem[];
}

export interface SheetAssets {
  bannerUrl: string;
  /** 도장 이미지 주소. 없으면 "(인)" 글자로 대신한다 */
  sealUrl: string | null;
}

/** 행 번호는 전부 0부터 (API 기준). 시트 화면의 행 번호 = 값 + 1 */
export interface SheetLayout {
  rowCount: number;
  headerRow: number;
  itemStart: number;
  /** 마지막 품목 행 (빈 여백 행 제외) */
  itemEnd: number;
  supplyRow: number;
  vatRow: number;
  totalRow: number;
  footerRow: number;
}

export const COLUMN_WIDTHS = [90, 290, 90, 110, 100, 135] as const;
const COLS = COLUMN_WIDTHS.length;

/* ── 서식 ───────────────────────────────────────────────────── */

type Rgb = { red: number; green: number; blue: number };
const rgb = (hex: string): Rgb => ({
  red: parseInt(hex.slice(1, 3), 16) / 255,
  green: parseInt(hex.slice(3, 5), 16) / 255,
  blue: parseInt(hex.slice(5, 7), 16) / 255,
});

const BRAND = rgb("#1E22B2");
const GRAY = rgb("#C0C0C0");
const RED = rgb("#DD0806");
const WHITE = rgb("#FFFFFF");
const BLACK = rgb("#000000");
const LINK = rgb("#1155CC");

interface TextFormat {
  fontSize?: number;
  bold?: boolean;
  underline?: boolean;
  foregroundColor?: Rgb;
  link?: { uri: string };
}

interface CellFormat {
  horizontalAlignment: "LEFT" | "CENTER" | "RIGHT";
  verticalAlignment: "TOP" | "MIDDLE" | "BOTTOM";
  wrapStrategy: "WRAP" | "CLIP" | "OVERFLOW_CELL";
  textFormat: TextFormat;
  backgroundColor?: Rgb;
  numberFormat?: { type: "NUMBER"; pattern: string };
}

type CellValue = { stringValue: string } | { numberValue: number } | { formulaValue: string };

interface Cell {
  value?: CellValue;
  format: CellFormat;
}

const baseFormat = (): CellFormat => ({
  horizontalAlignment: "CENTER",
  verticalAlignment: "MIDDLE",
  wrapStrategy: "CLIP",
  textFormat: { fontSize: 10, foregroundColor: BLACK },
});

const NUMBER = { type: "NUMBER", pattern: "#,##0" } as const;

/** 수식 문자열 안에 넣을 URL — 큰따옴표만 이스케이프하면 된다 */
const quoteFormulaString = (s: string) => `"${s.replace(/"/g, '""')}"`;

/* ── 본체 ───────────────────────────────────────────────────── */

export function computeLayout(itemCount: number): SheetLayout {
  const headerRow = 15;
  const itemStart = 16;
  const itemEnd = itemStart + itemCount - 1;
  // 품목 아래 빈 행 하나 — 기존 양식처럼 표 끝에 여백을 둔다
  const supplyRow = itemEnd + 2;
  const vatRow = supplyRow + 1;
  const totalRow = supplyRow + 2;
  const footerRow = totalRow + 10;
  return {
    rowCount: footerRow + 1,
    headerRow,
    itemStart,
    itemEnd,
    supplyRow,
    vatRow,
    totalRow,
    footerRow,
  };
}

/**
 * 품목 열의 세로 병합 구간 — 품목이 비어 있는 행은 바로 위 행에 묶인다.
 * [시작 인덱스, 끝 인덱스(포함)] 목록. 한 행짜리 구간은 병합하지 않으므로 빼고 돌려준다.
 */
export function groupSpans(items: Pick<EstimateItem, "group">[]): [number, number][] {
  const spans: [number, number][] = [];
  let start = 0;
  for (let i = 1; i <= items.length; i++) {
    if (i === items.length || items[i].group) {
      if (i - 1 > start) spans.push([start, i - 1]);
      start = i;
    }
  }
  return spans;
}

/**
 * 파일 단위 속성 — 파일 이름(=드라이브 파일명)·한국 로케일·서울 시간대.
 *
 * allowExternalImages: 배너·도장은 IMAGE() 로 우리 사이트에서 받아 온다. 구글 시트는 파일마다
 * "외부 URL 데이터 액세스 허용"을 받기 전까지 IMAGE() 를 #REF! 로 막는다(2024 보안 정책).
 * 사람이 파일마다 "액세스 허용"을 누르지 않게 API 로 켠다. 한 번 켜면 되돌릴 수 없는 값이라
 * 이미 켜진 파일에는 보내지 않는다(읽기 전용 필드를 다시 쓰면 오류가 날 수 있다).
 */
export function buildSpreadsheetPropertiesRequest(title: string, allowExternalImages: boolean): object {
  const properties: Record<string, unknown> = { title, locale: "ko_KR", timeZone: "Asia/Seoul" };
  const fields = ["title", "locale", "timeZone"];
  if (allowExternalImages) {
    properties.importFunctionsExternalUrlAccessAllowed = true;
    fields.push("importFunctionsExternalUrlAccessAllowed");
  }
  return { updateSpreadsheetProperties: { properties, fields: fields.join(",") } };
}

export function buildSheetRequests(
  input: SheetInput,
  sheetId: number,
  assets: SheetAssets,
): { requests: object[]; layout: SheetLayout } {
  const L = computeLayout(input.items.length);
  const grid: Cell[][] = Array.from({ length: L.rowCount }, () =>
    Array.from({ length: COLS }, () => ({ format: baseFormat() })),
  );
  const requests: object[] = [];
  const range = (r1: number, r2: number, c1: number, c2: number) => ({
    sheetId,
    startRowIndex: r1,
    endRowIndex: r2 + 1,
    startColumnIndex: c1,
    endColumnIndex: c2 + 1,
  });
  const merge = (r1: number, r2: number, c1: number, c2: number) =>
    requests.push({ mergeCells: { range: range(r1, r2, c1, c2), mergeType: "MERGE_ALL" } });

  const set = (
    r: number,
    c: number,
    value: string | number | { formula: string } | null,
    fmt: Partial<Omit<CellFormat, "textFormat">> & { text?: TextFormat } = {},
  ) => {
    const cell = grid[r][c];
    if (value !== null) {
      cell.value =
        typeof value === "number"
          ? { numberValue: value }
          : typeof value === "string"
            ? { stringValue: value } // 문자열은 항상 stringValue — "=" 로 시작해도 수식이 되지 않는다
            : { formulaValue: value.formula };
    }
    const { text, ...rest } = fmt;
    Object.assign(cell.format, rest);
    if (text) cell.format.textFormat = { ...cell.format.textFormat, ...text };
  };

  const fillRow = (r: number, c1: number, c2: number, fmt: Parameters<typeof set>[3]) => {
    for (let c = c1; c <= c2; c++) set(r, c, null, fmt);
  };

  /* 1) 배너 */
  merge(0, 0, 0, COLS - 1);
  set(0, 0, { formula: `=IMAGE(${quoteFormulaString(assets.bannerUrl)}, 1)` });
  fillRow(0, 0, COLS - 1, { backgroundColor: BRAND });

  /* 2) 제목 */
  merge(3, 3, 0, COLS - 1);
  set(3, 0, "견 적 서", { text: { fontSize: 16, bold: true, foregroundColor: WHITE } });
  fillRow(3, 0, COLS - 1, { backgroundColor: BRAND });

  /* 3) 수신자(왼쪽)·공급자(오른쪽) 블록 — 5~11행 */
  const label = { text: { fontSize: 11 } };
  const recv: [string, string, boolean][] = [
    ["수 신 처", `${input.clientCompany} 貴中`, true],
    ["담 당 자", input.clientContact ? `${input.clientContact} 님 貴下` : "", false],
    ["견적 일자", formatKoreanDate(input.issuedOn), false],
    ["문서 번호", input.docNumber, false],
    ["납품 기일", input.deliveryTerm, false],
    ["납품 장소", input.deliveryPlace, false],
    ["결재 조건", input.paymentTerm, false],
  ];
  recv.forEach(([k, v, bold], i) => {
    set(5 + i, 0, k, label);
    set(5 + i, 1, v, { text: { fontSize: 11, bold } });
  });

  const head = { text: { fontSize: 11, bold: true } };
  const val = { text: { fontSize: 10 } };
  // 6행(인덱스 6)부터 공급자 표. 5행 오른쪽은 비워 둔다 (기존 양식)
  set(6, 2, "사 업 자", head);
  merge(6, 6, 3, 5);
  set(6, 3, SUPPLIER.bizNumber, { text: { fontSize: 11 } });
  set(7, 2, "상 호", head);
  set(7, 3, SUPPLIER.company, val);
  set(7, 4, "대 표", head);
  set(7, 5, SUPPLIER.ceo, val);
  set(8, 2, "주 소", head);
  merge(8, 8, 3, 5);
  set(8, 3, SUPPLIER.address, { text: { fontSize: 9 } });
  set(9, 2, "WEB", head);
  merge(9, 9, 3, 5);
  set(9, 3, SUPPLIER.web, {
    text: { fontSize: 9, underline: true, foregroundColor: LINK, link: { uri: SUPPLIER.webUrl } },
  });
  set(10, 2, "종 목", head);
  set(10, 3, SUPPLIER.bizType, val);
  set(10, 4, "업 태", head);
  set(10, 5, SUPPLIER.bizItem, val);
  set(11, 2, "전 화", head);
  set(11, 3, SUPPLIER.phone, val);
  set(11, 4, "팩 스", head);
  set(11, 5, SUPPLIER.fax, val);

  /* 4) 견적가 */
  set(13, 0, "견 적 가", { text: { fontSize: 11 } });
  set(13, 1, "하기 견적 참조", { text: { fontSize: 11, bold: true, underline: true } });

  /* 5) 품목 표 머리 */
  ["품 목", "품 명", "수 량", "공급단가", "금 액", "비 고"].forEach((h, c) =>
    set(L.headerRow, c, h, { backgroundColor: BRAND, text: { fontSize: 11, bold: true, foregroundColor: WHITE } }),
  );

  /* 6) 품목 행 */
  input.items.forEach((item, i) => {
    const r = L.itemStart + i;
    const a1 = r + 1; // 수식은 시트 화면의 행 번호를 쓴다
    if (item.group) set(r, 0, item.group);
    set(r, 1, item.name, { wrapStrategy: "WRAP" });
    set(r, 2, item.quantity, { numberFormat: NUMBER });
    set(r, 3, item.unitPrice, { numberFormat: NUMBER });
    set(r, 4, { formula: `=C${a1}*D${a1}` }, { numberFormat: NUMBER });
    if (item.note) set(r, 5, item.note, { wrapStrategy: "WRAP" });
  });
  for (const [s, e] of groupSpans(input.items)) merge(L.itemStart + s, L.itemStart + e, 0, 0);
  // 여백 행에도 금액 서식을 깔아 둔다 — 시트에서 직접 한 줄 더 적을 때 모양이 맞게
  set(L.itemEnd + 1, 4, null, { numberFormat: NUMBER });

  /* 7) 합계 */
  const firstA1 = L.itemStart + 1;
  const blankA1 = L.itemEnd + 2; // 여백 행까지 합산 범위에 넣는다
  const totals: [number, string, string, Rgb | undefined, Rgb | undefined][] = [
    [L.supplyRow, "합 계", `=SUM(E${firstA1}:E${blankA1})`, GRAY, undefined],
    [L.vatRow, "부 가 가 치 세", `=ROUNDDOWN(D${L.supplyRow + 1}*0.1, 0)`, undefined, RED],
    [L.totalRow, "합 계 (VAT 포함)", `=D${L.supplyRow + 1}+D${L.vatRow + 1}`, GRAY, undefined],
  ];
  for (const [r, text, formula, bg, color] of totals) {
    merge(r, r, 0, 2);
    merge(r, r, 3, 5);
    fillRow(r, 0, COLS - 1, bg ? { backgroundColor: bg } : {});
    set(r, 0, text, { text: { fontSize: 11, bold: true } });
    set(r, 3, { formula }, { numberFormat: NUMBER, text: { fontSize: 11, bold: true, ...(color ? { foregroundColor: color } : {}) } });
  }

  /* 8) 참고·담당자 */
  const noteTop = L.totalRow + 3;
  merge(noteTop, noteTop + 2, 0, 0);
  set(noteTop, 0, "참고", { text: { bold: true } });
  merge(noteTop, noteTop + 2, 2, 2);
  set(noteTop, 2, "담당자", { text: { bold: true } });
  const contacts: [string, string][] = [
    ["담 당 :", SUPPLIER.managerName],
    ["전 화 :", SUPPLIER.managerPhone],
    ["메 일 :", SUPPLIER.managerEmail],
  ];
  for (let i = 0; i < 3; i++) {
    const r = noteTop + i;
    set(r, 1, ESTIMATE_NOTES[i], { horizontalAlignment: "LEFT", text: { fontSize: 9 } });
    set(r, 3, contacts[i][0]);
    merge(r, r, 4, 5);
    set(r, 4, contacts[i][1]);
  }

  /* 9) 서명 */
  merge(L.footerRow, L.footerRow, 0, 2);
  if (assets.sealUrl) {
    set(L.footerRow, 0, SUPPLIER.sealName, { horizontalAlignment: "RIGHT", text: { fontSize: 14 } });
    set(L.footerRow, 3, { formula: `=IMAGE(${quoteFormulaString(assets.sealUrl)}, 4, 64, 64)` }, { horizontalAlignment: "LEFT" });
  } else {
    set(L.footerRow, 0, `${SUPPLIER.sealName} (인)`, { horizontalAlignment: "RIGHT", text: { fontSize: 14 } });
  }

  /* ── 요청 조립 ── */
  const out: object[] = [];

  out.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { rowCount: L.rowCount, columnCount: COLS, hideGridlines: true } },
      fields: "gridProperties(rowCount,columnCount,hideGridlines)",
    },
  });

  COLUMN_WIDTHS.forEach((px, c) =>
    out.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: c, endIndex: c + 1 },
        properties: { pixelSize: px },
        fields: "pixelSize",
      },
    }),
  );

  // 품목 행은 높이를 고정하지 않는다 — 긴 품명이 줄바꿈되면 시트가 알아서 늘린다
  const heights: [number, number][] = [
    [0, 120], [1, 10], [2, 10], [3, 34], [4, 10],
    ...Array.from({ length: 7 }, (_, i): [number, number] => [5 + i, 24]),
    [12, 10], [13, 28], [14, 10], [L.headerRow, 28],
    [L.supplyRow, 26], [L.vatRow, 26], [L.totalRow, 26],
    [L.totalRow + 1, 16], [L.totalRow + 2, 16],
    [noteTop, 22], [noteTop + 1, 22], [noteTop + 2, 22],
    [noteTop + 3, 16], [noteTop + 4, 16],
    [L.footerRow, 76],
  ];
  for (const [r, px] of heights) {
    out.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: "ROWS", startIndex: r, endIndex: r + 1 },
        properties: { pixelSize: px },
        fields: "pixelSize",
      },
    });
  }

  // 병합은 값보다 먼저 — 병합이 나중에 오면 왼쪽 위가 아닌 칸의 값이 지워진다
  out.push(...requests);

  out.push({
    updateCells: {
      start: { sheetId, rowIndex: 0, columnIndex: 0 },
      rows: grid.map((row) => ({
        values: row.map((cell) => (cell.value ? { userEnteredValue: cell.value, userEnteredFormat: cell.format } : { userEnteredFormat: cell.format })),
      })),
      fields: "userEnteredValue,userEnteredFormat",
    },
  });

  // 테두리 — updateCells 의 userEnteredFormat 이 테두리를 지우므로 반드시 그 뒤에
  const thin = { style: "SOLID", color: BLACK };
  const dotted = { style: "DOTTED", color: BLACK };
  const borders = (r1: number, r2: number, c1: number, c2: number, spec: Record<string, object>) =>
    out.push({ updateBorders: { range: range(r1, r2, c1, c2), ...spec } });

  // 공급자 표
  borders(6, 11, 2, 5, { top: thin, bottom: thin, left: thin, right: thin, innerHorizontal: thin, innerVertical: thin });
  // 품목 표: 머리는 실선, 본문은 점선 격자 + 바깥 좌우 실선
  borders(L.headerRow, L.headerRow, 0, 5, { top: thin, bottom: thin, left: thin, right: thin, innerVertical: thin });
  borders(L.itemStart, L.itemEnd + 1, 0, 5, { left: thin, right: thin, innerHorizontal: dotted, innerVertical: dotted, bottom: dotted });
  // 합계 3행
  borders(L.supplyRow, L.totalRow, 0, 5, { top: thin, bottom: thin, left: thin, right: thin, innerHorizontal: thin });
  borders(L.supplyRow, L.totalRow, 2, 3, { innerVertical: thin });
  // 참고·담당자
  borders(noteTop, noteTop + 2, 0, 5, { top: thin, bottom: thin, left: thin, right: thin });
  borders(noteTop, noteTop + 2, 0, 0, { right: thin });
  borders(noteTop, noteTop + 2, 2, 2, { left: thin, right: thin });

  // 확인 단계에서 합계를 읽을 이름 있는 범위
  const named: [string, number][] = [
    [NAMED_RANGES.supply, L.supplyRow],
    [NAMED_RANGES.vat, L.vatRow],
    [NAMED_RANGES.total, L.totalRow],
  ];
  for (const [name, r] of named) {
    out.push({ addNamedRange: { namedRange: { name, range: range(r, r, 3, 3) } } });
  }

  return { requests: out, layout: L };
}
