import argparse
import os
import sys
import glob
import subprocess
import shutil

# Force UTF-8 output to avoid Windows charmap issues
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='ignore')
    sys.stderr.reconfigure(encoding='utf-8', errors='ignore')
except Exception:
    pass

def print_progress(file, index, total):
    print(f"PROGRESS {os.path.basename(file)} {index} {total}", flush=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--lang", default="ara")
    parser.add_argument("--tesseract-path", default=None)
    args = parser.parse_args()

    in_dir = args.input
    out_dir = args.output
    os.makedirs(out_dir, exist_ok=True)

    images = []
    for ext in ("*.jpg", "*.jpeg", "*.png"):
        images.extend(glob.glob(os.path.join(in_dir, ext)))
    images = sorted(images)

    print(f"TOTAL {len(images)}", flush=True)

    if not images:
        print("Arabic DL: no images found", file=sys.stderr, flush=True)
        sys.exit(2)

    repo_path = os.path.join(os.getcwd(), "engines", "Arabic-Handwritten-OCR")
    if not os.path.isdir(repo_path):
        print(
            "Arabic DL engine repo not found at engines/Arabic-Handwritten-OCR.\n"
            "Clone the repo and set up its environment.",
            file=sys.stderr, flush=True
        )
        sys.exit(3)

    # Try deep-learning inference if a usable entrypoint exists, otherwise fallback to Tesseract.
    # Fallback path ensures the app produces text outputs even before DL is fully wired.
    entrypoints = [
        os.path.join(repo_path, "recognize.py"),
        os.path.join(repo_path, "inference.py"),
    ]
    has_entry_script = any(os.path.isfile(p) for p in entrypoints)

    tesseract_cmd = args.tesseract_path or shutil.which("tesseract") or "tesseract"

    total = len(images)
    for idx, img in enumerate(images, start=1):
        out_txt = os.path.join(out_dir, os.path.splitext(os.path.basename(img))[0] + ".txt")
        try:
            if has_entry_script:
                # If a script exists, run it and capture output. Assumes it prints recognized text to stdout.
                # Prefer 'recognize.py' with an interface: python recognize.py --image <img>
                script = entrypoints[0] if os.path.isfile(entrypoints[0]) else entrypoints[1]
                result = subprocess.run([
                    sys.executable, script, "--image", img
                ], capture_output=True, text=True, check=False)
                text_out = result.stdout.strip()
                if not text_out:
                    # If script didn't return text, fallback to Tesseract
                    raise RuntimeError("DL script returned empty output; using Tesseract fallback")
                with open(out_txt, "w", encoding="utf-8") as f:
                    f.write(text_out + "\n")
            else:
                # Tesseract fallback for Arabic
                # psm 6: Assume a uniform block of text; oem 1: LSTM.
                tmp_base = os.path.join(out_dir, "tmp_" + os.path.splitext(os.path.basename(img))[0])
                cmd = [
                    tesseract_cmd, img, tmp_base, "-l", args.lang,
                    "--psm", "6", "--oem", "1", "-c", "preserve_interword_spaces=1"
                ]
                subprocess.run(cmd, check=False)
                # Tesseract writes tmp_base.txt
                tess_txt = tmp_base + ".txt"
                if os.path.exists(tess_txt):
                    os.replace(tess_txt, out_txt)
                else:
                    with open(out_txt, "w", encoding="utf-8") as f:
                        f.write("")
            print_progress(img, idx, total)
        except Exception as e:
            # Write error info but continue processing other images
            with open(out_txt, "w", encoding="utf-8") as f:
                f.write("")
            print(f"ERROR {os.path.basename(img)}: {e}", file=sys.stderr, flush=True)
            print_progress(img, idx, total)

    # Signal completion with exit code 0
    sys.exit(0)

if __name__ == "__main__":
    main()