"""Higgsfield çıktılarını oyuna hazırlar: beyaz arka planı kenardan flood-fill ile siler,
nesneleri kırpar, boyutlandırır ve public/assets altına PNG olarak yazar."""
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

RAW = Path(__file__).parent / "raw"
OUT = Path(__file__).parent.parent / "public" / "assets"
OUT.mkdir(parents=True, exist_ok=True)


def remove_white(img: Image.Image, tol: int = 38, holes: bool = False) -> Image.Image:
    rgb = np.asarray(img.convert("RGB")).astype(np.int16)
    h, w, _ = rgb.shape
    # Beyaza uzaklık: kenardan erişilebilen açık pikseller arka plan sayılır.
    dist = 255 * 3 - rgb.sum(axis=2)
    near_white = dist < tol * 3
    bg = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near_white[y, x] and not bg[y, x]:
                bg[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near_white[y, x] and not bg[y, x]:
                bg[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < h and 0 <= nx < w and not bg[ny, nx] and near_white[ny, nx]:
                bg[ny, nx] = True
                q.append((ny, nx))
    if holes:
        # Kenara değmeyen ama büyük ve düz beyaz alanlar (kupa kulbu içi gibi) da arka plandır.
        flat = dist < 36
        seen = bg.copy()
        min_hole = int(h * w * 0.0006)
        for sy in range(h):
            for sx in range(w):
                if flat[sy, sx] and not seen[sy, sx]:
                    region = [(sy, sx)]
                    seen[sy, sx] = True
                    i = 0
                    while i < len(region):
                        y, x = region[i]
                        i += 1
                        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                            if 0 <= ny < h and 0 <= nx < w and flat[ny, nx] and not seen[ny, nx]:
                                seen[ny, nx] = True
                                region.append((ny, nx))
                    if len(region) >= min_hole:
                        ys, xs = zip(*region)
                        bg[list(ys), list(xs)] = True
    alpha = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8))
    # Kenarları yumuşat ve beyaz haleyi biraz içeri çek.
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    out = img.convert("RGBA")
    out.putalpha(alpha)
    return out


def crop(img: Image.Image, pad: int = 4) -> Image.Image:
    a = np.asarray(img)[:, :, 3]
    ys, xs = np.where(a > 10)
    return img.crop((max(xs.min() - pad, 0), max(ys.min() - pad, 0),
                     min(xs.max() + pad, img.width), min(ys.max() + pad, img.height)))


def fit(img: Image.Image, max_h: int) -> Image.Image:
    if img.height <= max_h:
        return img
    return img.resize((round(img.width * max_h / img.height), max_h), Image.LANCZOS)


def components(img: Image.Image, min_area: int = 4000):
    """Şeffaf görseldeki ayrı nesneleri bulur.
    Dönüş: (kutular [(x0, y0, x1, y1, etiket)] satır satır sıralı, 1/4 ölçekli etiket haritası)."""
    a = np.asarray(img)[:, :, 3] > 10
    small = Image.fromarray((a * 255).astype(np.uint8)).resize((img.width // 4, img.height // 4))
    m = np.asarray(small) > 0
    h, w = m.shape
    labels = np.zeros(m.shape, np.int32)
    boxes = []
    label = 0
    for sy in range(h):
        for sx in range(w):
            if m[sy, sx] and not labels[sy, sx]:
                label += 1
                q = deque([(sy, sx)])
                labels[sy, sx] = label
                y0 = y1 = sy
                x0 = x1 = sx
                n = 0
                while q:
                    y, x = q.popleft()
                    n += 1
                    y0, y1, x0, x1 = min(y0, y), max(y1, y), min(x0, x), max(x1, x)
                    for dy in (-2, -1, 0, 1, 2):
                        for dx in (-2, -1, 0, 1, 2):
                            ny, nx = y + dy, x + dx
                            if 0 <= ny < h and 0 <= nx < w and m[ny, nx] and not labels[ny, nx]:
                                labels[ny, nx] = label
                                q.append((ny, nx))
                if n * 16 >= min_area:
                    boxes.append((x0 * 4, y0 * 4, (x1 + 1) * 4, (y1 + 1) * 4, label))
    boxes.sort(key=lambda b: (round(b[1] / (img.height / 3)), b[0]))
    return boxes, labels


def isolate(img: Image.Image, labels: np.ndarray, keep: set[int], box) -> Image.Image:
    """Kutuyu keser ve yalnızca `keep` etiketlerine ait pikselleri bırakır (komşu nesne taşmalarını siler)."""
    mask = Image.fromarray((np.isin(labels, list(keep)) * 255).astype(np.uint8))
    mask = mask.resize(img.size, Image.NEAREST).filter(ImageFilter.MaxFilter(9))
    out = img.copy()
    a = np.minimum(np.asarray(out)[:, :, 3], np.asarray(mask))
    out.putalpha(Image.fromarray(a))
    return crop(out.crop(tuple(box[:4])))


def has_alpha(img: Image.Image) -> bool:
    """Görselde gerçekten şeffaf piksel var mı (RGBA ama opak beyaz olan çıktıları ayırır)."""
    return img.mode == "RGBA" and (np.asarray(img)[:, :, 3] < 10).mean() > 0.05


def save(img: Image.Image, name: str):
    img.save(OUT / f"{name}.png", optimize=True)
    print(f"  -> {name}.png {img.size}")


def sprite(src: str, name: str, max_h: int, tol: int = 38):
    p = RAW / f"{src}.png"
    if not p.exists():
        print(f"skip {src} (yok)")
        return
    img = Image.open(p)
    img = img if has_alpha(img) else remove_white(img, tol)
    save(fit(crop(img), max_h), name)


def sheet(src: str, names: list[str], max_h: int):
    p = RAW / f"{src}.png"
    if not p.exists():
        return
    img = remove_white(Image.open(p))
    boxes, labels = components(img)
    print(f"{src}: {len(boxes)} nesne bulundu")
    for box, name in zip(boxes, names):
        if name:
            save(fit(isolate(img, labels, {box[4]}, box), max_h), name)


def pose_sheet(src: str, names: list[str], target_h: int, holes: bool = False):
    """Yatay poz şeridini keser; tüm pozlar aynı ölçekle küçültülür (ilk pozun yüksekliği = target_h)."""
    p = RAW / f"{src}.png"
    if not p.exists():
        return
    img = Image.open(p)
    # Zaten şeffaf (ör. Higgsfield arka plan silici çıktısı) ise beyaz silmeyi atla.
    img = img if has_alpha(img) else remove_white(img, holes=holes)
    boxes, labels = components(img, min_area=200)
    boxes.sort(key=lambda b: (b[2] - b[0]) * (b[3] - b[1]), reverse=True)
    main = sorted(boxes[:len(names)], key=lambda b: b[0])
    merged = [list(b[:4]) for b in main]
    keep = [{b[4]} for b in main]
    for b in boxes[len(names):]:  # yıldız vb. küçük parçaları, merkezi içinde kalan poza ekle
        cx = (b[0] + b[2]) / 2
        hits = [k for k in range(len(main)) if main[k][0] <= cx <= main[k][2]]
        if not hits:
            continue
        i = hits[0]
        m = merged[i]
        merged[i] = [min(m[0], b[0]), min(m[1], b[1]), max(m[2], b[2]), max(m[3], b[3])]
        keep[i].add(b[4])
    crops = [isolate(img, labels, kp, b) for kp, b in zip(keep, merged)]
    k = target_h / crops[0].height
    for c, name in zip(crops, names):
        save(c.resize((round(c.width * k), round(c.height * k)), Image.LANCZOS), name)


def background(src: str, name: str, top_ratio: float):
    p = RAW / f"{src}.png"
    if not p.exists():
        return
    img = Image.open(p).convert("RGB")
    img = img.crop((0, 0, img.width, int(img.height * top_ratio)))
    img = img.resize((round(img.width * 720 / img.height), 720), Image.LANCZOS)
    img.save(OUT / f"{name}.jpg", quality=84, optimize=True)
    print(f"  -> {name}.jpg {img.size}")


if __name__ == "__main__":
    only = set(sys.argv[1:])
    jobs = {
        "dino": lambda: (sprite("dragon_hero_nobg", "dino_base", 360),
                         pose_sheet("dragon_sheet", ["dino_run1", "dino_run2", "dino_jump", "dino_duck", "dino_dead"], 260)),
        "obstacles": lambda: sheet("obstacles", ["cactus1", "cactus2", "cactus3", "ptero", "coin", "rock"], 260),
        "icons": lambda: pose_sheet("icons_nobg", ["trophy", "medal", "sound_on", "sound_off", "exit"], 160),
        "bg": lambda: background("bg", "bg", 0.665),
        "logo": lambda: sprite("logo", "logo", 520, tol=30),
    }
    for key, job in jobs.items():
        if not only or key in only:
            job()
