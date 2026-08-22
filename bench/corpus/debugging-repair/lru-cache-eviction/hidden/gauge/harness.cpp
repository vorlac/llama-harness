#include "harness.hpp"

#include <cstdio>
#include <cstring>

namespace harness {

std::vector<TestCase>& registry() {
  static std::vector<TestCase> tests;
  return tests;
}

void record(Context& ctx, const std::string& message, const char* file, int line) {
  std::ostringstream out;
  const char* base = std::strrchr(file, '/');
  out << (base != nullptr ? base + 1 : file) << ":" << line << ": " << message;
  ctx.failures.push_back(out.str());
}

int run_all(const char* filter) {
  int failed = 0;
  int passed = 0;
  int skipped = 0;

  for (const TestCase& test : registry()) {
    if (filter != nullptr && filter[0] != '\0' && std::strstr(test.name, filter) == nullptr) {
      ++skipped;
      continue;
    }
    Context ctx;
    ctx.name = test.name;
    test.fn(ctx);
    if (ctx.failures.empty()) {
      ++passed;
      std::printf("PASS  %s\n", test.name);
    } else {
      ++failed;
      std::printf("FAIL  %s\n", test.name);
      for (const std::string& failure : ctx.failures) {
        std::printf("      %s\n", failure.c_str());
      }
    }
    std::fflush(stdout);
  }

  std::printf("\n%d passed, %d failed", passed, failed);
  if (skipped > 0) {
    std::printf(", %d not selected", skipped);
  }
  std::printf("\n");
  return failed;
}

}  // namespace harness
