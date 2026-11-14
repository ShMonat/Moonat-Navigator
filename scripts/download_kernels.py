# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Download the four NAIF kernels (~18.7 MB) used by moonat.ephem into data/raw/kernels/.

Usage: uv run python scripts/download_kernels.py   (files already present are skipped)
"""

from moonat.ephem.kernels import KERNELS, download_kernels

if __name__ == "__main__":
    d = download_kernels()
    for name in KERNELS:
        print(f"{(d / name).stat().st_size:>10,d}  {d / name}")
