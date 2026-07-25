#!/usr/bin/env python3
"""part-definitions.yaml → SQL (stdout). NAS에서 psql로 파이프해 part_definitions를 동기화한다.

왜 SQL을 뱉는가: NAS 시스템 python에 psycopg가 없어도 되고(pyyaml만 필요),
docker compose exec psql로 그대로 흘려보내면 되기 때문. 의존성 최소.
(더 단순한 대안 = psql `-v parts=<json>` + jsonb_to_recordset 단일 INSERT. 게이트 후 리팩터 후보.)

사용:
  python3 load-parts.py part-definitions.yaml [--prune] > /tmp/parts.sql
  docker compose exec -T postgres psql -U $PG_USER -d $PG_DB -v ON_ERROR_STOP=1 -f /tmp/parts.sql

--prune: YAML에 없는 파트를 active=false로 내린다. **기본은 끔** — 오타(키 대소문자·중복 키)
         하나로 전 사업이 조용히 멈추기 때문. 의도적으로 정리할 때만 쓴다.
"""
import json
import sys

try:
    import yaml
except ImportError:
    sys.exit("FATAL: pyyaml 필요 (apt install python3-yaml)")

# defaults에 있으면 안 되는 키 — 전 파트에 전파되면 사고가 난다
FORBIDDEN_IN_DEFAULTS = {"active", "name"}


def sql_str(s) -> str:
    """SQL 문자열 리터럴로 안전하게 인용(작은따옴표 이스케이프).
    standard_conforming_strings=on 전제 — 생성 SQL 첫 줄에서 명시적으로 켠다."""
    return "'" + str(s).replace("'", "''") + "'"


def deep_merge(base: dict, over: dict) -> dict:
    """1단계 재귀 병합. 얕은 update를 쓰면 파트가 lead_gen: {enabled: true}만 적어도
    defaults의 lead_gen.min_score/sources가 통째로 사라진다(정책이 조용히 바뀜)."""
    out = dict(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    prune = "--prune" in sys.argv
    if not args:
        sys.exit("usage: load-parts.py <part-definitions.yaml> [--prune]")
    with open(args[0], encoding="utf-8") as f:
        doc = yaml.safe_load(f)

    parts = doc.get("parts") or {}
    if not parts:
        sys.exit("FATAL: parts가 비어 있다 — YAML 구조 확인")
    defaults = doc.get("defaults") or {}
    bad = FORBIDDEN_IN_DEFAULTS & set(defaults)
    if bad:
        sys.exit(f"FATAL: defaults에 {sorted(bad)} 를 두면 전 파트에 전파된다 — 파트별로 지정할 것")

    print("SET standard_conforming_strings = on;")   # 백슬래시 리터럴 탈출 방어
    print("BEGIN;")
    keys = []
    for key, cfg in parts.items():
        if not isinstance(cfg, dict):
            sys.exit(f"FATAL: parts.{key} 가 매핑이 아니다")
        merged = deep_merge(defaults, cfg)
        name = merged.get("name", key)
        active = bool(merged.get("active", False))
        keys.append(key)
        blob = json.dumps(merged, ensure_ascii=False, default=str)   # 날짜 스칼라 등 방어
        print(
            f"INSERT INTO part_definitions (part_key, name, active, config) VALUES "
            f"({sql_str(key)}, {sql_str(name)}, {str(active).lower()}, {sql_str(blob)}::jsonb) "
            f"ON CONFLICT (part_key) DO UPDATE SET name=EXCLUDED.name, active=EXCLUDED.active, "
            f"config=EXCLUDED.config, synced_at=now();")

    if prune:
        keylist = ", ".join(sql_str(k) for k in keys)
        print(f"UPDATE part_definitions SET active=false, synced_at=now() "
              f"WHERE part_key NOT IN ({keylist}) AND active RETURNING part_key AS pruned;")
    print("COMMIT;")
    mode = "prune 포함" if prune else "prune 없음(--prune으로 활성화)"
    print(f"\\echo '동기화: {len(keys)}개 파트 upsert, {mode}'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
