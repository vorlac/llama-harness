# The TCP server of SPEC.md section 2: one thread per connection, one lock over
# the keyspace, and one background cycle that expires keys nobody touched.
#
# A thread per connection is what section 2.4 asks for directly: a connection
# holding half a command blocks only its own thread, so another connection's
# PING is answered while the first request is still incomplete. The lock is held
# for exactly one command, which is section 4.7's atomicity.

import errno
import os
import signal
import socket
import sys
import threading

from commands import COMMANDS, CommandError, unknown_command, wrong_arity
from resp import ProtocolError, error, next_request
from store import Keyspace

DEFAULT_PORT = 6399
HOST = "127.0.0.1"
BACKLOG = 128
READ_SIZE = 65536

# Section 6.3 asks for a cycle at least every 100 ms; this one runs twice that
# often so a key that expires just after a sweep is gone well inside the second.
SWEEP_INTERVAL_SECONDS = 0.05


class Session:
    """One connection's own state: which database it is on, and whether it ends."""

    def __init__(self, keyspace: Keyspace):
        self.keyspace = keyspace
        self.db_index = 0
        self.closing = False

    @property
    def database(self):
        return self.keyspace[self.db_index]


def dispatch(session: Session, arguments) -> bytes:
    """One command, from its name to its encoded reply."""
    name = arguments[0]
    entry = COMMANDS.get(name.lower().decode("latin-1"))
    if entry is None:
        return unknown_command(name)
    if not entry.arity_ok(len(arguments)):
        return wrong_arity(entry.name)
    try:
        return entry.handler(session, arguments)
    except CommandError as exc:
        return error(exc.message)


class Server:
    def __init__(self, port: int):
        self.port = port
        self.keyspace = Keyspace()
        self.lock = threading.Lock()
        self.stopping = threading.Event()
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    def run(self) -> int:
        self.listener.bind((HOST, self.port))
        self.listener.listen(BACKLOG)
        bound = self.listener.getsockname()[1]
        sys.stdout.write("READY %d\n" % bound)
        sys.stdout.flush()
        threading.Thread(target=self._sweeper, daemon=True).start()
        while not self.stopping.is_set():
            try:
                client, _ = self.listener.accept()
            except OSError as exc:
                if self.stopping.is_set() or exc.errno in (errno.EBADF, errno.EINVAL):
                    break
                continue
            client.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            threading.Thread(target=self._serve, args=(client,), daemon=True).start()
        return 0

    def stop(self) -> None:
        self.stopping.set()
        try:
            self.listener.close()
        except OSError:
            pass

    def _sweeper(self) -> None:
        while not self.stopping.wait(SWEEP_INTERVAL_SECONDS):
            with self.lock:
                self.keyspace.sweep()

    def _serve(self, client: socket.socket) -> None:
        session = Session(self.keyspace)
        buffer = bytearray()
        try:
            while True:
                try:
                    chunk = client.recv(READ_SIZE)
                except OSError:
                    return
                if not chunk:
                    return
                buffer += chunk
                while True:
                    try:
                        arguments, consumed = next_request(buffer)
                    except ProtocolError as exc:
                        self._write(client, error(exc.message))
                        return
                    if consumed == 0:
                        break
                    del buffer[:consumed]
                    if arguments is None:
                        continue
                    with self.lock:
                        reply = dispatch(session, arguments)
                    if not self._write(client, reply):
                        return
                    if session.closing:
                        return
        finally:
            try:
                client.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            client.close()

    @staticmethod
    def _write(client: socket.socket, payload: bytes) -> bool:
        try:
            client.sendall(payload)
        except OSError:
            return False
        return True


def parse_port(argv) -> int:
    port = DEFAULT_PORT
    index = 0
    while index < len(argv):
        argument = argv[index]
        if argument == "--port":
            if index + 1 >= len(argv):
                raise ValueError("--port needs a port number")
            port = int(argv[index + 1])
            index += 2
            continue
        if argument.startswith("--port="):
            port = int(argument.split("=", 1)[1])
            index += 1
            continue
        raise ValueError("unrecognised argument %r" % argument)
    if not 1024 <= port <= 65535:
        raise ValueError("port %d is outside 1024..65535" % port)
    return port


def main(argv) -> int:
    try:
        port = parse_port(argv)
    except ValueError as exc:
        sys.stderr.write("resp-server: %s\n" % exc)
        return 2
    server = Server(port)

    def shut_down(signum, frame):
        server.stop()
        os._exit(0)

    signal.signal(signal.SIGTERM, shut_down)
    signal.signal(signal.SIGINT, shut_down)
    return server.run()
