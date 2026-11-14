# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Terrain layer: LOLA DEM windows, horizon profiles (C3) and terrain patches (C4)."""

from .dem import LayeredDEM, build_layers
from .horizon import horizon_profile
from .patch import terrain_patch, write_terrain_patch

__all__ = ["LayeredDEM", "build_layers", "horizon_profile", "terrain_patch", "write_terrain_patch"]
