#pragma once

namespace conductor::router {

    // The router's build version, reported by /conductor/health and by --version.
    // Kept header-only so both the llama-router binary and router-tests link it
    // without a translation unit.
    inline constexpr const char* kRouterVersion = "0.0.1";

    inline const char* router_version() {
        return kRouterVersion;
    }

}  // namespace conductor::router
