# membench is deliberately free of project dependencies: it is a measurement
# tool, and scripts/hostinfo.py compiles it on demand with a plain clang++ call
# when no CMake build tree is around. Keep it that way - no vcpkg, no llama.
#
# The compiler checks below are spelled out rather than reusing the root scope's
# compiler_is_* generator expressions so this directory stays self-contained.

add_executable(membench
  membench.cpp
)

target_compile_features(membench
  PRIVATE
    cxx_std_23
)

find_package(Threads REQUIRED)

target_link_libraries(membench
  PRIVATE Threads::Threads
)

if (CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(membench
    PRIVATE
      -Wall
      -Wcast-align
      -Wpedantic
      -Wno-unused-parameter
  )

  # Optimization is not a nicety here. An -O0 build measures loop overhead
  # rather than the memory system, so force it on even in a Debug configuration.
  target_compile_options(membench
    PRIVATE
      -O3
  )
elseif (MSVC)
  target_compile_options(membench
    PRIVATE
      /W4
      /O2
  )
endif()
