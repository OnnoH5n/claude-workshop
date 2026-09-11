"""FastAPI service between the browser and Postgres.

The JSON contract is identical to the TypeScript middle tier it replaces, so the
existing Playwright suite verifies the swap rather than being rewritten around it.

In development Vite proxies /api here (see vite.config.ts), so the browser still
sees a single origin and needs no CORS. In production this process serves the built
frontend from dist/ as well.
"""

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

import queries
from db import is_ready, pool
from ingest import ingest
from models import (
    ComponentsResponse,
    PortfolioResponse,
    RepoResponse,
    ResetResponse,
)

DIST = Path(__file__).resolve().parent.parent / "dist"


@asynccontextmanager
async def lifespan(_: FastAPI) -> Any:
    pool.open()
    # First run against an empty database bootstraps itself rather than 500-ing.
    if not is_ready():
        ingest()
    yield
    pool.close()


app = FastAPI(title="Java estate — quality & lifecycle", lifespan=lifespan)


@app.get("/api/portfolio", response_model=PortfolioResponse)
def portfolio() -> dict[str, Any]:
    return queries.get_portfolio()


@app.get("/api/repos/{name}", response_model=RepoResponse)
def repo(name: str) -> dict[str, Any]:
    found = queries.get_repo(name)
    if found is None:
        raise HTTPException(status_code=404, detail=f"no repo {name}")
    return {"repo": found}


@app.get("/api/components", response_model=ComponentsResponse)
def components(
    q: str = Query(min_length=3, description="Substring of group:artifact"),
) -> dict[str, Any]:
    """The question a bare component count could never answer: during an incident,
    which repositories ship this dependency, and at what version."""
    return {"matches": queries.find_component(q)}


@app.post("/api/reset", response_model=ResetResponse)
def reset() -> dict[str, Any]:
    """Re-applies the schema and re-ingests the seed. Gives tests a clean starting
    state and lets the demo be re-run from scratch in front of an audience."""
    return {"repos": ingest()}


# Production only: in dev, Vite serves the frontend and proxies /api here.
if DIST.is_dir():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="frontend")
