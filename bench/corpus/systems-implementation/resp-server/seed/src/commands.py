# The command table and the families this workspace implements.
#
# Every handler takes the session and the raw argument list and returns encoded
# reply bytes. Arity is checked by the dispatcher, before a handler is reached
# and before anything else, per SPEC.md section 4.3; a handler therefore never
# checks its own argument count.
#
# Section 4.4's ordering is a handler-level obligation: the key's type is
# validated before any argument value is parsed, so every handler that touches
# a key looks the key up first and parses second. `SET` is the documented
# exception and says so where it is implemented.

from resp import (
    array,
    bulk,
    bulk_array,
    error,
    integer,
    simple,
)
from store import HASH, LIST, SET, STRING, now_ms
from values import INT64_MAX, glob_match, render_int, strict_int64

WRONGTYPE = "WRONGTYPE Operation against a key holding the wrong kind of value"
NOT_INT = "ERR value is not an integer or out of range"
HASH_NOT_INT = "ERR hash value is not an integer or out of range"
OVERFLOW = "ERR increment or decrement would overflow"
NOT_POSITIVE = "ERR value is out of range, must be positive"
SYNTAX = "ERR syntax error"
NO_SUCH_KEY = "ERR no such key"
DB_OUT_OF_RANGE = "ERR DB index is out of range"
INVALID_CURSOR = "ERR invalid cursor"

MAX_CURSOR = 2 ** 64 - 1
SCAN_DEFAULT_COUNT = 10


class CommandError(Exception):
    """A command-level failure: an error reply that leaves the connection open."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class Command:
    """One entry of the table: the canonical name, its arity, and its handler."""

    def __init__(self, name, handler, low, high, parity):
        self.name = name
        self.handler = handler
        self.low = low
        self.high = high
        self.parity = parity

    def arity_ok(self, argc: int) -> bool:
        if argc < self.low:
            return False
        if self.high is not None and argc > self.high:
            return False
        if self.parity == "odd" and argc % 2 == 0:
            return False
        if self.parity == "even" and argc % 2 == 1:
            return False
        return True


COMMANDS = {}


def register(name, low, high=None, parity=None):
    def bind(handler):
        COMMANDS[name] = Command(name, handler, low, high, parity)
        return handler

    return bind


def wrong_arity(name: str) -> bytes:
    return error("ERR wrong number of arguments for '%s' command" % name)


def unknown_command(name: bytes) -> bytes:
    return b"-ERR unknown command '" + name + b"'\r\n"


# -- shared helpers ------------------------------------------------------


def typed(database, key, kind):
    """The value under `key` when it is of `kind`, None when absent."""
    entry = database.entry(key)
    if entry is None:
        return None
    if entry[0] != kind:
        raise CommandError(WRONGTYPE)
    return entry[1]


def argument_int(text: bytes) -> int:
    value = strict_int64(text)
    if value is None:
        raise CommandError(NOT_INT)
    return value


def stored_int(text: bytes) -> int:
    value = strict_int64(text)
    if value is None:
        raise CommandError(NOT_INT)
    return value


def checked_sum(left: int, right: int) -> int:
    """The sum, or the overflow error of section 8.3.

    The accepted band is `(INT64_MIN, INT64_MAX]`, open at the bottom: a result
    of exactly INT64_MIN is refused, because `DECRBY` reaches it by negating its
    argument and INT64_MIN has no negation inside the type. `SET`ting INT64_MIN
    and reading it back is unaffected - the band is on the result of an
    arithmetic command, not on a stored value.
    """
    total = left + right
    if total <= -(2 ** 63) or total > INT64_MAX:
        raise CommandError(OVERFLOW)
    return total


def absolute_deadline(interval_ms: int, command_name: str) -> int:
    base = now_ms()
    if interval_ms > INT64_MAX - base:
        raise CommandError(
            "ERR invalid expire time in '%s' command" % command_name
        )
    return base + interval_ms


def normalized_range(start: int, stop: int, length: int):
    if start < 0:
        start += length
    if stop < 0:
        stop += length
    if start < 0:
        start = 0
    if stop > length - 1:
        stop = length - 1
    return start, stop


def drop_if_empty(database, key, container) -> None:
    if not container:
        database.drop(key)


# -- connection ----------------------------------------------------------


@register("ping", 1, 2)
def do_ping(session, args):
    if len(args) == 2:
        return bulk(args[1])
    return simple("PONG")


@register("echo", 2, 2)
def do_echo(session, args):
    return bulk(args[1])


@register("select", 2, 2)
def do_select(session, args):
    index = argument_int(args[1])
    if index < 0 or index >= len(session.keyspace.databases):
        raise CommandError(DB_OUT_OF_RANGE)
    session.db_index = index
    return simple("OK")


@register("quit", 1, 1)
def do_quit(session, args):
    session.closing = True
    return simple("OK")


# -- harness admin -------------------------------------------------------


@register("flushdb", 1, 2)
def do_flushdb(session, args):
    if len(args) == 2 and args[1].upper() not in (b"ASYNC", b"SYNC"):
        raise CommandError(SYNTAX)
    session.database.flush()
    return simple("OK")


@register("dbsize", 1, 1)
def do_dbsize(session, args):
    return integer(session.database.size())


# -- strings -------------------------------------------------------------


@register("get", 2, 2)
def do_get(session, args):
    return bulk(typed(session.database, args[1], STRING))


@register("set", 3)
def do_set(session, args):
    # The one command whose options are validated before the key is examined,
    # per section 7.3: arity, option syntax, expire-time validity, the GET type
    # check, then the store.
    key, value = args[1], args[2]
    expire_ms = None
    expire_text = None
    unit = None
    exclusive = None
    want_old = False
    index = 3
    while index < len(args):
        token = args[index].upper()
        if token in (b"EX", b"PX"):
            if unit is not None or index + 1 >= len(args):
                raise CommandError(SYNTAX)
            unit = token
            expire_text = args[index + 1]
            index += 2
            continue
        if token in (b"NX", b"XX"):
            if exclusive is not None:
                raise CommandError(SYNTAX)
            exclusive = token
            index += 1
            continue
        if token == b"GET":
            if want_old:
                raise CommandError(SYNTAX)
            want_old = True
            index += 1
            continue
        raise CommandError(SYNTAX)
    if unit is not None:
        interval = argument_int(expire_text)
        if interval <= 0:
            raise CommandError("ERR invalid expire time in 'set' command")
        if unit == b"EX":
            if interval > INT64_MAX // 1000:
                raise CommandError("ERR invalid expire time in 'set' command")
            interval *= 1000
        expire_ms = absolute_deadline_for_set(interval)

    database = session.database
    old = None
    if want_old:
        old = typed(database, key, STRING)
    exists = database.alive(key)
    if (exclusive == b"NX" and exists) or (exclusive == b"XX" and not exists):
        return bulk(old) if want_old else bulk(None)
    database.store(key, STRING, value)
    if expire_ms is not None:
        database.set_expiry(key, expire_ms)
    return bulk(old) if want_old else simple("OK")


def absolute_deadline_for_set(interval_ms: int) -> int:
    base = now_ms()
    if interval_ms > INT64_MAX - base:
        raise CommandError("ERR invalid expire time in 'set' command")
    return base + interval_ms


@register("getset", 3, 3)
def do_getset(session, args):
    database = session.database
    old = typed(database, args[1], STRING)
    database.store(args[1], STRING, args[2])
    return bulk(old)


@register("append", 3, 3)
def do_append(session, args):
    database = session.database
    current = typed(database, args[1], STRING)
    value = (current or b"") + args[2]
    database.store(args[1], STRING, value, keep_ttl=True)
    return integer(len(value))


def _increment(session, key, delta):
    database = session.database
    current = typed(database, key, STRING)
    base = stored_int(current) if current is not None else 0
    total = checked_sum(base, delta)
    database.store(key, STRING, render_int(total), keep_ttl=True)
    return integer(total)


@register("incr", 2, 2)
def do_incr(session, args):
    return _increment(session, args[1], 1)


@register("decr", 2, 2)
def do_decr(session, args):
    return _increment(session, args[1], -1)


@register("incrby", 3, 3)
def do_incrby(session, args):
    database = session.database
    current = typed(database, args[1], STRING)
    delta = argument_int(args[2])
    base = stored_int(current) if current is not None else 0
    total = checked_sum(base, delta)
    database.store(args[1], STRING, render_int(total), keep_ttl=True)
    return integer(total)


@register("decrby", 3, 3)
def do_decrby(session, args):
    database = session.database
    current = typed(database, args[1], STRING)
    delta = argument_int(args[2])
    base = stored_int(current) if current is not None else 0
    total = checked_sum(base, -delta)
    database.store(args[1], STRING, render_int(total), keep_ttl=True)
    return integer(total)


@register("strlen", 2, 2)
def do_strlen(session, args):
    current = typed(session.database, args[1], STRING)
    return integer(len(current) if current is not None else 0)


@register("mget", 2)
def do_mget(session, args):
    database = session.database
    out = []
    for key in args[1:]:
        entry = database.entry(key)
        out.append(entry[1] if entry is not None and entry[0] == STRING else None)
    return bulk_array(out)


@register("mset", 3, None, "odd")
def do_mset(session, args):
    database = session.database
    for index in range(1, len(args), 2):
        database.store(args[index], STRING, args[index + 1])
    return simple("OK")


# -- keyspace ------------------------------------------------------------


@register("del", 2)
def do_del(session, args):
    database = session.database
    return integer(sum(1 for key in args[1:] if database.drop(key)))


@register("exists", 2)
def do_exists(session, args):
    database = session.database
    return integer(sum(1 for key in args[1:] if database.alive(key)))


def _expire(session, args, factor, command_name):
    database = session.database
    interval = argument_int(args[2])
    if not database.alive(args[1]):
        return integer(0)
    if interval <= 0:
        database.drop(args[1])
        return integer(1)
    if factor != 1 and interval > INT64_MAX // factor:
        raise CommandError("ERR invalid expire time in '%s' command" % command_name)
    database.set_expiry(
        args[1], absolute_deadline(interval * factor, command_name)
    )
    return integer(1)


@register("expire", 3, 3)
def do_expire(session, args):
    return _expire(session, args, 1000, "expire")


@register("pexpire", 3, 3)
def do_pexpire(session, args):
    return _expire(session, args, 1, "pexpire")


@register("ttl", 2, 2)
def do_ttl(session, args):
    remaining = _remaining_ms(session.database, args[1])
    if remaining is None or remaining < 0:
        return integer(-2 if remaining is None else remaining)
    return integer((remaining + 500) // 1000)


@register("pttl", 2, 2)
def do_pttl(session, args):
    remaining = _remaining_ms(session.database, args[1])
    if remaining is None:
        return integer(-2)
    return integer(remaining)


def _remaining_ms(database, key):
    """Milliseconds left, -1 for no expiry, None for an absent key."""
    if not database.alive(key):
        return None
    deadline = database.deadline(key)
    if deadline is None:
        return -1
    return max(0, deadline - now_ms())


@register("persist", 2, 2)
def do_persist(session, args):
    database = session.database
    if not database.alive(args[1]):
        return integer(0)
    return integer(1 if database.clear_expiry(args[1]) else 0)


@register("keys", 2, 2)
def do_keys(session, args):
    database = session.database
    return bulk_array(
        [key for key in database.live_keys() if glob_match(args[1], key)]
    )


@register("type", 2, 2)
def do_type(session, args):
    kind = session.database.kind(args[1])
    return simple(kind if kind is not None else "none")


@register("rename", 3, 3)
def do_rename(session, args):
    database = session.database
    source, destination = args[1], args[2]
    if not database.alive(source):
        raise CommandError(NO_SUCH_KEY)
    if source == destination:
        return simple("OK")
    kind, value = database.values[source]
    deadline = database.deadline(source)
    database.values.pop(source, None)
    database.expiry.pop(source, None)
    database.store(destination, kind, value)
    if deadline is not None:
        database.set_expiry(destination, deadline)
    return simple("OK")


@register("scan", 2)
def do_scan(session, args):
    cursor_text = args[1]
    if not cursor_text.isdigit():
        raise CommandError(INVALID_CURSOR)
    cursor = int(cursor_text.decode("ascii"))
    if cursor > MAX_CURSOR:
        raise CommandError(INVALID_CURSOR)
    pattern = None
    count = SCAN_DEFAULT_COUNT
    index = 2
    while index < len(args):
        token = args[index].upper()
        if token == b"MATCH" and index + 1 < len(args):
            pattern = args[index + 1]
            index += 2
            continue
        if token == b"COUNT" and index + 1 < len(args):
            count = argument_int(args[index + 1])
            if count < 1:
                raise CommandError(SYNTAX)
            index += 2
            continue
        raise CommandError(SYNTAX)
    following, keys = session.database.scan(cursor, count)
    if pattern is not None:
        keys = [key for key in keys if glob_match(pattern, key)]
    return array([bulk(str(following).encode("ascii")), bulk_array(keys)])


# -- lists ---------------------------------------------------------------


def _push(session, args, prepend):
    database = session.database
    current = typed(database, args[1], LIST)
    values = list(current) if current is not None else []
    for value in args[2:]:
        if prepend:
            values.insert(0, value)
        else:
            values.append(value)
    database.store(args[1], LIST, values, keep_ttl=True)
    return integer(len(values))


@register("lpush", 3)
def do_lpush(session, args):
    return _push(session, args, True)


@register("rpush", 3)
def do_rpush(session, args):
    return _push(session, args, False)


def _pop(session, args, from_head):
    database = session.database
    current = typed(database, args[1], LIST)
    if len(args) == 2:
        if current is None:
            return bulk(None)
        value = current.pop(0) if from_head else current.pop()
        drop_if_empty(database, args[1], current)
        return bulk(value)
    count = argument_int(args[2])
    if count < 0:
        raise CommandError(NOT_POSITIVE)
    if current is None:
        return array(None)
    taken = []
    for _ in range(min(count, len(current))):
        taken.append(current.pop(0) if from_head else current.pop())
    drop_if_empty(database, args[1], current)
    return bulk_array(taken)


@register("lpop", 2, 3)
def do_lpop(session, args):
    return _pop(session, args, True)


@register("rpop", 2, 3)
def do_rpop(session, args):
    return _pop(session, args, False)


@register("lrange", 4, 4)
def do_lrange(session, args):
    current = typed(session.database, args[1], LIST)
    start = argument_int(args[2])
    stop = argument_int(args[3])
    if current is None:
        return array([])
    start, stop = normalized_range(start, stop, len(current))
    if start > stop:
        return array([])
    return bulk_array(current[start : stop + 1])


@register("llen", 2, 2)
def do_llen(session, args):
    current = typed(session.database, args[1], LIST)
    return integer(len(current) if current is not None else 0)


@register("lrem", 4, 4)
def do_lrem(session, args):
    database = session.database
    current = typed(database, args[1], LIST)
    count = argument_int(args[2])
    if current is None:
        return integer(0)
    element = args[3]
    limit = abs(count) if count else len(current)
    indexes = range(len(current)) if count >= 0 else range(len(current) - 1, -1, -1)
    doomed = []
    for position in indexes:
        if len(doomed) >= limit:
            break
        if current[position] == element:
            doomed.append(position)
    for position in sorted(doomed, reverse=True):
        del current[position]
    drop_if_empty(database, args[1], current)
    return integer(len(doomed))


@register("lindex", 3, 3)
def do_lindex(session, args):
    current = typed(session.database, args[1], LIST)
    index = argument_int(args[2])
    if current is None:
        return bulk(None)
    if index < 0:
        index += len(current)
    if index < 0 or index >= len(current):
        return bulk(None)
    return bulk(current[index])


# -- hashes --------------------------------------------------------------


@register("hset", 4, None, "even")
def do_hset(session, args):
    database = session.database
    current = typed(database, args[1], HASH)
    fields = dict(current) if current is not None else {}
    added = 0
    for index in range(2, len(args), 2):
        if args[index] not in fields:
            added += 1
        fields[args[index]] = args[index + 1]
    database.store(args[1], HASH, fields, keep_ttl=True)
    return integer(added)


@register("hget", 3, 3)
def do_hget(session, args):
    current = typed(session.database, args[1], HASH)
    return bulk(None if current is None else current.get(args[2]))


@register("hdel", 3)
def do_hdel(session, args):
    database = session.database
    current = typed(database, args[1], HASH)
    if current is None:
        return integer(0)
    removed = sum(1 for field in args[2:] if current.pop(field, None) is not None)
    drop_if_empty(database, args[1], current)
    return integer(removed)


@register("hgetall", 2, 2)
def do_hgetall(session, args):
    current = typed(session.database, args[1], HASH)
    if current is None:
        return array([])
    flat = []
    for field, value in current.items():
        flat.append(field)
        flat.append(value)
    return bulk_array(flat)


@register("hexists", 3, 3)
def do_hexists(session, args):
    current = typed(session.database, args[1], HASH)
    return integer(1 if current is not None and args[2] in current else 0)


@register("hincrby", 4, 4)
def do_hincrby(session, args):
    database = session.database
    current = typed(database, args[1], HASH)
    delta = argument_int(args[3])
    fields = dict(current) if current is not None else {}
    stored = fields.get(args[2])
    if stored is None:
        base = 0
    else:
        base = strict_int64(stored)
        if base is None:
            raise CommandError(HASH_NOT_INT)
    total = checked_sum(base, delta)
    fields[args[2]] = render_int(total)
    database.store(args[1], HASH, fields, keep_ttl=True)
    return integer(total)


@register("hkeys", 2, 2)
def do_hkeys(session, args):
    current = typed(session.database, args[1], HASH)
    return bulk_array([] if current is None else list(current))


@register("hvals", 2, 2)
def do_hvals(session, args):
    current = typed(session.database, args[1], HASH)
    return bulk_array([] if current is None else list(current.values()))


@register("hlen", 2, 2)
def do_hlen(session, args):
    current = typed(session.database, args[1], HASH)
    return integer(0 if current is None else len(current))


# -- sets ----------------------------------------------------------------


@register("sadd", 3)
def do_sadd(session, args):
    database = session.database
    current = typed(database, args[1], SET)
    members = set(current) if current is not None else set()
    before = len(members)
    members.update(args[2:])
    database.store(args[1], SET, members, keep_ttl=True)
    return integer(len(members) - before)


@register("srem", 3)
def do_srem(session, args):
    database = session.database
    current = typed(database, args[1], SET)
    if current is None:
        return integer(0)
    before = len(current)
    current.difference_update(args[2:])
    drop_if_empty(database, args[1], current)
    return integer(before - len(current))


@register("smembers", 2, 2)
def do_smembers(session, args):
    current = typed(session.database, args[1], SET)
    return bulk_array([] if current is None else list(current))


@register("sismember", 3, 3)
def do_sismember(session, args):
    current = typed(session.database, args[1], SET)
    return integer(1 if current is not None and args[2] in current else 0)


@register("scard", 2, 2)
def do_scard(session, args):
    current = typed(session.database, args[1], SET)
    return integer(0 if current is None else len(current))


def _set_operands(session, keys):
    # Section 7.7: every named key is type-checked before any result is built.
    return [typed(session.database, key, SET) or set() for key in keys]


@register("sinter", 2)
def do_sinter(session, args):
    operands = _set_operands(session, args[1:])
    result = set(operands[0])
    for other in operands[1:]:
        result &= other
    return bulk_array(list(result))


@register("sunion", 2)
def do_sunion(session, args):
    operands = _set_operands(session, args[1:])
    result = set()
    for other in operands:
        result |= other
    return bulk_array(list(result))


@register("sdiff", 2)
def do_sdiff(session, args):
    operands = _set_operands(session, args[1:])
    result = set(operands[0])
    for other in operands[1:]:
        result -= other
    return bulk_array(list(result))
