#!/usr/bin/env python3
"""Audit an already reviewed npm tarball without extracting or executing it."""
import hashlib
import json
import pathlib
import re
import sys
import tarfile


def digest(stream):
    result = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        result.update(chunk)
    return result.hexdigest()


def audit(tarball, approved):
    with open(tarball, "rb") as stream:
        if pathlib.Path(tarball).stat().st_size != approved["bytes"] or digest(stream) != approved["sha256"]:
            raise ValueError("Tarball differs from reviewed bytes/hash")
    with tarfile.open(tarball, "r|gz") as archive:
        members = {}
        contents = {}
        hashes = {}
        total = 0
        for member in archive:
            name = member.name
            parts = pathlib.PurePosixPath(name).parts
            if (not name.startswith("package/") or "\\" in name or name.startswith("/")
                    or any(part in ("", ".", "..") for part in parts)
                    or not member.isfile() or name in members):
                raise ValueError("Unsafe or duplicate tar entry")
            if member.size < 0 or member.size > 200 * 1024 * 1024:
                raise ValueError("Oversized tar entry")
            total += member.size
            if total > 300 * 1024 * 1024 or len(members) > 10000:
                raise ValueError("Tarball exceeds reviewed audit budget")
            if re.search(r"(^|/)(?:\.npmrc|\.env(?:\..*)?|id_rsa|id_ed25519|node_modules|\.git)(?:/|$)", name):
                raise ValueError("Disallowed credential/build path in tarball")
            members[name] = member
            stream = archive.extractfile(member)
            if member.size <= 2 * 1024 * 1024:
                contents[name] = stream.read()
                hashes[name] = hashlib.sha256(contents[name]).hexdigest()
            else:
                hashes[name] = digest(stream)

        def read(name):
            if name not in members:
                raise ValueError("Required package file missing: " + name)
            return contents.get(name)

        pkg = json.loads(read("package/package.json"))
        if (pkg.get("name") != approved["name"] or pkg.get("version") != approved["version"]
                or pkg.get("private") is True or pkg.get("license") != "LGPL-2.1-or-later"
                or pkg.get("type") != "module"
                or pkg.get("repository", {}).get("url") != "git+https://github.com/cosmemilton/acbr-printer-node.git"
                or pkg.get("publishConfig", {}).get("access", "public") != "public"):
            raise ValueError("Package identity/policy differs from review")
        for lifecycle in ("prepublish", "prepublishOnly", "prepare", "prepack", "postpack", "publish", "postpublish", "preinstall", "install", "postinstall"):
            if lifecycle in pkg.get("scripts", {}):
                raise ValueError("Package contains lifecycle hook: " + lifecycle)
        required = ["LICENSE", "NOTICE", "README.md", "DEPENDENCIES.lock.json", "dist/index.js", "dist/index.cjs", "dist/types/src/index.d.ts"]
        for name in required:
            read("package/" + name)
        expected_features = {"pos", "fortes", "danfe"}
        if tuple(map(int, approved["version"].split("."))) >= (0, 1, 2):
            expected_features.update({"serial", "layout-spooler"})
        for platform, executable in (("linux", "acbr-printer-worker"), ("win32", "acbr-printer-worker.exe")):
            prefix = "package/runtime/" + platform + "-x64/"
            runtime = json.loads(read(prefix + "manifest.json"))
            if (runtime.get("formatVersion") != 1 or runtime.get("sourceRevision") != 48590
                    or runtime.get("platform") != platform or runtime.get("arch") != "x64"
                    or runtime.get("executable") != executable
                    or set(runtime.get("features", [])) != expected_features):
                raise ValueError("Runtime identity differs from review")
            inventory = runtime.get("files", {})
            actual = {name[len(prefix):] for name in members if name.startswith(prefix)} - {"manifest.json"}
            if set(inventory) != actual:
                raise ValueError("Runtime inventory has missing/extra files")
            for name, expected in inventory.items():
                if not re.fullmatch(r"[a-f0-9]{64}", expected) or hashes.get(prefix + name) != expected:
                    raise ValueError("Runtime hash mismatch: " + name)
            for name in (executable, "sources/acbr-source.tar.gz", "sources/fortes-source.tar.gz", "sources/build.json", "licenses/ACBr-LICENSE.txt", "licenses/Fortes-LICENSE.txt", "licenses/fpc-COPYING.FPC", "licenses/lazarus-COPYING.modifiedLGPL.txt"):
                read(prefix + name)
        return {"name": pkg["name"], "version": pkg["version"], "sha256": approved["sha256"], "bytes": approved["bytes"], "files": len(members), "unpackedBytes": total, "audit": "passed"}


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3:
            raise ValueError("Use audit-reviewed-tarball.py TARBALL MANIFEST")
        with open(sys.argv[2], encoding="utf8") as stream:
            result = audit(sys.argv[1], json.load(stream))
        print(json.dumps(result, sort_keys=True))
    except Exception:
        # Never relay untrusted tar/package input into CI logs.
        print("Reviewed tarball audit failed.", file=sys.stderr)
        sys.exit(1)
