import argparse
import io
import os
import re
import sys


IMAGE_MODES = {
    "gundam": {"base_size": 1024, "image_size": 640, "crop_mode": True},
    "base": {"base_size": 1024, "image_size": 1024, "crop_mode": False},
}


def utf8_stdio():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        try:
            sys.stdout = io.TextIOWrapper(
                sys.stdout.buffer, encoding="utf-8", errors="replace"
            )
        except Exception:
            pass
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        try:
            sys.stderr = io.TextIOWrapper(
                sys.stderr.buffer, encoding="utf-8", errors="replace"
            )
        except Exception:
            pass


def ensure_dir(path):
    if not os.path.isdir(path):
        os.makedirs(path, exist_ok=True)


def base_no_ext(path):
    return os.path.splitext(os.path.basename(path))[0]


def list_images(dir_path):
    exts = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}
    files = []
    for name in os.listdir(dir_path):
        file_path = os.path.join(dir_path, name)
        if os.path.isfile(file_path) and os.path.splitext(name.lower())[1] in exts:
            files.append(file_path)

    def natural_key(path_value):
        parts = re.split(r"(\d+)", os.path.basename(path_value))
        return [int(part) if part.isdigit() else part.lower() for part in parts]

    files.sort(key=natural_key)
    return files


def pick_device(requested):
    import torch

    if requested and requested != "auto":
        if requested == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("CUDA dipilih tapi GPU CUDA tidak tersedia.")
        if requested == "mps" and not torch.backends.mps.is_available():
            raise RuntimeError("MPS dipilih tapi tidak tersedia.")
        return requested
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def get_torch_dtype(device):
    import torch

    if device == "cuda":
        return torch.bfloat16
    if device == "mps":
        return torch.float16
    return torch.float32


def ensure_local_snapshot(model_dir, device):
    if not model_dir:
        raise RuntimeError("Parameter --model-dir wajib diisi.")
    if not os.path.isdir(model_dir):
        raise RuntimeError(f"Folder model tidak ditemukan: {model_dir}")
    config_path = os.path.join(model_dir, "config.json")
    if not os.path.isfile(config_path):
        raise RuntimeError(
            "Snapshot lokal Unlimited-OCR tidak valid: config.json tidak ditemukan."
        )
    modeling_path = os.path.join(model_dir, "modeling_unlimitedocr.py")
    if device != "cuda" and os.path.isfile(modeling_path):
        try:
            content = open(modeling_path, "r", encoding="utf-8").read()
        except Exception:
            content = ""
        if ".cuda()" in content:
            raise RuntimeError(
                "Snapshot model masih hardcoded ke CUDA. Untuk CPU/MPS, patch dulu snapshot lokalnya."
            )


def load_model(model_dir, device):
    import torch
    from transformers import AutoModel, AutoTokenizer

    dtype = get_torch_dtype(device)
    tokenizer = AutoTokenizer.from_pretrained(
        model_dir,
        trust_remote_code=True,
        local_files_only=True,
    )
    model = AutoModel.from_pretrained(
        model_dir,
        trust_remote_code=True,
        local_files_only=True,
        use_safetensors=True,
        torch_dtype=dtype,
        attn_implementation="eager",
        low_cpu_mem_usage=True,
    )
    if device == "mps":
        os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    return tokenizer, model.eval().to(device)


def run_one(model, tokenizer, image_path, output_dir, image_mode, max_length):
    import torch

    mode = IMAGE_MODES[image_mode]
    with torch.no_grad():
        result = model.infer(
            tokenizer,
            prompt="<image>document parsing.",
            image_file=image_path,
            output_path=output_dir,
            base_size=mode["base_size"],
            image_size=mode["image_size"],
            crop_mode=mode["crop_mode"],
            no_repeat_ngram_size=35,
            ngram_window=128,
            max_length=max_length,
            save_results=False,
            eval_mode=True,
        )
    text = "" if result is None else str(result)
    out_path = os.path.join(output_dir, base_no_ext(image_path) + ".txt")
    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write(text)
    return out_path, text


def main():
    utf8_stdio()
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=False)
    parser.add_argument("--output", required=True)
    parser.add_argument("--file", required=False, help="Single image file to process")
    parser.add_argument("--model-dir", required=True)
    parser.add_argument(
        "--device", choices=("auto", "cuda", "mps", "cpu"), default="auto"
    )
    parser.add_argument(
        "--image-mode", choices=tuple(IMAGE_MODES.keys()), default="gundam"
    )
    parser.add_argument("--max-length", type=int, default=8192)
    args = parser.parse_args()

    if not args.input and not args.file:
        print("Either --input or --file is required", file=sys.stderr)
        sys.exit(1)

    ensure_dir(args.output)
    images = []
    if args.file:
        if not os.path.exists(args.file):
            print(f"File not found: {args.file}", file=sys.stderr)
            sys.exit(1)
        images = [args.file]
    else:
        images = list_images(args.input)

    print(f"TOTAL {len(images)}", flush=True)
    if not images:
        print("Unlimited-OCR: no images found", file=sys.stderr, flush=True)
        sys.exit(2)

    try:
        device = pick_device(args.device)
        ensure_local_snapshot(args.model_dir, device)
        tokenizer, model = load_model(args.model_dir, device)
    except Exception as exc:
        print(f"Failed to initialize Unlimited-OCR: {exc}", file=sys.stderr, flush=True)
        sys.exit(3)

    total = len(images)
    for idx, image_path in enumerate(images, start=1):
        try:
            run_one(
                model=model,
                tokenizer=tokenizer,
                image_path=image_path,
                output_dir=args.output,
                image_mode=args.image_mode,
                max_length=args.max_length,
            )
        except Exception as exc:
            out_path = os.path.join(args.output, base_no_ext(image_path) + ".txt")
            with open(out_path, "w", encoding="utf-8") as handle:
                handle.write("")
            print(
                f"Error processing {os.path.basename(image_path)}: {exc}",
                file=sys.stderr,
                flush=True,
            )
        print(f"PROGRESS {os.path.basename(image_path)} {idx} {total}", flush=True)

    sys.exit(0)


if __name__ == "__main__":
    main()
