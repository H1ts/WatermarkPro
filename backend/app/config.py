import os

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/data/uploads")
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "/data/outputs")
HLS_DIR = os.getenv("HLS_DIR", "/data/hls")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
BASE_URL = os.getenv("BASE_URL", "http://localhost")

# SMTP (email-нотификации, опционально)
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "noreply@watermarkpro.ru")
