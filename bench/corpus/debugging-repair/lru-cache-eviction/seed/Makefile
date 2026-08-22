# Build the cache demo and its test binary.
#
#   make            build both binaries into build/
#   make test       build and run the test suite
#   make clean      remove build/
#
# CXX and CXXFLAGS may be overridden from the environment.

CXX      ?= c++
CXXSTD   ?= -std=c++17
WARNINGS ?= -Wall -Wextra -Wpedantic -Wshadow -Wnon-virtual-dtor
OPT      ?= -O2
CXXFLAGS ?= $(CXXSTD) $(OPT) $(WARNINGS) -Iinclude

BUILD := build
LIB_SRC := src/clock.cpp src/stats.cpp
DEMO_SRC := src/main.cpp
TEST_SRC := tests/harness.cpp tests/run_tests.cpp tests/test_basics.cpp \
            tests/test_eviction.cpp tests/test_table.cpp

LIB_OBJ  := $(LIB_SRC:%.cpp=$(BUILD)/%.o)
DEMO_OBJ := $(DEMO_SRC:%.cpp=$(BUILD)/%.o)
TEST_OBJ := $(TEST_SRC:%.cpp=$(BUILD)/%.o)

DEMO := $(BUILD)/lru_demo
TESTS := $(BUILD)/lru_tests

.PHONY: all test clean

all: $(DEMO) $(TESTS)

$(DEMO): $(LIB_OBJ) $(DEMO_OBJ)
	$(CXX) $(CXXFLAGS) -o $@ $^

$(TESTS): $(LIB_OBJ) $(TEST_OBJ)
	$(CXX) $(CXXFLAGS) -o $@ $^

$(BUILD)/%.o: %.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) -Itests -MMD -MP -c $< -o $@

test: $(TESTS)
	./$(TESTS)

clean:
	rm -rf $(BUILD)

-include $(LIB_OBJ:.o=.d) $(DEMO_OBJ:.o=.d) $(TEST_OBJ:.o=.d)
