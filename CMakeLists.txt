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
      OFF # ON
)

string(TOLOWER "${CMAKE_SYSTEM_NAME}" host_os)
string(TOLOWER "${CMAKE_BUILD_TYPE}" build_type)
string(TOLOWER "${CMAKE_CXX_COMPILER_ARCHITECTURE_ID}" architecture)
set(CMAKE_DEBUG_POSTFIX ".${build_type}.${architecture}")

set(compiler_is_msvc "$<CXX_COMPILER_ID:MSVC>")
set(compiler_is_gnu "$<CXX_COMPILER_ID:GNU>")
set(compiler_is_clang "$<OR:$<CXX_COMPILER_ID:AppleClang>,$<CXX_COMPILER_ID:Clang>>")

add_subdirectory(extern/llama-cpp)
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
# `llama` or `ftxui` — llama.cpp's build is pre-broken upstream and the router does
# not need it (only its configure is exercised, via add_subdirectory above).
add_executable(llama-router
  "${CMAKE_CURRENT_SOURCE_DIR}/src/main.cpp"
)
target_compile_features(llama-router PRIVATE cxx_std_23)
target_include_directories(llama-router
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src/router"
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
  "${CMAKE_CURRENT_SOURCE_DIR}/src/router-tests/scaffold_test.cpp"
)
target_compile_features(router-tests PRIVATE cxx_std_23)
target_include_directories(router-tests
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src/router"
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
add_subdirectory(tools)

if (AUTOFORMAT_SRC_ON_CONFIGURE MATCHES ON)
  # Formatting rules defined by .clangformat
  # Scoped to src/*.[h]pp and src/*.[c]pp
  include(clang-format)
endif()

include(cmake-utils)
