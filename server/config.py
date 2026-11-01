from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

DATA_DIR = Path(os.getenv("BLACKBOX_DATA_DIR", ROOT / "data")).resolve()
UPLOAD_DIR = DATA_DIR / "uploads"
DATABASE_PATH = DATA_DIR / "blackbox.sqlite3"
MODEL_API_BASE_URL = "https://api.meta.ai/v1"
MODEL_API_KEY = os.getenv("MODEL_API_KEY", "").strip()
MUSE_MODEL = os.getenv("MUSE_MODEL", "muse-spark-1.3").strip()
SAM_MODEL = os.getenv("SAM_MODEL", "sam-3.1").strip()
MAX_UPLOAD_BYTES = min(100 * 1024 * 1024, int(os.getenv("BLACKBOX_MAX_UPLOAD_BYTES", str(100 * 1024 * 1024))))
MAX_CLIP_SECONDS = min(15, int(os.getenv("BLACKBOX_MAX_CLIP_SECONDS", "15")))
MAX_VIDEO_DIMENSION = min(1920, int(os.getenv("BLACKBOX_MAX_VIDEO_DIMENSION", "1920")))
MAX_VIDEO_PIXELS = min(1920 * 1080, int(os.getenv("BLACKBOX_MAX_VIDEO_PIXELS", str(1920 * 1080))))
MAX_VIDEO_FPS = min(60.0, float(os.getenv("BLACKBOX_MAX_VIDEO_FPS", "60")))

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
