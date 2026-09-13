import argparse
import os
import re
import subprocess
import sys
import io


def utf8_stdio():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        try:
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
        except Exception:
            pass

    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        try:
            sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
        except Exception:
            pass


def list_images(dir_path):
    exts = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}
    files = []
    for name in os.listdir(dir_path):
        p = os.path.join(dir_path, name)
        if os.path.isfile(p) and os.path.splitext(name.lower())[1] in exts:
            files.append(p)

    def natural_key(p):
        base = os.path.basename(p)
        parts = re.split(r"(\d+)", base)
        return [int(part) if part.isdigit() else part.lower() for part in parts]

    files.sort(key=natural_key)
    return files


def base_no_ext(p):
    return os.path.splitext(os.path.basename(p))[0]


def ensure_dir(d):
    if not os.path.isdir(d):
        os.makedirs(d, exist_ok=True)


def resolve_kraken_cmd():
    scripts_dir = os.path.dirname(sys.executable)
    candidates = []
    if os.name == "nt":
        candidates.append(os.path.join(scripts_dir, "kraken.exe"))
        candidates.append(os.path.join(scripts_dir, "kraken-script.py"))
        candidates.append(os.path.join(scripts_dir, "kraken.cmd"))
        candidates.append(os.path.join(scripts_dir, "kraken"))
    else:
        candidates.append(os.path.join(scripts_dir, "kraken"))
    candidates.append("kraken")
    for c in candidates:
        if c == "kraken":
            return (["kraken"], "kraken")
        if os.path.exists(c):
            if c.lower().endswith(".py"):
                return ([sys.executable, c], c)
            return ([c], c)
    return (["kraken"], "kraken")


def find_default_model(lang):
    l = str(lang or "").strip().lower()
    wants_arabic = l in {"ara", "ar", "arabic"} or "arab" in l

    model_dir_env = os.environ.get("KRAKEN_MODEL_DIR") or ""
    candidates = []
    if model_dir_env:
        candidates.append(model_dir_env)
    candidates.append(os.path.join(os.path.expanduser("~"), ".kraken"))
    candidates.append(os.path.join(os.path.expanduser("~"), "kraken"))
    appdata = os.environ.get("APPDATA") or ""
    if appdata:
        candidates.append(os.path.join(appdata, "kraken"))

    mlmodels = []
    for d in candidates:
        if not d or not os.path.isdir(d):
            continue
        try:
            for name in os.listdir(d):
                if name.lower().endswith(".mlmodel"):
                    mlmodels.append(os.path.join(d, name))
        except Exception:
            continue

    if not mlmodels:
        return ""

    if wants_arabic:
        arab = [p for p in mlmodels if "arab" in os.path.basename(p).lower()]
        if arab:
            arab.sort()
            return arab[0]

    mlmodels.sort()
    return mlmodels[0]


def main():
    utf8_stdio()

    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=False)
    parser.add_argument("--output", required=True)
    parser.add_argument("--file", required=False, help="Single image file to process")
    parser.add_argument("--lang", default="ara")
    parser.add_argument("--model", default="", help="Path to .mlmodel (recommended for Arabic)")
    args = parser.parse_args()

    if not args.input and not args.file:
        sys.stderr.write("Either --input or --file is required\n")
        sys.exit(1)

    out_dir = args.output
    ensure_dir(out_dir)

    imgs = []
    if args.file:
        if os.path.exists(args.file):
            imgs = [args.file]
        else:
            sys.stderr.write(f"File not found: {args.file}\n")
            sys.exit(1)
    else:
        imgs = list_images(args.input)

    print(f"TOTAL {len(imgs)}")
    sys.stdout.flush()

    base_cmd, _resolved = resolve_kraken_cmd()

    model = (args.model or "").strip()
    if not model:
        model = find_default_model(args.lang)

    if model and not os.path.exists(model):
        sys.stderr.write(f"Model not found: {model}\n")
        sys.stderr.flush()
        sys.exit(2)

    completed = 0
    total = len(imgs)
    for img in imgs:
        try:
            out_txt = os.path.join(out_dir, base_no_ext(img) + ".txt")
            cmd = list(base_cmd) + [
                "-i",
                img,
                out_txt,
                "segment",
                "-bl",
                "ocr",
            ]
            if model:
                cmd += ["-m", model]

            proc = subprocess.run(cmd, capture_output=True, text=True)
            if proc.returncode != 0:
                err = (proc.stderr or proc.stdout or "").strip()
                if not err:
                    err = f"kraken exited with code {proc.returncode}"
                raise RuntimeError(err)

            if not os.path.exists(out_txt):
                raise RuntimeError("Output file not created by kraken.")

            completed += 1
            print(f"PROGRESS {os.path.basename(img)} {completed} {total}")
            sys.stdout.flush()
        except Exception as e:
            sys.stderr.write(f"Error processing {img}: {e}\n")
            sys.stderr.flush()

    sys.exit(0)


if __name__ == "__main__":
    main()
