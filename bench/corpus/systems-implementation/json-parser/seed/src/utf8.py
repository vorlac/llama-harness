# Whole-input UTF-8 well-formedness, run before the grammar.
#
# SPEC.md section 5.1 makes this a whole-input scan that precedes parsing, so a
# document with a syntax error early and an ill-formed byte late reports the
# ill-formed byte. That is why validation is a pass of its own rather than a
# check folded into string scanning.

CONTINUATION = range(0x80, 0xC0)


def first_ill_formed(data):
    """The offset of the first ill-formed sequence, or None.

    The offset reported is the first byte of the sequence: the lead byte, or a
    stray continuation byte itself.
    """
    i = 0
    n = len(data)
    while i < n:
        lead = data[i]
        if lead < 0x80:
            i += 1
            continue
        if 0xC2 <= lead <= 0xDF:
            need = 1
        elif 0xE0 <= lead <= 0xEF:
            need = 2
        elif 0xF0 <= lead <= 0xF4:
            need = 3
        else:
            return i
        if i + need >= n:
            return i
        # U+10FFFF is the last scalar value there is, and a four-byte sequence
        # led by F4 can spell past it. The check is here rather than left to
        # the caller because a value above the range has no scalar to be.
        if lead == 0xF4 and data[i + 1] > 0x8F:
            return i
        for k in range(1, need + 1):
            if data[i + k] not in CONTINUATION:
                return i
        i += need + 1
    return None


def scalar_at(data, i):
    """The scalar value encoded at offset `i`, and the offset after it.

    Called only after `first_ill_formed` has cleared the whole input, so the
    sequence here is known to have a lead byte and its continuations.
    """
    lead = data[i]
    if lead < 0x80:
        return lead, i + 1
    if lead < 0xE0:
        return ((lead & 0x1F) << 6) | (data[i + 1] & 0x3F), i + 2
    if lead < 0xF0:
        return (
            ((lead & 0x0F) << 12) | ((data[i + 1] & 0x3F) << 6) | (data[i + 2] & 0x3F),
            i + 3,
        )
    return (
        ((lead & 0x07) << 18)
        | ((data[i + 1] & 0x3F) << 12)
        | ((data[i + 2] & 0x3F) << 6)
        | (data[i + 3] & 0x3F),
        i + 4,
    )
