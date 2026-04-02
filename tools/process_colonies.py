#!/usr/bin/env python3
import json
import math
import re
import sys
from pathlib import Path
from typing import Dict, List, Tuple

from PIL import Image, ImageDraw, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "assets" / "processed"
DATA_DIR = ROOT / "data"
JSON_PATH = DATA_DIR / "slides.json"
EMBED_PATH = DATA_DIR / "slides.embed.js"
MAX_DIM = 1100
WEBP_QUALITY = 74

# 个别原图自动识别的圆略大、裁切贴培养皿边缘时，按「文件名不含扩展名」缩小有效半径（0~1）
# C024/C025：检测圆偏大 + 白纸在画面一侧，收紧半径并略平移圆心（远离采样最亮方向）
RADIUS_SCALE_BY_STEM: Dict[str, float] = {
    "热带念珠菌": 0.72,
    "热带念珠菌1": 0.67,
}

# 圆心平移：(dx_frac, dy_frac) 与检测半径 r 相乘后加到 (cx,cy)；坐标与 find_best_circle 一致（x 右、y 下）
CENTER_NUDGE_FRAC_BY_STEM: Dict[str, Tuple[float, float]] = {
    "热带念珠菌": (0.032, -0.018),
    "热带念珠菌1": (-0.016, 0.042),
}


def ensure_dirs() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    for item in OUTPUT_DIR.iterdir():
        if item.is_file() and item.name != ".gitkeep":
            item.unlink()


def list_images(source_dir: Path) -> List[Path]:
    exts = {".jpg", ".jpeg", ".png", ".webp"}
    return sorted(
        [p for p in source_dir.iterdir() if p.is_file() and p.suffix.lower() in exts],
        key=lambda p: p.name,
    )


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def sample_circle_score(
    edge_px,
    gray_px,
    width: int,
    height: int,
    cx: int,
    cy: int,
    radius: int,
) -> float:
    edge_total = 0.0
    grad_total = 0.0
    count = 0
    delta = max(2, int(radius * 0.03))

    for i in range(96):
        angle = (math.tau * i) / 96.0
        c = math.cos(angle)
        s = math.sin(angle)
        xr = int(round(cx + radius * c))
        yr = int(round(cy + radius * s))
        xi = int(round(cx + (radius - delta) * c))
        yi = int(round(cy + (radius - delta) * s))
        xo = int(round(cx + (radius + delta) * c))
        yo = int(round(cy + (radius + delta) * s))

        if not (0 <= xr < width and 0 <= yr < height):
            continue
        if not (0 <= xi < width and 0 <= yi < height):
            continue
        if not (0 <= xo < width and 0 <= yo < height):
            continue

        edge_total += float(edge_px[xr, yr])
        grad_total += abs(float(gray_px[xi, yi]) - float(gray_px[xo, yo]))
        count += 1

    if not count:
        return -1.0

    mean_edge = edge_total / count
    mean_grad = grad_total / count
    return mean_edge * 0.55 + mean_grad * 0.95


def find_best_circle(img: Image.Image) -> Tuple[int, int, int]:
    work = ImageOps.exif_transpose(img).convert("RGB")
    scale = 1.0
    max_side = max(work.size)
    if max_side > 520:
        scale = 520.0 / max_side
        work = work.resize(
            (max(1, int(work.size[0] * scale)), max(1, int(work.size[1] * scale))),
            Image.Resampling.LANCZOS,
        )

    gray = work.convert("L")
    edges = gray.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.GaussianBlur(radius=1.2))
    edge_px = edges.load()
    gray_px = gray.load()
    width, height = edges.size
    min_dim = min(width, height)

    cx_start = int(width * 0.30)
    cx_end = int(width * 0.70)
    cy_start = int(height * 0.24)
    cy_end = int(height * 0.76)
    r_start = int(min_dim * 0.20)
    r_end = int(min_dim * 0.40)

    step_center = max(6, min_dim // 26)
    step_radius = max(6, min_dim // 28)

    best = None
    best_score = -1.0

    for cx in range(cx_start, cx_end + 1, step_center):
        for cy in range(cy_start, cy_end + 1, step_center):
            for radius in range(r_start, r_end + 1, step_radius):
                score = sample_circle_score(
                    edge_px,
                    gray_px,
                    width,
                    height,
                    cx,
                    cy,
                    radius,
                )
                center_bias = abs(cx - width / 2) * 0.04 + abs(cy - height / 2) * 0.04
                score -= center_bias
                if score > best_score:
                    best_score = score
                    best = (cx, cy, radius)

    if best is None:
        raise RuntimeError("未找到可用圆形区域")

    cx0, cy0, r0 = best
    refine_center = max(3, step_center // 2)
    refine_radius = max(3, step_radius // 2)

    for cx in range(cx0 - step_center, cx0 + step_center + 1, refine_center):
        for cy in range(cy0 - step_center, cy0 + step_center + 1, refine_center):
            for radius in range(max(8, r0 - step_radius), r0 + step_radius + 1, refine_radius):
                score = sample_circle_score(
                    edge_px,
                    gray_px,
                    width,
                    height,
                    cx,
                    cy,
                    radius,
                )
                center_bias = abs(cx - width / 2) * 0.04 + abs(cy - height / 2) * 0.04
                score -= center_bias
                if score > best_score:
                    best_score = score
                    best = (cx, cy, radius)

    cx, cy, radius = best
    inv = 1.0 / scale
    return int(round(cx * inv)), int(round(cy * inv)), int(round(radius * inv))


def crop_circle(
    img: Image.Image,
    circle: Tuple[float, float, float],
    radius_scale: float = 1.0,
) -> Image.Image:
    img = ImageOps.exif_transpose(img).convert("RGBA")
    width, height = img.size
    cx, cy, radius = circle
    cx = float(cx)
    cy = float(cy)
    radius = max(12, int(round(radius * radius_scale)))
    pad = max(16, int(radius * 0.08))
    left = int(round(clamp(cx - radius - pad, 0, width)))
    top = int(round(clamp(cy - radius - pad, 0, height)))
    right = int(round(clamp(cx + radius + pad, 0, width)))
    bottom = int(round(clamp(cy + radius + pad, 0, height)))

    cropped = img.crop((left, top, right, bottom))
    local_cx = cx - left
    local_cy = cy - top
    local_r = max(10, int(radius * 0.995))

    mask = Image.new("L", cropped.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse(
        (local_cx - local_r, local_cy - local_r, local_cx + local_r, local_cy + local_r),
        fill=255,
    )
    mask = mask.filter(ImageFilter.GaussianBlur(radius=max(1, int(local_r * 0.015))))
    cropped.putalpha(mask)
    return cropped


def shrink_for_web(img: Image.Image, max_dim: int) -> Image.Image:
    width, height = img.size
    longest = max(width, height)
    if longest <= max_dim:
        return img

    scale = max_dim / float(longest)
    new_size = (
        max(1, int(round(width * scale))),
        max(1, int(round(height * scale))),
    )
    return img.resize(new_size, Image.Resampling.LANCZOS)


def safe_stem(name: str) -> str:
    keep = []
    for ch in name:
        if ch.isalnum() or ch in {"-", "_"}:
            keep.append(ch)
        elif "\u4e00" <= ch <= "\u9fff":
            keep.append(ch)
    text = "".join(keep).strip("_-")
    return text or "item"


# 末尾编号式数字：半角/全角阿拉伯、其他 Unicode 十进制数字；数字前可有半角/全角空格
_TRAILING_DIGITS = re.compile(r"(?:[\s\u3000]*\d)+$", re.UNICODE)


def strip_trailing_digits(name: str) -> str:
    """菌名展示用：去掉末尾数字后缀（如 粪肠球菌3、粪肠球菌 ２ → 粪肠球菌）。"""
    t = name.strip()
    s = _TRAILING_DIGITS.sub("", t).strip()
    return s or t


def write_embed(data: List[Dict[str, str]]) -> None:
    EMBED_PATH.write_text(
        "window.__COLONY_DATA__ = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )


def process_one(src: Path, index: int) -> Dict[str, str]:
    stem = src.stem
    radius_scale = float(RADIUS_SCALE_BY_STEM.get(stem, 1.0))
    nxf, nyf = CENTER_NUDGE_FRAC_BY_STEM.get(stem, (0.0, 0.0))
    with Image.open(src) as img:
        cx, cy, r = find_best_circle(img)
        dx = nxf * r
        dy = nyf * r
        circle = (cx + dx, cy + dy, r)
        out_img = crop_circle(img, circle, radius_scale=radius_scale)
        out_img = shrink_for_web(out_img, MAX_DIM)

    stem = safe_stem(stem)
    out_name = f"{index:03d}_{stem}.webp"
    out_path = OUTPUT_DIR / out_name
    out_img.save(out_path, format="WEBP", quality=WEBP_QUALITY, method=6)

    return {
        "id": f"C{index:03d}",
        "title": strip_trailing_digits(safe_stem(src.stem)),
        "image": f"assets/processed/{out_name}",
        "filename": src.name,
    }


def main() -> int:
    if len(sys.argv) < 2:
        print("用法: python3 tools/process_colonies.py <原始图片目录>", file=sys.stderr)
        return 1

    source_dir = Path(sys.argv[1]).expanduser().resolve()
    if not source_dir.exists() or not source_dir.is_dir():
        print(f"目录不存在: {source_dir}", file=sys.stderr)
        return 1

    ensure_dirs()
    images = list_images(source_dir)
    if not images:
        print(f"目录中没有可处理图片: {source_dir}", file=sys.stderr)
        return 1

    data = []
    for index, src in enumerate(images, start=1):
        print(f"[{index}/{len(images)}] 处理中: {src.name}")
        try:
            data.append(process_one(src, index))
        except Exception as exc:
            print(f"  失败: {src.name} -> {exc}", file=sys.stderr)

    JSON_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_embed(data)

    print(f"完成，共生成 {len(data)} 张透明平板图")
    print(f"数据文件: {JSON_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
