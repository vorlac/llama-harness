"""Timestamp grammar, normalisation and rendering (SPEC.md sections 1.1.4,
5.3).

The pipeline carries instants as integer milliseconds since the Unix epoch.
There are no leap seconds anywhere: one day is exactly 86_400_000 ms.
"""

import datetime
import re

from .config import WINDOW_MS

TIMESTAMP_PATTERN = (
    r"\A([0-9]{4})-([0-9]{2})-([0-9]{2})"
    r"T([0-9]{2}):([0-9]{2}):([0-9]{2})\.([0-9]{3})"
    r"(Z|[+-][0-9]{2}:[0-9]{2})\Z"
)
TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%S.%f%z"

UNIX_EPOCH = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)

MAX_OFFSET_MINUTES = 14 * 60
MONTH_LENGTHS = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


def is_leap_year(year):
    """Proleptic Gregorian leap rule."""
    return (year % 4 == 0 and year % 100 != 0) or year % 400 == 0


def days_in_month(year, month):
    if month == 2 and is_leap_year(year):
        return 29
    return MONTH_LENGTHS[month - 1]


def civil_from_days(days):
    """(year, month, day) for a count of days since 1970-01-01."""
    days += 719468
    era = (days if days >= 0 else days - 146096) // 146097
    day_of_era = days - era * 146097
    year_of_era = (day_of_era - day_of_era // 1460 + day_of_era // 36524
                   - day_of_era // 146096) // 365
    year = year_of_era + era * 400
    day_of_year = day_of_era - (365 * year_of_era + year_of_era // 4
                                - year_of_era // 100)
    shifted_month = (5 * day_of_year + 2) // 153
    day = day_of_year - (153 * shifted_month + 2) // 5 + 1
    month = shifted_month + (3 if shifted_month < 10 else -9)
    return (year + (1 if month <= 2 else 0), month, day)


def parse_timestamp(text):
    """Return epoch milliseconds, or None when `text` is not a valid instant.

    Both halves of section 1.1.4 are enforced: the grammar, and then calendar
    and range validity of the fields it captured.
    """
    match = re.compile(TIMESTAMP_PATTERN).match(text)
    if match is None:
        return None

    year = int(match.group(1))
    month = int(match.group(2))
    day = int(match.group(3))
    if month < 1 or month > 12:
        return None
    if day < 1 or day > days_in_month(year, month):
        return None
    if int(match.group(4)) > 23 or int(match.group(5)) > 59:
        return None
    if int(match.group(6)) > 59:
        return None

    offset = match.group(8)
    if offset != "Z":
        offset_hours = int(offset[1:3])
        offset_minutes = int(offset[4:6])
        if offset_hours > 23 or offset_minutes > 59:
            return None
        if offset_hours * 60 + offset_minutes > MAX_OFFSET_MINUTES:
            return None

    if year < 1:
        # Year 0000 is a valid proleptic Gregorian year but lies outside the
        # range `datetime` covers.  Every instant in it is below the epoch
        # window section 4.5 accepts, so hand back an instant that is too.
        return -1

    try:
        moment = datetime.datetime.strptime(text, TIMESTAMP_FORMAT)
    except ValueError:
        return None
    since_epoch = moment - UNIX_EPOCH
    return (since_epoch.days * 86400000
            + since_epoch.seconds * 1000
            + since_epoch.microseconds // 1000)


def format_timestamp(epoch_ms):
    """Render epoch milliseconds as `YYYY-MM-DDTHH:MM:SS.mmmZ`."""
    seconds, milliseconds = divmod(epoch_ms, 1000)
    days, seconds_of_day = divmod(seconds, 86400)
    year, month, day = civil_from_days(days)
    hour, seconds_of_hour = divmod(seconds_of_day, 3600)
    minute, second = divmod(seconds_of_hour, 60)
    return "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ" % (
        year, month, day, hour, minute, second, milliseconds)


def window_start_ms(epoch_ms):
    """Start of the tumbling window that contains `epoch_ms`."""
    return (epoch_ms // WINDOW_MS) * WINDOW_MS
