import argparse
import random
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageFilter


CANVAS = 1024
IMAGE_W = 960
IMAGE_H = 540
IMAGE_Y = 328
PAPER = (239, 234, 218)
INK = (30, 32, 27)
MUTED = (74, 72, 62)
SEAL = (151, 42, 31)


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


FONT_TITLE = font(r"C:\Windows\Fonts\simkai.ttf", 108)
FONT_NOTE = font(r"C:\Windows\Fonts\simfang.ttf", 46)
FONT_SEAL = font(r"C:\Windows\Fonts\simkai.ttf", 25)


def text_size(draw, text, fnt):
    box = draw.textbbox((0, 0), text, font=fnt)
    return box[2] - box[0], box[3] - box[1]


def fit_text(draw, text, font_path, start_size, max_width):
    size = start_size
    while size >= 24:
        fnt = font(font_path, size)
        width, _ = text_size(draw, text, fnt)
        if width <= max_width:
            return fnt
        size -= 4
    return font(font_path, 24)


def wrap_text(draw, text, fnt, max_width, max_lines=2):
    lines = []
    current = ""
    for char in text:
        trial = f"{current}{char}"
        width, _ = text_size(draw, trial, fnt)
        if width <= max_width or not current:
            current = trial
            continue
        lines.append(current)
        current = char
        if len(lines) == max_lines:
            break
    if current and len(lines) < max_lines:
        lines.append(current)
    overflow = "".join(list(text)[sum(len(line) for line in lines):])
    if overflow and lines:
        while text_size(draw, f"{lines[-1]}…", fnt)[0] > max_width and lines[-1]:
            lines[-1] = lines[-1][:-1]
        lines[-1] = f"{lines[-1]}…"
    return lines


def make_paper():
    image = Image.new("RGB", (CANVAS, CANVAS), PAPER)
    pixels = image.load()
    random.seed(24)
    for y in range(CANVAS):
        for x in range(CANVAS):
            noise = random.randint(-7, 7)
            pixels[x, y] = tuple(max(0, min(255, channel + noise)) for channel in PAPER)
    texture = Image.effect_noise((CANVAS, CANVAS), 16).convert("L").filter(ImageFilter.GaussianBlur(0.7))
    tint = Image.new("RGB", (CANVAS, CANVAS), (216, 202, 170))
    image = Image.composite(tint, image, texture.point(lambda value: 24 if value > 175 else 0))
    return image


def crop_to_aspect(source, target_aspect):
    width, height = source.size
    source_aspect = width / height
    if source_aspect > target_aspect:
        crop_width = int(height * target_aspect)
        left = (width - crop_width) // 2
        return source.crop((left, 0, left + crop_width, height))
    crop_height = int(width / target_aspect)
    top = (height - crop_height) // 2
    return source.crop((0, top, width, top + crop_height))


def paste_specimen(canvas, source_path):
    source = Image.open(source_path).convert("RGBA")
    source = crop_to_aspect(source, IMAGE_W / IMAGE_H)
    source = source.resize((IMAGE_W, IMAGE_H), Image.Resampling.LANCZOS)
    layer = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    x = (CANVAS - IMAGE_W) // 2
    y = IMAGE_Y
    layer.alpha_composite(source, (x, y))
    canvas.alpha_composite(layer)


def draw_seal(canvas):
    size = 78
    x = CANVAS - 118
    y = CANVAS - 118
    seal = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    seal_draw = ImageDraw.Draw(seal)
    seal_draw.rectangle((2, 2, size - 3, size - 3), outline=SEAL + (235,), width=4)
    seal_draw.rectangle((10, 10, size - 11, size - 11), outline=SEAL + (205,), width=2)
    positions = [
        (size * 0.36, size * 0.34, "本"),
        (size * 0.66, size * 0.34, "草"),
        (size * 0.36, size * 0.66, "綱"),
        (size * 0.66, size * 0.66, "目"),
    ]
    for tx, ty, char in positions:
        seal_draw.text((tx, ty), char, fill=SEAL + (230,), font=FONT_SEAL, anchor="mm", stroke_width=1, stroke_fill=SEAL + (190,))

    random.seed(95)
    mask = Image.new("L", (size, size), 255)
    mask_pixels = mask.load()
    for py in range(size):
        for px in range(size):
            if random.random() < 0.035:
                mask_pixels[px, py] = random.randint(70, 160)
    seal.putalpha(ImageChops.multiply(seal.getchannel("A"), mask))
    canvas.alpha_composite(seal, (x, y))


def compose(raw, output, title, note):
    canvas = make_paper().convert("RGBA")
    paste_specimen(canvas, raw)
    draw = ImageDraw.Draw(canvas)

    title_font = fit_text(draw, title, r"C:\Windows\Fonts\simkai.ttf", 108, 760)
    note_font = fit_text(draw, note, r"C:\Windows\Fonts\simfang.ttf", 46, 820)
    note_lines = wrap_text(draw, note, note_font, 820, 2)

    draw.text((CANVAS // 2, 52), title, fill=INK, font=title_font, anchor="ma")
    for index, line in enumerate(note_lines):
        draw.text((CANVAS // 2, 160 + index * 52), line, fill=MUTED, font=note_font, anchor="ma")
    draw_seal(canvas)

    output_path = Path(output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output_path, quality=92, optimize=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--note", required=True)
    args = parser.parse_args()
    compose(args.raw, args.output, args.title, args.note)


if __name__ == "__main__":
    main()
