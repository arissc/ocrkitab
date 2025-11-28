import argparse
import os
import sys
import io
import json
import re


def utf8_stdout():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')


def list_images(dir_path):
    exts = {'.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff'}
    files = []
    for name in os.listdir(dir_path):
        p = os.path.join(dir_path, name)
        if os.path.isfile(p) and os.path.splitext(name.lower())[1] in exts:
            files.append(p)

    def natural_key(path):
        base = os.path.basename(path)
        # Split into text and digit chunks for natural sorting
        parts = re.split(r'(\d+)', base)
        return [int(part) if part.isdigit() else part.lower() for part in parts]

    files.sort(key=natural_key)
    return files


def base_no_ext(path):
    return os.path.splitext(os.path.basename(path))[0]


def ensure_dir(d):
    if not os.path.isdir(d):
        os.makedirs(d, exist_ok=True)


def map_lang(lang):
    # EasyOCR expects 'ar' for Arabic; map common code 'ara' to 'ar'
    if not lang:
        return 'ar'
    l = lang.lower()
    if l == 'ara':
        return 'ar'
    return l


def main():
    utf8_stdout()

    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--lang', default='ara')
    parser.add_argument('--gpu', action='store_true')
    args = parser.parse_args()

    in_dir = args.input
    out_dir = args.output
    lang = map_lang(args.lang)
    ensure_dir(out_dir)

    imgs = list_images(in_dir)
    print(f"TOTAL {len(imgs)}")
    sys.stdout.flush()

    try:
        import easyocr
    except Exception as e:
        sys.stderr.write(f"Failed to import easyocr: {e}\n")
        sys.stderr.flush()
        sys.exit(2)

    try:
        reader = easyocr.Reader([lang], gpu=args.gpu)
    except Exception as e:
        sys.stderr.write(f"Failed to initialize EasyOCR reader: {e}\n")
        sys.stderr.flush()
        sys.exit(3)

    completed = 0
    for img in imgs:
        try:
            results = reader.readtext(img, detail=1, paragraph=True)
            # results: list of [bbox, text, score]
            lines = []
            for r in results:
                if isinstance(r, (list, tuple)) and len(r) >= 2:
                    text = r[1]
                    if isinstance(text, str) and text.strip():
                        lines.append(text.strip())

            content = "\n".join(lines)
            out_txt = os.path.join(out_dir, base_no_ext(img) + '.txt')
            with open(out_txt, 'w', encoding='utf-8') as f:
                f.write(content)

            completed += 1
            print(f"PROGRESS {os.path.basename(img)} {completed} {len(imgs)}")
            sys.stdout.flush()
        except Exception as e:
            sys.stderr.write(f"Error processing {img}: {e}\n")
            sys.stderr.flush()

    sys.exit(0)


if __name__ == '__main__':
    main()