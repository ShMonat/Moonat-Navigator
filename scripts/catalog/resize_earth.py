# AI-generated with Claude Code (Anthropic), directed and reviewed by the Moonat team.
"""Downsample the NASA Blue Marble full-resolution JPEG to 2048x1024 for the web.

Usage: uv run --with pillow python scripts/catalog/resize_earth.py <in.jpg> <out.jpg>
Source: NASA Visible Earth id 57752 (Blue Marble: Land Surface, Shallow Water, and Shaded Topography), public domain.
"""

import sys

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
im = Image.open(sys.argv[1]).convert("RGB")
im = im.resize((2048, 1024), Image.LANCZOS)
im.save(sys.argv[2], "JPEG", quality=85, optimize=True, progressive=True)
