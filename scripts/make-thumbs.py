"""为生成图制作图鉴卡片用的小图，并把 manifest 的 thumbnailUrl 指向小图。

原图（public/generated-herbs/raw/*.jpg，约 1376×768、600KB+）只在详情页加载；
卡片用 640px 宽的 WebP（约 30–50KB），一页 24 张从 ~15MB 降到 ~1MB。

用法：
    python scripts/make-thumbs.py            # 补齐所有缺失的小图并更新 manifest
    python scripts/make-thumbs.py --force    # 全部重做
    python scripts/make-thumbs.py --ids a,b  # 只处理指定条目（生图脚本在单张生成后调用）
"""
import argparse
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / 'data' / 'media-manifest.json'
PUBLIC = ROOT / 'public'
THUMB_DIR = PUBLIC / 'generated-herbs' / 'thumb'
WIDTH = 640


def make_thumb(raw_path: Path, out_path: Path) -> None:
    with Image.open(raw_path) as image:
        image = image.convert('RGB')
        height = round(image.height * WIDTH / image.width)
        image.resize((WIDTH, height), Image.LANCZOS).save(out_path, 'WEBP', quality=80, method=6)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--ids', default='')
    parser.add_argument('--raw', help='只为这一张原图出小图（不读写 manifest）')
    parser.add_argument('--out')
    args = parser.parse_args()
    if args.raw and args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        make_thumb(Path(args.raw), Path(args.out))
        return
    only = {value for value in args.ids.split(',') if value}

    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    made = 0
    for item in manifest:
        raw_url = item.get('rawUrl')
        if not raw_url or (only and item['entryId'] not in only):
            continue
        raw_path = PUBLIC / raw_url.lstrip('/')
        if not raw_path.exists():
            continue
        out_path = THUMB_DIR / f"{item['entryId']}.webp"
        if args.force or only or not out_path.exists() or out_path.stat().st_mtime < raw_path.stat().st_mtime:
            make_thumb(raw_path, out_path)
            made += 1
        item['thumbnailUrl'] = f"/generated-herbs/thumb/{item['entryId']}.webp"
        item['imageUrl'] = raw_url

    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'thumbs: made {made}')


if __name__ == '__main__':
    main()
