// membench - a controlled memory bandwidth probe.
//
// hostinfo.py used to report a "memory bandwidth" number derived from a single
// bytes(bytearray) copy in CPython, and it read about a third of the truth. The
// reasons are worth stating, because the obvious suspect is not one of them.
//
//   1. The destination is allocated inside the timed region. A fresh 512 MiB
//      mapping is zero-fill-on-demand, so the copy also pays a first-touch page
//      fault for every page it writes. Measured here, that is a 3x effect and
//      it is the whole story behind the old number.
//
//   2. Nothing pins the measuring thread. macOS exposes no CPU affinity API on
//      Apple silicon, and the same copy runs 6x slower on an E-core than on a
//      P-core, so an unpinned run reports the scheduler, not the memory system.
//
// Alignment, the thing this tool was originally written to investigate, turned
// out not to matter: moving both buffers together across every granularity from
// 8 bytes to a full page changes nothing at any buffer size. What does cost
// throughput - about 15% on the median, plus a lot of variance - is src and dst
// sitting at different offsets *relative to each other*, which is why the flags
// below control the two offsets independently rather than one "aligned" bool.
//
// So: buffers are mmap'd (page aligned by construction), slid to a requested
// byte offset, and pre-faulted outside the clock, and the thread asks for
// user-interactive QoS. A default run times the copy and nothing else;
// --src-offset, --dst-offset, --fresh-dst and --qos put each confound back one
// at a time.

#include <sys/mman.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <new>
#include <string>
#include <thread>
#include <vector>

#if defined(__APPLE__)
  #include <pthread/qos.h>
  #define MEMBENCH_QOS 1
#else
  #define MEMBENCH_QOS 0
#endif

#if defined(__ARM_NEON)
  #include <arm_neon.h>
  #define MEMBENCH_NEON 1
#else
  #define MEMBENCH_NEON 0
#endif

namespace membench {

    // Apple silicon uses a 128 byte line, twice the x86-64 convention. Every
    // alignment claim in this tool is relative to this, not to 64.
    constexpr std::size_t cache_line = 128;
    constexpr std::size_t mib = 1024ull * 1024ull;

    static std::size_t page_size() {
        static const std::size_t size = static_cast<std::size_t>(::sysconf(_SC_PAGESIZE));
        return size;
    }

    // Unaligned access is well defined through this alias, which matters for
    // the read kernel at odd --src-offset values.
    using u64_unaligned = std::uint64_t __attribute__((aligned(1)));

    // ---------------------------------------------------------------------
    // Core placement
    // ---------------------------------------------------------------------

    // Asymmetric cores make an unpinned single-threaded bandwidth number close
    // to meaningless: the same binary reads ~75 GB/s on a P-core and ~45 GB/s on
    // an E-core, and macOS decides which one you get. There is no CPU affinity
    // API on Apple silicon, but QoS class steers placement - background is
    // confined to the E-cluster, user-interactive is served by the P-cluster.
    // Every thread that runs a kernel sets this, workers included.
    static bool apply_qos(const std::string& name) {
#if MEMBENCH_QOS
        qos_class_t cls = QOS_CLASS_UNSPECIFIED;
        if (name == "default")
            return true;
        else if (name == "user-interactive")
            cls = QOS_CLASS_USER_INTERACTIVE;
        else if (name == "user-initiated")
            cls = QOS_CLASS_USER_INITIATED;
        else if (name == "utility")
            cls = QOS_CLASS_UTILITY;
        else if (name == "background")
            cls = QOS_CLASS_BACKGROUND;
        else
            return false;

        return ::pthread_set_qos_class_self_np(cls, 0) == 0;
#else
        return name == "default";
#endif
    }

    // ---------------------------------------------------------------------
    // Buffers
    // ---------------------------------------------------------------------

    // Anonymous mmap hands back page-aligned memory (16 KiB on Apple silicon),
    // which is already a multiple of every alignment this tool cares about. The
    // trailing slack lets the usable base slide to base+offset without a second
    // allocation, so an "offset 32" run differs from an "offset 0" run in
    // exactly one variable.
    class region {
    public:
        region(std::size_t bytes, std::size_t offset)
            : m_length{ bytes + offset + page_size() } {
            void* p = ::mmap(nullptr, m_length, PROT_READ | PROT_WRITE,
                             MAP_PRIVATE | MAP_ANON, -1, 0);
            if (p == MAP_FAILED)
                throw std::bad_alloc{};

            m_base = static_cast<std::byte*>(p);
            m_data = m_base + offset;
        }

        ~region() {
            if (m_base != nullptr)
                ::munmap(m_base, m_length);
        }

        region(const region&) = delete;
        region& operator=(const region&) = delete;

        // Touch every page so first-touch faults land outside the timed region.
        void prefault(unsigned char fill) {
            std::memset(m_base, fill, m_length);
        }

        std::byte* data() const {
            return m_data;
        }

    private:
        std::size_t m_length{ 0 };
        std::byte* m_base{ nullptr };
        std::byte* m_data{ nullptr };
    };

    // ---------------------------------------------------------------------
    // Kernels
    // ---------------------------------------------------------------------

    using kernel_fn = std::uint64_t (*)(std::byte*, const std::byte*, std::size_t);

    // Every kernel returns something derived from the memory it touched. main
    // folds that into a sink so the optimizer cannot decide the work is dead.
    static std::uint64_t g_sink = 0;

    static std::uint64_t kernel_copy(std::byte* dst, const std::byte* src, std::size_t n) {
        std::memcpy(dst, src, n);
        return static_cast<std::uint64_t>(dst[n - 1]);
    }

    static std::uint64_t kernel_write(std::byte* dst, const std::byte* src, std::size_t n) {
        std::memset(dst, 0x5a, n);
        return static_cast<std::uint64_t>(dst[n - 1]);
    }

    static std::uint64_t kernel_read(std::byte* dst, const std::byte* src, std::size_t n) {
        // Eight independent accumulators keep enough loads in flight to saturate
        // the load queues. One dependent chain would measure latency instead.
        std::uint64_t acc[8] = { 0, 0, 0, 0, 0, 0, 0, 0 };
        const u64_unaligned* p = reinterpret_cast<const u64_unaligned*>(src);
        const std::size_t words = n / sizeof(std::uint64_t);

        std::size_t i = 0;
        for (; i + 8 <= words; i += 8) {
            for (std::size_t k = 0; k < 8; ++k)
                acc[k] += p[i + k];
        }

        std::uint64_t total = 0;
        for (std::size_t k = 0; k < 8; ++k)
            total += acc[k];
        for (; i < words; ++i)
            total += p[i];

        return total;
    }

#if MEMBENCH_NEON

    static std::uint64_t kernel_neon(std::byte* dst, const std::byte* src, std::size_t n) {
        std::uint8_t* d = reinterpret_cast<std::uint8_t*>(dst);
        const std::uint8_t* s = reinterpret_cast<const std::uint8_t*>(src);

        std::size_t i = 0;
        for (; i + 64 <= n; i += 64)
            vst1q_u8_x4(d + i, vld1q_u8_x4(s + i));
        if (i < n)
            std::memcpy(d + i, s + i, n - i);

        return static_cast<std::uint64_t>(dst[n - 1]);
    }

    // stnp is a non-temporal store pair: it writes 32 bytes without first
    // pulling the destination line into cache, so a bulk copy stops evicting
    // the working set around it. This is the closest arm64 equivalent to the
    // movnt stores a tuned x86 memcpy would use for large sizes.
    static std::uint64_t kernel_stnp(std::byte* dst, const std::byte* src, std::size_t n) {
        std::uint8_t* d = reinterpret_cast<std::uint8_t*>(dst);
        const std::uint8_t* s = reinterpret_cast<const std::uint8_t*>(src);

        std::size_t i = 0;
        for (; i + 64 <= n; i += 64) {
            asm volatile(
                "ldp q0, q1, [%[in]]\n\t"
                "ldp q2, q3, [%[in], #32]\n\t"
                "stnp q0, q1, [%[out]]\n\t"
                "stnp q2, q3, [%[out], #32]"
                :
                : [in] "r"(s + i), [out] "r"(d + i)
                : "v0", "v1", "v2", "v3", "memory");
        }
        if (i < n)
            std::memcpy(d + i, s + i, n - i);

        return static_cast<std::uint64_t>(dst[n - 1]);
    }

#endif

    struct kernel_info {
        const char* name;
        kernel_fn fn;
        int bus_passes;  // times the copied span crosses the bus: read + write
        const char* blurb;
    };

    static const std::vector<kernel_info>& kernels() {
        static const std::vector<kernel_info> table = {
            { "copy", kernel_copy, 2, "libc memcpy - what hostinfo.py approximates" },
            { "read", kernel_read, 1, "load only, 8 accumulators" },
            { "write", kernel_write, 1, "libc memset, store only" },
#if MEMBENCH_NEON
            { "neon", kernel_neon, 2, "hand-rolled 64B NEON load/store loop" },
            { "stnp", kernel_stnp, 2, "NEON copy with non-temporal stores" },
#endif
        };
        return table;
    }

    static const kernel_info* find_kernel(const std::string& name) {
        for (const kernel_info& k : kernels()) {
            if (name == k.name)
                return &k;
        }
        return nullptr;
    }

    // ---------------------------------------------------------------------
    // Timing
    // ---------------------------------------------------------------------

    // Padded to a full line so neighbouring workers never share one. This is
    // the alignas(128) that actually matters at the tool level - the buffer
    // alignment question is answered by --src-offset / --dst-offset instead.
    struct alignas(cache_line) worker_slot {
        std::byte* dst{ nullptr };
        const std::byte* src{ nullptr };
        std::size_t bytes{ 0 };
        std::uint64_t sink{ 0 };
    };

    static std::string g_qos{ "default" };

    static double run_pass(kernel_fn fn, std::byte* dst, const std::byte* src, std::size_t bytes,
                           std::size_t threads) {
        using clock = std::chrono::steady_clock;

        if (threads <= 1) {
            const auto start = clock::now();
            const std::uint64_t v = fn(dst, src, bytes);
            const auto stop = clock::now();
            g_sink += v;
            return std::chrono::duration<double>(stop - start).count();
        }

        // Slice on a cache line boundary so no two workers write the same line.
        const std::size_t slice = (bytes / threads) & ~(cache_line - 1);
        std::vector<worker_slot> slots(threads);
        for (std::size_t k = 0; k < threads; ++k) {
            const std::size_t begin = k * slice;
            const std::size_t end = (k + 1 == threads) ? bytes : begin + slice;
            slots[k].dst = dst + begin;
            slots[k].src = src + begin;
            slots[k].bytes = end - begin;
        }

        std::atomic<std::size_t> ready{ 0 };
        std::atomic<std::size_t> done{ 0 };
        std::atomic<bool> go{ false };

        std::vector<std::thread> workers;
        workers.reserve(threads);
        for (std::size_t k = 0; k < threads; ++k) {
            workers.emplace_back([&, k]() {
                apply_qos(g_qos);  // QoS is per-thread, so inherit it explicitly
                ready.fetch_add(1, std::memory_order_release);
                while (!go.load(std::memory_order_acquire))
                    ;  // spin, so the start edge is tight rather than scheduled
                slots[k].sink = fn(slots[k].dst, slots[k].src, slots[k].bytes);
                done.fetch_add(1, std::memory_order_release);
            });
        }

        while (ready.load(std::memory_order_acquire) < threads)
            ;

        // Thread creation and join both sit outside the clock; the workers
        // announce completion through `done` so teardown is not timed.
        const auto start = clock::now();
        go.store(true, std::memory_order_release);
        while (done.load(std::memory_order_acquire) < threads)
            ;
        const auto stop = clock::now();

        for (std::thread& w : workers)
            w.join();
        for (const worker_slot& s : slots)
            g_sink += s.sink;

        return std::chrono::duration<double>(stop - start).count();
    }

    // The cores idle at a low clock and take tens of milliseconds to ramp. Without
    // this, the first configuration measured in a process reads 20-25% slow and
    // every sweep looks like a monotonic improvement caused by whatever it was
    // varying. Burn in until the clock has settled, then start measuring.
    static void burn_in(double milliseconds) {
        if (milliseconds <= 0.0)
            return;

        using clock = std::chrono::steady_clock;
        region scratch{ 8 * mib, 0 };
        scratch.prefault(0x11);

        std::byte* half = scratch.data() + 4 * mib;
        const auto deadline = clock::now() + std::chrono::duration_cast<clock::duration>(
                                                 std::chrono::duration<double, std::milli>{
                                                     milliseconds });
        while (clock::now() < deadline)
            g_sink += kernel_copy(half, scratch.data(), 4 * mib);
    }

    // ---------------------------------------------------------------------
    // Runs
    // ---------------------------------------------------------------------

    struct config {
        std::size_t bytes{ 512 * mib };
        std::size_t passes{ 7 };
        std::size_t threads{ 1 };
        std::size_t src_offset{ 0 };
        std::size_t dst_offset{ 0 };
        std::string kernel{ "copy" };
        std::string qos{ "user-interactive" };
        double warmup_ms{ 300.0 };
        bool fresh_dst{ false };
        bool prefault{ true };
    };

    struct result {
        double seconds{ 0.0 };
        double gb_per_sec{ 0.0 };
        double effective_gb_per_sec{ 0.0 };
    };

    static result run(const config& cfg, const kernel_info& kern) {
        g_qos = cfg.qos;
        apply_qos(g_qos);

        region src{ cfg.bytes, cfg.src_offset };
        src.prefault(0xa5);

        double best = std::numeric_limits<double>::infinity();

        if (cfg.fresh_dst) {
            // Reproduces CPython's bytes(src): a brand new mapping every pass,
            // so the copy eats a first-touch fault on every destination page.
            for (std::size_t p = 0; p < cfg.passes; ++p) {
                region dst{ cfg.bytes, cfg.dst_offset };
                const double t = run_pass(kern.fn, dst.data(), src.data(), cfg.bytes,
                                          cfg.threads);
                best = std::min(best, t);
            }
        }
        else {
            region dst{ cfg.bytes, cfg.dst_offset };
            if (cfg.prefault)
                dst.prefault(0x5a);

            run_pass(kern.fn, dst.data(), src.data(), cfg.bytes, cfg.threads);  // warm-up
            for (std::size_t p = 0; p < cfg.passes; ++p) {
                const double t = run_pass(kern.fn, dst.data(), src.data(), cfg.bytes,
                                          cfg.threads);
                best = std::min(best, t);
            }
        }

        result r;
        r.seconds = best;
        r.gb_per_sec = static_cast<double>(cfg.bytes) / best / 1e9;
        r.effective_gb_per_sec = r.gb_per_sec * kern.bus_passes;
        return r;
    }

    // ---------------------------------------------------------------------
    // Reporting
    // ---------------------------------------------------------------------

    struct labelled_result {
        std::string label;
        config cfg;
        result res;
    };

    static void print_header(const config& cfg) {
        std::printf("membench  %zu MiB buffers, best of %zu passes\n", cfg.bytes / mib,
                    cfg.passes);
        std::printf("host      page %zu B, cache line %zu B, %u logical cpus\n\n", page_size(),
                    cache_line, std::thread::hardware_concurrency());
        std::printf("  %-32s %6s %16s %4s %5s %5s %10s %10s %8s\n", "run", "kernel", "qos", "thr",
                    "src+", "dst+", "GB/s", "eff GB/s", "ms");
        std::printf("  %s\n", std::string(32 + 6 + 16 + 4 + 5 + 5 + 10 + 10 + 8 + 8, '-').c_str());
    }

    static void print_row(const labelled_result& lr) {
        std::printf("  %-32s %6s %16s %4zu %5zu %5zu %10.2f %10.2f %8.2f\n", lr.label.c_str(),
                    lr.cfg.kernel.c_str(), lr.cfg.qos.c_str(), lr.cfg.threads, lr.cfg.src_offset,
                    lr.cfg.dst_offset, lr.res.gb_per_sec, lr.res.effective_gb_per_sec,
                    lr.res.seconds * 1e3);
    }

    static void print_json(const std::vector<labelled_result>& rows) {
        std::printf("{\n  \"page_size\": %zu,\n  \"cache_line\": %zu,\n  \"runs\": [\n",
                    page_size(), cache_line);
        for (std::size_t i = 0; i < rows.size(); ++i) {
            const labelled_result& lr = rows[i];
            std::printf(
                "    {\"label\": \"%s\", \"kernel\": \"%s\", \"qos\": \"%s\", "
                "\"threads\": %zu, \"buffer_mb\": %zu, \"src_offset\": %zu, "
                "\"dst_offset\": %zu, \"fresh_dst\": %s, \"seconds\": %.9f, "
                "\"bytes_per_sec\": %.1f, \"effective_bytes_per_sec\": %.1f}%s\n",
                lr.label.c_str(), lr.cfg.kernel.c_str(), lr.cfg.qos.c_str(),
                lr.cfg.threads, lr.cfg.bytes / mib, lr.cfg.src_offset, lr.cfg.dst_offset,
                lr.cfg.fresh_dst ? "true" : "false", lr.res.seconds,
                lr.res.gb_per_sec * 1e9, lr.res.effective_gb_per_sec * 1e9,
                i + 1 == rows.size() ? "" : ",");
        }
        std::printf("  ]\n}\n");
    }

    static void print_usage(const char* argv0) {
        std::printf("\nusage: %s [options]\n\n", argv0);
        std::printf("  --size-mb N      buffer size per side, MiB (default 512)\n");
        std::printf("  --passes N       timed passes, best wins (default 7)\n");
        std::printf("  --threads N      worker threads (default 1)\n");
        std::printf("  --src-offset N   bytes to slide the source off its page (default 0)\n");
        std::printf("  --dst-offset N   bytes to slide the destination off its page (default 0)\n");
        std::printf("  --kernel K       ");
        for (const kernel_info& k : kernels())
            std::printf("%s ", k.name);
        std::printf("(default copy)\n");
        std::printf("  --warmup-ms N    clock ramp burn-in before the first run (default 300)\n");
        std::printf("  --qos C          core placement: user-interactive (default, P-cores),\n");
        std::printf("                   user-initiated, utility, background (E-cores), default\n");
        std::printf("  --fresh-dst      remap the destination each pass (include page faults)\n");
        std::printf("  --no-prefault    skip the warm-up memset of the destination\n");
        std::printf("  --align N        put both buffers exactly N-aligned (not 2N), same phase\n");
        std::printf("  --sweep          relative phase sweep: dst slides, src stays put\n");
        std::printf("  --sweep-align    alignment granularity sweep: both slide together\n");
        std::printf("  --sweep-threads  thread scaling sweep\n");
        std::printf("  --sweep-kernels  every kernel at the default alignment\n");
        std::printf("  --sweep-qos      the same copy on each QoS class (P-core vs E-core)\n");
        std::printf("  --json           machine-readable output\n\n");
        std::printf("  kernels:\n");
        for (const kernel_info& k : kernels())
            std::printf("    %-6s %s\n", k.name, k.blurb);
        std::printf("\n");
    }

}  // namespace membench

int main(int argc, char** argv) {
    using namespace membench;

    config cfg;
    bool sweep_align = false;
    bool sweep_align_grain = false;
    bool sweep_threads = false;
    bool sweep_kernels = false;
    bool sweep_qos = false;
    bool as_json = false;

    auto need = [&](int i) -> bool {
        return i + 1 < argc;
    };

    for (int i = 1; i < argc; ++i) {
        try {
            const std::string arg = argv[i];
            if (arg == "--size-mb" && need(i))
                cfg.bytes = std::stoull(argv[++i]) * mib;
            else if (arg == "--passes" && need(i))
                cfg.passes = std::stoull(argv[++i]);
            else if (arg == "--threads" && need(i))
                cfg.threads = std::stoull(argv[++i]);
            else if (arg == "--src-offset" && need(i))
                cfg.src_offset = std::stoull(argv[++i]);
            else if (arg == "--dst-offset" && need(i))
                cfg.dst_offset = std::stoull(argv[++i]);
            else if (arg == "--kernel" && need(i))
                cfg.kernel = argv[++i];
            else if (arg == "--warmup-ms" && need(i))
                cfg.warmup_ms = std::stod(argv[++i]);
            else if (arg == "--qos" && need(i))
                cfg.qos = argv[++i];
            else if (arg == "--sweep-qos")
                sweep_qos = true;
            else if (arg == "--align" && need(i)) {
                // "Exactly N aligned": both buffers sit N past a page boundary,
                // so the pair is N-aligned but deliberately not 2N-aligned.
                // Moving both together holds relative phase constant, which is
                // the only way to isolate alignment granularity from it.
                const std::size_t grain = std::stoull(argv[++i]);
                cfg.src_offset = grain;
                cfg.dst_offset = grain;
            }
            else if (arg == "--sweep-align")
                sweep_align_grain = true;
            else if (arg == "--fresh-dst")
                cfg.fresh_dst = true;
            else if (arg == "--no-prefault")
                cfg.prefault = false;
            else if (arg == "--sweep")
                sweep_align = true;
            else if (arg == "--sweep-threads")
                sweep_threads = true;
            else if (arg == "--sweep-kernels")
                sweep_kernels = true;
            else if (arg == "--json")
                as_json = true;
            else {
                print_usage(argv[0]);
                return arg == "-h" || arg == "--help" ? 0 : 1;
            }
        } catch (const std::exception& e) {
            std::fprintf(stderr, "error: %s\n", e.what());
            print_usage(argv[0]);
            return 1;
        }
    }

    if (cfg.bytes == 0 || cfg.passes == 0 || cfg.threads == 0) {
        std::fprintf(stderr, "error: --size-mb, --passes and --threads must all be non-zero\n");
        return 1;
    }

    const kernel_info* kern = find_kernel(cfg.kernel);
    if (kern == nullptr) {
        std::fprintf(stderr, "error: unknown kernel '%s'\n", cfg.kernel.c_str());
        print_usage(argv[0]);
        return 1;
    }

    if (!apply_qos(cfg.qos)) {
        std::fprintf(stderr, "error: unknown or unavailable qos class '%s'\n", cfg.qos.c_str());
        return 1;
    }

    g_qos = cfg.qos;
    burn_in(cfg.warmup_ms);

    std::vector<labelled_result> rows;

    auto add = [&](const std::string& label, config c, const kernel_info& k) {
        c.kernel = k.name;
        rows.push_back({ label, c, run(c, k) });
        if (!as_json) {
            if (rows.size() == 1)
                print_header(cfg);
            print_row(rows.back());
            std::fflush(stdout);
        }
    };

    if (sweep_align) {
        // Offsets chosen to separate three distinct effects: sub-word
        // misalignment (1, 7), word-aligned but line-split (8, 32, 64), and
        // fully line aligned (0, 128). 32 is the case CPython actually hands
        // the destination of bytes(src).
        static const std::size_t offsets[] = { 0, 1, 7, 8, 16, 32, 64, 128 };
        for (std::size_t off : offsets) {
            config c = cfg;
            c.src_offset = 0;
            c.dst_offset = off;
            add("dst offset " + std::to_string(off), c, *kern);
        }
        for (std::size_t off : { std::size_t{ 32 }, std::size_t{ 64 } }) {
            config c = cfg;
            c.src_offset = off;
            c.dst_offset = off;
            add("both offset " + std::to_string(off) + " (same phase)", c, *kern);
        }
        {
            config c = cfg;
            c.src_offset = 0;
            c.dst_offset = 32;
            c.fresh_dst = true;
            add("dst offset 32, fresh mapping", c, *kern);
        }
        {
            config c = cfg;
            c.src_offset = 0;
            c.dst_offset = 0;
            c.fresh_dst = true;
            add("dst aligned, fresh mapping", c, *kern);
        }
    }

    if (sweep_align_grain) {
        // Both buffers move together, so relative phase never changes and the
        // only variable is how coarsely the pair is aligned. 64 is one cache
        // line on x86 but half a line here; 128 is a full line; 256 is every
        // other line.
        static const std::size_t grains[] = { 8, 16, 32, 64, 128, 256, 512, 1024, 4096 };
        for (std::size_t g : grains) {
            config c = cfg;
            c.src_offset = g;
            c.dst_offset = g;
            add("exactly " + std::to_string(g) + "B aligned", c, *kern);
        }
        config c = cfg;
        c.src_offset = 0;
        c.dst_offset = 0;
        add("16384B (page) aligned", c, *kern);
    }

    if (sweep_qos) {
        // Runs the identical copy on each scheduling class. A spread here means
        // any unpinned bandwidth number is reporting core placement, not memory.
        for (const char* q : { "user-interactive", "user-initiated", "utility", "background" }) {
            config c = cfg;
            c.qos = q;
            add(std::string{ "qos " } + q, c, *kern);
        }
    }

    if (sweep_kernels) {
        for (const kernel_info& k : kernels()) {
            config c = cfg;
            add(std::string{ "kernel " } + k.name, c, k);
        }
    }

    if (sweep_threads) {
        const unsigned hw = std::max(1u, std::thread::hardware_concurrency());
        for (std::size_t t = 1; t <= hw; t *= 2) {
            config c = cfg;
            c.threads = t;
            add(std::to_string(t) + (t == 1 ? " thread" : " threads"), c, *kern);
        }
        if ((hw & (hw - 1)) != 0) {
            config c = cfg;
            c.threads = hw;
            add(std::to_string(hw) + " threads", c, *kern);
        }
    }

    if (!sweep_align && !sweep_align_grain && !sweep_threads && !sweep_kernels && !sweep_qos)
        add("single run", cfg, *kern);

    if (as_json)
        print_json(rows);
    else
        std::printf("\n  (eff GB/s counts both directions for copy kernels: read + write)\n");

    // Keep the sink observable so none of the kernels can be optimized away.
    if (g_sink == 0xdeadbeefdeadbeefull)
        std::fprintf(stderr, "sink %llu\n", static_cast<unsigned long long>(g_sink));

    return 0;
}
