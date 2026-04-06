import logging
import asyncio
from concurrent.futures import ThreadPoolExecutor

import boto3
from botocore.exceptions import ClientError
from sqlalchemy.orm import Session

from app.config import settings

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=2)

EMAIL_STRINGS = {
    "en": {
        "order_received_subject": "Your Order Has Been Received!",
        "greeting": "Dear {name},",
        "order_received_body": "We have received your order and will get back to you shortly regarding the payment.",
        "order_details_heading": "Here are your order details:",
        "closing": "We're excited to see you on our screens!",
        "best_regards": "Best regards,",
        "reference": "Reference",
        "location": "Location",
        "dates": "Dates",
        "total_amount": "Total Amount",
        "confirmed_subject": "Your Order Has Been Confirmed!",
        "confirmed_body": "Great news! Your order and payment have been successfully confirmed.",
        "confirmed_closing": "We look forward to seeing you on our screens!",
        "admin_new_booking_subject": "New booking received",
        "admin_new_campaign_subject": "New campaign booking received",
        "customer": "Customer",
        "email": "Email",
        "phone": "Phone",
        "campaign_received_subject": "Your Campaign Order Has Been Received!",
        "campaign_received_body": "We have received your campaign order with {count} spaces and will get back to you shortly regarding the payment.",
        "campaign_summary": "Here are your campaign details:",
        "space": "Space",
    },
    "he": {
        "order_received_subject": "ההזמנה שלך התקבלה!",
        "greeting": "{name} שלום,",
        "order_received_body": "קיבלנו את ההזמנה שלך ונחזור אליך בהקדם בנוגע לתשלום.",
        "order_details_heading": ":פרטי ההזמנה שלך",
        "closing": "!מצפים לראות אותך על המסכים שלנו",
        "best_regards": ",בברכה",
        "reference": "מספר הזמנה",
        "location": "מיקום",
        "dates": "תאריכים",
        "total_amount": "סכום כולל",
        "confirmed_subject": "ההזמנה שלך אושרה!",
        "confirmed_body": "!חדשות טובות! ההזמנה והתשלום שלך אושרו בהצלחה",
        "confirmed_closing": "!מצפים לראות אותך על המסכים שלנו",
        "admin_new_booking_subject": "הזמנה חדשה התקבלה",
        "admin_new_campaign_subject": "הזמנת קמפיין חדשה התקבלה",
        "customer": "לקוח",
        "email": "אימייל",
        "phone": "טלפון",
        "campaign_received_subject": "הזמנת הקמפיין שלך התקבלה!",
        "campaign_received_body": "קיבלנו את הזמנת הקמפיין שלך עם {count} מסכים ונחזור אליך בהקדם בנוגע לתשלום.",
        "campaign_summary": ":פרטי הקמפיין שלך",
        "space": "מסך",
    },
}


def _get_ses_client():
    if not settings.AWS_ACCESS_KEY_ID or not settings.AWS_SECRET_ACCESS_KEY:
        return None
    return boto3.client(
        "ses",
        region_name=settings.AWS_SES_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
    )


def send_email(to: str, subject: str, html_body: str) -> bool:
    try:
        client = _get_ses_client()
        if not client:
            logger.warning("SES not configured — skipping email to %s", to)
            return False
        if not settings.SES_SENDER_EMAIL:
            logger.warning("SES_SENDER_EMAIL not set — skipping email to %s", to)
            return False
        client.send_email(
            Source=settings.SES_SENDER_EMAIL,
            Destination={"ToAddresses": [to]},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {"Html": {"Data": html_body, "Charset": "UTF-8"}},
            },
        )
        logger.info("Email sent to %s subject=%s", to, subject)
        return True
    except ClientError as e:
        logger.error("SES send failed to %s: %s", to, e)
        return False
    except Exception as e:
        logger.error("Unexpected email error to %s: %s", to, e)
        return False


def send_email_background(to: str, subject: str, html_body: str):
    try:
        loop = asyncio.get_event_loop()
        loop.run_in_executor(_executor, send_email, to, subject, html_body)
    except RuntimeError:
        _executor.submit(send_email, to, subject, html_body)


# ── Logo (inline SVG-safe text logo for email clients) ──────────────

_LOGO_HTML = """<table cellpadding="0" cellspacing="0" style="margin:0 auto;">
<tr>
<td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:28px;font-weight:800;color:#242424;letter-spacing:-0.5px;">Leads</td>
<td style="padding-left:4px;vertical-align:middle;">
<div style="width:10px;height:10px;background:#e61e4d;border-radius:50%;display:inline-block;"></div>
</td>
</tr>
</table>"""


# ── Base HTML wrapper ────────────────────────────────────────────────

def _base_html(content: str, lang: str = "en") -> str:
    direction = "rtl" if lang == "he" else "ltr"
    align = "right" if lang == "he" else "left"
    return f"""<!DOCTYPE html>
<html lang="{lang}" dir="{direction}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f2f2f2;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;padding:48px 20px;">
<tr><td align="center">

<!-- Main card -->
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.06),0 8px 40px rgba(0,0,0,0.04);">

<!-- Content -->
<tr><td style="padding:48px 44px 32px;text-align:{align};direction:{direction};">
{content}
</td></tr>

<!-- Footer / Logo -->
<tr><td style="padding:28px 44px 36px;text-align:center;border-top:1px solid #f0f0f0;">
{_LOGO_HTML}
<p style="margin:8px 0 0;font-size:12px;color:#b0b0b0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">&copy; 2026 Leads. All rights reserved.</p>
</td></tr>

</table>
<!-- /Main card -->

</td></tr>
</table>
</body>
</html>"""


# ── Details card (order details inside a subtle card) ────────────────

def _details_card(rows: list[tuple[str, str]], lang: str = "en") -> str:
    align = "right" if lang == "he" else "left"
    html = f"""<table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;background:#f9f9f9;border-radius:12px;overflow:hidden;">"""
    for i, (label, value) in enumerate(rows):
        border = "border-bottom:1px solid #efefef;" if i < len(rows) - 1 else ""
        html += f"""<tr>
<td style="padding:14px 20px;{border}font-size:13px;color:#888;font-weight:600;text-align:{align};width:38%;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{label}</td>
<td style="padding:14px 20px;{border}font-size:14px;color:#222;font-weight:500;text-align:{align};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{value}</td>
</tr>"""
    html += "</table>"
    return html


# ── Campaign orders table ────────────────────────────────────────────

def _orders_table(orders_with_spaces: list[tuple], lang: str = "en") -> str:
    s = EMAIL_STRINGS.get(lang, EMAIL_STRINGS["en"])
    align = "right" if lang == "he" else "left"

    html = f"""<table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;background:#f9f9f9;border-radius:12px;overflow:hidden;">"""
    # Header
    html += f"""<tr style="background:#f2f2f2;">
<td style="padding:12px 16px;text-align:{align};font-size:11px;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{s["space"]}</td>
<td style="padding:12px 16px;text-align:{align};font-size:11px;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{s["reference"]}</td>
<td style="padding:12px 16px;text-align:{align};font-size:11px;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{s["dates"]}</td>
<td style="padding:12px 16px;text-align:{align};font-size:11px;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{s["total_amount"]}</td>
</tr>"""

    for i, (order, space) in enumerate(orders_with_spaces):
        border = "border-bottom:1px solid #efefef;" if i < len(orders_with_spaces) - 1 else ""
        html += f"""<tr>
<td style="padding:12px 16px;{border}font-size:13px;color:#222;text-align:{align};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{space.name if space else '—'}</td>
<td style="padding:12px 16px;{border}font-size:13px;color:#666;text-align:{align};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{order.reference_number}</td>
<td style="padding:12px 16px;{border}font-size:13px;color:#666;text-align:{align};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{order.start_date} — {order.end_date}</td>
<td style="padding:12px 16px;{border}font-size:13px;color:#222;font-weight:600;text-align:{align};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">&#8362;{order.total_cost:,.2f}</td>
</tr>"""

    # Total row
    total = sum(float(o.total_cost) for o, _ in orders_with_spaces)
    html += f"""<tr style="background:#f2f2f2;">
<td colspan="3" style="padding:14px 16px;font-size:14px;color:#222;font-weight:700;text-align:{align};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{s["total_amount"]}</td>
<td style="padding:14px 16px;font-size:15px;color:#e61e4d;font-weight:700;text-align:{align};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">&#8362;{total:,.2f}</td>
</tr>"""
    html += "</table>"
    return html


# ── Email builders ───────────────────────────────────────────────────

def build_booking_created_customer_email(order, user, space, lang: str = "en") -> tuple[str, str]:
    s = EMAIL_STRINGS.get(lang, EMAIL_STRINGS["en"])
    subject = s["order_received_subject"]
    name = user.name if user else "Customer"
    greeting = s["greeting"].replace("{name}", name)

    rows = [
        (s["reference"], order.reference_number),
        (s["location"], space.name if space else "—"),
        (s["dates"], f"{order.start_date} — {order.end_date}"),
        (s["total_amount"], f"&#8362;{order.total_cost:,.2f}"),
    ]

    content = f"""
<p style="margin:0 0 20px;font-size:16px;color:#222;font-weight:600;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{greeting}</p>
<p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{s["order_received_body"]}</p>
<p style="margin:0 0 4px;font-size:14px;color:#222;font-weight:700;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{s["order_details_heading"]}</p>
{_details_card(rows, lang)}
<p style="margin:28px 0 0;font-size:15px;color:#555;line-height:1.7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{s["closing"]}</p>
<p style="margin:24px 0 0;font-size:14px;color:#888;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{s["best_regards"]}</p>
"""
    return subject, _base_html(content, lang)


def build_booking_created_admin_email(order, user, space) -> tuple[str, str]:
    s = EMAIL_STRINGS["en"]
    subject = f"{s['admin_new_booking_subject']} — {order.reference_number}"

    customer_rows = [
        (s["customer"], user.name if user else "—"),
        (s["email"], user.email if user else "—"),
        (s["phone"], user.phone_number if user and user.phone_number else "—"),
    ]
    order_rows = [
        (s["reference"], order.reference_number),
        (s["location"], space.name if space else "—"),
        (s["dates"], f"{order.start_date} — {order.end_date}"),
        (s["total_amount"], f"&#8362;{order.total_cost:,.2f}"),
    ]

    content = f"""
<p style="margin:0 0 20px;font-size:16px;color:#222;font-weight:600;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">New Booking Received</p>
<p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">A new booking has been placed and is awaiting confirmation.</p>
<p style="margin:0 0 4px;font-size:14px;color:#222;font-weight:700;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">Customer Info</p>
{_details_card(customer_rows, "en")}
<p style="margin:28px 0 4px;font-size:14px;color:#222;font-weight:700;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">Order Details</p>
{_details_card(order_rows, "en")}
"""
    return subject, _base_html(content, "en")


def build_booking_confirmed_email(order, user, space, lang: str = "en") -> tuple[str, str]:
    s = EMAIL_STRINGS.get(lang, EMAIL_STRINGS["en"])
    subject = s["confirmed_subject"]
    name = user.name if user else "Customer"
    greeting = s["greeting"].replace("{name}", name)

    rows = [
        (s["reference"], order.reference_number),
        (s["location"], space.name if space else "—"),
        (s["dates"], f"{order.start_date} — {order.end_date}"),
        (s["total_amount"], f"&#8362;{order.total_cost:,.2f}"),
    ]

    content = f"""
<p style="margin:0 0 20px;font-size:16px;color:#222;font-weight:600;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{greeting}</p>
<p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{s["confirmed_body"]}</p>
<p style="margin:0 0 4px;font-size:14px;color:#222;font-weight:700;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{s["order_details_heading"]}</p>
{_details_card(rows, lang)}
<p style="margin:28px 0 0;font-size:15px;color:#555;line-height:1.7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{s["confirmed_closing"]}</p>
<p style="margin:24px 0 0;font-size:14px;color:#888;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{s["best_regards"]}</p>
"""
    return subject, _base_html(content, lang)


def build_campaign_created_customer_email(orders_with_spaces: list[tuple], user, lang: str = "en") -> tuple[str, str]:
    s = EMAIL_STRINGS.get(lang, EMAIL_STRINGS["en"])
    subject = s["campaign_received_subject"]
    name = user.name if user else "Customer"
    greeting = s["greeting"].replace("{name}", name)
    count = len(orders_with_spaces)
    body = s["campaign_received_body"].replace("{count}", str(count))

    content = f"""
<p style="margin:0 0 20px;font-size:16px;color:#222;font-weight:600;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{greeting}</p>
<p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{body}</p>
<p style="margin:0 0 4px;font-size:14px;color:#222;font-weight:700;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{s["campaign_summary"]}</p>
{_orders_table(orders_with_spaces, lang)}
<p style="margin:28px 0 0;font-size:15px;color:#555;line-height:1.7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{s["closing"]}</p>
<p style="margin:24px 0 0;font-size:14px;color:#888;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{s["best_regards"]}</p>
"""
    return subject, _base_html(content, lang)


def build_campaign_created_admin_email(orders_with_spaces: list[tuple], user) -> tuple[str, str]:
    s = EMAIL_STRINGS["en"]
    count = len(orders_with_spaces)
    subject = f"{s['admin_new_campaign_subject']} — {count} spaces"

    customer_rows = [
        (s["customer"], user.name if user else "—"),
        (s["email"], user.email if user else "—"),
        (s["phone"], user.phone_number if user and user.phone_number else "—"),
    ]

    content = f"""
<p style="margin:0 0 20px;font-size:16px;color:#222;font-weight:600;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">New Campaign Booking Received</p>
<p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">A new campaign booking with {count} spaces has been placed and is awaiting confirmation.</p>
<p style="margin:0 0 4px;font-size:14px;color:#222;font-weight:700;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">Customer Info</p>
{_details_card(customer_rows, "en")}
<p style="margin:28px 0 4px;font-size:14px;color:#222;font-weight:700;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">Order Details</p>
{_orders_table(orders_with_spaces, "en")}
"""
    return subject, _base_html(content, "en")


# ── Toggle helper ────────────────────────────────────────────────────

def is_email_enabled(db: Session) -> bool:
    from app.models.app_settings import AppSetting
    row = db.query(AppSetting).filter(AppSetting.key == "emails_enabled").first()
    if row is None:
        return True  # default: enabled
    return row.value.lower() == "true"


# ── Send helpers ─────────────────────────────────────────────────────

def send_booking_created_emails(order, user, space, db: Session | None = None):
    if db and not is_email_enabled(db):
        logger.info("Email sending disabled — skipping booking created emails for order %s", order.reference_number)
        return

    # Admin email only (includes customer info + order details)
    if settings.ADMIN_EMAIL:
        admin_subj, admin_html = build_booking_created_admin_email(order, user, space)
        send_email_background(settings.ADMIN_EMAIL, admin_subj, admin_html)


def send_booking_confirmed_email(order, user, space, db: Session | None = None):
    if db and not is_email_enabled(db):
        logger.info("Email sending disabled — skipping booking confirmed email for order %s", order.reference_number)
        return

    lang = getattr(user, "language", "en") or "en"
    subj, html = build_booking_confirmed_email(order, user, space, lang)
    if user and user.email:
        send_email_background(user.email, subj, html)


def send_campaign_created_emails(orders_with_spaces: list[tuple], user, db: Session | None = None):
    if db and not is_email_enabled(db):
        logger.info("Email sending disabled — skipping campaign created emails")
        return

    # Admin email only (includes customer info + order details table)
    if settings.ADMIN_EMAIL:
        admin_subj, admin_html = build_campaign_created_admin_email(orders_with_spaces, user)
        send_email_background(settings.ADMIN_EMAIL, admin_subj, admin_html)
