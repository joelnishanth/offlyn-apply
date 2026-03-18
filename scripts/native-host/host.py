#!/usr/bin/env python3
"""
Offlyn Native Messaging Host — macOS / Linux
Communicates with the Offlyn browser extension via stdin/stdout using the
4-byte length-prefixed JSON protocol required by Chrome and Firefox.

Commands:
  { "cmd": "ping" }          → { "ok": true, "version": "1.0.0" }
  { "cmd": "run_setup" }     → streaming { "type": "progress", "line": "..." }
                               followed by { "type": "done", "ok": true/false }
"""
import sys
import struct
import json
import subprocess
import platform
import os

SCRIPT_BASE = (
    "https://raw.githubusercontent.com/joelnishanth/offlyn-apply/main"
    "/scripts/setup-ollama"
)
VERSION = "1.0.0"
OFFLYN_DIR = os.path.dirname(os.path.abspath(__file__))


def send(obj: dict) -> None:
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("@I", len(data)) + data)
    sys.stdout.buffer.flush()


def recv() -> dict | None:
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    length = struct.unpack("@I", raw)[0]
    payload = sys.stdin.buffer.read(length)
    return json.loads(payload)


def run_setup() -> None:
    os_name = platform.system()
    script_name = "setup-mac.sh" if os_name == "Darwin" else "setup-linux.sh"

    # Prefer a bundled local copy (installed alongside this host)
    local_script = os.path.join(OFFLYN_DIR, script_name)
    if os.path.exists(local_script) and os.access(local_script, os.X_OK):
        cmd = ["bash", local_script]
    else:
        url = f"{SCRIPT_BASE}/{script_name}"
        cmd = ["bash", "-c", f'curl -fsSL "{url}" | bash']

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    for line in proc.stdout:
        send({"type": "progress", "line": line.rstrip()})

    proc.wait()
    send({"type": "done", "ok": proc.returncode == 0})


def main() -> None:
    while True:
        msg = recv()
        if msg is None:
            break

        cmd = msg.get("cmd")

        if cmd == "ping":
            send({"ok": True, "version": VERSION})

        elif cmd == "run_setup":
            try:
                run_setup()
            except Exception as exc:
                send({"type": "done", "ok": False, "error": str(exc)})

        else:
            send({"ok": False, "error": f"Unknown command: {cmd}"})


if __name__ == "__main__":
    main()
