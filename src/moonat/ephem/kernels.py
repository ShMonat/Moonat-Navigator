# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""NAIF kernels: where they live, how to download them, and one cached skyfield loader.

Kernels (all from https://naif.jpl.nasa.gov/pub/naif/generic_kernels/):
- ``de421.bsp``                    JPL DE421 planetary + lunar ephemeris (SPK), 1900-2050.
- ``moon_pa_de421_1900-2050.bpc``  lunar principal-axes (PA) orientation from DE421 (binary PCK).
- ``moon_080317.tf``               frame kernel: MOON_ME_DE421 = MOON_PA_DE421 + fixed rotation.
- ``pck00008.tpc``                 text PCK; we only use it to check BODY301_RADII = 1737.4 km.

The kernel directory is ``$MOONAT_KERNEL_DIR`` if set. Otherwise it is the first
``data/raw/kernels/`` that holds ``de421.bsp``, searching from the repo root upward (so git
worktrees share the main checkout's download). Otherwise it is ``<repo>/data/raw/kernels/``.
"""

from __future__ import annotations

import os
import urllib.request
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

NAIF = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/"
KERNELS = {
    "de421.bsp": NAIF + "spk/planets/a_old_versions/de421.bsp",
    "moon_pa_de421_1900-2050.bpc": NAIF + "pck/moon_pa_de421_1900-2050.bpc",
    "moon_080317.tf": NAIF + "fk/satellites/moon_080317.tf",
    "pck00008.tpc": NAIF + "pck/a_old_versions/pck00008.tpc",
}
MOON_RADIUS_KM = 1737.4  # reference sphere of CONTRACTS §0 (= IAU / pck00008 BODY301_RADII)
FRAME_NAME = "MOON_ME_DE421"

_REPO = Path(__file__).resolve().parents[3]


def kernel_dir() -> Path:
    """Return the directory that holds (or will hold) the NAIF kernels."""
    env = os.environ.get("MOONAT_KERNEL_DIR")
    if env:
        return Path(env)
    for base in (_REPO, *_REPO.parents):
        cand = base / "data" / "raw" / "kernels"
        if (cand / "de421.bsp").exists():
            return cand
    return _REPO / "data" / "raw" / "kernels"


def kernels_available() -> bool:
    """True if all four kernels are present locally."""
    d = kernel_dir()
    return all((d / name).exists() for name in KERNELS)


def download_kernels(verbose: bool = True) -> Path:
    """Download any missing kernel into :func:`kernel_dir` (about 18.7 MB in total)."""
    d = kernel_dir()
    d.mkdir(parents=True, exist_ok=True)
    for name, url in KERNELS.items():
        path = d / name
        if path.exists():
            continue
        if verbose:
            print(f"downloading {url}")
        tmp = path.with_suffix(path.suffix + ".part")
        urllib.request.urlretrieve(url, tmp)
        tmp.replace(path)
    return d


@dataclass(frozen=True)
class Kernels:
    """Loaded skyfield objects: timescale, DE421 ephemeris and the MOON_ME_DE421 frame."""

    ts: object
    eph: object
    frame: object


@lru_cache(maxsize=1)
def load_kernels() -> Kernels:
    """Load (once) the timescale, DE421 and the MOON_ME_DE421 frame with skyfield.

    The timescale uses skyfield's built-in leap-second and Delta-T tables (no download).
    """
    from skyfield.api import PlanetaryConstants, load, load_file

    d = kernel_dir()
    missing = [n for n in KERNELS if not (d / n).exists()]
    if missing:
        raise FileNotFoundError(
            f"missing NAIF kernels {missing} in {d}; "
            "run `uv run python scripts/download_kernels.py`"
        )
    pc = PlanetaryConstants()
    with open(d / "moon_080317.tf", "rb") as f:
        pc.read_text(f)
    with open(d / "pck00008.tpc", "rb") as f:
        pc.read_text(f)
    pc.read_binary(open(d / "moon_pa_de421_1900-2050.bpc", "rb"))  # kept open by skyfield
    radii = pc.variables["BODY301_RADII"]
    assert all(abs(r - MOON_RADIUS_KM) < 1e-9 for r in radii), radii
    return Kernels(
        ts=load.timescale(builtin=True),
        eph=load_file(str(d / "de421.bsp")),
        frame=pc.build_frame_named(FRAME_NAME),
    )
