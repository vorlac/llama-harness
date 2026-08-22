"""The producer/consumer pipeline.

Three roles run at once:

* the **reader** turns `events.ndjson` into numbered lines;
* the **transform pool** runs the order-independent stages of SPEC.md
  sections 4.1 to 4.5 -- encoding, emptiness, parse, validate, normalise;
* the **collector** runs the order-dependent stages, sections 4.6 to 5.8 --
  deduplicate, enrich, filter, delta, aggregate -- and it sees records in
  input line order, which is what those stages are defined against.

Line numbers travel with every record so the collector can restore input order
however the pool happened to schedule the work, and so the output is the same
at any worker count (SPEC.md section 6).
"""

import copy
import queue
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from .aggregate import DeltaTracker, WindowStore
from .config import (EPOCH_MS_MAX, QUALITY_MIN, REJECT_REASONS,
                     VALUE_ABS_MAX_CANON)
from .escaping import detail_value, raw_prefix
from .jsonsubset import JsonError, parse_record
from .output import RejectLog
from .timestamps import format_timestamp, window_start_ms
from .validation import Reject, validate

PRINTABLE_PATTERN = r"\A[ -~]*\Z"

POLL_INTERVAL_SECONDS = 0.001

SHUTDOWN = object()


class Counters:
    """Everything `summary.txt` reports, except what the outputs know."""

    def __init__(self):
        self.input_lines = 0
        self.rejected = dict.fromkeys(REJECT_REASONS, 0)
        self.dropped_inactive = 0
        self.dropped_non_telemetry = 0
        self.dropped_low_quality = 0
        self.aggregated_records = 0

    def rejected_total(self):
        return sum(self.rejected.values())


def first_unprintable(line):
    """(offset, character) of the first byte outside 0x20-0x7E."""
    for offset, character in enumerate(line):
        if character < " " or character > "~":
            return offset, character
    return None, None


class Pipeline:
    """One run of the job over one input file."""

    def __init__(self, device_table, workers):
        self.device_table = device_table
        self.workers = workers
        self.counters = Counters()
        self.reject_log = RejectLog()
        self.windows = WindowStore()

        self._deltas = DeltaTracker()
        self._seen_ids = {}
        self._raw_queue = queue.Queue()
        self._transformed_queue = queue.Queue()
        # Guards the reject log and the run counters.  Every stage writes to
        # both, from whichever thread happened to notice the record.
        self._lock = threading.RLock()
        self._expected_lines = None

    # -- orchestration -------------------------------------------------------

    def run(self, events_path):
        collector = threading.Thread(target=self._collect, name="collector",
                                     daemon=True)
        collector.start()

        pool = ThreadPoolExecutor(max_workers=self.workers,
                                  thread_name_prefix="transform")
        transformers = [pool.submit(self._transform_loop)
                        for _ in range(self.workers)]

        self._read(events_path)

        for _ in range(self.workers):
            self._raw_queue.put(SHUTDOWN)
        for transformer in transformers:
            transformer.result()
        pool.shutdown()

        while collector.is_alive():
            time.sleep(POLL_INTERVAL_SECONDS)

    # -- stage 1: read -------------------------------------------------------

    def _read(self, events_path):
        """Split the event stream into numbered lines and feed the pool.

        The trailing empty segment after the file's final LF is not a line
        (SPEC.md section 1.1).
        """
        with open(events_path, "rb", buffering=0) as handle:
            lines = handle.read().decode("latin-1").split("\n")
        if lines and lines[-1] == "":
            lines.pop()

        for line_number, line in enumerate(lines, start=1):
            self._raw_queue.put((line_number, line))

        self.counters.input_lines = len(lines)
        self._expected_lines = len(lines)

    # -- stages 2 to 5: the transform pool -----------------------------------

    def _transform_loop(self):
        while True:
            item = self._raw_queue.get()
            if item is SHUTDOWN:
                return
            line_number, line = item
            record = self._transform(line_number, line)
            self._transformed_queue.put((line_number, record))

    def _transform(self, line_number, line):
        """SPEC.md sections 4.1 to 4.5 for one line.

        Returns the normalised record, or None when the line was rejected --
        in which case the reject has already been logged.
        """
        with self._lock:
            prefix = raw_prefix(line)

            # 4.1 encoding
            if re.compile(PRINTABLE_PATTERN).match(line) is None:
                offset, character = first_unprintable(line)
                self._reject(line_number, prefix, Reject(
                    "bad_encoding", "-",
                    "byte=0x%02x offset=%d" % (ord(character), offset)))
                return None

            # 4.2 emptiness
            if line.strip(" ") == "":
                self._reject(line_number, prefix,
                             Reject("empty_line", "-"))
                return None

            # 4.3 parse
            try:
                document = parse_record(line)
            except JsonError:
                self._reject(line_number, prefix, Reject("bad_json", "-"))
                return None
            if not isinstance(document, dict):
                self._reject(line_number, prefix, Reject("not_object", "-"))
                return None

            # 4.4 validate
            record, reject = validate(document)
            if reject is not None:
                self._reject(line_number, prefix, reject)
                return None

            # 4.5 normalise: the timestamp is already UTC milliseconds, all
            # that is left is the window the specification supports.
            epoch_ms = record["epoch_ms"]
            if epoch_ms < 0 or epoch_ms >= EPOCH_MS_MAX:
                self._reject(line_number, prefix,
                             Reject("timestamp_out_of_range", "/ts"))
                return None

            record["line_number"] = line_number
            record["prefix"] = prefix
            # The collector gets a record of its own: the two stages run in
            # different threads and must not share mutable state.
            return copy.deepcopy(record)

    # -- stages 6 to 10: the collector ---------------------------------------

    def _collect(self):
        """Consume transformed records strictly in input line order."""
        pending = {}
        next_line = 1
        while True:
            expected = self._expected_lines
            if expected is not None and next_line > expected:
                return

            try:
                while True:
                    line_number, record = self._transformed_queue.get_nowait()
                    pending[line_number] = record
            except queue.Empty:
                pass

            if next_line not in pending:
                time.sleep(POLL_INTERVAL_SECONDS)
                continue

            while next_line in pending:
                record = pending.pop(next_line)
                next_line += 1
                if record is not None:
                    self._absorb(record)

    def _absorb(self, record):
        line_number = record["line_number"]
        prefix = record["prefix"]

        # 4.6 deduplicate: the first occurrence in input order wins.
        identifier = record["id"]
        first_line = self._seen_ids.get(identifier)
        if first_line is not None:
            self._reject(line_number, prefix, Reject(
                "duplicate_id", "/id", "first_line=%d" % first_line))
            return
        self._seen_ids[identifier] = line_number

        # 4.7 enrich
        device = self.device_table.lookup(record["dev"])
        if device is None:
            self._reject(line_number, prefix, Reject(
                "unknown_device", "/dev",
                "value=%s" % detail_value(record["dev"])))
            return
        site = record["site"]
        if site is not None and site != device.site_id:
            self._reject(line_number, prefix, Reject(
                "site_mismatch", "/site",
                "record=%s lookup=%s" % (detail_value(site),
                                         detail_value(device.site_id))))
            return

        kind = record["kind"]
        if kind == "telemetry":
            value = record["value"] + device.calibration_milli
            if value > VALUE_ABS_MAX_CANON or value < -VALUE_ABS_MAX_CANON:
                self._reject(line_number, prefix, Reject(
                    "value_out_of_range", "/payload/value",
                    "value=%s" % detail_value(record["raw_value"])))
                return

        # 5.6 filter: dropped records are counted, never rejected.
        if not device.active:
            self.counters.dropped_inactive += 1
            return
        if kind != "telemetry":
            self.counters.dropped_non_telemetry += 1
            return
        if record["quality"] < QUALITY_MIN:
            self.counters.dropped_low_quality += 1
            return

        # 5.7 delta, against the previous accepted record for this key.
        metric = record["metric"]
        delta = self._deltas.observe(record["dev"], metric, value)

        # 5.8 aggregate
        epoch_ms = record["epoch_ms"]
        self.windows.add(record["dev"], metric, window_start_ms(epoch_ms),
                         device, value, delta, format_timestamp(epoch_ms),
                         record["tags"])
        self.counters.aggregated_records += 1

    # -- shared state --------------------------------------------------------

    def _reject(self, line_number, prefix, reject):
        with self._lock:
            self.reject_log.add(line_number, reject, prefix)
            self.counters.rejected[reject.reason] += 1
