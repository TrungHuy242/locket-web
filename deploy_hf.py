"""Upload Locket Web to a Hugging Face Docker Space safely (never uploads backend/data or .env).

Usage:
    set HF_TOKEN=hf_...                     (Windows PowerShell: $env:HF_TOKEN="hf_...")
    python deploy_hf.py <username>/<space>
"""
from __future__ import annotations

import argparse
import getpass
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

IGNORE_PATTERNS = [
    "backend/data/**",
    "backend/data/*",
    "backend/tests/**",
    ".env",
    ".env.*",
    "locketlam_session.json",
    "chat_history.json",
    "my_moments_*.json",
    "**/.git/**",
    "**/.git/*",
    ".git/**",
    "**/__pycache__/**",
    "**/*.pyc",
    ".pytest_cache/**",
    ".claude/**",
    "frontend/node_modules/**",
    "frontend/dist/**",
    "vendor/locketlam/assets/**",
    "vendor/locketlam/examples/**",
    "vendor/locketlam/tests/**",
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload Locket Web to a Hugging Face Docker Space.")
    parser.add_argument("space_id", help="Target Space id, e.g. yourname/locket-web")
    parser.add_argument("--message", "-m", default="Deploy Locket Web", help="Commit message")
    args = parser.parse_args()

    try:
        from huggingface_hub import HfApi
    except ImportError:
        print("Thieu thu vien huggingface_hub. Chay: pip install huggingface_hub", file=sys.stderr)
        sys.exit(1)

    token = (os.environ.get("HF_TOKEN") or "").strip()
    if not token:
        token = getpass.getpass("Nhap HF_TOKEN (khong hien ky tu): ").strip()
    if not token:
        print("Chua co HF_TOKEN.", file=sys.stderr)
        sys.exit(1)

    api = HfApi(token=token)
    print(f"Dang tai ma nguon len Space https://huggingface.co/spaces/{args.space_id} ...")
    print("(Tu dong bo qua backend/data/, .env, node_modules/, frontend/dist/ va .git/)")
    api.upload_folder(
        folder_path=str(ROOT),
        repo_id=args.space_id,
        repo_type="space",
        commit_message=args.message,
        ignore_patterns=IGNORE_PATTERNS,
        delete_patterns=["backend/app/**", "frontend/src/**", "frontend/public/**"],
    )
    slug = args.space_id.lower().replace("/", "-").replace("_", "-")
    print()
    print("Da day len thanh cong!")
    print(f"  Theo doi build logs: https://huggingface.co/spaces/{args.space_id}?logs=build")
    print(f"  Mo ung dung truc tiep (khong dung iframe): https://{slug}.hf.space")


if __name__ == "__main__":
    main()
