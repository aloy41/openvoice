"""Minimal, dependency-free Prometheus metrics.

We deliberately avoid pulling in a metrics client library: the surface here is
small (request counts/latency + a liveness gauge) and a handful of counters
rendered as Prometheus text is enough for an operator to scrape with Prometheus
or point an uptime monitor at. Exposed at GET /api/metrics.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict


class Metrics:
    """Process-wide counters. Thread-safe (Starlette may run the sync render
    off the event loop); increments are cheap dict updates under a lock."""

    def __init__(self, *, start_time: float) -> None:
        self._start_time = start_time
        self._lock = threading.Lock()
        # (method, status_class) -> count, e.g. ("GET", "2xx")
        self._requests: dict[tuple[str, str], int] = defaultdict(int)
        self._duration_ms_sum: float = 0.0
        self._duration_count: int = 0

    def observe_request(self, method: str, status_code: int, duration_ms: float) -> None:
        status_class = f"{status_code // 100}xx"
        with self._lock:
            self._requests[(method.upper(), status_class)] += 1
            self._duration_ms_sum += duration_ms
            self._duration_count += 1

    def render(self, *, now: float) -> str:
        with self._lock:
            requests = dict(self._requests)
            duration_sum = self._duration_ms_sum
            duration_count = self._duration_count
        lines: list[str] = [
            "# HELP openvoice_up 1 if the process is serving.",
            "# TYPE openvoice_up gauge",
            "openvoice_up 1",
            "# HELP openvoice_uptime_seconds Seconds since process start.",
            "# TYPE openvoice_uptime_seconds gauge",
            f"openvoice_uptime_seconds {now - self._start_time:.1f}",
            "# HELP openvoice_requests_total HTTP requests by method and status class.",
            "# TYPE openvoice_requests_total counter",
        ]
        for (method, status_class), count in sorted(requests.items()):
            lines.append(
                f'openvoice_requests_total{{method="{method}",status="{status_class}"}} {count}'
            )
        lines += [
            "# HELP openvoice_request_duration_ms_sum Total request handling time (ms).",
            "# TYPE openvoice_request_duration_ms_sum counter",
            f"openvoice_request_duration_ms_sum {duration_sum:.1f}",
            "# HELP openvoice_request_duration_count Number of observed requests.",
            "# TYPE openvoice_request_duration_count counter",
            f"openvoice_request_duration_count {duration_count}",
        ]
        return "\n".join(lines) + "\n"


def new_metrics() -> Metrics:
    return Metrics(start_time=time.time())
