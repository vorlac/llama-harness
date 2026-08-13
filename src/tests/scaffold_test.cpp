#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest/doctest.h>

#include <string>

#include "router/version.hpp"

TEST_CASE("router scaffold: version helper returns the build version") {
    CHECK(std::string(conductor::router::router_version()) == "0.0.1");
}
