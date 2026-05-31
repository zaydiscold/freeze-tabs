#!/usr/bin/env python3
"""Generate the toolbar icons with only the Python standard library.

We hand-write PNGs (zlib + struct) so there's no Pillow/numpy dependency — the
whole thing stays self-contained and reproducible. Design: a blue rounded-ish
tile (#3b82f6) with a white 6-arm snowflake to signal "freeze."
"""
import os
import struct
import zlib

BG = (0x3B, 0x82, 0xF6)   # blue-500
FG = (0xFF, 0xFF, 0xFF)   # white snowflake


def make_png(size: int) -> bytes:
    cx = cy = (size - 1) / 2.0
    r = size * 0.40            # snowflake radius
    arm = max(1, size // 16)   # arm half-thickness in px
    pad = size * 0.06          # transparent corner padding (fake rounding)

    def pixel(x, y):
        # Transparent corners so the square looks slightly inset.
        if x < pad or y < pad or x > size - 1 - pad or y > size - 1 - pad:
            return (0, 0, 0, 0)
        dx, dy = x - cx, y - cy
        dist = (dx * dx + dy * dy) ** 0.5
        if dist <= r:
            # 6 arms at 0/60/120 degrees -> draw 3 lines through center.
            for ang in (0.0, 1.0471975512, 2.0943951024):  # 0, 60, 120 deg
                import math
                ux, uy = math.cos(ang), math.sin(ang)
                # distance from point to the line through center with dir (ux,uy)
                perp = abs(-uy * dx + ux * dy)
                along = abs(ux * dx + uy * dy)
                if perp <= arm and along <= r:
                    return (*FG, 255)
        return (*BG, 255)

    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0 for each scanline
        for x in range(size):
            raw.extend(pixel(x, y))

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    return (b"\x89PNG\r\n\x1a\n" +
            chunk(b"IHDR", ihdr) +
            chunk(b"IDAT", zlib.compress(bytes(raw), 9)) +
            chunk(b"IEND", b""))


def main():
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
    os.makedirs(out, exist_ok=True)
    for s in (16, 48, 128):
        path = os.path.join(out, f"icon{s}.png")
        with open(path, "wb") as f:
            f.write(make_png(s))
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
