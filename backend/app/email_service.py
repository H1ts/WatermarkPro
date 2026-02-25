"""Email-нотификации для WatermarkPro.

Отправляет HTML-письма через SMTP при ключевых событиях:
  - Рендер завершён
  - Новый комментарий
  - Статус ревью изменён

Если SMTP_HOST не задан — все функции тихо пропускают отправку.
"""

import asyncio
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from .config import SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, BASE_URL

logger = logging.getLogger("watermarkpro.email")


def _smtp_configured() -> bool:
    return bool(SMTP_HOST)


def _send_email(to: str, subject: str, html: str):
    """Синхронная отправка через SMTP (вызывается в потоке)."""
    if not _smtp_configured() or not to:
        return

    msg = MIMEMultipart("alternative")
    msg["From"] = SMTP_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.attach(MIMEText(html, "html", "utf-8"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as srv:
            srv.ehlo()
            if SMTP_PORT != 25:
                srv.starttls()
                srv.ehlo()
            if SMTP_USER:
                srv.login(SMTP_USER, SMTP_PASSWORD)
            srv.sendmail(SMTP_FROM, [to], msg.as_string())
        logger.info("Email sent to %s: %s", to, subject)
    except Exception:
        logger.exception("Failed to send email to %s", to)


async def send_email_async(to: str, subject: str, html: str):
    """Асинхронная обёртка — отправляет в thread pool, не блокирует event loop."""
    if not _smtp_configured() or not to:
        return
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _send_email, to, subject, html)


# ── HTML-шаблоны ──────────────────────────────────────────────────────

_STYLE = """
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #0a0a0f; color: #e2e2e8; margin: 0; padding: 0; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 32px 20px; }
  .header { text-align: center; margin-bottom: 24px; }
  .logo { font-size: 22px; font-weight: 700;
          background: linear-gradient(135deg, #7c3aed, #a78bfa);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .card { background: #12121a; border: 1px solid #2a2a3e; border-radius: 12px;
          padding: 24px; margin-bottom: 16px; }
  .card h2 { font-size: 18px; margin: 0 0 12px; }
  .card p { font-size: 14px; color: #8b8ba0; margin: 4px 0; line-height: 1.5; }
  .btn { display: inline-block; padding: 12px 28px; border-radius: 8px;
         background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff;
         text-decoration: none; font-weight: 600; font-size: 14px;
         margin-top: 16px; }
  .badge { display: inline-block; padding: 4px 12px; border-radius: 6px;
           font-size: 12px; font-weight: 600; }
  .badge-approved { background: #0a2618; color: #4ade80; border: 1px solid #166534; }
  .badge-revision { background: #2d1215; color: #fca5a5; border: 1px solid #7f1d1d; }
  .badge-pending { background: #1a1a2e; color: #8b8ba0; border: 1px solid #2a2a3e; }
  .footer { text-align: center; font-size: 12px; color: #4a4a5e; margin-top: 24px; }
</style>
"""


def _wrap(content: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8">{_STYLE}</head>
<body>
<div class="wrap">
  <div class="header"><span class="logo">WatermarkPro</span></div>
  {content}
  <p class="footer">WatermarkPro — защита видеоконтента для кинопродакшена</p>
</div>
</body>
</html>"""


def render_done_html(filename: str, client_name: str, job_id: str) -> str:
    review_url = f"{BASE_URL}/review/{job_id}"
    share_url = f"{BASE_URL}/share/{job_id}"
    return _wrap(f"""
    <div class="card">
      <h2>Видео готово!</h2>
      <p><strong>Файл:</strong> {filename}</p>
      <p><strong>Клиент:</strong> {client_name}</p>
      <a href="{review_url}" class="btn">Открыть рецензирование</a>
    </div>
    <div class="card">
      <p>Ссылка для клиента:</p>
      <p><a href="{share_url}" style="color: #a78bfa;">{share_url}</a></p>
    </div>
    """)


def new_comment_html(filename: str, author: str, text: str,
                     timecode_str: str, job_id: str) -> str:
    review_url = f"{BASE_URL}/review/{job_id}"
    return _wrap(f"""
    <div class="card">
      <h2>Новый комментарий</h2>
      <p><strong>Файл:</strong> {filename}</p>
      <p><strong>Автор:</strong> {author}</p>
      <p><strong>Таймкод:</strong> {timecode_str}</p>
      <p style="color: #e2e2e8; margin-top: 12px;">{text or '(рисунок без текста)'}</p>
      <a href="{review_url}" class="btn">Открыть рецензию</a>
    </div>
    """)


def status_change_html(filename: str, new_status: str, job_id: str) -> str:
    review_url = f"{BASE_URL}/review/{job_id}"
    labels = {
        "approved": ("Утверждено", "badge-approved"),
        "needs_revision": ("Нужны правки", "badge-revision"),
        "pending_review": ("На рецензии", "badge-pending"),
    }
    label, badge_cls = labels.get(new_status, (new_status, "badge-pending"))
    return _wrap(f"""
    <div class="card">
      <h2>Статус ревью изменён</h2>
      <p><strong>Файл:</strong> {filename}</p>
      <p style="margin-top: 12px;">
        Новый статус: <span class="badge {badge_cls}">{label}</span>
      </p>
      <a href="{review_url}" class="btn">Открыть рецензию</a>
    </div>
    """)
