import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

const defaultEventForm = {
  title: "",
  venue_id: "",
  starts_date: "",
  starts_time: ""
};

function toDateInputValue(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

function toTimeInputValue(date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatTimeTyping(rawValue) {
  const digits = rawValue.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function formatDateTyping(rawValue) {
  const digits = rawValue.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}

function normalizeDateOnBlur(rawValue) {
  const trimmed = rawValue.trim();
  if (!trimmed) return "";
  const dotted = trimmed.replace(/[/-]/g, ".");
  const directMatch = dotted.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (directMatch) return `${directMatch[1].padStart(2, "0")}.${directMatch[2].padStart(2, "0")}.${directMatch[3]}`;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 8) return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
  return trimmed;
}

function normalizeTimeOnBlur(rawValue) {
  const trimmed = rawValue.trim();
  if (!trimmed) return "";
  const directMatch = trimmed.match(/^(\d{1,2}):(\d{1,2})$/);
  if (directMatch) return `${directMatch[1].padStart(2, "0")}:${directMatch[2].padStart(2, "0")}`;
  const digitsOnly = trimmed.replace(/\D/g, "");
  if (digitsOnly.length === 3 || digitsOnly.length === 4) {
    const hoursRaw = digitsOnly.length === 3 ? digitsOnly.slice(0, 1) : digitsOnly.slice(0, 2);
    return `${hoursRaw.padStart(2, "0")}:${digitsOnly.slice(-2).padStart(2, "0")}`;
  }
  return trimmed;
}

function isValidDateValue(value) {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return false;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function isValidTimeValue(value) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function validateDateTimeFields(dateValue, timeValue) {
  const errors = {};
  if (!isValidDateValue(dateValue)) errors.starts_date = "Некорректная дата. Формат: ДД.ММ.ГГГГ";
  if (!isValidTimeValue(timeValue)) errors.starts_time = "Некорректное время. Формат: ЧЧ:ММ";
  return errors;
}

function buildIsoDateTime(dateValue, timeValue) {
  if (!isValidDateValue(dateValue) || !isValidTimeValue(timeValue)) return null;
  const [day, month, year] = dateValue.split(".");
  return new Date(`${year}-${month}-${day}T${timeValue}:00`).toISOString();
}

export default function AdminEditEventPage() {
  const { me } = useAuth();
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [venues, setVenues] = useState([]);
  const [eventForm, setEventForm] = useState(defaultEventForm);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    loadPageData();
  }, [eventId]);

  async function loadPageData() {
    setLoading(true);
    setNotFound(false);
    try {
      const [venuesRes, eventsRes] = await Promise.all([api.get("/venues"), api.get("/events")]);
      const availableVenues = venuesRes.data || [];
      const eventItem = (eventsRes.data || []).find((item) => item.id === Number(eventId));
      if (!eventItem) {
        setNotFound(true);
        return;
      }

      const startsAtDate = eventItem.starts_at ? new Date(eventItem.starts_at) : null;
      const venueId =
        eventItem.venue_id ?? availableVenues.find((venue) => venue.name === eventItem.venue_name)?.id ?? "";

      setVenues(availableVenues);
      setEventForm({
        title: eventItem.title,
        venue_id: venueId ? String(venueId) : "",
        starts_date: startsAtDate ? toDateInputValue(startsAtDate) : "",
        starts_time: startsAtDate ? toTimeInputValue(startsAtDate) : ""
      });
      setErrors({});
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }

  async function saveEvent(event) {
    event.preventDefault();
    const formErrors = validateDateTimeFields(eventForm.starts_date, eventForm.starts_time);
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) return;

    const startsAtIso = buildIsoDateTime(eventForm.starts_date, eventForm.starts_time);
    if (!startsAtIso) return;

    try {
      await api.put(`/events/${eventId}`, {
        title: eventForm.title,
        venue_id: Number(eventForm.venue_id),
        starts_at: startsAtIso
      });
      navigate("/admin/events");
    } catch (error) {
      alert(error?.response?.data?.detail || "Не удалось обновить мероприятие");
    }
  }

  function handleDateChange(e) {
    setEventForm((prev) => ({ ...prev, starts_date: formatDateTyping(e.target.value) }));
    setErrors((prev) => ({ ...prev, starts_date: "" }));
  }

  function handleDateBlur(e) {
    const normalized = normalizeDateOnBlur(e.target.value);
    setEventForm((prev) => ({ ...prev, starts_date: normalized }));
    if (normalized && !isValidDateValue(normalized)) {
      setErrors((prev) => ({ ...prev, starts_date: "Некорректная дата. Формат: ДД.ММ.ГГГГ" }));
    }
  }

  function handleTimeChange(e) {
    setEventForm((prev) => ({ ...prev, starts_time: formatTimeTyping(e.target.value) }));
    setErrors((prev) => ({ ...prev, starts_time: "" }));
  }

  function handleTimeBlur(e) {
    const normalized = normalizeTimeOnBlur(e.target.value);
    setEventForm((prev) => ({ ...prev, starts_time: normalized }));
    if (normalized && !isValidTimeValue(normalized)) {
      setErrors((prev) => ({ ...prev, starts_time: "Некорректное время. Формат: ЧЧ:ММ" }));
    }
  }

  if (me?.role !== "admin") {
    return (
      <section className="card">
        <h2>Доступ ограничен</h2>
        <p>Страница доступна только администратору.</p>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="card">
        <p>Загрузка мероприятия...</p>
      </section>
    );
  }

  if (notFound) {
    return (
      <section className="card">
        <h2>Мероприятие не найдено</h2>
        <Link to="/admin/events">Вернуться к мероприятиям</Link>
      </section>
    );
  }

  return (
    <form className="card" onSubmit={saveEvent}>
      <h2>Редактировать мероприятие</h2>
      <label>
        Название
        <input value={eventForm.title} onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })} required />
      </label>
      <label>
        Площадка
        <select
          value={eventForm.venue_id}
          onChange={(e) => setEventForm({ ...eventForm, venue_id: e.target.value })}
          required
          disabled={venues.length === 0}
        >
          <option value="">Выбери площадку</option>
          {venues.map((venue) => (
            <option key={venue.id} value={venue.id}>
              {venue.name}
            </option>
          ))}
        </select>
      </label>

      <div className="datetime-grid">
        <label>
          Дата (ДД.ММ.ГГГГ)
          <input
            type="text"
            inputMode="numeric"
            placeholder="Например, 10.05.2026"
            value={eventForm.starts_date}
            onChange={handleDateChange}
            onBlur={handleDateBlur}
            maxLength={10}
            className={errors.starts_date ? "input-error" : ""}
            required
          />
          <span className={`field-error ${errors.starts_date ? "" : "field-error-placeholder"}`}>
            {errors.starts_date || " "}
          </span>
        </label>
        <label>
          Время (ЧЧ:ММ)
          <input
            type="text"
            inputMode="numeric"
            placeholder="Например, 19:30"
            value={eventForm.starts_time}
            onChange={handleTimeChange}
            onBlur={handleTimeBlur}
            maxLength={5}
            className={errors.starts_time ? "input-error" : ""}
            required
          />
          <span className={`field-error ${errors.starts_time ? "" : "field-error-placeholder"}`}>
            {errors.starts_time || " "}
          </span>
        </label>
      </div>

      <div className="item-actions">
        <button type="submit">Сохранить</button>
        <Link to="/admin/events" className="button-link">
          Отмена
        </Link>
      </div>
    </form>
  );
}
