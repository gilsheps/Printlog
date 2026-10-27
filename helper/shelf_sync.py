#!/usr/bin/env python3
"""
Shelf Sync - print-history helper for PrintLog (the STL/3MF library page).

Brings your Bambu Lab print history into the library, two ways (like the
Home Assistant Bambu Lab integration):

  * Bambu Cloud  - signs in to your Bambu account (email + code), imports the
                   full "Printing History" and keeps it in sync, and listens
                   to the printer live through the cloud.
  * LAN          - talks to the printer directly on your home network
                   (IP + Access Code + serial) and logs every print that
                   finishes or fails while this helper is running.

Results are written to  <library>/.shelf/printer-sync.json  - the library
page reads that file and logs the prints on the matching models.

Usage:
    python3 shelf_sync.py setup        first-time setup (wizard)
    python3 shelf_sync.py              run (sync + live), Ctrl+C to stop
    python3 shelf_sync.py sync         sync the cloud history once and exit
    python3 shelf_sync.py status       show settings and last sync
    python3 shelf_sync.py autostart on|off   start automatically at login
    python3 shelf_sync.py logout       forget the saved cloud token

Requires Python 3.8+ only - no extra packages to install.
Your password is never saved - only the access token Bambu returns, in
~/.shelf-sync/config.json (readable only by you).
"""
from __future__ import annotations

import base64
import getpass
import json
import os
import platform
import socket
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

VERSION = "1.0.0"
CONFIG_DIR = Path.home() / ".shelf-sync"
CONFIG_FILE = CONFIG_DIR / "config.json"
LOG_FILE = CONFIG_DIR / "shelf-sync.log"
OUT_NAME = "printer-sync.json"

API = {
    "login": "https://api.bambulab.com/v1/user-service/user/login",
    "tfa": "https://bambulab.com/api/sign-in/tfa",
    "csrf": "https://bambulab.com/api/csrf",
    "email_code": "https://api.bambulab.com/v1/user-service/user/sendemail/code",
    "bind": "https://api.bambulab.com/v1/iot-service/api/user/bind",
    "tasks": "https://api.bambulab.com/v1/user-service/my/tasks",
    "preference": "https://api.bambulab.com/v1/design-user-service/my/preference",
}
# Cloud task status codes, as returned by /my/tasks
TASK_STATUS = {0: "running", 1: "running", 2: "ok", 3: "cancel", 4: "fail"}  # as in Bambu Studio Print History


# ----------------------------------------------------------------- utils
def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str) -> None:
    line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    try:
        print(line, flush=True)
    except Exception:
        pass
    try:
        CONFIG_DIR.mkdir(exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
        if LOG_FILE.stat().st_size > 2_000_000:
            LOG_FILE.replace(LOG_FILE.with_suffix(".old.log"))
    except Exception:
        pass


def load_config() -> dict:
    try:
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_config(cfg: dict) -> None:
    CONFIG_DIR.mkdir(exist_ok=True)
    tmp = CONFIG_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    try:
        os.chmod(tmp, 0o600)
    except Exception:
        pass
    os.replace(tmp, CONFIG_FILE)


def ask(prompt: str, default: str | None = None) -> str:
    sfx = f" [{default}]" if default else ""
    while True:
        v = input(f"{prompt}{sfx}: ").strip()
        if v:
            return v
        if default is not None:
            return default


def choose(prompt: str, options: list[str], default: int = 1) -> int:
    print(prompt)
    for i, o in enumerate(options, 1):
        print(f"  {i}) {o}")
    while True:
        v = input(f"Choose 1-{len(options)} [{default}]: ").strip() or str(default)
        if v.isdigit() and 1 <= int(v) <= len(options):
            return int(v)


def color_hex(c: str | None) -> str:
    if not c:
        return ""
    c = c.strip().lstrip("#")
    return "#" + c[:6].upper() if len(c) >= 6 else ""


# ----------------------------------------------------------------- cloud API
class CloudError(Exception):
    pass


class AuthExpired(CloudError):
    pass


class BambuCloud:
    def __init__(self, region: str = "global", token: str = ""):
        self.region = region
        self.token = token

    def url(self, key: str) -> str:
        u = API[key]
        return u.replace(".com", ".cn") if self.region == "china" else u

    def headers(self, auth: bool = True) -> dict:
        h = {
            "User-Agent": "bambu_network_agent/01.09.05.01",
            "X-BBL-Client-Name": "OrcaSlicer",
            "X-BBL-Client-Type": "slicer",
            "X-BBL-Client-Version": "01.09.05.51",
            "X-BBL-Language": "en-US",
            "X-BBL-OS-Type": "linux",
            "X-BBL-OS-Version": "6.2.0",
            "X-BBL-Agent-Version": "01.09.05.01",
            "X-BBL-Executable-info": "{}",
            "X-BBL-Agent-OS-Type": "linux",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if auth and self.token:
            h["Authorization"] = f"Bearer {self.token}"
        return h

    def _req(self, method: str, url: str, body=None, headers=None, allow400=False):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers=headers or self.headers())
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else {}), r.headers
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", "replace")
            if e.code in (401,) or (e.code == 403 and "cloudflare" not in raw.lower() and self.token):
                raise AuthExpired("Bambu rejected the saved token - run: python3 shelf_sync.py setup")
            if e.code == 403 and "cloudflare" in raw.lower():
                raise CloudError("Blocked by Cloudflare. Try again later, or: pip install curl_cffi")
            if e.code == 400 and allow400:
                try:
                    return 400, json.loads(raw), e.headers
                except Exception:
                    return 400, {}, e.headers
            raise CloudError(f"HTTP {e.code}: {raw[:200]}")
        except urllib.error.URLError as e:
            raise CloudError(f"No connection to Bambu Cloud: {e.reason}")

    # --- login flow (same as the Home Assistant integration) ---
    def login_password(self, email: str, password: str) -> dict:
        st, j, _ = self._req("POST", self.url("login"), {"account": email, "password": password, "apiError": ""}, self.headers(False), allow400=True)
        if st == 400:
            raise CloudError("Wrong email or password" if j.get("code") in (None, 1, 2) else f"Login failed: {j}")
        return j

    def send_email_code(self, email: str) -> None:
        self._req("POST", self.url("email_code"), {"email": email, "type": "codeLogin"}, self.headers(False))

    def login_code(self, email: str, code: str) -> str:
        st, j, _ = self._req("POST", self.url("login"), {"account": email, "code": code}, self.headers(False), allow400=True)
        if st == 400:
            c = j.get("code")
            if c == 1:
                raise CloudError("The code expired - a new one was sent to your email")
            raise CloudError("Wrong code")
        return j.get("accessToken", "")

    def login_tfa(self, tfa_key: str, code: str) -> str:
        req = urllib.request.Request(self.url("csrf"), headers=self.headers(False))
        with urllib.request.urlopen(req, timeout=20) as r:
            cookies = r.headers.get_all("Set-Cookie") or []
        csrf = ""
        for c in cookies:
            if c.startswith("bbl_csrf_token="):
                csrf = c.split(";")[0].split("=", 1)[1]
        h = self.headers(False)
        if csrf:
            h["x-bbl-csrf-token"] = csrf
            h["Cookie"] = f"bbl_csrf_token={csrf}"
        req = urllib.request.Request(self.url("tfa"), data=json.dumps({"tfaKey": tfa_key, "tfaCode": code}).encode(), method="POST", headers=h)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                for c in r.headers.get_all("Set-Cookie") or []:
                    if c.startswith("token="):
                        return c.split(";")[0].split("=", 1)[1]
        except urllib.error.HTTPError as e:
            raise CloudError(f"2FA failed (HTTP {e.code})")
        raise CloudError("2FA failed - no token returned")

    def user_id(self) -> str:
        parts = self.token.split(".")
        if len(parts) == 3:
            try:
                p = parts[1] + "=" * (-len(parts[1]) % 4)
                u = json.loads(base64.urlsafe_b64decode(p)).get("username")
                if u:
                    return u
            except Exception:
                pass
        _, j, _ = self._req("GET", self.url("preference"))
        uid = j.get("uid")
        if not uid:
            raise CloudError("Could not read the account user id")
        return f"u_{uid}"

    def devices(self) -> list:
        _, j, _ = self._req("GET", self.url("bind"))
        return j.get("devices") or []

    def tasks(self, max_pages: int = 200, known_ids: set | None = None) -> list:
        """Download the task (print) history, newest first, page by page."""
        out, seen = [], set()
        offset, limit = 0, 50
        for _ in range(max_pages):
            sep = "&" if "?" in self.url("tasks") else "?"
            _, j, _ = self._req("GET", f"{self.url('tasks')}{sep}limit={limit}&offset={offset}")
            hits = j.get("hits") or []
            new = [h for h in hits if h.get("id") not in seen]
            if not new:
                break
            for h in new:
                seen.add(h.get("id"))
            out.extend(new)
            total = j.get("total") or 0
            offset += len(hits)
            # stop early when we reach tasks we already have (incremental sync)
            if known_ids and all(str(h.get("id")) in known_ids for h in new):
                break
            if total and offset >= total:
                break
            if len(hits) < limit and not total:
                break
        return out


# ----------------------------------------------------------------- output file
class Output:
    def __init__(self, library: str, cfg: dict):
        self.path = Path(library) / ".shelf" / OUT_NAME
        self.lock = threading.Lock()
        self.data = {"schema": 1, "helper": {}, "printers": {}, "prints": []}
        try:
            d = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(d.get("prints"), list):
                self.data["prints"] = d["prints"]
        except Exception:
            pass
        self.data["helper"] = {"version": VERSION, "mode": cfg.get("mode"), "host": platform.node(), "started": now_iso()}
        self._last_write = 0.0
        self._pending = False

    def known_cloud_ids(self) -> set:
        return {p["key"][6:] for p in self.data["prints"] if p.get("key", "").startswith("cloud-")}

    def set_helper(self, **kw):
        with self.lock:
            self.data["helper"].update(kw)
        self.write()

    def set_printer(self, serial: str, info: dict, throttle: bool = True):
        with self.lock:
            cur = self.data["printers"].get(serial, {})
            cur.update(info)
            cur["updated"] = now_iso()
            self.data["printers"][serial] = cur
        self.write(throttle=throttle)

    def add_print(self, entry: dict) -> bool:
        """Add or merge one print. Returns True if it is new."""
        with self.lock:
            prints = self.data["prints"]
            for i, p in enumerate(prints):
                if p["key"] == entry["key"]:
                    if p != entry:
                        prints[i] = {**p, **entry}
                    return False
            # a cloud task replaces the live record of the same print
            if entry["source"] == "cloud":
                for i, p in enumerate(prints):
                    if p["source"] == "lan-live" or p["source"] == "cloud-live":
                        if _same_print(p, entry):
                            entry["aliasKeys"] = sorted(set(p.get("aliasKeys", []) + [p["key"]]))
                            prints[i] = entry
                            return False
            else:
                for p in prints:
                    if p["source"] == "cloud" and _same_print(p, entry):
                        return False
            prints.append(entry)
            prints.sort(key=lambda p: p.get("start") or "", reverse=True)
            del prints[8000:]
            return True

    def write(self, throttle: bool = False):
        if throttle and time.time() - self._last_write < 15:
            self._pending = True
            return
        with self.lock:
            self.data["helper"]["written"] = now_iso()
            txt = json.dumps(self.data, ensure_ascii=False, indent=1)
            self._last_write = time.time()
            self._pending = False
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_name(OUT_NAME + ".tmp")
            tmp.write_text(txt, encoding="utf-8")
            os.replace(tmp, self.path)
        except Exception as e:
            log(f"Could not write {self.path}: {e}")

    def flush_pending(self):
        if self._pending:
            self.write()


def _parse_time(s: str | None) -> float | None:
    if not s:
        return None
    try:
        return datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
    except Exception:
        return None


def _close(a, b, secs) -> bool:
    ta, tb = _parse_time(a), _parse_time(b)
    return ta is not None and tb is not None and abs(ta - tb) <= secs


def _norm(s: str) -> str:
    return "".join(ch for ch in (s or "").lower() if ch.isalnum())


def _same_print(a: dict, b: dict) -> bool:
    if a.get("serial") != b.get("serial"):
        return False
    if _close(a.get("start"), b.get("start"), 20 * 60):
        return True
    return bool(_norm(a.get("title"))) and _norm(a.get("title")) == _norm(b.get("title")) and _close(a.get("end"), b.get("end"), 20 * 60)


def task_to_entry(t: dict, printers: dict) -> dict | None:
    status = TASK_STATUS.get(t.get("status"), "unknown")
    if status == "running":
        return None
    serial = t.get("deviceId") or ""
    fil = []
    for a in t.get("amsDetailMapping") or []:
        fil.append({"type": a.get("filamentType") or a.get("targetFilamentType") or "", "color": color_hex(a.get("targetColor") or a.get("sourceColor")), "grams": round(float(a.get("weight") or 0), 2)})
    start, end = t.get("startTime"), t.get("endTime")
    ts, te = _parse_time(start), _parse_time(end)
    minutes = round((te - ts) / 60) if ts and te and te > ts else round((t.get("costTime") or 0) / 60)
    return {
        "key": f"cloud-{t.get('id')}",
        "source": "cloud",
        "serial": serial,
        "printer": t.get("deviceName") or printers.get(serial, {}).get("name", ""),
        "printerModel": t.get("deviceModel") or "",
        "title": t.get("title") or "",
        "design": t.get("designTitle") or "",
        "designId": t.get("designId") or 0,
        "plate": t.get("plateIndex") or 0,
        "plateName": t.get("plateName") or "",
        "result": status,
        "rawStatus": t.get("status"),
        "start": start,
        "end": end,
        "minutes": minutes,
        "estMinutes": round((t.get("costTime") or 0) / 60),
        "grams": round(float(t.get("weight") or 0), 2),
        "filaments": fil,
        "bed": t.get("bedType") or "",
        "cover": t.get("cover") or "",
        "mode": t.get("mode") or "",
    }


# ----------------------------------------------------------------- live (MQTT)
class LiveWatcher:
    """Follows one printer's MQTT reports and logs prints when they end."""

    def __init__(self, out: Output, serial: str, name: str, source: str):
        self.out, self.serial, self.name, self.source = out, serial, name, source
        self.state: dict = {}
        self.active: dict | None = None
        self.prev_state = None

    def on_report(self, payload: dict):
        p = payload.get("print")
        if not isinstance(p, dict):
            return
        self.state.update({k: v for k, v in p.items() if not isinstance(v, (dict, list)) or k in ("ams",)})
        st = str(self.state.get("gcode_state", "")).upper()
        job = self.state.get("subtask_name") or self.state.get("gcode_file") or ""
        info = {"name": self.name, "conn": self.source, "state": st.lower() or "unknown", "progress": self.state.get("mc_percent"),
                "remainingMin": self.state.get("mc_remaining_time"), "job": job, "layer": self.state.get("layer_num"), "layers": self.state.get("total_layer_num")}
        self.out.set_printer(self.serial, info, throttle=st == self.prev_state)
        running = st in ("PREPARE", "RUNNING", "PAUSE", "SLICING")
        if running and not self.active:
            start = now_iso()
            try:
                gst = int(self.state.get("gcode_start_time") or 0)
                if 1_600_000_000 < gst <= time.time() + 60:
                    start = datetime.fromtimestamp(gst, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            except (TypeError, ValueError):
                pass
            self.active = {"start": start, "job": job, "file": self.state.get("gcode_file") or "", "task": str(self.state.get("task_id") or ""), "seenState": self.prev_state}
            log(f"{self.name}: print started - {job}")
        elif running and self.active and job and not self.active["job"]:
            self.active["job"] = job
        if st in ("FINISH", "FAILED") and self.active and self.prev_state in ("PREPARE", "RUNNING", "PAUSE", "SLICING"):
            a = self.active
            res = "ok" if st == "FINISH" else "fail"
            start_ts = _parse_time(a["start"]) or time.time()
            entry = {
                "key": f"live-{self.serial}-{a['task'] or a['start']}",
                "source": "lan-live" if self.source == "lan" else "cloud-live",
                "serial": self.serial, "printer": self.name, "title": a["job"] or job, "design": "",
                "file": a["file"], "plate": 0, "result": res, "start": a["start"], "end": now_iso(),
                "minutes": round((time.time() - start_ts) / 60), "grams": 0, "filaments": [], "cover": "",
                "error": self.state.get("print_error") or 0,
                # we only saw part of the print if the helper started mid-print
                "partialObservation": a.get("seenState") is None,
            }
            if self.out.add_print(entry):
                log(f"{self.name}: print {'finished' if res == 'ok' else 'FAILED'} - {entry['title']}")
            self.out.write()
            self.active = None
        if st in ("IDLE", "FINISH", "FAILED") and self.active and self.prev_state not in ("PREPARE", "RUNNING", "PAUSE", "SLICING"):
            self.active = None
        self.prev_state = st


def mqtt_available() -> bool:
    return True  # built-in minimal MQTT client, no extra packages needed


class MiniMQTT:
    """Tiny MQTT 3.1.1 client over TLS (subscribe + publish QoS 0) - stdlib only."""

    def __init__(self, host, port, user, password, insecure, label, on_connect, on_message, on_down):
        self.host, self.port, self.user, self.password = host, port, user, password
        self.insecure, self.label = insecure, label
        self.on_connect, self.on_message, self.on_down = on_connect, on_message, on_down
        self.sock = None
        self.running = True
        self.wlock = threading.Lock()
        self.thread = threading.Thread(target=self._loop, daemon=True)

    # --- encoding helpers
    @staticmethod
    def _str(s: str) -> bytes:
        b = s.encode("utf-8")
        return len(b).to_bytes(2, "big") + b

    @staticmethod
    def _len(n: int) -> bytes:
        out = bytearray()
        while True:
            d, n = n % 128, n // 128
            out.append(d | (0x80 if n else 0))
            if not n:
                return bytes(out)

    def _send(self, ptype: int, body: bytes):
        with self.wlock:
            if self.sock:
                self.sock.sendall(bytes([ptype]) + self._len(len(body)) + body)

    def _recv_exact(self, n: int) -> bytes:
        buf = bytearray()
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("closed")
            buf += chunk
        return bytes(buf)

    def _read_packet(self):
        h = self._recv_exact(1)[0]
        mult, length = 1, 0
        while True:
            d = self._recv_exact(1)[0]
            length += (d & 127) * mult
            mult *= 128
            if not d & 128:
                break
        return h, self._recv_exact(length) if length else b""

    # --- api
    def subscribe(self, topic: str, pid: int = 1):
        self._send(0x82, pid.to_bytes(2, "big") + self._str(topic) + b"\x00")

    def publish(self, topic: str, payload: str):
        self._send(0x30, self._str(topic) + payload.encode("utf-8"))

    def start(self):
        self.thread.start()
        return self

    def loop_stop(self):
        self.running = False
        try:
            if self.sock:
                self.sock.close()
        except Exception:
            pass

    def disconnect(self):
        try:
            self._send(0xE0, b"")
        except Exception:
            pass
        self.loop_stop()

    def _connect(self):
        ctx = ssl.create_default_context()
        if self.insecure:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        raw = socket.create_connection((self.host, self.port), timeout=20)
        self.sock = ctx.wrap_socket(raw, server_hostname=None if self.insecure else self.host)
        cid = f"shelf-sync-{uuid.uuid4().hex[:10]}"
        flags = 0x02 | 0x80 | 0x40  # clean session + username + password
        body = self._str("MQTT") + bytes([4, flags]) + (60).to_bytes(2, "big") + self._str(cid) + self._str(self.user) + self._str(self.password)
        self._send(0x10, body)
        h, b = self._read_packet()
        if h >> 4 != 2 or len(b) < 2:
            raise ConnectionError("no CONNACK")
        return b[1]

    def _loop(self):
        delay = 5
        while self.running:
            try:
                rc = self._connect()
                self.on_connect(self, rc)
                if rc != 0:
                    raise ConnectionRefusedError(rc)
                delay = 5
                self.sock.settimeout(30)
                last_ping = time.time()
                while self.running:
                    if time.time() - last_ping > 45:
                        self._send(0xC0, b"")
                        last_ping = time.time()
                    try:
                        h, b = self._read_packet()
                    except socket.timeout:
                        continue
                    ptype = h >> 4
                    if ptype == 3:  # PUBLISH
                        qos = (h >> 1) & 3
                        tl = int.from_bytes(b[:2], "big")
                        topic = b[2:2 + tl].decode("utf-8", "replace")
                        i = 2 + tl
                        if qos:
                            pid = b[i:i + 2]
                            i += 2
                            self._send(0x40, pid)
                        self.on_message(topic, b[i:])
            except ConnectionRefusedError:
                delay = 600  # wrong credentials - don't hammer the printer/cloud
            except Exception as e:
                if self.running:
                    self.on_down(self, e)
            finally:
                try:
                    if self.sock:
                        self.sock.close()
                except Exception:
                    pass
                self.sock = None
            if self.running:
                time.sleep(delay)
                delay = min(delay * 2, 600)


def start_mqtt(host: str, port: int, user: str, password: str, serials: list, watchers: dict, insecure: bool, label: str):
    def on_connect(c, rc):
        if rc == 0:
            log(f"{label}: connected")
            for i, s in enumerate(serials, 1):
                c.subscribe(f"device/{s}/report", i)
                c.publish(f"device/{s}/request", json.dumps({"pushing": {"sequence_id": "0", "command": "pushall", "version": 1, "push_target": 1}}))
        else:
            reason = {4: "wrong access code / token", 5: "not authorised"}.get(rc, f"code {rc}")
            log(f"{label}: connection refused ({reason})")
            for s in serials:
                if s in watchers:
                    watchers[s].out.set_printer(s, {"conn": "error", "error": reason}, throttle=False)

    def on_down(c, err):
        log(f"{label}: disconnected ({err}), retrying…")
        for s in serials:
            if s in watchers:
                watchers[s].out.set_printer(s, {"conn": "offline"}, throttle=False)

    def on_message(topic, payload):
        try:
            serial = topic.split("/")[1]
            w = watchers.get(serial)
            if w:
                w.on_report(json.loads(payload.decode("utf-8", "replace")))
        except Exception as e:
            log(f"{label}: bad message ({e})")

    return MiniMQTT(host, port, user, password, insecure, label, on_connect, on_message, on_down).start()


# ----------------------------------------------------------------- LAN discovery
def discover(seconds: int = 8) -> dict:
    """Bambu printers announce themselves with SSDP on UDP 2021."""
    found = {}
    socks = []
    for port in (2021, 1990):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if hasattr(socket, "SO_REUSEPORT"):
                try:
                    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
                except OSError:
                    pass
            s.bind(("", port))
            try:
                mreq = socket.inet_aton("239.255.255.250") + socket.inet_aton("0.0.0.0")
                s.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
            except OSError:
                pass
            s.settimeout(0.5)
            socks.append(s)
        except OSError:
            pass
    end = time.time() + seconds
    while time.time() < end and socks:
        for s in socks:
            try:
                data, addr = s.recvfrom(4096)
            except (socket.timeout, OSError):
                continue
            txt = data.decode("utf-8", "replace")
            if "bambulab" not in txt.lower():
                continue
            h = {}
            for line in txt.split("\r\n"):
                if ":" in line:
                    k, v = line.split(":", 1)
                    h[k.strip().lower()] = v.strip()
            serial = h.get("usn", "")
            if serial:
                found[serial] = {"ip": h.get("location", addr[0]), "name": h.get("devname.bambu.com", serial), "model": h.get("devmodel.bambu.com", ""), "connect": h.get("devconnect.bambu.com", "")}
    for s in socks:
        s.close()
    return found


# ----------------------------------------------------------------- setup wizard
def cloud_login(cfg: dict) -> BambuCloud:
    region = "china" if choose("Bambu account region:", ["Global (bambulab.com)", "China (bambulab.cn)"]) == 2 else "global"
    cloud = BambuCloud(region)
    email = ask("Bambu account email (or phone)", cfg.get("cloud", {}).get("email"))
    password = getpass.getpass("Password (not saved, typing is hidden): ")
    j = cloud.login_password(email, password)
    token = j.get("accessToken", "")
    lt = j.get("loginType")
    if not token and lt == "verifyCode":
        cloud.send_email_code(email)
        print("Bambu sent a verification code to your email.")
        for _ in range(3):
            try:
                token = cloud.login_code(email, ask("Code from the email"))
                break
            except CloudError as e:
                print(f"  {e}")
    elif not token and lt == "tfa":
        token = cloud.login_tfa(j.get("tfaKey", ""), ask("Two-factor code (authenticator app)"))
    if not token:
        raise CloudError(f"Login failed ({lt or j})")
    cloud.token = token
    cfg["cloud"] = {"email": email, "region": region, "token": token, "user": cloud.user_id(), "saved": now_iso()}
    print("✓ Signed in to Bambu Cloud")
    return cloud


def setup() -> None:
    cfg = load_config()
    print(f"\nShelf Sync {VERSION} - setup\n")
    lib = cfg.get("library")
    while True:
        p = ask("Path of your models folder (tip: drag the folder into this window)", lib).strip().strip("'\"")
        p = os.path.expanduser(p.replace("\\ ", " "))
        if Path(p).is_dir():
            if not (Path(p) / ".shelf").is_dir():
                print("  Note: this folder was not opened in the library page yet - that's fine, it will be.")
            cfg["library"] = str(Path(p).resolve())
            break
        print("  That folder does not exist, try again.")
    mode = choose("\nHow should the helper reach your printer?", [
        "Bambu Cloud - import the full print history + live (recommended)",
        "LAN only - live, directly from the printer on your network (no account)",
        "Both - cloud history + live from the printer on the LAN",
    ])
    cfg["mode"] = {1: "cloud", 2: "lan", 3: "both"}[mode]
    printers = {p["serial"]: p for p in cfg.get("printers", [])}

    if cfg["mode"] in ("cloud", "both"):
        print()
        cloud = cloud_login(cfg)
        for d in cloud.devices():
            s = d.get("dev_id")
            printers[s] = {**printers.get(s, {}), "serial": s, "name": d.get("name") or s, "model": d.get("dev_product_name") or d.get("dev_model_name") or "", "access_code": d.get("dev_access_code") or printers.get(s, {}).get("access_code", "")}
        print("Printers on the account: " + (", ".join(p["name"] for p in printers.values()) or "none"))

    if cfg["mode"] in ("lan", "both"):
        print("\nLooking for printers on your network (8 s)…")
        found = discover()
        for s, f in found.items():
            print(f"  found {f['name']} ({f['model']}) at {f['ip']}  serial {s}")
            printers.setdefault(s, {"serial": s, "name": f["name"], "model": f["model"]})
            printers[s]["ip"] = f["ip"]
        if not printers or input("Add a printer manually? [y/N]: ").strip().lower() == "y":
            s = ask("Printer serial number (Settings > Device on the printer)")
            printers.setdefault(s, {"serial": s, "name": s})
        for p in printers.values():
            print(f"\n{p['name']}:")
            p["ip"] = ask("  IP address (printer screen: Settings > Network)", p.get("ip"))
            p["access_code"] = ask("  Access Code (printer screen: Settings > Network/LAN)", p.get("access_code"))
    cfg["printers"] = list(printers.values())
    cfg.setdefault("interval_min", 10)
    save_config(cfg)
    print(f"\n✓ Saved to {CONFIG_FILE}")
    if cfg["mode"] in ("cloud", "both"):
        print("\nImporting your print history now…")
        try:
            sync_once(cfg)
        except CloudError as e:
            print(f"  {e}")
    print("\nNext: run   python3 shelf_sync.py            (keep it running)")
    print("   or     python3 shelf_sync.py autostart on (start automatically at login)\n")


# ----------------------------------------------------------------- run
def sync_history(cfg: dict, out: Output) -> int:
    c = cfg.get("cloud") or {}
    cloud = BambuCloud(c.get("region", "global"), c.get("token", ""))
    printers = {p["serial"]: p for p in cfg.get("printers", [])}
    known = out.known_cloud_ids()
    tasks = cloud.tasks(known_ids=known if known else None)
    new = 0
    for t in tasks:
        e = task_to_entry(t, printers)
        if e and out.add_print(e):
            new += 1
    out.set_helper(lastSync=now_iso(), lastError="", needsLogin=False, cloudTasks=len(tasks))
    return new


def sync_once(cfg: dict) -> None:
    out = Output(cfg["library"], cfg)
    try:
        n = sync_history(cfg, out)
        total = sum(1 for p in out.data["prints"] if p["source"] == "cloud")
        print(f"✓ {n} new prints imported ({total} in total). The library page will pick them up.")
    except AuthExpired as e:
        out.set_helper(lastError=str(e), needsLogin=True)
        raise


def run() -> None:
    cfg = load_config()
    if not cfg.get("library"):
        print("Not set up yet - run:  python3 shelf_sync.py setup")
        sys.exit(1)
    out = Output(cfg["library"], cfg)
    mode = cfg.get("mode", "cloud")
    log(f"Shelf Sync {VERSION} started ({mode}) → {out.path}")
    out.set_helper(lastError="", needsLogin=False)
    clients = []
    printers = cfg.get("printers", [])
    if mqtt_available():
        if mode in ("lan", "both"):
            for p in printers:
                if p.get("ip") and p.get("access_code"):
                    w = {p["serial"]: LiveWatcher(out, p["serial"], p.get("name", p["serial"]), "lan")}
                    clients.append(start_mqtt(p["ip"], 8883, "bblp", p["access_code"], [p["serial"]], w, True, f"{p.get('name')} (LAN)"))
        elif mode == "cloud" and (cfg.get("cloud") or {}).get("token"):
            c = cfg["cloud"]
            host = "cn.mqtt.bambulab.com" if c.get("region") == "china" else "us.mqtt.bambulab.com"
            ws = {p["serial"]: LiveWatcher(out, p["serial"], p.get("name", p["serial"]), "cloud") for p in printers}
            if ws:
                clients.append(start_mqtt(host, 8883, c.get("user", ""), c["token"], list(ws), ws, False, "Bambu Cloud live"))
    else:
        log("paho-mqtt is not installed - live updates are off (pip install paho-mqtt). History sync still works.")

    interval = max(2, int(cfg.get("interval_min", 10))) * 60
    next_sync = 0.0
    try:
        while True:
            if mode in ("cloud", "both") and time.time() >= next_sync:
                try:
                    n = sync_history(cfg, out)
                    if n:
                        log(f"Cloud history: {n} new prints")
                    next_sync = time.time() + interval
                except AuthExpired as e:
                    log(str(e))
                    out.set_helper(lastError=str(e), needsLogin=True)
                    next_sync = time.time() + 6 * 3600
                except CloudError as e:
                    log(f"Cloud sync failed: {e}")
                    out.set_helper(lastError=str(e))
                    next_sync = time.time() + 300
            out.flush_pending()
            time.sleep(5)
    except KeyboardInterrupt:
        log("Stopped.")
    finally:
        for c in clients:
            try:
                c.loop_stop()
                c.disconnect()
            except Exception:
                pass
        out.set_helper(stopped=now_iso())


# ----------------------------------------------------------------- autostart
def autostart(on: bool) -> None:
    script = str(Path(__file__).resolve())
    py = sys.executable
    system = platform.system()
    if system == "Darwin":
        plist = Path.home() / "Library/LaunchAgents/com.gilsheps.modelshelf.sync.plist"
        if on:
            plist.parent.mkdir(parents=True, exist_ok=True)
            plist.write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
 <key>Label</key><string>com.gilsheps.modelshelf.sync</string>
 <key>ProgramArguments</key><array><string>{py}</string><string>{script}</string><string>run</string></array>
 <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
 <key>StandardOutPath</key><string>{CONFIG_DIR}/launchd.log</string>
 <key>StandardErrorPath</key><string>{CONFIG_DIR}/launchd.log</string>
</dict></plist>
""", encoding="utf-8")
            subprocess.run(["launchctl", "unload", str(plist)], capture_output=True)
            subprocess.run(["launchctl", "load", str(plist)], check=False)
            print(f"✓ Will start at login (and is running now). Log: {LOG_FILE}")
            print("  If your models folder is in Documents/Desktop/Downloads, macOS may ask once to allow Python access - click Allow.")
        else:
            subprocess.run(["launchctl", "unload", str(plist)], capture_output=True)
            plist.unlink(missing_ok=True)
            print("✓ Autostart removed")
    elif system == "Windows":
        startup = Path(os.environ.get("APPDATA", "")) / "Microsoft/Windows/Start Menu/Programs/Startup"
        vbs = startup / "ShelfSync.vbs"
        if on:
            pyw = Path(py).with_name("pythonw.exe")
            exe = str(pyw if pyw.exists() else py)
            vbs.write_text(f'CreateObject("WScript.Shell").Run """{exe}"" ""{script}"" run", 0, False\n', encoding="utf-8")
            subprocess.Popen([exe, script, "run"], creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            print(f"✓ Will start at login (and is running now, hidden). Log: {LOG_FILE}")
        else:
            vbs.unlink(missing_ok=True)
            print("✓ Autostart removed (the running copy stops at next sign-out, or end python in Task Manager)")
    else:
        print("Autostart is supported on macOS and Windows. On Linux add  python3 shelf_sync.py run  to your session startup.")


def status() -> None:
    cfg = load_config()
    if not cfg:
        print("Not set up yet - run:  python3 shelf_sync.py setup")
        return
    print(f"Library : {cfg.get('library')}")
    print(f"Mode    : {cfg.get('mode')}")
    if cfg.get("cloud"):
        print(f"Account : {cfg['cloud'].get('email')} ({cfg['cloud'].get('region')}) signed in {cfg['cloud'].get('saved')}")
    for p in cfg.get("printers", []):
        print(f"Printer : {p.get('name')}  {p.get('model', '')}  serial {p.get('serial')}  ip {p.get('ip', '-')}")
    try:
        d = json.loads((Path(cfg["library"]) / ".shelf" / OUT_NAME).read_text(encoding="utf-8"))
        h = d.get("helper", {})
        print(f"Last sync: {h.get('lastSync', '-')}  prints recorded: {len(d.get('prints', []))}  {('ERROR: ' + h['lastError']) if h.get('lastError') else ''}")
    except Exception:
        print("No sync file yet.")


def main(argv: list) -> None:
    cmd = argv[1] if len(argv) > 1 else "run"
    try:
        if cmd == "setup":
            setup()
        elif cmd == "run":
            run()
        elif cmd == "sync":
            cfg = load_config()
            if not cfg.get("cloud"):
                print("Cloud is not set up - run:  python3 shelf_sync.py setup")
                return
            sync_once(cfg)
        elif cmd == "status":
            status()
        elif cmd == "autostart":
            autostart(len(argv) < 3 or argv[2] != "off")
        elif cmd == "logout":
            cfg = load_config()
            cfg.pop("cloud", None)
            save_config(cfg)
            print("✓ Cloud token removed")
        elif cmd == "discover":
            for s, f in discover().items():
                print(f"{f['name']} ({f['model']}) {f['ip']} serial {s}")
        else:
            print(__doc__)
    except CloudError as e:
        print(f"\n✗ {e}")
        sys.exit(2)
    except KeyboardInterrupt:
        print()


if __name__ == "__main__":
    main(sys.argv)
