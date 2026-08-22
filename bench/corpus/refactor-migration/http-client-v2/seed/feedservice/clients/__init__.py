"""One client per upstream. All of them go through feedservice.gateway."""

from __future__ import annotations

from .catalog import CatalogClient
from .health import HealthClient
from .inventory import InventoryClient
from .pricing import PricingClient

__all__ = ["CatalogClient", "PricingClient", "InventoryClient", "HealthClient"]
