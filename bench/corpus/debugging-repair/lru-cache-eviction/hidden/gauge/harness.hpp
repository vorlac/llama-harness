// Minimal self-contained test harness.
//
// A test is a free function registered at static-initialisation time:
//
//   TEST(some_behaviour) {
//     CHECK_EQ(actual, expected);
//     CHECK(condition);
//   }
//
// Checks record a failure and keep going, so one test reports every mismatch it
// finds rather than only the first. run_all() prints one line per test and
// returns the number of failed tests.
#ifndef LRU_TESTS_HARNESS_HPP
#define LRU_TESTS_HARNESS_HPP

#include <ostream>
#include <sstream>
#include <string>
#include <vector>

namespace harness {

// Makes CHECK_EQ usable on the sequences the cache hands back.
template <class T>
std::ostream& operator<<(std::ostream& out, const std::vector<T>& values) {
  out << "[";
  for (std::size_t i = 0; i < values.size(); ++i) {
    if (i != 0) {
      out << ", ";
    }
    out << values[i];
  }
  out << "]";
  return out;
}

struct Context {
  std::string name;
  std::vector<std::string> failures;
};

using TestFn = void (*)(Context&);

struct TestCase {
  const char* name;
  TestFn fn;
};

std::vector<TestCase>& registry();

struct Registrar {
  Registrar(const char* name, TestFn fn) { registry().push_back(TestCase{name, fn}); }
};

void record(Context& ctx, const std::string& message, const char* file, int line);

inline void check(Context& ctx, bool ok, const char* expression, const char* file,
                  int line) {
  if (!ok) {
    record(ctx, std::string("expected true: ") + expression, file, line);
  }
}

template <class A, class B>
void check_eq(Context& ctx, const A& actual, const B& expected, const char* actual_text,
              const char* expected_text, const char* file, int line) {
  if (!(actual == expected)) {
    std::ostringstream out;
    out << actual_text << " == " << expected_text << "\n         actual:   " << actual
        << "\n         expected: " << expected;
    record(ctx, out.str(), file, line);
  }
}

// Runs every registered test whose name contains `filter` (nullptr or an empty
// string runs all of them). Returns the number of failed tests.
int run_all(const char* filter);

}  // namespace harness

#define TEST(test_name)                                                      \
  static void test_name(harness::Context& ctx_);                             \
  static const harness::Registrar registrar_##test_name(#test_name,          \
                                                        &test_name);         \
  static void test_name(harness::Context& ctx_)

#define CHECK(condition) harness::check(ctx_, (condition), #condition, __FILE__, __LINE__)

#define CHECK_EQ(actual, expected)                                           \
  harness::check_eq(ctx_, (actual), (expected), #actual, #expected, __FILE__, \
                    __LINE__)

#endif  // LRU_TESTS_HARNESS_HPP
