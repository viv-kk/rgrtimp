from datetime import datetime, timedelta, timezone
from enum import Enum
import base64
from email.message import EmailMessage
import hashlib
import hmac
import io
import os
import secrets
import smtplib
import uuid

import jwt
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from passlib.context import CryptContext
from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict
import qrcode
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, create_engine, func, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

load_dotenv()


DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://postgres:postgres@localhost:5433/event_security",
)
JWT_SECRET = os.getenv("JWT_SECRET", "dev_secret_change_me")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "720"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "14"))
MAX_FAILED_LOGIN_ATTEMPTS = int(os.getenv("MAX_FAILED_LOGIN_ATTEMPTS", "5"))
LOGIN_LOCK_MINUTES = int(os.getenv("LOGIN_LOCK_MINUTES", "15"))
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USER)
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() == "true"
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "ChangeMe_Admin_Password_123!")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
LOGIN_ATTEMPTS: dict[str, dict] = {}


class Base(DeclarativeBase):
    pass


class UserRole(str, Enum):
    admin = "admin"
    cashier = "cashier"


class TicketStatus(str, Enum):
    sold = "sold"
    used = "used"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default=UserRole.cashier.value)


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(120))
    venue_name: Mapped[str] = mapped_column(String(120))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))

    tickets: Mapped[list["Ticket"]] = relationship(back_populates="event")


class Venue(Base):
    __tablename__ = "venues"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))


class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    ticket_uuid: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), index=True)
    seat_label: Mapped[str | None] = mapped_column(String(30), nullable=True)
    buyer_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    price: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(20), default=TicketStatus.sold.value)
    qr_token: Mapped[str] = mapped_column(String(600), unique=True)
    sold_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    sold_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    event: Mapped[Event] = relationship(back_populates="tickets")


class GateScanLog(Base):
    __tablename__ = "gate_scan_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    ticket_id: Mapped[int | None] = mapped_column(ForeignKey("tickets.id"), nullable=True)
    scanned_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    decision: Mapped[str] = mapped_column(String(20))
    reason: Mapped[str] = mapped_column(String(255))
    scanned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class CashierRegistrationRequest(Base):
    __tablename__ = "cashier_registration_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class SystemAuditLog(Base):
    __tablename__ = "system_audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    event_type: Mapped[str] = mapped_column(String(40), index=True)
    actor: Mapped[str] = mapped_column(String(50))
    action: Mapped[str] = mapped_column(String(120))
    details: Mapped[str] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    model_config = ConfigDict(from_attributes=True)


class EventCreate(BaseModel):
    title: str
    venue_id: int
    starts_at: datetime


class EventUpdate(BaseModel):
    title: str
    venue_id: int
    starts_at: datetime


class EventOut(BaseModel):
    id: int
    title: str
    venue_id: int | None = None
    venue_name: str
    starts_at: datetime
    model_config = ConfigDict(from_attributes=True)


class VenueCreate(BaseModel):
    name: str
    address: str | None = None
    capacity: int | None = None


class VenueUpdate(BaseModel):
    name: str
    address: str | None = None
    capacity: int | None = None


class VenueOut(BaseModel):
    id: int
    name: str
    address: str | None = None
    capacity: int | None = None
    model_config = ConfigDict(from_attributes=True)


class TicketSaleCreate(BaseModel):
    event_id: int
    seat_label: str | None = None
    buyer_name: str | None = None
    price: float


class TicketOut(BaseModel):
    id: int
    ticket_uuid: str
    event_id: int
    status: str
    price: float
    qr_token: str
    short_code: str
    qr_image_base64: str


class TicketBatchSaleCreate(BaseModel):
    event_id: int
    seat_labels: list[str]
    buyer_name: str | None = None
    price_per_ticket: float


class TicketBatchSaleResponse(BaseModel):
    tickets: list[TicketOut]
    quantity: int
    total_price: float


class GateScanRequest(BaseModel):
    scan_value: str | None = None
    qr_token: str | None = None


class GateScanResponse(BaseModel):
    allowed: bool
    message: str
    ticket_id: int | None = None


class TicketEmailRequest(BaseModel):
    email: str
    ticket_ids: list[int] | None = None


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class CashierRegisterRequest(BaseModel):
    username: str
    password: str


class CashierRegistrationRequestOut(BaseModel):
    id: int
    username: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class SeatMapResponse(BaseModel):
    rows: int
    cols: int
    taken_seats: list[str]


class EventStatsResponse(BaseModel):
    event_id: int
    sold_count: int
    checked_in_count: int
    not_checked_in_count: int
    check_in_rate_percent: float
    gate_allow_count: int
    gate_deny_count: int
    repeated_qr_attempts: int


class AuditEventOut(BaseModel):
    timestamp: datetime
    event_type: str
    actor: str
    action: str
    details: str
    extra: dict[str, str] | None = None


class AuditFeedResponse(BaseModel):
    items: list[AuditEventOut]


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role,
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def hash_refresh_token(refresh_token: str) -> str:
    return hashlib.sha256(refresh_token.encode("utf-8")).hexdigest()


def create_refresh_token_record(db: Session, user_id: int) -> str:
    raw_token = secrets.token_urlsafe(48)
    token_record = RefreshToken(
        user_id=user_id,
        token_hash=hash_refresh_token(raw_token),
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(token_record)
    return raw_token


def issue_token_pair(db: Session, user: User) -> TokenResponse:
    access_token = create_access_token(user)
    refresh_token = create_refresh_token_record(db, user.id)
    db.commit()
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


def get_login_lock_seconds(username_key: str) -> int:
    state = LOGIN_ATTEMPTS.get(username_key)
    if not state:
        return 0
    locked_until = state.get("locked_until")
    if not locked_until:
        return 0
    now = datetime.now(timezone.utc)
    if locked_until <= now:
        LOGIN_ATTEMPTS.pop(username_key, None)
        return 0
    return int((locked_until - now).total_seconds())


def register_failed_login(username_key: str) -> None:
    now = datetime.now(timezone.utc)
    state = LOGIN_ATTEMPTS.get(username_key, {"count": 0, "locked_until": None})
    state["count"] = int(state.get("count", 0)) + 1
    if state["count"] >= MAX_FAILED_LOGIN_ATTEMPTS:
        state["locked_until"] = now + timedelta(minutes=LOGIN_LOCK_MINUTES)
        state["count"] = 0
    LOGIN_ATTEMPTS[username_key] = state


def clear_login_attempts(username_key: str) -> None:
    LOGIN_ATTEMPTS.pop(username_key, None)


def create_ticket_token(ticket_uuid: str, event_id: int) -> str:
    payload = {
        "ticket_uuid": ticket_uuid,
        "event_id": event_id,
        "issued_at": datetime.now(timezone.utc).isoformat(),
        "type": "ticket",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def build_qr_png_bytes(qr_value: str) -> bytes:
    qr = qrcode.QRCode(version=1, box_size=8, border=2)
    qr.add_data(qr_value)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()


def build_qr_base64(qr_value: str) -> str:
    return base64.b64encode(build_qr_png_bytes(qr_value)).decode("ascii")


def normalize_seat_label(seat_label: str) -> str:
    return seat_label.strip().upper()


def create_short_ticket_code(ticket_uuid: str) -> str:
    digest = hmac.new(JWT_SECRET.encode("utf-8"), ticket_uuid.encode("utf-8"), hashlib.sha256).hexdigest()
    return str(int(digest[:12], 16) % 100_000_000).zfill(8)


def ticket_to_out(ticket: Ticket) -> TicketOut:
    return TicketOut(
        id=ticket.id,
        ticket_uuid=ticket.ticket_uuid,
        event_id=ticket.event_id,
        status=ticket.status,
        price=ticket.price,
        qr_token=ticket.qr_token,
        short_code=create_short_ticket_code(ticket.ticket_uuid),
        qr_image_base64=build_qr_base64(ticket.qr_token),
    )


def event_to_out(event: Event, venue_id_by_name: dict[str, int]) -> EventOut:
    return EventOut(
        id=event.id,
        title=event.title,
        venue_id=venue_id_by_name.get(event.venue_name),
        venue_name=event.venue_name,
        starts_at=event.starts_at,
    )


def get_pdf_font_names() -> tuple[str, str]:
    regular = "Helvetica"
    bold = "Helvetica-Bold"
    regular_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    bold_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

    try:
        registered_fonts = pdfmetrics.getRegisteredFontNames()
        if "DejaVuSans" not in registered_fonts and os.path.exists(regular_path):
            pdfmetrics.registerFont(TTFont("DejaVuSans", regular_path))
        if "DejaVuSans-Bold" not in registered_fonts and os.path.exists(bold_path):
            pdfmetrics.registerFont(TTFont("DejaVuSans-Bold", bold_path))
        registered_fonts = pdfmetrics.getRegisteredFontNames()
        if "DejaVuSans" in registered_fonts and "DejaVuSans-Bold" in registered_fonts:
            regular = "DejaVuSans"
            bold = "DejaVuSans-Bold"
    except Exception:
        pass

    return regular, bold


def build_ticket_pdf_bytes(
    event_title: str,
    venue_name: str,
    starts_at: datetime,
    ticket_uuid: str,
    seat_label: str | None,
    buyer_name: str | None,
    price: float,
    qr_token: str,
) -> bytes:
    regular_font, bold_font = get_pdf_font_names()
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    # Dark background to match the app visual style.
    pdf.setFillColor(colors.HexColor("#020617"))
    pdf.rect(0, 0, width, height, stroke=0, fill=1)

    try:
        pdf.setFillAlpha(0.22)
    except Exception:
        pass
    pdf.setFillColor(colors.HexColor("#1D4ED8"))
    pdf.circle(70, height - 80, 95, stroke=0, fill=1)
    pdf.setFillColor(colors.HexColor("#4338CA"))
    pdf.circle(width - 65, height - 120, 85, stroke=0, fill=1)
    try:
        pdf.setFillAlpha(1)
    except Exception:
        pass

    margin = 36
    card_x = margin
    card_y = margin
    card_w = width - 2 * margin
    card_h = height - 2 * margin
    pdf.setFillColor(colors.HexColor("#0F172A"))
    pdf.setStrokeColor(colors.HexColor("#334155"))
    pdf.setLineWidth(1)
    pdf.roundRect(card_x, card_y, card_w, card_h, radius=18, stroke=1, fill=1)

    header_h = 90
    pdf.setFillColor(colors.HexColor("#1E3A8A"))
    pdf.roundRect(card_x, card_y + card_h - header_h, card_w, header_h, radius=18, stroke=0, fill=1)
    pdf.rect(card_x, card_y + card_h - header_h, card_w, 18, stroke=0, fill=1)

    pdf.setFillColor(colors.HexColor("#93C5FD"))
    pdf.roundRect(card_x + 24, card_y + card_h - 30, 92, 18, radius=9, stroke=0, fill=1)
    pdf.setFillColor(colors.HexColor("#0F172A"))
    pdf.setFont(bold_font, 9)
    pdf.drawCentredString(card_x + 70, card_y + card_h - 24, "ONE-TIME PASS")

    pdf.setFillColor(colors.white)
    pdf.setFont(bold_font, 24)
    pdf.drawString(card_x + 24, card_y + card_h - 52, "Event Security Ticket")
    pdf.setFont(regular_font, 11)
    pdf.drawString(card_x + 24, card_y + card_h - 72, "One-time QR pass for event entry")

    content_top = card_y + card_h - header_h - 24
    left_x = card_x + 24
    right_x = card_x + card_w - 220

    pdf.setFillColor(colors.HexColor("#1E293B"))
    pdf.roundRect(left_x - 10, content_top - 60, card_w - 260, 72, radius=12, stroke=0, fill=1)
    pdf.setFillColor(colors.HexColor("#BFDBFE"))
    pdf.setFont(bold_font, 11)
    pdf.drawString(left_x, content_top, "Event")
    pdf.setFont(bold_font, 13)
    pdf.setFillColor(colors.HexColor("#F8FAFC"))
    pdf.drawString(left_x, content_top - 18, event_title)
    pdf.setFont(regular_font, 10)
    pdf.setFillColor(colors.HexColor("#CBD5E1"))
    pdf.drawString(left_x, content_top - 34, f"Venue: {venue_name}")
    pdf.drawString(left_x, content_top - 49, f"Start: {starts_at.strftime('%d.%m.%Y %H:%M')}")

    details_y = content_top - 92
    pdf.setFillColor(colors.HexColor("#93C5FD"))
    pdf.setFont(bold_font, 12)
    pdf.drawString(left_x, details_y, "Ticket details")

    pdf.setFont(regular_font, 10)
    rows = [
        ("Entry code", create_short_ticket_code(ticket_uuid)),
        ("Seat", seat_label or "-"),
        ("Visitor", buyer_name or "-"),
        ("Price", f"{price:.2f}"),
    ]
    row_y = details_y - 20
    for label, value in rows:
        row_box_y = row_y - 13
        text_y = row_box_y + 5
        pdf.setFillColor(colors.HexColor("#1E293B"))
        pdf.roundRect(left_x - 6, row_box_y, card_w - 280, 18, radius=8, stroke=0, fill=1)
        pdf.setFillColor(colors.HexColor("#94A3B8"))
        pdf.drawString(left_x, text_y, f"{label}:")
        pdf.setFillColor(colors.HexColor("#F8FAFC"))
        pdf.drawString(left_x + 100, text_y, str(value))
        row_y -= 24

    qr_bytes = build_qr_png_bytes(qr_token)
    qr_img = ImageReader(io.BytesIO(qr_bytes))
    # Fixed geometry to keep QR block crisp and prevent overlap with caption.
    qr_panel_x = right_x - 10
    qr_panel_y = content_top - 215
    qr_panel_w = 180
    qr_panel_h = 202
    qr_size = 160
    qr_img_x = right_x
    qr_img_y = qr_panel_y + 32
    qr_bg_padding = 4
    caption_y = qr_panel_y + 12

    pdf.setFillColor(colors.HexColor("#E2E8F0"))
    pdf.roundRect(qr_panel_x, qr_panel_y, qr_panel_w, qr_panel_h, radius=14, stroke=0, fill=1)
    pdf.setFillColor(colors.white)
    pdf.roundRect(
        qr_img_x - qr_bg_padding,
        qr_img_y - qr_bg_padding,
        qr_size + 2 * qr_bg_padding,
        qr_size + 2 * qr_bg_padding,
        radius=8,
        stroke=0,
        fill=1,
    )
    pdf.drawImage(qr_img, qr_img_x, qr_img_y, width=qr_size, height=qr_size, preserveAspectRatio=True, mask="auto")
    pdf.setFillColor(colors.HexColor("#0F172A"))
    pdf.setFont(regular_font, 9)
    pdf.drawCentredString(right_x + 80, caption_y, "Show this QR at entrance")

    footer_y = card_y + 28
    pdf.setFillColor(colors.HexColor("#334155"))
    pdf.line(card_x + 20, footer_y + 30, card_x + card_w - 20, footer_y + 30)
    pdf.setFillColor(colors.HexColor("#94A3B8"))
    pdf.setFont(regular_font, 9)
    pdf.drawString(card_x + 24, footer_y + 12, "Important: QR can only be used once. Keep this ticket safe.")

    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def send_ticket_email(
    to_email: str,
    event_title: str,
    venue_name: str,
    starts_at: datetime,
    ticket_uuid: str,
    seat_label: str | None,
    buyer_name: str | None,
    price: float,
    qr_token: str,
) -> None:
    if not SMTP_HOST or not SMTP_FROM:
        raise HTTPException(
            status_code=500,
            detail="SMTP не настроен. Заполни SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/SMTP_FROM",
        )

    ticket_pdf = build_ticket_pdf_bytes(
        event_title=event_title,
        venue_name=venue_name,
        starts_at=starts_at,
        ticket_uuid=ticket_uuid,
        seat_label=seat_label,
        buyer_name=buyer_name,
        price=price,
        qr_token=qr_token,
    )
    send_email_with_attachments(
        to_email=to_email,
        subject=f"Билет на мероприятие: {event_title}",
        body=(
            "Ваш билет сформирован.\n\n"
            f"Мероприятие: {event_title}\n"
            f"Площадка: {venue_name}\n"
            f"Начало: {starts_at.isoformat()}\n\n"
            "Во вложении PDF-билет с QR-кодом. Покажите его на входе."
        ),
        attachments=[
            (
                f"ticket_{create_short_ticket_code(ticket_uuid)}.pdf",
                ticket_pdf,
            )
        ],
    )


def send_email_with_attachments(
    to_email: str,
    subject: str,
    body: str,
    attachments: list[tuple[str, bytes]],
) -> None:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to_email
    msg.set_content(body)
    for filename, attachment_bytes in attachments:
        msg.add_attachment(
            attachment_bytes,
            maintype="application",
            subtype="pdf",
            filename=filename,
        )

    if SMTP_USE_TLS:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            if SMTP_USER:
                server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)
    else:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT) as server:
            if SMTP_USER:
                server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)


def send_ticket_bundle_email(
    to_email: str,
    tickets_with_events: list[tuple[Ticket, Event]],
) -> None:
    if not SMTP_HOST or not SMTP_FROM:
        raise HTTPException(
            status_code=500,
            detail="SMTP не настроен. Заполни SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/SMTP_FROM",
        )
    if not tickets_with_events:
        raise HTTPException(status_code=400, detail="Нет билетов для отправки")

    attachments: list[tuple[str, bytes]] = []
    event_titles: set[str] = set()
    for ticket, event in tickets_with_events:
        event_titles.add(event.title)
        ticket_pdf = build_ticket_pdf_bytes(
            event_title=event.title,
            venue_name=event.venue_name,
            starts_at=event.starts_at,
            ticket_uuid=ticket.ticket_uuid,
            seat_label=ticket.seat_label,
            buyer_name=ticket.buyer_name,
            price=ticket.price,
            qr_token=ticket.qr_token,
        )
        attachments.append((f"ticket_{create_short_ticket_code(ticket.ticket_uuid)}.pdf", ticket_pdf))

    subject_event = next(iter(event_titles)) if len(event_titles) == 1 else "несколько мероприятий"
    body_lines = [
        "Ваши билеты сформированы.",
        "",
        f"Количество билетов: {len(attachments)}",
        f"Мероприятие: {subject_event}",
        "",
        "Во вложении PDF-билеты с QR-кодами. Покажите их на входе.",
    ]
    send_email_with_attachments(
        to_email=to_email,
        subject=f"Билеты на мероприятие: {subject_event}",
        body="\n".join(body_lines),
        attachments=attachments,
    )


def decode_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    payload = decode_jwt(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid access token type")

    user = db.get(User, int(payload["sub"]))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_role(*roles: UserRole):
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in [r.value for r in roles]:
            raise HTTPException(status_code=403, detail="Not enough permissions")
        return user

    return checker


def seed_default_users(db: Session) -> None:
    username_taken_by_other = db.scalar(
        select(User).where(User.username == ADMIN_USERNAME, User.role != UserRole.admin.value).limit(1)
    )
    if username_taken_by_other:
        raise RuntimeError(f"ADMIN_USERNAME '{ADMIN_USERNAME}' is already used by non-admin user")

    admin_user = db.scalar(select(User).where(User.role == UserRole.admin.value).limit(1))
    if not admin_user:
        admin_user = User(
            username=ADMIN_USERNAME,
            password_hash=hash_password(ADMIN_PASSWORD),
            role=UserRole.admin.value,
        )
        db.add(admin_user)
        db.commit()
        return

    changed = False
    if admin_user.username != ADMIN_USERNAME:
        admin_user.username = ADMIN_USERNAME
        changed = True
    if not verify_password(ADMIN_PASSWORD, admin_user.password_hash):
        admin_user.password_hash = hash_password(ADMIN_PASSWORD)
        changed = True

    if changed:
        db.commit()


def append_system_audit(
    db: Session,
    *,
    event_type: str,
    actor: str,
    action: str,
    details: str,
) -> None:
    db.add(
        SystemAuditLog(
            event_type=event_type,
            actor=actor,
            action=action,
            details=details,
        )
    )


app = FastAPI(title="Event Security API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_default_users(db)


@app.get("/health")
def healthcheck():
    return {"status": "ok"}


@app.post("/auth/login", response_model=TokenResponse)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    username_key = form_data.username.strip().lower()
    lock_seconds = get_login_lock_seconds(username_key)
    if lock_seconds > 0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Слишком много попыток входа. Повтори через {lock_seconds} сек.",
        )

    user = db.scalar(select(User).where(User.username == form_data.username))
    if not user or not verify_password(form_data.password, user.password_hash):
        register_failed_login(username_key)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    clear_login_attempts(username_key)
    return issue_token_pair(db, user)


@app.post("/auth/cashier-register", status_code=status.HTTP_201_CREATED)
def register_cashier(payload: CashierRegisterRequest, db: Session = Depends(get_db)):
    username = payload.username.strip()
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="Логин должен быть не короче 3 символов")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Пароль должен быть не короче 6 символов")

    existing_user = db.scalar(select(User).where(User.username == username))
    if existing_user:
        raise HTTPException(status_code=409, detail="Пользователь с таким логином уже существует")

    existing_request = db.scalar(select(CashierRegistrationRequest).where(CashierRegistrationRequest.username == username))
    if existing_request:
        raise HTTPException(status_code=409, detail="Заявка с таким логином уже отправлена и ожидает подтверждения")

    request = CashierRegistrationRequest(username=username, password_hash=hash_password(payload.password))
    db.add(request)
    append_system_audit(
        db,
        event_type="cashier_request_submitted",
        actor=username,
        action="Заявка кассира создана",
        details=f"Кассир {username} отправил заявку на регистрацию",
    )
    db.commit()
    return {"ok": True, "message": "Заявка отправлена. Дождитесь подтверждения администратора."}


@app.post("/auth/refresh", response_model=TokenResponse)
def refresh_access_token(payload: RefreshTokenRequest, db: Session = Depends(get_db)):
    refresh_hash = hash_refresh_token(payload.refresh_token)
    token_record = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == refresh_hash))
    now = datetime.now(timezone.utc)
    if not token_record or token_record.revoked_at is not None or token_record.expires_at < now:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    user = db.get(User, token_record.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    token_record.revoked_at = now
    access_token = create_access_token(user)
    new_refresh_token = create_refresh_token_record(db, user.id)
    db.commit()
    return TokenResponse(access_token=access_token, refresh_token=new_refresh_token)


@app.get("/auth/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user


@app.get("/admin/cashier-requests", response_model=list[CashierRegistrationRequestOut])
def list_cashier_requests(
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.admin)),
):
    return db.scalars(select(CashierRegistrationRequest).order_by(CashierRegistrationRequest.created_at.asc())).all()


@app.post("/admin/cashier-requests/{request_id}/approve", response_model=UserOut)
def approve_cashier_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.admin)),
):
    request = db.get(CashierRegistrationRequest, request_id)
    if not request:
        raise HTTPException(status_code=404, detail="Заявка не найдена")

    existing_user = db.scalar(select(User).where(User.username == request.username))
    if existing_user:
        db.delete(request)
        db.commit()
        raise HTTPException(status_code=409, detail="Пользователь с таким логином уже существует")

    user = User(username=request.username, password_hash=request.password_hash, role=UserRole.cashier.value)
    db.add(user)
    append_system_audit(
        db,
        event_type="cashier_request_approved",
        actor=current_user.username,
        action="Заявка кассира подтверждена",
        details=f"Администратор {current_user.username} подтвердил заявку кассира {user.username}",
    )
    db.delete(request)
    db.commit()
    db.refresh(user)
    return user


@app.delete("/admin/cashier-requests/{request_id}")
def reject_cashier_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.admin)),
):
    request = db.get(CashierRegistrationRequest, request_id)
    if not request:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    append_system_audit(
        db,
        event_type="cashier_request_rejected",
        actor=current_user.username,
        action="Заявка кассира отклонена",
        details=f"Администратор отклонил заявку кассира {request.username}",
    )
    db.delete(request)
    db.commit()
    return {"ok": True}


@app.post("/events", response_model=EventOut)
def create_event(
    payload: EventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.admin)),
):
    venue = db.get(Venue, payload.venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")
    event = Event(
        title=payload.title,
        venue_name=venue.name,
        starts_at=payload.starts_at,
        created_by=current_user.id,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return EventOut(id=event.id, title=event.title, venue_id=venue.id, venue_name=event.venue_name, starts_at=event.starts_at)


@app.post("/venues", response_model=VenueOut)
def create_venue(
    payload: VenueCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.admin)),
):
    venue_name = payload.name.strip()
    if not venue_name:
        raise HTTPException(status_code=400, detail="Venue name is required")

    existing = db.scalar(select(Venue).where(Venue.name == venue_name))
    if existing:
        raise HTTPException(status_code=409, detail="Venue with this name already exists")

    venue = Venue(
        name=venue_name,
        address=payload.address.strip() if payload.address else None,
        capacity=payload.capacity,
        created_by=current_user.id,
    )
    db.add(venue)
    db.commit()
    db.refresh(venue)
    return venue


@app.get("/venues", response_model=list[VenueOut])
def list_venues(
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.admin, UserRole.cashier)),
):
    return db.scalars(select(Venue).order_by(Venue.name.asc())).all()


@app.put("/venues/{venue_id}", response_model=VenueOut)
def update_venue(
    venue_id: int,
    payload: VenueUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.admin)),
):
    venue = db.get(Venue, venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")

    venue_name = payload.name.strip()
    if not venue_name:
        raise HTTPException(status_code=400, detail="Venue name is required")

    duplicate = db.scalar(select(Venue).where(Venue.name == venue_name, Venue.id != venue_id))
    if duplicate:
        raise HTTPException(status_code=409, detail="Venue with this name already exists")

    old_name = venue.name
    venue.name = venue_name
    venue.address = payload.address.strip() if payload.address else None
    venue.capacity = payload.capacity

    if old_name != venue_name:
        linked_events = db.scalars(select(Event).where(Event.venue_name == old_name)).all()
        for event in linked_events:
            event.venue_name = venue_name

    db.commit()
    db.refresh(venue)
    return venue


@app.delete("/venues/{venue_id}")
def delete_venue(
    venue_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.admin)),
):
    venue = db.get(Venue, venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")

    event_exists = db.scalar(select(Event.id).where(Event.venue_name == venue.name).limit(1))
    if event_exists:
        raise HTTPException(status_code=409, detail="Нельзя удалить площадку, пока с ней связаны мероприятия")

    db.delete(venue)
    db.commit()
    return {"ok": True}


@app.get("/events", response_model=list[EventOut])
def list_events(
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.admin, UserRole.cashier)),
):
    events = db.scalars(select(Event).order_by(Event.starts_at.asc())).all()
    venues = db.scalars(select(Venue)).all()
    venue_id_by_name = {venue.name: venue.id for venue in venues}
    return [event_to_out(event, venue_id_by_name) for event in events]


@app.put("/events/{event_id}", response_model=EventOut)
def update_event(
    event_id: int,
    payload: EventUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.admin)),
):
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    venue = db.get(Venue, payload.venue_id)
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")

    event.title = payload.title
    event.venue_name = venue.name
    event.starts_at = payload.starts_at
    db.commit()
    db.refresh(event)
    return EventOut(id=event.id, title=event.title, venue_id=venue.id, venue_name=event.venue_name, starts_at=event.starts_at)


@app.delete("/events/{event_id}")
def delete_event(
    event_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.admin)),
):
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    ticket_exists = db.scalar(select(Ticket.id).where(Ticket.event_id == event_id).limit(1))
    if ticket_exists:
        raise HTTPException(status_code=409, detail="Нельзя удалить мероприятие, по которому уже есть билеты")

    db.delete(event)
    db.commit()
    return {"ok": True}


@app.post("/tickets/sell", response_model=TicketOut)
def sell_ticket(
    payload: TicketSaleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.cashier)),
):
    event = db.get(Event, payload.event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    ticket_uuid = str(uuid.uuid4())
    qr_token = create_ticket_token(ticket_uuid=ticket_uuid, event_id=event.id)
    ticket = Ticket(
        ticket_uuid=ticket_uuid,
        event_id=event.id,
        seat_label=payload.seat_label,
        buyer_name=payload.buyer_name,
        price=payload.price,
        status=TicketStatus.sold.value,
        qr_token=qr_token,
        sold_by=current_user.id,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket_to_out(ticket)


@app.get("/events/{event_id}/seat-map", response_model=SeatMapResponse)
def get_event_seat_map(
    event_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.cashier)),
):
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    taken = db.scalars(
        select(Ticket.seat_label).where(
            Ticket.event_id == event_id,
            Ticket.seat_label.is_not(None),
        )
    ).all()
    taken_seats = [normalize_seat_label(seat) for seat in taken if seat]
    return SeatMapResponse(rows=8, cols=12, taken_seats=taken_seats)


@app.get("/events/{event_id}/stats", response_model=EventStatsResponse)
def get_event_stats(
    event_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.admin, UserRole.cashier)),
):
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    sold_count = db.scalar(select(func.count(Ticket.id)).where(Ticket.event_id == event_id)) or 0
    checked_in_count = (
        db.scalar(
            select(func.count(Ticket.id)).where(
                Ticket.event_id == event_id,
                Ticket.status == TicketStatus.used.value,
            )
        )
        or 0
    )
    gate_allow_count = (
        db.scalar(
            select(func.count(GateScanLog.id))
            .join(Ticket, Ticket.id == GateScanLog.ticket_id)
            .where(
                Ticket.event_id == event_id,
                GateScanLog.decision == "allow",
            )
        )
        or 0
    )
    gate_deny_count = (
        db.scalar(
            select(func.count(GateScanLog.id))
            .join(Ticket, Ticket.id == GateScanLog.ticket_id)
            .where(
                Ticket.event_id == event_id,
                GateScanLog.decision == "deny",
            )
        )
        or 0
    )
    repeated_qr_attempts = (
        db.scalar(
            select(func.count(GateScanLog.id))
            .join(Ticket, Ticket.id == GateScanLog.ticket_id)
            .where(
                Ticket.event_id == event_id,
                GateScanLog.decision == "deny",
                GateScanLog.reason == "Ticket already used",
            )
        )
        or 0
    )

    not_checked_in_count = max(sold_count - checked_in_count, 0)
    check_in_rate_percent = round((checked_in_count / sold_count) * 100, 2) if sold_count else 0.0
    return EventStatsResponse(
        event_id=event_id,
        sold_count=sold_count,
        checked_in_count=checked_in_count,
        not_checked_in_count=not_checked_in_count,
        check_in_rate_percent=check_in_rate_percent,
        gate_allow_count=gate_allow_count,
        gate_deny_count=gate_deny_count,
        repeated_qr_attempts=repeated_qr_attempts,
    )


@app.post("/tickets/sell-batch", response_model=TicketBatchSaleResponse)
def sell_ticket_batch(
    payload: TicketBatchSaleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.cashier)),
):
    event = db.get(Event, payload.event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if payload.price_per_ticket <= 0:
        raise HTTPException(status_code=400, detail="Price must be greater than zero")
    if len(payload.seat_labels) == 0:
        raise HTTPException(status_code=400, detail="Select at least one seat")

    normalized = [normalize_seat_label(seat) for seat in payload.seat_labels if seat.strip()]
    if len(normalized) != len(payload.seat_labels):
        raise HTTPException(status_code=400, detail="Seat labels must not be empty")
    if len(set(normalized)) != len(normalized):
        raise HTTPException(status_code=400, detail="Duplicate seats in request")

    existing = db.scalars(
        select(Ticket.seat_label).where(
            Ticket.event_id == payload.event_id,
            Ticket.seat_label.in_(normalized),
        )
    ).all()
    if existing:
        occupied = ", ".join(sorted({normalize_seat_label(seat) for seat in existing if seat}))
        raise HTTPException(status_code=409, detail=f"Seats already sold: {occupied}")

    created_tickets: list[Ticket] = []
    for seat_label in normalized:
        ticket_uuid = str(uuid.uuid4())
        qr_token = create_ticket_token(ticket_uuid=ticket_uuid, event_id=event.id)
        ticket = Ticket(
            ticket_uuid=ticket_uuid,
            event_id=event.id,
            seat_label=seat_label,
            buyer_name=payload.buyer_name,
            price=payload.price_per_ticket,
            status=TicketStatus.sold.value,
            qr_token=qr_token,
            sold_by=current_user.id,
        )
        db.add(ticket)
        created_tickets.append(ticket)

    db.commit()
    for ticket in created_tickets:
        db.refresh(ticket)

    tickets_out = [ticket_to_out(ticket) for ticket in created_tickets]
    quantity = len(tickets_out)
    return TicketBatchSaleResponse(
        tickets=tickets_out,
        quantity=quantity,
        total_price=round(payload.price_per_ticket * quantity, 2),
    )


@app.get("/tickets/{ticket_id}/qr.png")
def get_ticket_qr_image(
    ticket_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.cashier)),
):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return StreamingResponse(io.BytesIO(build_qr_png_bytes(ticket.qr_token)), media_type="image/png")


@app.post("/tickets/{ticket_id}/send-email")
def send_ticket_qr_email(
    ticket_id: int,
    payload: TicketEmailRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.cashier)),
):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    requested_ids = payload.ticket_ids or []
    target_ids = {ticket_id, *requested_ids}

    tickets = db.scalars(select(Ticket).where(Ticket.id.in_(target_ids)).order_by(Ticket.id.asc())).all()
    if not tickets:
        raise HTTPException(status_code=404, detail="Tickets not found")

    missing_ids = sorted(target_ids - {item.id for item in tickets})
    if missing_ids:
        raise HTTPException(status_code=404, detail=f"Tickets not found: {', '.join(str(item) for item in missing_ids)}")

    events = db.scalars(select(Event).where(Event.id.in_({item.event_id for item in tickets}))).all()
    event_by_id = {event.id: event for event in events}
    tickets_with_events: list[tuple[Ticket, Event]] = []
    for item in tickets:
        event = event_by_id.get(item.event_id)
        if not event:
            raise HTTPException(status_code=404, detail=f"Event not found for ticket {item.id}")
        tickets_with_events.append((item, event))

    send_ticket_bundle_email(to_email=payload.email, tickets_with_events=tickets_with_events)
    if len(tickets_with_events) == 1:
        return {"ok": True, "message": f"PDF-билет отправлен на {payload.email}"}
    return {"ok": True, "message": f"{len(tickets_with_events)} PDF-билета отправлены на {payload.email}"}


@app.get("/audit/feed", response_model=AuditFeedResponse)
def get_audit_feed(
    limit: int = 100,
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.admin)),
):
    limit = max(1, min(limit, 500))
    audit_items: list[AuditEventOut] = []

    ticket_rows = db.execute(
        select(Ticket, User.username, Event.title)
        .join(User, Ticket.sold_by == User.id)
        .join(Event, Ticket.event_id == Event.id)
        .order_by(Ticket.sold_at.desc())
        .limit(limit)
    ).all()
    for ticket, username, event_title in ticket_rows:
        audit_items.append(
            AuditEventOut(
                timestamp=ticket.sold_at,
                event_type="ticket_sale",
                actor=username,
                action="Продажа билета",
                details=f"{event_title}, место: {ticket.seat_label or '-'}, код: {create_short_ticket_code(ticket.ticket_uuid)}",
                extra={
                    "Кассир": username,
                    "Мероприятие": event_title,
                    "Место": ticket.seat_label or "-",
                    "Код билета": create_short_ticket_code(ticket.ticket_uuid),
                    "Покупатель": ticket.buyer_name or "-",
                    "Цена": f"{ticket.price:.2f}",
                },
            )
        )

    scan_rows = db.execute(
        select(GateScanLog, User.username, Ticket.ticket_uuid, Event.title)
        .join(User, GateScanLog.scanned_by == User.id)
        .outerjoin(Ticket, GateScanLog.ticket_id == Ticket.id)
        .outerjoin(Event, Ticket.event_id == Event.id)
        .order_by(GateScanLog.scanned_at.desc())
        .limit(limit)
    ).all()
    for scan_log, username, ticket_uuid, event_title in scan_rows:
        ticket_code = create_short_ticket_code(ticket_uuid) if ticket_uuid else "-"
        audit_items.append(
            AuditEventOut(
                timestamp=scan_log.scanned_at,
                event_type="gate_scan",
                actor=username,
                action="Сканирование на входе",
                details=(
                    f"Результат: {scan_log.decision}. "
                    f"Причина: {scan_log.reason}. "
                    f"Событие: {event_title or '-'}, код: {ticket_code}"
                ),
                extra={
                    "Сотрудник КПП": username,
                    "Результат": scan_log.decision,
                    "Причина": scan_log.reason,
                    "Мероприятие": event_title or "-",
                    "Код билета": ticket_code,
                },
            )
        )

    system_rows = db.scalars(select(SystemAuditLog).order_by(SystemAuditLog.created_at.desc()).limit(limit)).all()
    for log_item in system_rows:
        audit_items.append(
            AuditEventOut(
                timestamp=log_item.created_at,
                event_type=log_item.event_type,
                actor=log_item.actor,
                action=log_item.action,
                details=log_item.details,
                extra=None,
            )
        )

    audit_items.sort(key=lambda item: item.timestamp, reverse=True)
    return AuditFeedResponse(items=audit_items[:limit])


@app.post("/gate/scan", response_model=GateScanResponse)
def scan_qr(
    payload: GateScanRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.cashier)),
):
    scan_value = (payload.scan_value or payload.qr_token or "").strip()
    if not scan_value:
        raise HTTPException(status_code=400, detail="Scan value is required")

    ticket = None
    invalid_reason = "Invalid or broken scan value"
    if scan_value.isdigit() and len(scan_value) == 8:
        # Short code fallback for manual entry at the gate.
        candidates = db.scalars(select(Ticket).order_by(Ticket.id.desc())).all()
        for candidate in candidates:
            if create_short_ticket_code(candidate.ticket_uuid) == scan_value:
                ticket = candidate
                break
        if not ticket:
            invalid_reason = "Short code not found"
    else:
        try:
            qr_payload = decode_jwt(scan_value)
            if qr_payload.get("type") != "ticket":
                raise HTTPException(status_code=400, detail="Invalid QR token type")
            ticket = db.scalar(select(Ticket).where(Ticket.ticket_uuid == qr_payload["ticket_uuid"]))
            if not ticket:
                invalid_reason = "Ticket not found"
        except HTTPException:
            invalid_reason = "Invalid or broken QR token"

    if not ticket:
        db.add(
            GateScanLog(
                ticket_id=None,
                scanned_by=current_user.id,
                decision="deny",
                reason=invalid_reason,
            )
        )
        db.commit()
        return GateScanResponse(allowed=False, message="Билет не найден или код недействителен")

    if ticket.used_at is not None or ticket.status == TicketStatus.used.value:
        db.add(
            GateScanLog(
                ticket_id=ticket.id,
                scanned_by=current_user.id,
                decision="deny",
                reason="Ticket already used",
            )
        )
        db.commit()
        return GateScanResponse(
            allowed=False,
            message="Этот QR уже был использован",
            ticket_id=ticket.id,
        )

    ticket.status = TicketStatus.used.value
    ticket.used_at = datetime.now(timezone.utc)
    db.add(
        GateScanLog(
            ticket_id=ticket.id,
            scanned_by=current_user.id,
            decision="allow",
            reason="Ticket accepted",
        )
    )
    db.commit()
    return GateScanResponse(allowed=True, message="Проход разрешен", ticket_id=ticket.id)
