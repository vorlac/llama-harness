"""Constants fixed by the data contract.

Every value here comes from `SPEC.md` in the task directory and none of them is
configurable at run time.  Keeping them in one module means the window size,
the reject enumeration and the output column order each have exactly one
definition in the program.
"""

# --- section 5.3: windowing -------------------------------------------------

WINDOW_MS = 300000

# --- section 5.6: filtering -------------------------------------------------

QUALITY_MIN = 50

# --- numeric domains, sections 1.1.2, 1.1.3, 4.4, 4.5, 4.7 ------------------

EPOCH_MS_MAX = 4102444800000          # 2100-01-01T00:00:00.000Z
VALUE_ABS_MAX = 1000000000            # before unit conversion
VALUE_ABS_MAX_CANON = 2000000000      # after conversion and calibration
SEQ_MAX = 2147483647
CODE_MAX = 65535
MAX_TAGS = 8

# --- section 2.2: reject row shape ------------------------------------------

RAW_PREFIX_BYTES = 80
DETAIL_VALUE_BYTES = 32

# --- section 1.1.2 and 1.1.5: closed vocabularies ---------------------------

KINDS = ("telemetry", "status", "audit")
METRICS = ("temperature", "pressure", "humidity", "flow", "voltage")
STATES = ("online", "offline", "degraded", "maintenance")
ACTIONS = ("login", "logout", "config", "reboot")

# --- section 2: output headers ----------------------------------------------

WINDOWS_HEADER = ("device_id,site_id,region,metric,window_start,count,"
                  "sum_milli,min_milli,max_milli,mean_milli,"
                  "max_abs_delta_milli,first_ts,last_ts,tags")
REJECTS_HEADER = "line_no\treason\tfield\tdetail\traw_prefix"

WINDOWS_FILE = "windows.csv"
REJECTS_FILE = "rejects.tsv"
SUMMARY_FILE = "summary.txt"

# --- section 3: the closed reject enumeration, in summary.txt order ---------

REJECT_REASONS = (
    "bad_encoding", "empty_line", "bad_json", "not_object", "missing_field",
    "bad_type", "bad_id", "bad_timestamp", "timestamp_out_of_range",
    "unknown_kind", "bad_payload", "unknown_metric", "unknown_unit",
    "bad_value", "value_out_of_range", "bad_quality", "bad_tag",
    "duplicate_id", "unknown_device", "site_mismatch",
)

# --- section 2.3: summary.txt key order -------------------------------------

SUMMARY_KEYS = (
    ("input_lines", "rejected_total")
    + tuple("rejected_" + reason for reason in REJECT_REASONS)
    + ("dropped_inactive", "dropped_non_telemetry", "dropped_low_quality",
       "aggregated_records", "window_rows", "distinct_devices",
       "sum_milli_total")
)

# --- section 7.2: exit codes ------------------------------------------------

EXIT_OK = 0
EXIT_INTERNAL = 1
EXIT_USAGE = 2
EXIT_EVENTS = 3
EXIT_DEVICES = 4
EXIT_OUTPUT = 5
