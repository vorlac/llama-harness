"""Prove the vendored modern_http library works in this checkout.

    python3 -m modern_http._selfcheck

This exercises the library directly against wirenet. It is not part of the
service and migrates nothing; it exists so that a caller who hits a problem can
tell whether the fault is in their code or in the library.
"""

from __future__ import annotations

import asyncio
import sys

import wirenet

import modern_http as mh


def _world():
    wirenet.reset()

    state = {"flaky": 0}

    def ok(request):
        if request.path == "/slow-connect":
            return wirenet.json_reply({"ok": True}, connect_delay=0.4, delay=0.8)
        if request.path == "/teapot":
            return wirenet.json_reply({"error": "teapot"}, status=418)
        if request.path == "/throttled":
            return wirenet.json_reply({"error": "slow down"}, status=429,
                                      headers={"retry-after": "0"})
        if request.path == "/stream":
            return wirenet.ndjson_reply(
                [{"n": n} for n in range(5)], chunk_sizes=[13, 13, 13],
                fault_after=2, fault_kind="timeout")
        if request.path == "/flaky":
            state["flaky"] += 1
            if state["flaky"] < 3:
                return wirenet.json_reply({"error": "again"}, status=503)
            return wirenet.json_reply({"attempt": state["flaky"]})
        return wirenet.json_reply({"path": request.path,
                                   "echo": request.json()})

    def broken(request):
        raise wirenet.Fault("protocol", "garbage on the wire")

    wirenet.serve("ok.internal", ok)
    wirenet.serve("broken.internal", broken)


def check(label, condition):
    print("  %-52s %s" % (label, "ok" if condition else "FAILED"))
    if not condition:
        raise SystemExit("selfcheck failed: %s" % label)


async def main() -> int:
    _world()
    seen = []

    async def hook(request):
        seen.append((request.method, request.url))

    mh.clear_request_hooks()
    mh.add_request_hook(hook)

    async with mh.ClientSession(base_url="http://ok.internal",
                                timeout=mh.Timeout(total=1.0)) as session:
        response = await session.get("/thing", params={"a": "1"})
        check("GET returns 200", response.status == 200)
        check("json() decodes", response.json()["path"] == "/thing")
        check("is_success", response.is_success)

        posted = await session.post("/echo", json={"ids": [1, 2]})
        check("POST echoes body", posted.json()["echo"] == {"ids": [1, 2]})

        teapot = await session.get("/teapot")
        check("4xx does not raise by default", teapot.status == 418)
        try:
            teapot.raise_for_status()
            raised = None
        except mh.ClientError as exc:
            raised = exc
        check("raise_for_status raises ClientError", raised is not None)
        check("exception carries the response", raised.response.status == 418)

        try:
            await session.get("/throttled", raise_on_status=True)
            throttle = None
        except mh.TooManyRequests as exc:
            throttle = exc
        check("429 -> TooManyRequests", throttle is not None)
        check("retry_after parsed", throttle.retry_after == 0.0)
        check("TooManyRequests is a ClientError",
              isinstance(throttle, mh.ClientError))

        try:
            await session.get("/slow-connect")
            timed_out = None
        except mh.TransportError as exc:
            timed_out = exc
        check("total budget catches connect+read",
              isinstance(timed_out, mh.ReadTimeout))

        lines = []
        try:
            async with session.stream("GET", "/stream") as stream:
                async for line in stream.aiter_lines():
                    lines.append(line)
            dropped = None
        except mh.ReadTimeout as exc:
            dropped = exc
        check("truncated stream raises ReadTimeout", dropped is not None)
        check("lines before the drop were delivered", len(lines) == 2)

        check("request_count counts every attempt", session.request_count == 6)

    async with mh.ClientSession(timeout=mh.Timeout(read=1.0)) as session:
        try:
            await session.get("http://broken.internal/x")
            fault = None
        except mh.TransportError as exc:
            fault = exc
        check("wire fault -> ProtocolError", isinstance(fault, mh.ProtocolError))
        try:
            await session.get("http://nowhere.internal/x")
            missing = None
        except mh.TransportError as exc:
            missing = exc
        check("unknown host -> ConnectError", isinstance(missing, mh.ConnectError))

    session = mh.ClientSession(base_url="http://ok.internal")
    try:
        await session.get("/thing")
        unstarted = None
    except mh.ConfigurationError as exc:
        unstarted = exc
    check("unstarted session refuses to work", unstarted is not None)

    try:
        mh.Timeout(read=-1)
        bad = None
    except mh.ConfigurationError as exc:
        bad = exc
    check("Timeout validates its fields", bad is not None)

    def not_async(request):
        return None

    try:
        mh.add_request_hook(not_async)
        sync_hook = None
    except mh.ConfigurationError as exc:
        sync_hook = exc
    check("sync hooks are rejected", sync_hook is not None)

    check("hook saw every request", len(seen) == 8)
    mh.clear_request_hooks()
    print("modern_http %s selfcheck passed" % mh.__version__)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
