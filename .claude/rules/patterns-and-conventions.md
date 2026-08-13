# Patterns and Conventions Reference

Standard patterns and conventions used throughout llama-conductor, aligned with modern C++ best practices, the [C++ Core Guidelines](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines), and [clang-tidy](https://clang.llvm.org/extra/clang-tidy/) enforcement patterns.

---

## No Backwards Compatibility

**MANDATORY:** This codebase does not maintain backwards compatibility. When code is refactored, moved, or replaced:

1. **Delete all old code** — No legacy wrappers, re-exports, or compatibility shims
2. **Update all call sites** — Every reference must point to the new location
3. **Remove unused files** — Files that only exist to re-export moved code must be deleted
4. **No transition periods** — Changes are atomic; old and new never coexist

### Prohibited Patterns

```cpp
// PROHIBITED: Re-export wrapper for moved code
#include "new_location/types.hpp"
namespace old_location {
    using new_location::SomeType;  // NO! Delete this file entirely
}

// PROHIBITED: Legacy aliases
using OldName = NewName;  // NO! Update all call sites instead

// PROHIBITED: Compatibility shims
template <typename T>
concept LegacyConcept = NewConcept<T>;  // NO! Just use NewConcept
```

---

## Common Modernization Patterns

### Pattern 1: Primitive Sprawl → Structured Types
```cpp
// BEFORE
void func(i32 x, i32 y, i32 w, i32 h, u8 r, u8 g, u8 b, u8 a);

// AFTER
void func(Rect<i32> const& bounds, Color const& color);
```

### Pattern 2: Raw Pointers → std::span
```cpp
// BEFORE
void process(const u8* data, std::size_t size);

// AFTER
void process(std::span<const u8> data);
```

### Pattern 3: Output Parameters → Return Values
```cpp
// BEFORE
void get_size(i32* out_w, i32* out_h);

// AFTER
[[nodiscard]] Size<i32> get_size() const;
```

### Pattern 4: Separate Members → Grouped
```cpp
// BEFORE
struct Window {
    i32 m_x, m_y;
    i32 m_width, m_height;
};

// AFTER
struct Window {
    Point<i32> m_position;
    Size<i32> m_size;
};
```

### Pattern 5: Virtual Inheritance → Concepts
```cpp
// BEFORE (virtual interface)
class IRenderer {
public:
    virtual ~IRenderer() = default;
    virtual bool begin_frame() = 0;
    virtual void end_frame() = 0;
};

// AFTER (concept-based)
template <typename T>
concept RendererBackend = requires(T& renderer) {
    { renderer.begin_frame() } -> std::convertible_to<bool>;
    { renderer.end_frame() } -> std::same_as<void>;
};
```

### Pattern 6: std::enable_if → C++20 Requires Clauses
```cpp
// BEFORE (C++17 SFINAE)
template <typename T, std::enable_if_t<std::is_integral_v<T>, int> = 0>
void process(T value);

// AFTER (C++20 concepts)
template <std::integral T>
void process(T value);
```

### Pattern 7: Raw Loops → Ranges and Views
```cpp
// BEFORE
std::vector<int> results;
for (const auto& item : items) {
    if (item.active) {
        results.push_back(item.value * 2);
    }
}

// AFTER (C++20 ranges)
auto results = items
    | std::views::filter([](const auto& item) { return item.active; })
    | std::views::transform([](const auto& item) { return item.value * 2; })
    | std::ranges::to<std::vector>();
```

---

## Ownership and Resource Management

### Smart Pointer Guidelines

| Pointer Type | Ownership | Use When |
|--------------|-----------|----------|
| `std::unique_ptr<T>` | Exclusive | Default choice for heap allocation |
| `std::shared_ptr<T>` | Shared | Multiple owners truly needed |
| `std::weak_ptr<T>` | Non-owning | Breaking cycles, optional observers |
| `T*` (raw pointer) | Non-owning | Observing, never owning |
| `T&` (reference) | Non-owning | Required access, never null |

### RAII Pattern
```cpp
class StateScope {
public:
    explicit StateScope(StateManager& mgr) : m_mgr(mgr) {
        m_mgr.save();
    }
    ~StateScope() {
        m_mgr.restore();
    }

    // Non-copyable, non-movable
    StateScope(const StateScope&) = delete;
    StateScope& operator=(const StateScope&) = delete;

private:
    StateManager& m_mgr;
};
```

### Rule of Zero/Five

```cpp
// Rule of Zero: Prefer classes that don't need custom destructors
struct Widget {
    std::string m_name;
    std::unique_ptr<Texture> m_texture;
    // No destructor needed - members clean themselves up
};

// Rule of Five: If you define one, define all five
class Buffer {
public:
    Buffer(std::size_t size);
    ~Buffer();
    Buffer(const Buffer& other);
    Buffer& operator=(const Buffer& other);
    Buffer(Buffer&& other) noexcept;
    Buffer& operator=(Buffer&& other) noexcept;
private:
    u8* m_data;
    std::size_t m_size;
};
```

---

## Function Parameter Guidelines

| Intent | Parameter Type | Example |
|--------|---------------|---------|
| Input (cheap to copy) | `T` (by value) | `void set_id(i32 id)` |
| Input (expensive) | `const T&` | `void set_name(const std::string& name)` |
| Input (move from) | `T&&` | `void set_buffer(std::vector<u8>&& data)` |
| Input/Output | `T&` | `void update(Widget& widget)` |
| Output (prefer return) | Return value | `[[nodiscard]] Widget create()` |
| Optional input | `const T*` | `void render(const Theme* override)` |
| Sink (takes ownership) | `std::unique_ptr<T>` | `void adopt(std::unique_ptr<Widget> w)` |

---

## const Correctness

```cpp
// 1. Make member functions const if they don't modify state
[[nodiscard]] Size<i32> get_size() const;
[[nodiscard]] bool is_visible() const;

// 2. Use const for parameters that shouldn't be modified
void render(const Widget& widget);

// 3. Prefer const_iterator when not modifying elements
for (auto it = container.cbegin(); it != container.cend(); ++it);

// 4. Use constexpr for compile-time constants
static constexpr i32 k_max_widgets = 100;
```

---

## Modern Attributes

### [[nodiscard]]
```cpp
// Use for functions where ignoring return is likely a bug
[[nodiscard]] Result<Widget> create_widget();
[[nodiscard]] bool try_connect();
```

### [[maybe_unused]]
```cpp
// Suppress warnings for intentionally unused variables
[[maybe_unused]] auto lock = std::lock_guard(m_mutex);
```

### [[likely]] / [[unlikely]] (C++20)
```cpp
if (cache.contains(key)) [[likely]] {
    return cache.get(key);
}
```

---

## Error Handling Patterns

### Result<T> for Recoverable Errors
```cpp
[[nodiscard]] Result<Widget> create_widget(const Config& cfg) {
    if (!cfg.valid()) {
        return err<Widget>(Error::InvalidConfig);
    }
    return ok(Widget{cfg});
}
```

### std::optional for "Maybe" Values
```cpp
[[nodiscard]] std::optional<Widget*> find_widget(std::string_view name);
```

### When to Use Each

| Situation | Mechanism |
|-----------|-----------|
| Programming error (bug) | `assert()` |
| Recoverable error | `Result<T>` |
| "Not found" / "No value" | `std::optional<T>` |
| Unrecoverable error | Exception (rare) |
| Boolean success/fail | `[[nodiscard]] bool` |

---

## noexcept Guidelines

```cpp
// Mark functions that don't throw
void swap(Widget& other) noexcept;
Widget(Widget&& other) noexcept;
Widget& operator=(Widget&& other) noexcept;
~Widget() noexcept;

// Functions that should be noexcept:
// - Destructors
// - Move constructors/assignments
// - swap functions
// - Simple getters/observers
// - Memory deallocation
```

## Comment Standards

### Prohibited Language
- Change words: "changed", "updated", "modified", "fixed", "refactored"
- Temporal: "now", "new", "previously", "old", "formerly"
- Context: "added for", "per request", "by Claude", "AI-generated"

### Prohibited Comment Patterns
- **`/// @brief`**: Use `//` for single-line or `/** */` for multi-line
- **`///<`**: Use regular `//` for inline comments
- **Section dividers**: No `// === Section ===` patterns
- **`@name` groupings**: No Doxygen grouping constructs

### When to Use Each Format

**Use `//` for:**
- Simple function descriptions
- Member variable descriptions
- Inline code clarifications

```cpp
// Gets the current mouse position.
[[nodiscard]] Point<f32> position() const noexcept;

Point<f32> m_position{};  // Current position in screen coordinates.
```

**Use `/** */` for:**
- Classes and structs
- Functions with multiple parameters
- Template parameters needing explanation

```cpp
/**
 * @brief Creates a window with the specified parameters.
 * @param title Window title.
 * @param size Window dimensions.
 */
explicit Window(std::string_view title, Size<i32> size);
```

---

## Success Criteria

All work must satisfy:

- Build with `-Werror` and zero warnings
- All public APIs use typed interfaces (no `void*`)
- Modern C++23 features where applicable
- Descriptive variable names
- Tests pass
- clang-tidy passes with enabled checks

---

## References

- [C++ Core Guidelines](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines)
- [clang-tidy Checks](https://clang.llvm.org/extra/clang-tidy/checks/list.html)
