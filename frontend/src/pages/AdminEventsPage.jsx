import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

const defaultEventForm = {
  title: "",
  venue_id: "",
  starts_date: "",
  starts_time: ""
};

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
  if (directMatch) {
    return `${directMatch[1].padStart(2, "0")}.${directMatch[2].padStart(2, "0")}.${directMatch[3]}`;
  }
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

function isValidTimeValue(value) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
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

export default function AdminEventsPage() {
  const { me, events, loadEvents } = useAuth();
  const [venues, setVenues] = useState([]);
  const [eventForm, setEventForm] = useState(defaultEventForm);
  const [createErrors, setCreateErrors] = useState({});

  useEffect(() => {
    loadVenues();
  }, []);

  async function loadVenues() {
    try {
      const { data } = await api.get("/venues");
      setVenues(data);
    } catch {
      setVenues([]);
    }
  }

  async function createEvent(event) {
    event.preventDefault();
    const errors = validateDateTimeFields(eventForm.starts_date, eventForm.starts_time);
    setCreateErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const startsAtIso = buildIsoDateTime(eventForm.starts_date, eventForm.starts_time);
    if (!startsAtIso) return;

    try {
      await api.post("/events", {
        title: eventForm.title,
        venue_id: Number(eventForm.venue_id),
        starts_at: startsAtIso
      });
      setEventForm(defaultEventForm);
      setCreateErrors({});
      loadEvents();
    } catch {
      alert("Не удалось создать мероприятие");
    }
  }

  async function removeEvent(eventId) {
    const confirmed = window.confirm("Удалить мероприятие? Если по нему есть билеты, удаление будет запрещено.");
    if (!confirmed) return;
    try {
      await api.delete(`/events/${eventId}`);
      loadEvents();
    } catch (error) {
      alert(error?.response?.data?.detail || "Не удалось удалить мероприятие");
    }
  }

  function handleCreateDateChange(e) {
    const value = formatDateTyping(e.target.value);
    setEventForm((prev) => ({ ...prev, starts_date: value }));
    setCreateErrors((prev) => ({ ...prev, starts_date: "" }));
  }

  function handleCreateDateBlur(e) {
    const normalized = normalizeDateOnBlur(e.target.value);
    setEventForm((prev) => ({ ...prev, starts_date: normalized }));
    if (normalized && !isValidDateValue(normalized)) {
      setCreateErrors((prev) => ({ ...prev, starts_date: "Некорректная дата. Формат: ДД.ММ.ГГГГ" }));
    }
  }

  function handleCreateTimeChange(e) {
    setEventForm((prev) => ({ ...prev, starts_time: formatTimeTyping(e.target.value) }));
    setCreateErrors((prev) => ({ ...prev, starts_time: "" }));
  }

  function handleCreateTimeBlur(e) {
    const normalized = normalizeTimeOnBlur(e.target.value);
    setEventForm((prev) => ({ ...prev, starts_time: normalized }));
    if (normalized && !isValidTimeValue(normalized)) {
      setCreateErrors((prev) => ({ ...prev, starts_time: "Некорректное время. Формат: ЧЧ:ММ" }));
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

  return (
    <>
      <section className="card page-head">
        <h2>Управление мероприятиями</h2>
        <p className="muted">Создавай мероприятия и привязывай их к существующим площадкам.</p>
      </section>

      <form className="card" onSubmit={createEvent}>
        <h3>Создать мероприятие</h3>
        <label>
          Название
          <input
            value={eventForm.title}
            onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
            required
          />
        </label>
        {venues.length === 0 && <p className="error">Сначала создай площадку во вкладке "Управление площадками".</p>}
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
              onChange={handleCreateDateChange}
              onBlur={handleCreateDateBlur}
              maxLength={10}
              className={createErrors.starts_date ? "input-error" : ""}
              required
            />
            <span className={`field-error ${createErrors.starts_date ? "" : "field-error-placeholder"}`}>
              {createErrors.starts_date || " "}
            </span>
          </label>
          <label>
            Время (ЧЧ:ММ)
            <input
              type="text"
              inputMode="numeric"
              placeholder="Например, 19:30"
              value={eventForm.starts_time}
              onChange={handleCreateTimeChange}
              onBlur={handleCreateTimeBlur}
              maxLength={5}
              className={createErrors.starts_time ? "input-error" : ""}
              required
            />
            <span className={`field-error ${createErrors.starts_time ? "" : "field-error-placeholder"}`}>
              {createErrors.starts_time || " "}
            </span>
          </label>
        </div>
        <button type="submit" disabled={venues.length === 0}>
          Создать
        </button>
      </form>

      <section className="card">
        <h3>Список мероприятий</h3>
        {events.length === 0 ? (
          <p>Пока нет созданных мероприятий.</p>
        ) : (
          <ul className="list list-actions">
            {events.map((event) => (
              <li key={event.id}>
                <span>
                  {event.title} — {event.venue_name} (
                  {new Date(event.starts_at).toLocaleString("ru-RU", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false
                  })})
                </span>
                <div className="item-actions">
                  <Link to={`/admin/events/${event.id}/edit`} className="button-link">
                    Редактировать
                  </Link>
                  <button type="button" onClick={() => removeEvent(event.id)}>
                    Удалить
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
