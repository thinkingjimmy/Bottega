#!/usr/bin/python3
"""
[INPUT]: Receives one offline source directory and an ordinary probe UID; requires root for fixed-path installation.
[OUTPUT]: Publishes verified stable bwrap bytes, an exact AppArmor profile, and an atomic activation receipt after namespace probes.
[POS]: Linux compiler component installer; never used for daily compilation or arbitrary package execution.
"""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import socket
import stat
import subprocess
import tempfile

BINARY_SHA256 = "52231e1caf55bcbc667b269f49c63599a6f7db4767ae6a039580d0ff853db712"
BINARY_BYTES = 72160
PROFILE_TEMPLATE = (
    "# Bottega fixed compiler namespace launcher.\nabi <abi/4.0>,\ninclude <tunables/global>\n\n"
    "profile bottega-{payload_id} /opt/bottega/runtime/bwrap/{payload_id}/bwrap flags=(unconfined) {\n  userns,\n}\n"
)
PAYLOAD_ID = "bwrap-" + hashlib.sha256(
    ("bottega.compiler-linux-component/v1\nsha256:" + BINARY_SHA256 + "\n" + PROFILE_TEMPLATE).encode()
).hexdigest()
ROOT = Path("/opt/bottega/runtime/bwrap")
VERSION_ROOT = ROOT / PAYLOAD_ID
PROFILE_NAME = "bottega-" + PAYLOAD_ID
PROFILE_PATH = Path("/etc/apparmor.d") / PROFILE_NAME
PROFILE = PROFILE_TEMPLATE.replace("{payload_id}", PAYLOAD_ID).encode()
ENV = {"LANG": "C", "LC_ALL": "C", "PATH": "/usr/bin:/bin"}


def digest(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def secure_path(path):
    path = Path(path)
    if not path.is_absolute() or path.resolve(strict=True) != path:
        raise RuntimeError("Component path is not canonical")
    for item in (path, *path.parents):
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise RuntimeError("Component path is writable or unowned")
        if item != path and not stat.S_ISDIR(info.st_mode):
            raise RuntimeError("Component ancestor is not a directory")


def read_source(path, maximum):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > maximum:
            raise RuntimeError("Invalid source file")
        data = bytearray()
        while len(data) <= maximum:
            chunk = os.read(descriptor, min(65536, maximum + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        after = os.fstat(descriptor)
        fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns", "st_nlink")
        if len(data) != before.st_size or any(getattr(before, key) != getattr(after, key) for key in fields):
            raise RuntimeError("Source changed while reading")
        return bytes(data)
    finally:
        os.close(descriptor)


def ensure_directory(path):
    if not path.exists():
        ensure_directory(path.parent)
        path.mkdir(mode=0o755)
    secure_path(path)
    if not path.is_dir():
        raise RuntimeError("Expected component directory")


def atomic_write(path, data, mode=0o644):
    secure_path(path.parent)
    if path.exists() or path.is_symlink():
        secure_path(path)
        if not path.is_file() or path.stat().st_nlink != 1:
            raise RuntimeError("Cannot replace an unowned file")
    descriptor, temporary = tempfile.mkstemp(prefix=".install-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            os.fchmod(output.fileno(), mode)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def verify_fixed_file(path, expected):
    secure_path(path)
    if read_source(path, len(expected)) != expected:
        raise RuntimeError("Existing component bytes do not match this release")


def probe(uid):
    user = pwd.getpwuid(uid)
    python = Path("/usr/bin/python3").resolve(strict=True)
    secure_path(python)
    with tempfile.TemporaryDirectory(prefix="bottega-compiler-install-") as temporary:
        root = Path(temporary)
        os.chown(root, uid, user.pw_gid)
        output = root / "output"
        output.mkdir(mode=0o700)
        os.chown(output, uid, user.pw_gid)
        secret = root / "secret"
        secret.write_text("must-not-be-visible")
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            port = listener.getsockname()[1]
            script = r'''
import errno,json,os,socket,subprocess,sys
secret,output,port,profile=sys.argv[1:]
def denied(operation):
    try: operation()
    except OSError as error: return error.errno in (errno.ENOENT,errno.EACCES,errno.EPERM,errno.ENETUNREACH,errno.ECONNREFUSED)
    return False
assert denied(lambda: open(secret,"rb")), "read boundary"
assert denied(lambda: open(secret+"-write","wb")), "write boundary"
assert denied(lambda: subprocess.run(["/usr/bin/true"],check=True)), "exec boundary"
assert denied(lambda: socket.create_connection(("127.0.0.1",int(port)),timeout=1)), "network boundary"
with open(output+"/allowed","w") as stream: stream.write("allowed")
with open("/proc/self/attr/current") as stream: observed=stream.read().strip()
assert observed in (profile+" (unconfined)",profile+" (enforce)"), "AppArmor attachment"
print(json.dumps({"profile":observed,"read":True,"write":True,"exec":True,"network":True}))
'''
            command = [str(VERSION_ROOT / "bwrap"), "--die-with-parent", "--new-session", "--unshare-all",
                       "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
                       "--ro-bind", str(python), str(python)]
            for path in ("/usr/lib", "/usr/lib64", "/lib", "/lib64"):
                if Path(path).exists():
                    command.extend(["--ro-bind", path, path])
            command.extend(["--bind", str(output), str(output), "--chdir", str(output), "--",
                            str(python), "-I", "-S", "-c", script, str(secret), str(output), str(port), PROFILE_NAME])
            result = subprocess.run(command, env=ENV, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, timeout=10, check=True, user=uid, group=user.pw_gid,
                                    extra_groups=[])
            if len(result.stdout) > 4096 or len(result.stderr) > 4096:
                raise RuntimeError("Component probe exceeded its diagnostic budget")
            return json.loads(result.stdout)


def install(source, uid):
    if os.geteuid() != 0 or uid <= 0:
        raise RuntimeError("Installation requires root and an ordinary probe UID")
    if os.uname().machine != "x86_64":
        raise RuntimeError("This component requires Linux x86-64")
    with open("/etc/os-release", encoding="utf8") as stream:
        release = dict(line.rstrip().split("=", 1) for line in stream if "=" in line)
    if release.get("ID", "").strip('"') != "ubuntu" or release.get("VERSION_ID", "").strip('"') != "24.04":
        raise RuntimeError("This component requires Ubuntu 24.04")
    if Path("/sys/module/apparmor/parameters/enabled").read_text().strip() != "Y":
        raise RuntimeError("AppArmor must remain enabled")
    binary = read_source(source / "bwrap", BINARY_BYTES)
    if len(binary) != BINARY_BYTES or digest(binary) != "sha256:" + BINARY_SHA256:
        raise RuntimeError("Offline payload does not match the release")
    if read_source(source / "bwrap.apparmor", len(PROFILE)) != PROFILE:
        raise RuntimeError("Offline profile does not match the exact attachment")
    parser = Path("/usr/sbin/apparmor_parser").resolve(strict=True)
    secure_path(parser)
    ensure_directory(ROOT)
    descriptor = os.open(ROOT / "install.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, 0o644)
    lease_descriptor = None
    try:
        secure_path(ROOT / "install.lock")
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        ensure_directory(VERSION_ROOT)
        target = VERSION_ROOT / "bwrap"
        if target.exists():
            verify_fixed_file(target, binary)
        else:
            atomic_write(target, binary, 0o755)
        lease_path = VERSION_ROOT / "lease.lock"
        if not lease_path.exists():
            atomic_write(lease_path, b"")
        secure_path(lease_path)
        lease_descriptor = os.open(lease_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        lock_info = os.fstat(lease_descriptor)
        if not stat.S_ISREG(lock_info.st_mode) or lock_info.st_nlink != 1 or lock_info.st_size != 0:
            raise RuntimeError("Component lease inode is invalid")
        fcntl.flock(lease_descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if PROFILE_PATH.exists():
            verify_fixed_file(PROFILE_PATH, PROFILE)
        else:
            atomic_write(PROFILE_PATH, PROFILE)
        subprocess.run([str(parser), "--replace", "--skip-cache", str(PROFILE_PATH)], env=ENV,
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                       timeout=10, check=True)
        observed = probe(uid)
        receipt = {"schema": "bottega.compiler-linux-active/v1", "payloadId": PAYLOAD_ID,
                   "binarySha256": digest(binary), "profileSha256": digest(PROFILE)}
        atomic_write(VERSION_ROOT / "receipt.json", json_bytes({**receipt, "probe": observed}))
        active = ROOT / "active.json"
        if active.exists():
            secure_path(active)
            previous = json.loads(read_source(active, 4096))
            if previous != receipt:
                # Retain every rollback receipt; retirement requires a separately verified drain.
                previous_id = previous.get("payloadId", "")
                if not previous_id.startswith("bwrap-") or len(previous_id) != 70 or any(c not in "0123456789abcdef" for c in previous_id[6:]):
                    raise RuntimeError("Previous activation is invalid")
                ensure_directory(ROOT / "rollback")
                atomic_write(ROOT / "rollback" / (previous_id + ".json"), json_bytes(previous))
        atomic_write(active, json_bytes(receipt))
        print(json.dumps({"status": "activated", **receipt, "probe": observed}))
    finally:
        if lease_descriptor is not None:
            os.close(lease_descriptor)
        os.close(descriptor)


if __name__ == "__main__":
    arguments = argparse.ArgumentParser(description="Install the fixed offline Bottega compiler component")
    arguments.add_argument("action", choices=["install"])
    arguments.add_argument("--source", required=True, type=Path)
    arguments.add_argument("--uid", required=True, type=int)
    options = arguments.parse_args()
    install(options.source, options.uid)
