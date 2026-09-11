"""Postgres connection pool.

Connection details come from the environment so the same code points at the
compose container locally and a managed instance in production.
"""

import os
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgres://estate:estate@localhost:5433/estate"
)

pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=8, open=False)


@contextmanager
def cursor() -> Iterator[Any]:
    """Dict-row cursor on a pooled connection, committed on clean exit."""
    with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        yield cur


def query(sql: str, params: tuple[Any, ...] | None = None) -> list[dict[str, Any]]:
    with cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def query_one(sql: str, params: tuple[Any, ...] | None = None) -> dict[str, Any] | None:
    rows = query(sql, params)
    return rows[0] if rows else None


def is_ready() -> bool:
    """True when the schema has been applied and holds data."""
    try:
        row = query_one("select count(*) as n from repository")
        return bool(row and row["n"] > 0)
    except Exception:
        return False
