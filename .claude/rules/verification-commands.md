# Verification Commands Reference

Standard commands for verifying build success, checking for legacy patterns, and validating code quality in DeclGUI.

---

## Build Verification

### Full Build (macOS Apple Silicon)
```bash
# Configure with debug preset
cmake --preset macos-arm64-clang-debug

# Build the project
cmake --build build/macos-arm64-clang-debug --parallel

# Run tests
./build/macos-arm64-clang-debug/tests/declgui_unit_tests
```

### Available Presets

| Platform | Debug | Release |
|----------|-------|---------|
| macOS (ARM) | `macos-arm64-clang-debug` | `macos-arm64-clang-release` |

---

## Legacy Pattern Detection

### Check for Primitive Sprawl
```bash
# Separate x, y coordinates (should use ds::point or similar)
grep -rn "i32 x,\s*i32 y\|f32 x,\s*f32 y" include/ --include="*.hpp"

# Separate width, height (should use ds::dims or similar)
grep -rn "i32 width,\s*i32 height\|f32 w,\s*f32 h" include/ --include="*.hpp"

# Separate RGBA (should use Color)
grep -rn "u8 r,\s*u8 g,\s*u8 b" include/ --include="*.hpp"
```

### Check for Function Pointers
```bash
# C-style function pointers (should use std::function or a lambda)
grep -rn "void\s*(\*[a-zA-Z_]*)" include/ --include="*.hpp"
```

---

## Concept Verification

### Check Concept Satisfaction
```bash
# Look for static_assert concept checks
grep -rn "static_assert.*concept" include/ --include="*.hpp"

# Find all concept definitions
grep -rn "^template.*concept\s*\w*\s*=" include/ --include="*.hpp"
```

### Check for Virtual Inheritance
```bash
# Virtual functions (should be minimal - prefer concepts)
grep -rn "virtual\s*~\|virtual\s*bool\|virtual\s*void" include/declgui/core/

# Pure virtual functions
grep -rn "=\s*0\s*;" include/ --include="*.hpp"
```

---

## Code Quality Checks

### Check for TODO/FIXME Comments
```bash
# Find incomplete work markers
grep -rn "TODO\|FIXME\|XXX\|HACK" include/ tests/ --include="*.hpp" --include="*.cpp"
```

### Check for Prohibited Comment Language
```bash
# Change words (should not appear in comments)
grep -rn "//.*changed\|//.*updated\|//.*fixed\|//.*modified" include/

# Temporal words
grep -rn "//.*now\s\|//.*previously\|//.*new\s" include/

# Attribution
grep -rn "//.*Claude\|//.*AI-generated\|//.*per request" include/
```

### Check for Missing [[nodiscard]]
```bash
# Functions returning values without [[nodiscard]]
grep -rn "^\s*[a-zA-Z_<>:]*\s\+[a-zA-Z_]*(" include/ --include="*.hpp" | grep -v nodiscard | grep -v void
```

### Check for C-Style Casts
```bash
# C-style casts (should use static_cast, etc.)
grep -rn "(\s*\w\+\s*\*\?\s*)" include/ --include="*.hpp" | grep -v "static_cast\|dynamic_cast\|reinterpret_cast\|const_cast"
```

---

## Include Graph Analysis

### Check for Heavy Includes
```bash
# Count includes per file
for f in include/**/*.hpp; do echo "$f: $(grep -c '#include' $f)"; done | sort -t: -k2 -rn | head -20

# Find files including potentially heavy headers
grep -rn '#include.*<algorithm>\|#include.*<vector>\|#include.*<string>' include/ --include="*.hpp"
```

---

## Duplication Detection

### Find Similar Function Names
```bash
# Functions with similar naming patterns
grep -rn "\s*get_[a-z_]*(\|set_[a-z_]*(" include/ --include="*.hpp" | sort | uniq -d

# Find accessor/mutator pairs
grep -rn "^\s*\w.*\s\+get_\|^\s*void\s\+set_" include/ --include="*.hpp"
```
