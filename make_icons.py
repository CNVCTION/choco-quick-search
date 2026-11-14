import math
import struct
import zlib


def write_png(path, size, pixels):
    def chunk(tag, data):
        raw = tag + data
        return struct.pack(">I", len(data)) + raw + struct.pack(">I", zlib.crc32(raw) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    stride = size * 4
    rows = b"".join(
        b"\x00" + bytes(pixels[y * stride:(y + 1) * stride]) for y in range(size)
    )
    payload = zlib.compress(rows, 9)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", header))
        f.write(chunk(b"IDAT", payload))
        f.write(chunk(b"IEND", b""))


def rounded_rect_mask(x, y, size, radius, inset=0.0):
    lo = inset
    hi = size - inset
    if x < lo or x >= hi or y < lo or y >= hi:
        return False
    rx = min(x - lo, hi - 1 - x)
    ry = min(y - lo, hi - 1 - y)
    if rx >= radius or ry >= radius:
        return True
    dx = radius - rx
    dy = radius - ry
    return dx * dx + dy * dy <= radius * radius


def draw(size, inset_ratio, bg, fg):
    scale = size / 512.0
    inset = 512 * inset_ratio * scale
    radius = 96 * scale
    pixels = bytearray()
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r = g = b = a = 0
            if rounded_rect_mask(x, y, size, radius, inset):
                r, g, b = bg
                a = 255
            row.extend((r, g, b, a))
        pixels.extend(row)

    cx = size / 2
    cy = size / 2
    ring_r = 118 * scale
    ring_w = 34 * scale
    handle_len = 92 * scale
    handle_w = 44 * scale
    angle = math.radians(45)
    hx0 = cx + (ring_r - ring_w / 2 + 6 * scale) * math.cos(angle)
    hy0 = cy + (ring_r - ring_w / 2 + 6 * scale) * math.sin(angle)
    hx1 = hx0 + handle_len * math.cos(angle)
    hy1 = hy0 + handle_len * math.sin(angle)

    for y in range(size):
        for x in range(size):
            idx = (y * size + x) * 4
            if pixels[idx + 3] == 0:
                continue
            dx = (x + 0.5) - cx
            dy = (y + 0.5) - cy
            dist = math.hypot(dx, dy)
            in_ring = abs(dist - ring_r) <= ring_w / 2
            in_handle = False
            if hx1 != hx0:
                t = ((x + 0.5 - hx0) * (hx1 - hx0) + (y + 0.5 - hy0) * (hy1 - hy0)) / (handle_len ** 2)
                if -0.05 <= t <= 1.05:
                    px = hx0 + t * (hx1 - hx0)
                    py = hy0 + t * (hy1 - hy0)
                    half = handle_w / 2
                    perp = abs(-(x + 0.5 - px) * math.sin(angle) + (y + 0.5 - py) * math.cos(angle))
                    in_handle = perp <= half
            if in_ring or in_handle:
                pixels[idx] = fg[0]
                pixels[idx + 1] = fg[1]
                pixels[idx + 2] = fg[2]
    return pixels


BG = (61, 40, 20)
FG = (232, 163, 61)

for name, size, inset in [
    ("icon-192.png", 192, 0.02),
    ("icon-512.png", 512, 0.02),
    ("maskable-512.png", 512, 0.12),
]:
    write_png(f"public/icons/{name}", size, draw(size, inset, BG, FG))
    print("wrote", name)
