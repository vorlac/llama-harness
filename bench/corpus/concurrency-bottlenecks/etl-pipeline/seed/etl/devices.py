"""The device lookup table (SPEC.md section 1.2).

`devices.tsv` is small, sorted by `device_id`, and read once at startup.  Any
problem with it is fatal: a bad lookup table is a startup error, never a
per-record reject.
"""

import collections
import re

DEVICES_HEADER = "device_id\tsite_id\tregion\tcalibration_milli\tactive"

DEVICE_PATTERN = r"\Adev-[0-9]{6}\Z"
SITE_PATTERN = r"\ASITE-[0-9]{2}\Z"
REGION_PATTERN = r"\A[a-z]{2}-[a-z]+\Z"
INTEGER_PATTERN = r"\A-?(?:0|[1-9][0-9]*)\Z"

CALIBRATION_ABS_MAX = 1000000

Device = collections.namedtuple(
    "Device", "device_id site_id region calibration_milli active")


class DeviceTableError(Exception):
    """`devices.tsv` is missing, unreadable or malformed."""


class DeviceTable:
    """The rows of `devices.tsv`, in the order the file lists them."""

    def __init__(self, devices):
        self._devices = devices
        self._device_ids = [device.device_id for device in devices]

    def __len__(self):
        return len(self._devices)

    def lookup(self, device_id):
        """The row for `device_id`, or None when the table does not list it."""
        try:
            position = self._device_ids.index(device_id)
        except ValueError:
            return None
        return self._devices[position]


def _fail(path, line_number, message):
    raise DeviceTableError("%s:%d: %s" % (path, line_number, message))


def load_device_table(path):
    """Read and check `devices.tsv`.  Raises DeviceTableError on any problem."""
    try:
        handle = open(path, "rb")
    except OSError as exc:
        raise DeviceTableError("%s: %s" % (path, exc))

    devices = []
    device_ids = []
    with handle:
        header = handle.readline().decode("latin-1").rstrip("\n")
        if header != DEVICES_HEADER:
            raise DeviceTableError("%s: unexpected header %r" % (path, header))
        for line_number, raw in enumerate(handle, start=2):
            line = raw.decode("latin-1").rstrip("\n")
            if line == "":
                continue
            columns = line.split("\t")
            if len(columns) != 5:
                _fail(path, line_number,
                      "expected 5 columns, found %d" % len(columns))
            device_id, site_id, region, calibration, active = columns
            if re.compile(DEVICE_PATTERN).match(device_id) is None:
                _fail(path, line_number, "bad device_id %r" % device_id)
            if device_id in device_ids:
                _fail(path, line_number, "duplicate device_id %r" % device_id)
            if re.compile(SITE_PATTERN).match(site_id) is None:
                _fail(path, line_number, "bad site_id %r" % site_id)
            if re.compile(REGION_PATTERN).match(region) is None:
                _fail(path, line_number, "bad region %r" % region)
            if re.compile(INTEGER_PATTERN).match(calibration) is None:
                _fail(path, line_number, "bad calibration_milli %r"
                      % calibration)
            if abs(int(calibration)) > CALIBRATION_ABS_MAX:
                _fail(path, line_number, "calibration_milli out of range")
            if active not in ("0", "1"):
                _fail(path, line_number, "bad active %r" % active)
            devices.append(Device(device_id, site_id, region,
                                  int(calibration), active == "1"))
            device_ids.append(device_id)
    return DeviceTable(devices)
