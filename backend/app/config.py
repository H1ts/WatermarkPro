import os

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/data/uploads")
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "/data/outputs")
HLS_DIR = os.getenv("HLS_DIR", "/data/hls")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
BASE_URL = os.getenv("BASE_URL", "http://localhost")
