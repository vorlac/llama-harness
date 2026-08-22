"""The fake upstreams the service is developed and tested against.

These are wirenet servers: plain request-in / reply-out functions that know
nothing about any HTTP client library. They are shared by the test suite and by
the CLI demo, and they are NOT part of any client migration - if you find
yourself editing this file to make a client change work, the client change is
wrong.

Scenarios select one deviation from the healthy world:

    default             everything healthy except media (slow) and search (broken)
    slow-catalog        catalog takes 50ms to answer
    flaky-catalog       catalog answers 503 twice, then succeeds
    protocol-catalog    catalog speaks garbage on the wire, every time
    garbage-catalog     catalog answers 200 with a body that is not JSON
    catalog-offline     nothing is listening on the catalog host
    throttled-pricing   the pricing batch answers 429 once, then succeeds
    reject-pricing      the pricing batch answers 422, every time
    truncated-stream    the live price stream dies part-way through
    bad-inventory-page  the second inventory page answers 422
"""

from __future__ import annotations

from typing import Dict, List

import wirenet

CATALOG_ETAG = "W/\"catalog-v7\""

ITEMS = [
    {"id": "SKU-1", "name": "Aluminium Widget", "category": "widgets"},
    {"id": "SKU-2", "name": "Brass Gizmo", "category": "gizmos"},
    {"id": "SKU-3", "name": "Copper Sprocket", "category": "widgets"},
    {"id": "SKU-4", "name": "Delrin Bushing", "category": "bushings"},
]

# SKU-4 is deliberately unpriced: the report has to cope with a missing price.
PRICES = {
    "SKU-1": {"amount": 1299, "currency": "USD"},
    "SKU-2": {"amount": 450, "currency": "USD"},
    "SKU-3": {"amount": 8725, "currency": "USD"},
}

INVENTORY_PAGES = [
    {"cursor": None, "next": "p2",
     "levels": [{"id": "SKU-1", "on_hand": 12}, {"id": "SKU-2", "on_hand": 0}]},
    {"cursor": "p2", "next": "p3",
     "levels": [{"id": "SKU-3", "on_hand": 7}]},
    {"cursor": "p3", "next": None,
     "levels": [{"id": "SKU-4", "on_hand": 3}]},
]

LIVE_PRICES = [
    {"id": "SKU-1", "amount": 1301},
    {"id": "SKU-2", "amount": 448},
    {"id": "SKU-3", "amount": 8710},
    {"id": "SKU-4", "amount": 199},
]

SCENARIOS = (
    "default", "slow-catalog", "flaky-catalog", "protocol-catalog",
    "garbage-catalog", "catalog-offline", "throttled-pricing",
    "reject-pricing", "truncated-stream", "bad-inventory-page",
)

_HEALTHY = wirenet.json_reply({"status": "ok"})


def install(scenario: str = "default") -> Dict[str, int]:
    """Register the whole fake world. Returns the mutable call-counter dict."""
    if scenario not in SCENARIOS:
        raise ValueError("unknown scenario %r (have: %s)"
                         % (scenario, ", ".join(SCENARIOS)))
    wirenet.reset()
    calls = {"catalog": 0, "pricing": 0, "inventory": 0, "live": 0}

    # ------------------------------------------------------------- catalog

    def catalog(request):
        if request.path == "/healthz":
            return wirenet.json_reply({"status": "ok"})
        if request.path != "/catalog/index":
            return wirenet.json_reply({"error": "no such path"}, status=404)
        calls["catalog"] += 1
        if scenario == "protocol-catalog":
            raise wirenet.Fault("protocol", "catalog spoke gibberish")
        if scenario == "flaky-catalog" and calls["catalog"] <= 2:
            return wirenet.json_reply({"error": "catalog is warming up"},
                                      status=503)
        if scenario == "garbage-catalog":
            return wirenet.WireReply(
                status=200, headers={"content-type": "application/json"},
                body=b"{\"items\": [ this is not json")
        delay = 0.05 if scenario == "slow-catalog" else 0.0
        if request.headers.get("if-none-match") == CATALOG_ETAG:
            return wirenet.WireReply(status=304, headers={"etag": CATALOG_ETAG},
                                     body=b"", delay=delay)
        return wirenet.json_reply({"items": ITEMS, "revision": 7},
                                  headers={"etag": CATALOG_ETAG}, delay=delay)

    # ------------------------------------------------------------- pricing

    def pricing(request):
        if request.path == "/healthz":
            return wirenet.json_reply({"status": "ok"})
        if request.path == "/pricing/live":
            calls["live"] += 1
            kwargs = {}
            if scenario == "truncated-stream":
                kwargs = {"fault_after": 2, "fault_kind": "timeout"}
            return wirenet.ndjson_reply(LIVE_PRICES, chunk_sizes=[40, 40, 40],
                                        **kwargs)
        if request.path != "/pricing/batch":
            return wirenet.json_reply({"error": "no such path"}, status=404)
        if request.method != "POST":
            return wirenet.json_reply({"error": "use POST"}, status=405)
        calls["pricing"] += 1
        if scenario == "reject-pricing":
            return wirenet.json_reply({"error": "batch too large"}, status=422)
        if scenario == "throttled-pricing" and calls["pricing"] == 1:
            return wirenet.json_reply({"error": "slow down"}, status=429,
                                      headers={"retry-after": "0"})
        payload = request.json() or {}
        wanted = [i for i in payload.get("ids", []) if i in PRICES]
        return wirenet.json_reply(
            {"prices": dict((i, PRICES[i]) for i in wanted),
             "missing": sorted(set(payload.get("ids", [])) - set(wanted))})

    # ----------------------------------------------------------- inventory

    def inventory(request):
        if request.path == "/healthz":
            return wirenet.json_reply({"status": "ok"})
        if request.path != "/inventory":
            return wirenet.json_reply({"error": "no such path"}, status=404)
        calls["inventory"] += 1
        cursor = request.param("cursor")
        page = None
        for candidate in INVENTORY_PAGES:
            if candidate["cursor"] == cursor:
                page = candidate
                break
        if page is None:
            return wirenet.json_reply({"error": "bad cursor"}, status=400)
        if scenario == "bad-inventory-page" and cursor == "p2":
            return wirenet.json_reply({"error": "page is corrupt"}, status=422)
        headers = {}
        if page["next"]:
            headers["link"] = ("<http://inventory.internal/inventory?cursor=%s>"
                               "; rel=\"next\"" % page["next"])
        return wirenet.json_reply({"levels": page["levels"]}, headers=headers)

    # -------------------------------------------------- health-only hosts

    def media(request):
        # Answers correctly, but only after a slow connect and a slow read.
        # Neither half exceeds a 1s budget on its own; together they do.
        return wirenet.json_reply({"status": "ok"}, connect_delay=0.4, delay=0.8)

    def search(request):
        raise wirenet.Fault("protocol", "search sent a malformed frame")

    if scenario != "catalog-offline":
        wirenet.serve("catalog.internal", catalog)
    wirenet.serve("pricing.internal", pricing)
    wirenet.serve("inventory.internal", inventory)
    wirenet.serve("media.internal", media)
    wirenet.serve("search.internal", search)
    return calls
