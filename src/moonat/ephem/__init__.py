# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Ephemeris layer: where the Sun, Earth and planets are in the sky of a lunar site.

- ``moonat.ephem.direct``: rigorous skyfield + DE421 + MOON_ME_DE421 computation (needs kernels).
- ``moonat.ephem.table``: reader of the browser tables (C1) + topocentric transform (numpy only).
- ``moonat.ephem.topo``: the shared geometry (ENU, az/el, phase, ERA, quaternions).

Conventions: docs/CONTRACTS.md §0 (MOON_ME, 1737.4 km sphere, radial up, azimuth clockwise from
north, UTC at interfaces). Validation against JPL Horizons: docs/validation/ephem.md.
"""

from .topo import era_deg, to_posix_seconds

__all__ = ["era_deg", "to_posix_seconds"]
