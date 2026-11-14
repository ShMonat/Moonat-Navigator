# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""HTTP access to large PDS rasters: labels, whole small files, and byte-range windows.

Big IMG files (0.1-2 GB) are never downloaded whole. :class:`RemoteRaster` reads square blocks
(``BLOCK`` x ``BLOCK`` pixels) with multi-range HTTP requests (one byte range per pixel row) and
caches each block as ``.npy`` under ``<dem_dir>/<product>/``. Every byte received is added to a
persistent counter (``<dem_dir>/download_log.json``); a hard budget stops runaway downloads.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from .pds import RasterSpec, spec_from_label

BLOCK = 256  # block edge (pixels) for the window cache
MAX_RANGES_PER_REQUEST = 128
BUDGET_BYTES = int(float(os.environ.get("MOONAT_DEM_BUDGET_MB", "500")) * 1e6)
FULL_DOWNLOAD_MAX_BYTES = 40_000_000  # files up to this size are downloaded whole
USER_AGENT = "moonat-terrain/0.1 (python urllib)"

_lock = threading.Lock()


def dem_dir() -> Path:
    """Shared raw-DEM folder: ``$MOONAT_DEM_DIR`` or ``<main checkout>/data/raw/dem``.

    In a git worktree the main checkout is found via ``git rev-parse --git-common-dir`` so all
    worktrees on a laptop share one download cache.
    """
    env = os.environ.get("MOONAT_DEM_DIR")
    if env:
        p = Path(env)
    else:
        here = Path(__file__).resolve().parent
        root = here.parents[2]
        try:
            common = subprocess.run(
                ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
                cwd=here,
                capture_output=True,
                text=True,
                timeout=10,
                check=True,
            ).stdout.strip()
            if common:
                root = Path(common).parent
        except (OSError, subprocess.SubprocessError):
            pass
        p = root / "data" / "raw" / "dem"
    p.mkdir(parents=True, exist_ok=True)
    return p


# ------------------------------------------------------------------------------------------------
# Byte accounting
# ------------------------------------------------------------------------------------------------


def _log_path() -> Path:
    return dem_dir() / "download_log.json"


def bytes_fetched() -> int:
    """Total bytes downloaded into the shared DEM folder so far (all sessions)."""
    p = _log_path()
    if not p.exists():
        return 0
    return int(json.loads(p.read_text())["total_bytes"])


def _account(n: int, what: str) -> None:
    with _lock:
        p = _log_path()
        log = json.loads(p.read_text()) if p.exists() else {"total_bytes": 0, "by_product": {}}
        log["total_bytes"] += n
        log["by_product"][what] = log["by_product"].get(what, 0) + n
        p.write_text(json.dumps(log, indent=1))


def _check_budget(n_more: int) -> None:
    if bytes_fetched() + n_more > BUDGET_BYTES:
        raise RuntimeError(
            f"DEM download budget exceeded: {bytes_fetched() / 1e6:.1f} MB fetched, "
            f"+{n_more / 1e6:.1f} MB requested, budget {BUDGET_BYTES / 1e6:.0f} MB "
            "(set MOONAT_DEM_BUDGET_MB to change)"
        )


# ------------------------------------------------------------------------------------------------
# HTTP primitives
# ------------------------------------------------------------------------------------------------


def _open(url: str, headers: dict | None = None, method: str = "GET", retries: int = 4):
    h = {"User-Agent": USER_AGENT}
    h.update(headers or {})
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=h, method=method)
            return urllib.request.urlopen(req, timeout=120)
        except OSError as e:  # URLError, timeouts, resets
            last = e
            time.sleep(2.0 * (attempt + 1))
    raise RuntimeError(f"HTTP failed for {url}: {last}")


def content_length(url: str) -> int:
    """Size in bytes of a remote file (HEAD request)."""
    with _open(url, method="HEAD") as r:
        return int(r.headers["Content-Length"])


def fetch_text(url: str, cache: Path) -> str:
    """Small text file (e.g. a PDS label), cached on disk."""
    if cache.exists():
        return cache.read_text(encoding="latin-1")
    with _open(url) as r:
        data = r.read()
    _account(len(data), "labels")
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(data)
    return data.decode("latin-1")


def download_file(url: str, dest: Path, expected_bytes: int | None = None) -> Path:
    """Download a whole file (after checking Content-Length against the budget)."""
    if dest.exists() and (expected_bytes is None or dest.stat().st_size == expected_bytes):
        return dest
    n = content_length(url)
    if expected_bytes is not None and n != expected_bytes:
        raise RuntimeError(f"{url}: Content-Length {n} != expected {expected_bytes}")
    if n > FULL_DOWNLOAD_MAX_BYTES:
        raise RuntimeError(f"{url}: {n / 1e6:.0f} MB is too big for a full download")
    _check_budget(n)
    tmp = dest.with_suffix(dest.suffix + ".part")
    got = 0
    with _open(url) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
            got += len(chunk)
    _account(got, dest.stem)
    if got != n:
        raise RuntimeError(f"{url}: got {got} of {n} bytes")
    tmp.replace(dest)
    return dest


def fetch_ranges(url: str, ranges: list[tuple[int, int]], what: str) -> list[bytes]:
    """Fetch inclusive byte ranges [(a, b), ...] of ``url`` in one multi-range request.

    Returns one bytes object per requested range, in request order. Refuses a non-206 reply
    (a server that ignores Range would otherwise send the whole file).
    """
    spec = ",".join(f"{a}-{b}" for a, b in ranges)
    with _open(url, headers={"Range": f"bytes={spec}"}) as r:
        if r.status != 206:
            raise RuntimeError(f"{url}: server ignored Range (status {r.status})")
        ctype = r.headers.get("Content-Type", "")
        body = r.read()
    _account(len(body), what)
    parts: dict[int, bytes] = {}
    if ctype.startswith("multipart/byteranges"):
        boundary = re.search(r"boundary=\"?([^\";]+)\"?", ctype).group(1).encode()
        for chunk in body.split(b"--" + boundary):
            if b"Content-Range" not in chunk[:300]:
                continue
            head, _, data = chunk.partition(b"\r\n\r\n")
            m = re.search(rb"bytes (\d+)-(\d+)/", head)
            a, b = int(m.group(1)), int(m.group(2))
            parts[a] = data[: b - a + 1]
    else:  # single range
        m = re.search(r"bytes (\d+)-(\d+)/", r.headers["Content-Range"])
        parts[int(m.group(1))] = body
    out = []
    for a, b in ranges:
        if a in parts and len(parts[a]) >= b - a + 1:
            out.append(parts[a][: b - a + 1])
            continue
        # The server may merge adjacent ranges into one part: find the part containing [a, b].
        for start, data in parts.items():
            if start <= a and start + len(data) >= b + 1:
                out.append(data[a - start : b - start + 1])
                break
        else:
            raise RuntimeError(f"{url}: missing byte range {a}-{b} in reply")
    return out


# ------------------------------------------------------------------------------------------------
# Remote rasters
# ------------------------------------------------------------------------------------------------


class RemoteRaster:
    """A PDS IMG raster read through a local block cache (or a whole-file download if small)."""

    def __init__(self, name: str, img_url: str, lbl_url: str):
        self.dir = dem_dir() / name.lower()
        self.dir.mkdir(parents=True, exist_ok=True)
        text = fetch_text(lbl_url, self.dir / (name.lower() + ".lbl"))
        self.spec: RasterSpec = spec_from_label(name, img_url, text)
        self._full: np.ndarray | None = None
        if self.spec.file_bytes <= FULL_DOWNLOAD_MAX_BYTES:
            path = download_file(img_url, self.dir / (name.lower() + ".img"), self.spec.file_bytes)
            self._full = np.memmap(
                path, dtype=self.spec.dtype, mode="r", shape=(self.spec.lines, self.spec.samples)
            )

    # -- blocks --------------------------------------------------------------------------------
    def _block_path(self, br: int, bc: int) -> Path:
        return self.dir / f"b{BLOCK}_{br:04d}_{bc:04d}.npy"

    def _fetch_block_run(self, br: int, bcs: list[int]) -> None:
        """Fetch a contiguous run of blocks in one block-row and write them to the cache."""
        s = self.spec
        r0, r1 = br * BLOCK, min((br + 1) * BLOCK, s.lines)
        c0, c1 = bcs[0] * BLOCK, min((bcs[-1] + 1) * BLOCK, s.samples)
        bpp = s.bytes_per_px
        rows = list(range(r0, r1))
        ranges = [(r * s.record_bytes + c0 * bpp, r * s.record_bytes + c1 * bpp - 1) for r in rows]
        _check_budget(len(ranges) * (c1 - c0) * bpp)
        data = []
        for i in range(0, len(ranges), MAX_RANGES_PER_REQUEST):
            data += fetch_ranges(s.url, ranges[i : i + MAX_RANGES_PER_REQUEST], s.name)
        arr = np.frombuffer(b"".join(data), dtype=s.dtype).reshape(r1 - r0, c1 - c0)
        for bc in bcs:
            a = bc * BLOCK - c0
            b = min(a + BLOCK, c1 - c0)
            np.save(self._block_path(br, bc), np.ascontiguousarray(arr[:, a:b]))

    def ensure_blocks(self, r0: int, r1: int, c0: int, c1: int, workers: int = 6) -> None:
        """Make sure all blocks touching rows [r0, r1) and cols [c0, c1) are cached."""
        if self._full is not None:
            return
        s = self.spec
        r0, r1 = max(r0, 0), min(r1, s.lines)
        c0, c1 = max(c0, 0), min(c1, s.samples)
        if r0 >= r1 or c0 >= c1:
            return
        jobs = []
        for br in range(r0 // BLOCK, (r1 - 1) // BLOCK + 1):
            missing = [
                bc
                for bc in range(c0 // BLOCK, (c1 - 1) // BLOCK + 1)
                if not self._block_path(br, bc).exists()
            ]
            # split into contiguous runs of at most 8 blocks (keeps each reply < ~2 MB)
            run: list[int] = []
            for bc in missing:
                if run and (bc != run[-1] + 1 or len(run) >= 8):
                    jobs.append((br, run))
                    run = []
                run.append(bc)
            if run:
                jobs.append((br, run))
        if not jobs:
            return
        with ThreadPoolExecutor(max_workers=workers) as ex:
            list(ex.map(lambda j: self._fetch_block_run(*j), jobs))

    def read(self, r0: int, r1: int, c0: int, c1: int, download: bool = True) -> np.ndarray:
        """Heights (m, float32) of image rows [r0, r1) x cols [c0, c1); NaN outside the image.

        Column indices of cylindrical global rasters wrap around (360 deg periodic).
        With ``download=False`` only cached blocks are used; missing blocks read as NaN.
        """
        s = self.spec
        out = np.full((r1 - r0, c1 - c0), np.nan, dtype=np.float32)
        periodic = s.projection == "cyl" and abs(s.samples / s.res_ppd - 360.0) < 1e-9
        if periodic:
            cols = np.arange(c0, c1) % s.samples
        else:
            cols = np.arange(c0, c1)
        okc = (cols >= 0) & (cols < s.samples)
        rr0, rr1 = max(r0, 0), min(r1, s.lines)
        if rr0 >= rr1 or not okc.any():
            return out
        # Process contiguous column segments (a wrap splits the window in two).
        segs = []
        idx = np.flatnonzero(okc)
        start = idx[0]
        for a, b in zip(idx[:-1], idx[1:], strict=True):
            if b != a + 1 or cols[b] != cols[a] + 1:
                segs.append((start, a + 1))
                start = b
        segs.append((start, idx[-1] + 1))
        for j0, j1 in segs:
            cc0, cc1 = int(cols[j0]), int(cols[j1 - 1]) + 1
            out[rr0 - r0 : rr1 - r0, j0:j1] = self._read_inside(rr0, rr1, cc0, cc1, download)
        return out

    def _read_inside(self, r0: int, r1: int, c0: int, c1: int, download: bool = True):
        s = self.spec
        if self._full is not None:
            return self._full[r0:r1, c0:c1].astype(np.float32) * np.float32(s.to_metres)
        if download:
            self.ensure_blocks(r0, r1, c0, c1)
        out = np.full((r1 - r0, c1 - c0), np.nan, dtype=np.float32)
        for br in range(r0 // BLOCK, (r1 - 1) // BLOCK + 1):
            for bc in range(c0 // BLOCK, (c1 - 1) // BLOCK + 1):
                bp = self._block_path(br, bc)
                if not bp.exists():  # only possible with download=False
                    continue
                blk = np.load(bp)
                ra, rb = max(r0, br * BLOCK), min(r1, br * BLOCK + blk.shape[0])
                ca, cb = max(c0, bc * BLOCK), min(c1, bc * BLOCK + blk.shape[1])
                out[ra - r0 : rb - r0, ca - c0 : cb - c0] = blk[
                    ra - br * BLOCK : rb - br * BLOCK, ca - bc * BLOCK : cb - bc * BLOCK
                ]
        return out * np.float32(s.to_metres)
