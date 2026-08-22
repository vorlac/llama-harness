# Wire strings: the ASCII token encoding of SPEC.md section 3.3.
#
# Decoding is per byte and happens before UTF-8 decoding, so a token is turned
# into a byte string first and interpreted as text second. Every rejection here
# is `bad-request`, which the caller reports with position -1: a malformed
# request is not a pattern error and carries no pattern offset.

from errors import BadRequest

_HEX = "0123456789abcdefABCDEF"


def decode_token(token: str) -> str:
    """One wire token as the text it denotes.

    A token consisting of exactly one `-` is the empty string; every other
    `-` is malformed, which is what makes the empty token unambiguous.
    """
    if token == "":
        raise BadRequest("empty field")
    if token == "-":
        return ""
    out = bytearray()
    i = 0
    n = len(token)
    while i < n:
        ch = token[i]
        if ch == "\\":
            if i + 1 >= n:
                raise BadRequest("token ends with a lone backslash")
            nxt = token[i + 1]
            if nxt == "\\":
                out.append(0x5C)
                i += 2
                continue
            if nxt == "x":
                if i + 3 >= n or token[i + 2] not in _HEX or token[i + 3] not in _HEX:
                    raise BadRequest("truncated or malformed \\xHH escape")
                out.append(int(token[i + 2 : i + 4], 16))
                i += 4
                continue
            raise BadRequest("undefined wire escape \\%s" % nxt)
        code = ord(ch)
        if ch == "-" or code < 0x21 or code > 0x7E:
            raise BadRequest("byte %#04x is not writable in a wire token" % code)
        out.append(code)
        i += 1
    try:
        return bytes(out).decode("utf-8")
    except UnicodeDecodeError:
        raise BadRequest("token does not decode as UTF-8")
