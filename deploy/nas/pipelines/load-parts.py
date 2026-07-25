#!/usr/bin/env python3
"""part-definitions.yaml → SQL (stdout). NAS에서 psql로 파이프해 part_definitions를 동기화한다.

왜 SQL을 뱉는가: NAS 시스템 python에 psycopg가 없어도 되고(pyyaml만 필요),
docker compose exec psql로 그대로 흘려보내면 되기 때문. 의존성 최소.

사용:
  python3 load-parts.py part-definitions.yaml > /tmp/parts.sql
  docker compose exec -T postgres psql -U $PG_USER -d $PG_DB -v ON_ERROR_STOP=1 -f /tmp/parts.sql

동작: YAML의 parts를 upsert. **YAML에 없는 파트는 active=false로 내린다**(삭제하지 않음 —
      "대체 검증 전 삭제 금지" 원칙. 이력과 연결된 리드가 고아가 되지 않는다).
"""
import json
import sys

try:
    import yaml
except ImportError:
    sys.exit("FATAL: pyyaml 필요 (apt install python3-yaml)")


def sql_str(s: str) -> str:
    """SQL 문자열 리터럴로 안전하게 인용(작은따옴표 이스케이프)."""
    return "'" + str(s).replace("'", "''") + "'"


def main() -> int:
    if len(sys.argv) < 2:
        sys.exit("usage: load-parts.py <part-definitions.yaml>")
    with open(sys.argv[1], encoding="utf-8") as f:
        doc = yaml.safe_load(f)

    parts = doc.get("parts") or {}
    if not parts:
        sys.exit("FATAL: parts가 비어 있다 — YAML 구조 확인")
    defaults = doc.get("defaults") or {}

    print("BEGIN;")
    keys = []
    for key, cfg in parts.items():
        if not isinstance(cfg, dict):
            sys.exit(f"FATAL: parts.{key} 가 매핑이 아니다")
        merged = dict(defaults)
        merged.update(cfg)
        name = merged.get("name", key)
        active = bool(merged.get("active", False))
        keys.append(key)
        print(
            f"INSERT INTO part_definitions (part_key, name, active, config) VALUES "
            f"({sql_str(key)}, {sql_str(name)}, {str(active).lower()}, {sql_str(json.dumps(merged, ensure_ascii=False))}::jsonb) "
            f"ON CONFLICT (part_key) DO UPDATE SET name=EXCLUDED.name, active=EXCLUDED.active, "
            f"config=EXCLUDED.config, synced_at=now();")

    # YAML에서 사라진 파트는 비활성화(삭제 아님)
    keylist = ", ".join(sql_str(k) for k in keys)
    print(f"UPDATE part_definitions SET active=false, synced_at=now() WHERE part_key NOT IN ({keylist});")
    print("COMMIT;")
    print(f"\\echo '동기화: {len(keys)}개 파트 upsert, 나머지는 비활성화'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
