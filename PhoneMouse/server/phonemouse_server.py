#!/usr/bin/env python3
"""PhoneMouse desktop receiver.

Run this on the computer you want to control, then open the PhoneMouse app on your iPhone
(same Wi-Fi network) and pick this computer.

    pip install -r requirements.txt
    python3 phonemouse_server.py

Wire protocol (newline-delimited text over TCP):
    server -> PM1 <nonce> <computer name>
    client -> A <hex HMAC-SHA256(key=PIN, msg=nonce)>
    server -> OK | NO <reason>
    client -> M <dx> <dy>      relative move, pixels (fractions accumulate)
              B <l|r|m> <1|0>  button down / up
              S <dx> <dy>      scroll, wheel notches (+dy = scroll up)
              P <token>        ping (echoed back)
"""
import argparse
import hashlib
import hmac
import json
import os
import secrets
import socket
import sys
import threading
import time

PROTOCOL = "PM1"
SERVICE_TYPE = "_phonemouse._tcp.local."
DEFAULT_PORT = 47800
IDLE_TIMEOUT = 6.0        # seconds without any data before a client is dropped
AUTH_TIMEOUT = 20.0
MAX_LINE = 256


def config_path():
    base = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(base, "phonemouse", "config.json")


def load_pin(force_new=False):
    path = config_path()
    if not force_new:
        try:
            with open(path) as f:
                pin = str(json.load(f)["pin"])
                if len(pin) == 6 and pin.isdigit():
                    return pin
        except (OSError, ValueError, KeyError):
            pass
    pin = "%06d" % secrets.randbelow(1_000_000)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump({"pin": pin}, f)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    except OSError as e:
        print("  (could not save PIN: %s - it will change next launch)" % e)
    return pin


def local_addresses():
    found = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.0.2.1", 9))      # no packets are sent; just picks the outbound interface
        found.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in found:
                found.append(ip)
    except OSError:
        pass
    return found


class Pointer:
    """Applies events to the real mouse. Keeps sub-pixel / sub-notch remainders."""

    def __init__(self, scroll_scale):
        from pynput.mouse import Button, Controller
        self.mouse = Controller()
        self.buttons = {"l": Button.left, "r": Button.right, "m": Button.middle}
        self.held = set()
        self.rx = self.ry = 0.0
        self.sx = self.sy = 0.0
        self.scroll_scale = scroll_scale
        self.lock = threading.Lock()

    def move(self, dx, dy):
        with self.lock:
            self.rx += dx
            self.ry += dy
            ix, iy = int(self.rx), int(self.ry)
            if ix or iy:
                self.rx -= ix
                self.ry -= iy
                self.mouse.move(ix, iy)

    def button(self, name, down):
        btn = self.buttons.get(name)
        if btn is None:
            return
        with self.lock:
            if down and name not in self.held:
                self.held.add(name)
                self.mouse.press(btn)
            elif not down and name in self.held:
                self.held.discard(name)
                self.mouse.release(btn)

    def scroll(self, dx, dy):
        with self.lock:
            self.sx += dx * self.scroll_scale
            self.sy += dy * self.scroll_scale
            ix, iy = int(self.sx), int(self.sy)
            if ix or iy:
                self.sx -= ix
                self.sy -= iy
                self.mouse.scroll(ix, iy)

    def release_all(self):
        with self.lock:
            for name in list(self.held):
                self.held.discard(name)
                try:
                    self.mouse.release(self.buttons[name])
                except Exception:
                    pass
            self.rx = self.ry = self.sx = self.sy = 0.0


class FailureLimiter:
    """Slows down PIN guessing: after 5 wrong PINs an address waits 30 s."""

    def __init__(self):
        self.failures = {}
        self.lock = threading.Lock()

    def blocked(self, ip):
        with self.lock:
            count, until = self.failures.get(ip, (0, 0.0))
            return count >= 5 and time.monotonic() < until

    def record(self, ip, ok):
        with self.lock:
            if ok:
                self.failures.pop(ip, None)
                return
            count, until = self.failures.get(ip, (0, 0.0))
            if count >= 5 and time.monotonic() >= until:
                count = 0
            self.failures[ip] = (count + 1, time.monotonic() + 30.0)


def read_lines(conn):
    """Yields decoded lines; raises socket.timeout / OSError on trouble."""
    buf = b""
    while True:
        chunk = conn.recv(4096)
        if not chunk:
            return
        buf += chunk
        while True:
            i = buf.find(b"\n")
            if i < 0:
                break
            line, buf = buf[:i], buf[i + 1:]
            yield line.decode("utf-8", "replace").strip()
        if len(buf) > MAX_LINE:
            return


def handle_client(conn, addr, pin, name, pointer, limiter, active, quiet):
    ip = addr[0]
    authed = False
    try:
        conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        if limiter.blocked(ip):
            conn.sendall(b"NO slow-down\n")
            return
        nonce = secrets.token_hex(16)
        conn.settimeout(AUTH_TIMEOUT)
        conn.sendall(("%s %s %s\n" % (PROTOCOL, nonce, name)).encode())
        expected = hmac.new(pin.encode(), nonce.encode(), hashlib.sha256).hexdigest()

        for line in read_lines(conn):
            if not line:
                continue
            parts = line.split()
            kind = parts[0]
            if not authed:
                if kind != "A" or len(parts) < 2:
                    conn.sendall(b"NO auth-required\n")
                    return
                ok = hmac.compare_digest(parts[1].lower(), expected)
                limiter.record(ip, ok)
                if not ok:
                    conn.sendall(b"NO bad-pin\n")
                    print("  x wrong PIN from %s" % ip)
                    return
                authed = True
                # Newest phone wins: drop whoever was connected before.
                with active["lock"]:
                    old = active.get("conn")
                    active["conn"] = conn
                if old is not None:
                    try:
                        old.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass
                conn.settimeout(IDLE_TIMEOUT)
                conn.sendall(b"OK\n")
                print("  + phone connected from %s" % ip)
                continue
            try:
                if kind == "M" and len(parts) == 3:
                    dx, dy = float(parts[1]), float(parts[2])
                    if abs(dx) < 5000 and abs(dy) < 5000:      # also rejects NaN / inf
                        pointer.move(dx, dy)
                elif kind == "B" and len(parts) == 3:
                    pointer.button(parts[1], parts[2] == "1")
                elif kind == "S" and len(parts) == 3:
                    dx, dy = float(parts[1]), float(parts[2])
                    if abs(dx) < 200 and abs(dy) < 200:
                        pointer.scroll(dx, dy)
                elif kind == "P":
                    conn.sendall((line[:64] + "\n").encode())
            except ValueError:
                continue
            except Exception as e:      # an injection failure must not kill the session
                if not quiet:
                    print("  ! could not apply %r: %s" % (line, e))
    except (socket.timeout, OSError):
        pass
    finally:
        if authed:
            with active["lock"]:
                mine = active.get("conn") is conn
                if mine:
                    active["conn"] = None
            if mine:
                pointer.release_all()      # never leave a button stuck down
            print("  - phone disconnected (%s)" % ip)
        try:
            conn.close()
        except OSError:
            pass


def advertise(name, port, addresses):
    try:
        from zeroconf import ServiceInfo, Zeroconf
    except ImportError:
        print("  (zeroconf not installed: the app won't auto-discover this computer;")
        print("   use 'Enter address' in the app instead)")
        return None
    try:
        zc = Zeroconf()
        info = ServiceInfo(
            SERVICE_TYPE,
            "%s.%s" % (name, SERVICE_TYPE),
            addresses=[socket.inet_aton(a) for a in addresses],
            port=port,
            properties={"v": "1"},
        )
        zc.register_service(info, allow_name_change=True)
        return zc, info
    except Exception as e:
        print("  (auto-discovery unavailable: %s)" % e)
        return None


def main():
    ap = argparse.ArgumentParser(description="PhoneMouse desktop receiver")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--name", default=None, help="name shown in the app (default: hostname)")
    ap.add_argument("--new-pin", action="store_true", help="generate a new pairing PIN")
    ap.add_argument("--no-discovery", action="store_true", help="do not advertise on the network")
    ap.add_argument("--scroll-scale", type=float, default=None,
                    help="scroll units per wheel notch (default: 1, or 3 on macOS)")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    name = (args.name or socket.gethostname().split(".")[0] or "Computer").strip()
    name = "".join(ch for ch in name if ch.isprintable() and ch not in "\r\n")[:40] or "Computer"
    scroll_scale = args.scroll_scale if args.scroll_scale is not None else (3.0 if sys.platform == "darwin" else 1.0)

    try:
        pointer = Pointer(scroll_scale)
    except Exception as e:
        print("Could not get control of the mouse: %s" % e)
        print("Install the dependency with:  pip install pynput")
        if sys.platform.startswith("linux"):
            print("On Linux this needs an X11 session (Wayland sessions are not supported by pynput).")
        return 1

    pin = load_pin(args.new_pin)
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        server.bind(("0.0.0.0", args.port))
    except OSError as e:
        print("Could not listen on port %d: %s (try --port)" % (args.port, e))
        return 1
    server.listen(8)

    addresses = local_addresses()
    advert = None if args.no_discovery else advertise(name, args.port, addresses)

    print()
    print("  PhoneMouse receiver is running")
    print("  ------------------------------")
    print("  Computer : %s" % name)
    print("  Address  : %s" % ("  /  ".join("%s:%d" % (a, args.port) for a in addresses) or "port %d" % args.port))
    print("  PIN      : %s %s" % (pin[:3], pin[3:]))
    print()
    print("  Open PhoneMouse on your iPhone (same Wi-Fi) and pick this computer.")
    if sys.platform == "darwin":
        print("  macOS: allow your terminal under System Settings > Privacy & Security > Accessibility.")
    print("  Ctrl+C to quit.")
    print()

    limiter = FailureLimiter()
    active = {"lock": threading.Lock(), "conn": None}
    try:
        while True:
            conn, addr = server.accept()
            threading.Thread(
                target=handle_client,
                args=(conn, addr, pin, name, pointer, limiter, active, args.quiet),
                daemon=True,
            ).start()
    except KeyboardInterrupt:
        print("\n  bye")
    finally:
        pointer.release_all()
        if advert:
            zc, info = advert
            try:
                zc.unregister_service(info)
                zc.close()
            except Exception:
                pass
        server.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
