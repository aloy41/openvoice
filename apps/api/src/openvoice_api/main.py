"""FastAPI application factory.

The engine and Redis client are created eagerly (they connect lazily) so tests
can construct apps without running the lifespan; the lifespan only logs and
disposes resources.
"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import Environment, Settings
from .logging_setup import configure_logging, request_id_var
from .routers import (
    auth,
    communities,
    dev_auth,
    health,
    invites,
    messages,
    moderation,
    roles,
    voice,
    ws,
)
from .security import new_csrf_token

log = logging.getLogger("openvoice.api")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings if settings is not None else Settings()  # type: ignore[call-arg]
    configure_logging(settings.log_level)

    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    redis_client: aioredis.Redis = aioredis.from_url(  # type: ignore[no-untyped-call]
        settings.redis_url, socket_connect_timeout=2, socket_timeout=2
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        log.info(
            "api starting",
            extra={
                "extra_fields": {
                    "environment": settings.environment.value,
                    "dev_auth_enabled": settings.dev_auth_enabled,
                }
            },
        )
        yield
        await engine.dispose()
        await redis_client.aclose()

    app = FastAPI(
        title="Openvoice API",
        version="0.1.0",
        lifespan=lifespan,
        openapi_url="/api/openapi.json",
        docs_url=None if settings.environment is Environment.PRODUCTION else "/api/docs",
        redoc_url=None,
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.sessionmaker = sessionmaker
    app.state.redis = redis_client

    @app.middleware("http")
    async def request_context(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        req_id = request.headers.get("x-request-id") or uuid.uuid4().hex
        ctx_token = request_id_var.set(req_id)
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            log.exception(
                "unhandled error",
                extra={"extra_fields": {"method": request.method, "path": request.url.path}},
            )
            response = JSONResponse(
                status_code=500,
                content={
                    "code": "internal_error",
                    "message": "An internal error occurred.",
                    "request_id": req_id,
                },
            )
        duration_ms = round((time.perf_counter() - start) * 1000, 1)
        response.headers["x-request-id"] = req_id
        # Double-submit CSRF: every browser ends up with a CSRF cookie it can
        # echo in the x-csrf-token header (validated in deps.require_csrf).
        if settings.csrf_cookie_name not in request.cookies:
            response.set_cookie(
                settings.csrf_cookie_name,
                new_csrf_token(),
                max_age=settings.session_max_age_seconds,
                httponly=False,
                samesite="lax",
                secure=settings.effective_cookie_secure,
                path="/",
            )
        log.info(
            "request",
            extra={
                "extra_fields": {
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "duration_ms": duration_ms,
                }
            },
        )
        request_id_var.reset(ctx_token)
        return response

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        if isinstance(exc.detail, dict) and "code" in exc.detail:
            body: dict[str, object] = dict(exc.detail)
        else:
            body = {"code": "http_error", "message": str(exc.detail)}
        body["request_id"] = request_id_var.get()
        return JSONResponse(status_code=exc.status_code, content=body, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        field_errors = [
            {"loc": list(err.get("loc", [])), "msg": err.get("msg"), "type": err.get("type")}
            for err in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={
                "code": "validation_error",
                "message": "Request validation failed.",
                "request_id": request_id_var.get(),
                "field_errors": field_errors,
            },
        )

    app.include_router(health.router, prefix="/api")
    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(dev_auth.router, prefix="/api/v1")
    app.include_router(voice.router, prefix="/api/v1")
    app.include_router(communities.router, prefix="/api/v1")
    app.include_router(invites.router, prefix="/api/v1")
    app.include_router(moderation.router, prefix="/api/v1")
    app.include_router(roles.router, prefix="/api/v1")
    app.include_router(messages.router, prefix="/api/v1")
    app.include_router(ws.router, prefix="/api/v1")

    return app
