/**
 * 백민주 아티스트 + 작품 13점 등록 (일회성).
 *
 *   node scripts/add-artist-baekminju.mjs <이미지 폴더>           # 미리보기만 (기본)
 *   node scripts/add-artist-baekminju.mjs <이미지 폴더> --apply   # 실제 업로드·등록
 *
 * 어드민 업로드와 같은 방식: Storage `uploads` 에 {uuid}.jpg 로 올리고,
 * portfolio_items.tags 에 "백민주" 를 붙여 아티스트와 연결한다.
 * 이미지는 폭 1920 이하 JPEG 로 맞춘다 (/admin/setup "원본 줄이기" 기준과 동일).
 * 같은 slug 가 이미 있으면 그 작품은 건너뛴다 — 다시 돌려도 중복 등록되지 않는다.
 * env 는 메인 저장소의 .env.local 에서 읽는다 (ENV_FILE 로 바꿀 수 있음).
 */
import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const dir = process.argv[2];
const APPLY = process.argv.includes("--apply");

const ENV_FILE = process.env.ENV_FILE ?? path.join(process.env.HOME, "repos/pe-studio-web/.env.local");
if (existsSync(ENV_FILE)) {
  for (const raw of readFileSync(ENV_FILE, "utf-8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

const TAG = "백민주";
const MAX_WIDTH = 1920;

export const ARTIST = {
  id: "artist-05",
  name: "백민주",
  english_name: "Baek Min-ju",
  role: "페이퍼크래프트 작가 · 로우폴리 푸드·캐릭터",
  photo: null,
  // 작품에서 드러나는 사실만 적었다. 이력·링크는 어드민에서 보완.
  bio: "음식과 인물을 각진 면으로 단순화해 종이로 옮기는 페이퍼크래프트 작가입니다. 브런치·초밥·짬뽕 같은 일상의 음식부터 한복·발레복을 입은 인물 피규어까지, 부드러운 색감과 또렷한 면 분할로 친근한 입체를 만듭니다.",
  specialties: ["로우폴리 페이퍼크래프트", "푸드 미니어처", "캐릭터 피규어"],
  style_tags: ["로우폴리", "파스텔"],
  career: [],
  portfolio_tag: TAG,
  links: [],
  published: true,
  sort_order: 4,
};

const FOOD = ["페이퍼 피규어", "종이 미니어처", "푸드 페이퍼크래프트"];
const FIGURE = ["페이퍼 피규어", "종이 피규어", "캐릭터 굿즈"];

/** file: 폴더 안 파일명, producedAt: 제작 시기 (2026-04 ~ 2026-09 사이로 분산) */
export const WORKS = [
  {
    file: "브런치.jpg", slug: "baekminju-brunch-plate", title: "브런치 플레이트", producedAt: "2026-04-14",
    tags: FOOD, keywords: ["브런치 페이퍼크래프트", "종이 음식 모형"],
    description: "구멍 숭숭 뚫린 식빵 한 장을 중심으로 토마토와 오이 슬라이스, 아보카도 두 쪽, 구멍 난 치즈, 칼집 낸 소시지, 반숙 달걀프라이와 양송이까지 브런치 한 접시의 재료를 하나씩 따로 접어 늘어놓았습니다. 식빵의 기공과 치즈 구멍은 오목하게 파낸 면으로, 토마토 씨는 작은 조각을 덧대어 표현했습니다.",
  },
  {
    file: "초밥.jpg", slug: "baekminju-sushi-set", title: "모둠 초밥", producedAt: "2026-04-27",
    tags: FOOD, keywords: ["초밥 페이퍼크래프트", "종이 초밥", "음식 미니어처"],
    description: "참치·연어·광어·문어·장어·새우·달걀말이·성게 군함과 김말이 두 점까지, 초밥 열두 점을 각각 다른 종이로 만들었습니다. 연어의 흰 지방 줄무늬, 문어 다리의 빨판, 새우 꼬리처럼 생선마다 알아볼 수 있는 특징을 덧댄 조각으로 살렸고, 밥알 부분은 흰 각진 받침으로 통일했습니다.",
  },
  {
    file: "브런치2.png", slug: "baekminju-croissant-brunch", title: "크루아상 브런치", producedAt: "2026-05-09",
    tags: FOOD, keywords: ["크루아상 페이퍼크래프트", "종이 빵 모형"],
    description: "겹겹이 말린 크루아상과 반으로 가른 삶은 달걀, 자몽 반쪽, 한 조각을 잘라낸 까망베르 치즈, 브로콜리를 흰 천 위에 올린 아침 식탁입니다. 크루아상은 마디마다 면을 나눠 부풀어 오른 결을 만들었고, 자몽 과육은 방사형 조각으로 나눴습니다.",
  },
  {
    file: "피자.jpg", slug: "baekminju-quattro-pizza", title: "콰트로 피자", producedAt: "2026-05-21",
    tags: FOOD, keywords: ["피자 페이퍼크래프트", "종이 피자 모형"],
    description: "도우 테두리를 여덟 토막으로 나눠 두른 피자 위에 페퍼로니·올리브, 마르게리타, 하와이안, 버섯 토핑을 조각마다 다르게 올렸습니다. 한 조각을 살짝 빼내 단면을 보여 주며, 올리브와 버섯은 두께가 있는 입체 조각으로 따로 만들어 붙였습니다.",
  },
  {
    file: "짬뽕.jpg", slug: "baekminju-jjamppong", title: "짬뽕", producedAt: "2026-06-02",
    tags: FOOD, keywords: ["짬뽕 페이퍼크래프트", "한식 음식 모형", "종이 음식 미니어처"],
    description: "검은 다각형 그릇에 붉은 국물을 깔고, 굵은 면발 위로 새우 두 마리와 홍합, 오징어 링과 칼집 낸 오징어 몸통, 표고버섯을 얹었습니다. 면발은 길게 접은 조각을 나란히 겹쳐 흐름을 만들었고, 오징어 칼집은 작은 정육면체를 줄지어 세워 표현했습니다.",
  },
  {
    file: "산도.png", slug: "baekminju-fruit-sando", title: "과일 산도", producedAt: "2026-06-24",
    tags: FOOD, keywords: ["과일 산도 페이퍼크래프트", "샌드위치 모형"],
    description: "생크림 사이에 키위, 딸기, 블루베리와 망고를 박아 넣은 일본식 과일 산도 세 조각입니다. 식빵은 연한 미색 종이로 두툼하게 세우고, 단면의 과일은 납작한 조각을 겹쳐 붙여 잘린 면의 무늬를 그대로 옮겼습니다.",
  },
  {
    file: "디저트들.jpg", slug: "baekminju-dessert-set", title: "카눌레와 초콜릿, 도넛", producedAt: "2026-07-02",
    tags: FOOD, keywords: ["디저트 페이퍼크래프트", "종이 도넛", "초콜릿 모형"],
    description: "홈이 깊게 팬 카눌레, 초콜릿 링 도넛, 말차·플레인 폰데링 도넛과 하트·줄무늬·아몬드를 올린 초콜릿 여섯 알을 붉은 바탕 위에 모았습니다. 폰데링의 둥근 알갱이 하나하나를 다면체로 접어 이어 붙였습니다.",
  },
  {
    file: "아이스크림.jpg", slug: "baekminju-soft-ice-cream", title: "소프트 아이스크림 콘", producedAt: "2026-07-15",
    tags: FOOD, keywords: ["아이스크림 페이퍼크래프트", "파스텔 종이 공예"],
    description: "초콜릿·딸기, 소다·레몬, 민트·복숭아 맛 소프트 아이스크림 세 개를 파스텔 톤으로 만들었습니다. 둥글게 감아 올린 아이스크림을 층마다 각진 면으로 나누고, 꼭대기에 체리와 레몬 조각을 올렸습니다.",
  },
  {
    file: "갈비.jpg", slug: "baekminju-galbijjim", title: "갈비찜", producedAt: "2026-08-04",
    tags: FOOD, keywords: ["갈비찜 페이퍼크래프트", "한식 음식 모형"],
    description: "검은 팔각 그릇에 뼈가 붙은 갈비 네 덩이와 당근, 노란 단호박, 대파를 담은 갈비찜입니다. 갈비는 진한 갈색 살과 미색 뼈 단면을 나눠 접었고, 검은 배경 위에서 강한 조명으로 각 면의 명암이 드러나도록 촬영했습니다.",
  },
  {
    file: "발레.jpg", slug: "baekminju-ballerina", title: "발레리나", producedAt: "2026-08-12",
    tags: FIGURE, keywords: ["발레리나 페이퍼크래프트", "종이 인형 피규어"],
    description: "흰 튀튀를 입고 두 팔을 벌린 발레리나의 뒷모습입니다. 튀튀는 얇은 종이를 주름 접어 펼쳤고, 등의 검은 스트랩과 한쪽 다리의 레그워머, 관절마다 감은 가는 끈까지 작은 디테일을 살렸습니다.",
  },
  {
    file: "비니.jpg", slug: "baekminju-beanie-girl", title: "비니 소녀", producedAt: "2026-08-21",
    tags: FIGURE, keywords: ["캐릭터 페이퍼크래프트", "종이 인형 피규어"],
    description: "노란 비니에 분홍 카디건, 회색 원피스를 입고 두툼한 굽의 신발을 신은 소녀 피규어입니다. 얼굴은 이목구비 없이 면 분할만으로 남겨 두고, 카디건 단추와 비니의 라벨처럼 옷차림의 작은 요소로 인상을 만들었습니다.",
  },
  {
    file: "목장소녀.jpg", slug: "baekminju-ranch-girl", title: "목장 소녀", producedAt: "2026-08-29",
    tags: FIGURE, keywords: ["캐릭터 페이퍼크래프트", "종이 피규어"],
    description: "금발 단발에 분홍 원피스, 연두색 퍼프소매와 주름 치마단, 갈색 부츠를 갖춘 목장 소녀입니다. 앞머리는 끝을 뾰족하게 자른 조각을 겹쳐 붙였고, 치맛단의 물결무늬 띠와 초커로 색의 포인트를 줬습니다.",
  },
  {
    file: "한복.jpg", slug: "baekminju-hanbok-girl", title: "한복 소녀", producedAt: "2026-09-03",
    tags: [...FIGURE, "전통 종이공예"], keywords: ["한복 페이퍼크래프트", "한복 인형", "종이 한복 피규어"],
    description: "댕기 머리를 땋아 늘인 소녀가 팥죽색 저고리와 하늘색 치마를 입고 서 있습니다. 초록 고름과 끝동, 깃을 덧대 저고리의 구조를 살렸고, 치마는 위아래 두 단의 다면체로 나눠 풍성하게 퍼지는 실루엣을 만들었습니다.",
  },
];

function summaryOf(title) {
  // 받침 유무에 맞춰 조사를 고른다 (예: 짬뽕을 / 피자를)
  const last = title.charCodeAt(title.length - 1);
  const hasFinal = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
  return `"${title}"${hasFinal ? "을" : "를"} 각진 면으로 단순화해 표현한 백민주 작가의 페이퍼 크래프트입니다. 순수 종이로 만든 수제 작품입니다.`;
}

export function buildRow(work, images, now) {
  return {
    id: randomUUID(),
    slug: work.slug,
    title: work.title,
    summary: summaryOf(work.title),
    category: "페이퍼 크래프트",
    description: work.description,
    client: "",
    client_type: "전시·행사",
    tags: [...work.tags, TAG],
    keywords: work.keywords,
    images,
    image_alts: images.map(() => `${work.title} 페이퍼크래프트 — 백민주 작가 작품`),
    published: true,
    featured: false,
    produced_at: work.producedAt,
    created_at: now,
    updated_at: now,
  };
}

/** 폭 1920 이하 JPEG 로 맞춘다. 이미 작은 JPEG 은 그대로 둔다 (재압축으로 화질만 깎이지 않게). */
async function prepare(file) {
  const input = readFileSync(file);
  const meta = await sharp(input).metadata();
  if (meta.format === "jpeg" && (meta.width ?? 0) <= MAX_WIDTH) return { buffer: input, meta, changed: false };
  const buffer = await sharp(input).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  return { buffer, meta, changed: true };
}

async function main() {
  if (!dir || !existsSync(dir)) {
    console.error("사용법: node scripts/add-artist-baekminju.mjs <이미지 폴더> [--apply]");
    process.exit(1);
  }
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (APPLY && (!url || !key)) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 누락");
    process.exit(1);
  }
  const sb = APPLY ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  const now = new Date().toISOString();

  if (APPLY) {
    const { data: existing } = await sb.from("artists").select("created_at").eq("id", ARTIST.id).maybeSingle();
    const { error } = await sb.from("artists").upsert({ ...ARTIST, created_at: existing?.created_at ?? now, updated_at: now });
    if (error) throw new Error(`artists 저장 실패: ${error.message}`);
  }
  console.log(`${APPLY ? "✔" : "·"} 아티스트 ${ARTIST.name} (${ARTIST.id})`);

  let done = 0, skipped = 0;
  for (const work of WORKS) {
    const file = path.join(dir, work.file);
    if (!existsSync(file)) throw new Error(`파일 없음: ${file}`);
    const { buffer, meta, changed } = await prepare(file);
    const sizeKb = Math.round(buffer.length / 1024);
    const shape = `${meta.width}x${meta.height}${changed ? " → 축소/JPEG" : ""} ${sizeKb}KB`;

    if (!APPLY) {
      console.log(`· ${work.producedAt} ${work.title} [${work.slug}] ${shape}`);
      continue;
    }
    const { data: dup } = await sb.from("portfolio_items").select("id").eq("slug", work.slug).maybeSingle();
    if (dup) {
      console.log(`- 건너뜀(이미 있음) ${work.title}`);
      skipped++;
      continue;
    }
    const filename = `${randomUUID()}.jpg`;
    const up = await sb.storage.from("uploads").upload(filename, buffer, { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" });
    if (up.error) throw new Error(`업로드 실패 ${work.file}: ${up.error.message}`);
    const publicUrl = sb.storage.from("uploads").getPublicUrl(filename).data.publicUrl;
    const { error } = await sb.from("portfolio_items").insert(buildRow(work, [publicUrl], now));
    if (error) throw new Error(`작품 저장 실패 ${work.title}: ${error.message}`);
    console.log(`✔ ${work.producedAt} ${work.title} ${shape}`);
    done++;
  }
  console.log(APPLY ? `완료: 등록 ${done}, 건너뜀 ${skipped}` : "미리보기만 했습니다. 실제 등록은 --apply");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
