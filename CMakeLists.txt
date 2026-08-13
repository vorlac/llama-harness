cmake_minimum_required(VERSION 3.22)
set(CMAKE_MESSAGE_LOG_LEVEL STATUS)

list(APPEND CMAKE_MODULE_PATH
  "${CMAKE_CURRENT_SOURCE_DIR}/cmake"
)

include(vcpkg-init)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_EXTENSIONS ON)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_COLOR_DIAGNOSTICS ON)
set(CMAKE_DIRECTORY_LABELS ON)

project(myprogram
  LANGUAGES
    C CXX
  VERSION
    0.0.1
)

option(
  AUTOFORMAT_SRC_ON_CONFIGURE
    "If enabled, clang-format will be used to format all sources in src/ during configuration"
      ON
)

string(TOLOWER "${CMAKE_SYSTEM_NAME}" host_os)
string(TOLOWER "${CMAKE_BUILD_TYPE}" build_type)
string(TOLOWER "${CMAKE_CXX_COMPILER_ARCHITECTURE_ID}" architecture)
set(CMAKE_DEBUG_POSTFIX ".${build_type}.${architecture}")

set(compiler_is_msvc "$<CXX_COMPILER_ID:MSVC>")
set(compiler_is_gnu "$<CXX_COMPILER_ID:GNU>")
set(compiler_is_clang "$<OR:$<CXX_COMPILER_ID:AppleClang>,$<CXX_COMPILER_ID:Clang>>")

# llama.cpp pins itself to C++17 and marks it "don't bump" (extern/llama-cpp
# src/CMakeLists.txt, ggml/src/CMakeLists.txt). CMAKE_CXX_STANDARD is inherited by
# add_subdirectory, so leaving it at 23 compiles the vendored sources at a standard
# upstream never builds against: under C++23 std::make_unique is constexpr, which
# instantiates llama_model_dflash::graph<>/llama_model_eagle3::graph<> before the
# explicit specializations further down those files and fails to compile. Our own
# targets request cxx_std_23 individually, so scoping the submodule to 17 costs
# nothing here.
set(CMAKE_CXX_STANDARD 17)
add_subdirectory(extern/llama-cpp)
set(CMAKE_CXX_STANDARD 23)

find_package(spdlog CONFIG REQUIRED)

# llama-router build dependencies (vcpkg ports; spdlog already found above).
find_package(httplib CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)
find_package(nlohmann_json_schema_validator CONFIG REQUIRED)
find_package(doctest CONFIG REQUIRED)

enable_testing()

# The C++ llama-router (Task 11.x): a fail-soft proxy/scheduler in front of
# llama-server. Sources are added per TDD task; Task 11.1 is the scaffold (main
# only). It links the (header-only) web/JSON libraries plus spdlog and NEVER links
# `llama` or `ftxui` — the router proxies to a separately-launched `llama-server`
# and needs neither library.
add_executable(llama-router
  "${CMAKE_CURRENT_SOURCE_DIR}/router/main.cpp"
)
target_compile_features(llama-router PRIVATE cxx_std_23)
# The REPO ROOT is the only user-code include root: every in-workspace header is
# included by its full path from the root (`#include "router/version.hpp"`), so an
# include names where the header actually lives no matter which file includes it.
# The spelling is unchanged from when the sources sat under src/ — router/ simply
# moved up a level, so the include root moved with it.
target_include_directories(llama-router
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}"
)
target_link_libraries(llama-router
  PRIVATE spdlog::spdlog
  PRIVATE httplib::httplib
  PRIVATE nlohmann_json::nlohmann_json
  PRIVATE nlohmann_json_schema_validator::validator
)

# router-tests: the doctest suite, registered with ctest. Sources grow per task;
# 11.1 is a single scaffold case. (Per-case doctest_discover_tests can replace the
# whole-binary add_test once configure is confirmed.)
add_executable(router-tests
  "${CMAKE_CURRENT_SOURCE_DIR}/router/tests/scaffold_test.cpp"
  "${CMAKE_CURRENT_SOURCE_DIR}/router/tests/config_test.cpp"
  "${CMAKE_CURRENT_SOURCE_DIR}/router/tests/proxy_test.cpp"
  "${CMAKE_CURRENT_SOURCE_DIR}/router/tests/admission_test.cpp"
  "${CMAKE_CURRENT_SOURCE_DIR}/router/tests/affinity_test.cpp"
  "${CMAKE_CURRENT_SOURCE_DIR}/router/tests/schema_observer_test.cpp"
  "${CMAKE_CURRENT_SOURCE_DIR}/router/tests/metrics_test.cpp"
  "${CMAKE_CURRENT_SOURCE_DIR}/router/tests/cli_test.cpp"
)
target_compile_features(router-tests PRIVATE cxx_std_23)
target_include_directories(router-tests
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}"
)
target_link_libraries(router-tests
  PRIVATE doctest::doctest
  PRIVATE spdlog::spdlog
  PRIVATE httplib::httplib
  PRIVATE nlohmann_json::nlohmann_json
  PRIVATE nlohmann_json_schema_validator::validator
)
add_test(NAME router-tests COMMAND router-tests)

# Standalone measurement tools. These carry no project dependencies so they can
# also be built directly with a single compiler invocation - see tools/README.md.
# They live OUTSIDE router/ because they are not part of the router: membench is a
# dependency-free measurement probe that links neither the router nor its libraries.
add_subdirectory(tools)

if (AUTOFORMAT_SRC_ON_CONFIGURE MATCHES ON)
  # Formatting rules defined by .clangformat
  # Scoped to the workspace's own C++: router/ and tools/ (never extern/).
  include(clang-format)
endif()

include(cmake-utils)
