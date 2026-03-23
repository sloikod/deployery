#!/usr/bin/env python3
"""Creates a Wayland virtual pointer via zwlr_virtual_pointer_manager_v1.

No uinput/kernel modules needed - pure Wayland wire protocol over the compositor
socket. Grants WL_SEAT_CAPABILITY_POINTER to the seat so wayvnc's cursor_sc path
can capture cursor shapes and send them via RFB -239 (client-side cursor in noVNC).

Run once per Sway session before wayvnc starts; kill on session end.
"""
import os, select, signal, socket, struct, sys

XDG_RUNTIME_DIR = os.environ.get("XDG_RUNTIME_DIR", "/tmp/sway-runtime")
WAYLAND_DISPLAY  = os.environ.get("WAYLAND_DISPLAY",  "wayland-1")

# ---------------------------------------------------------------------------
# Minimal Wayland wire-protocol helpers
# ---------------------------------------------------------------------------

def _pack(obj_id: int, opcode: int, payload: bytes = b"") -> bytes:
    size = 8 + len(payload)
    return struct.pack("<IHH", obj_id, opcode, size) + payload

def _uint(v: int) -> bytes:
    return struct.pack("<I", v)

def _string(s: str) -> bytes:
    b = s.encode() + b"\0"
    b += bytes((-len(b)) % 4)          # pad to 4-byte boundary
    return struct.pack("<I", len(s) + 1) + b

# wl_display opcodes
GET_REGISTRY = 1
SYNC         = 0

# wl_registry opcodes / events
BIND   = 0
GLOBAL = 0

# wl_callback events
DONE = 0

# ---------------------------------------------------------------------------
# Wayland client
# ---------------------------------------------------------------------------

class WaylandClient:
    def __init__(self) -> None:
        path = f"{XDG_RUNTIME_DIR}/{WAYLAND_DISPLAY}"
        self._s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self._s.connect(path)
        self._buf = b""
        self._next = 2          # 1 = wl_display

    def alloc(self) -> int:
        oid = self._next
        self._next += 1
        return oid

    def send(self, obj: int, opcode: int, payload: bytes = b"") -> None:
        self._s.sendall(_pack(obj, opcode, payload))

    def recv(self) -> tuple[int, int, bytes]:
        while len(self._buf) < 8:
            self._buf += self._s.recv(4096)
        oid, op, sz = struct.unpack_from("<IHH", self._buf)
        while len(self._buf) < sz:
            self._buf += self._s.recv(4096)
        pay, self._buf = self._buf[8:sz], self._buf[sz:]
        return oid, op, pay

    def sync(self) -> None:
        cb = self.alloc()
        self.send(1, SYNC, _uint(cb))
        while True:
            oid, op, _ = self.recv()
            if oid == cb and op == DONE:
                return

    def fileno(self) -> int:
        return self._s.fileno()

    def drain(self) -> bool:
        """Read and discard pending data. Return False if connection closed."""
        data = self._s.recv(4096)
        if data:
            self._buf += data
            return True
        return False

    def close(self) -> None:
        self._s.close()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

w = WaylandClient()

# Get registry
reg = w.alloc()
w.send(1, GET_REGISTRY, _uint(reg))

# Enumerate globals - look for zwlr_virtual_pointer_manager_v1
cb = w.alloc()
w.send(1, SYNC, _uint(cb))
vpm_name = None
while True:
    oid, op, pay = w.recv()
    if oid == reg and op == GLOBAL:
        gname = struct.unpack_from("<I", pay)[0]
        slen  = struct.unpack_from("<I", pay, 4)[0]
        iface = pay[8:8 + slen - 1].decode()
        if iface == "zwlr_virtual_pointer_manager_v1":
            vpm_name = gname
    elif oid == cb and op == DONE:
        break

if vpm_name is None:
    print("compositor lacks zwlr_virtual_pointer_manager_v1", file=sys.stderr)
    sys.exit(1)

# Bind the manager (untyped new_id: name + interface + version + new_id)
vpm = w.alloc()
w.send(reg, BIND,
       _uint(vpm_name)
       + _string("zwlr_virtual_pointer_manager_v1")
       + _uint(1)
       + _uint(vpm))

# create_virtual_pointer(seat=null, id=vp)
vp = w.alloc()
w.send(vpm, 0, _uint(0) + _uint(vp))

w.sync()  # ensure compositor processed the creation

sys.stdout.write("ready\n")
sys.stdout.flush()

# Keep the Wayland connection (and virtual pointer) alive until killed
running = True
def _stop(*_): global running; running = False
signal.signal(signal.SIGTERM, _stop)
signal.signal(signal.SIGINT,  _stop)

while running:
    r, _, _ = select.select([w], [], [], 1.0)
    if r and not w.drain():
        break  # compositor closed connection

w.close()
