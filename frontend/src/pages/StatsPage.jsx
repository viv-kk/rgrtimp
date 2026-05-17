import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

export default function StatsPage() {
  const { events } = useAuth();
  const [eventId, setEventId] = useState("");
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!eventId) {
      setStats(null);
      return;
    }
    loadStats(eventId);
  }, [eventId]);

  async function loadStats(selectedEventId) {
    setError("");
    try {
      const { data } = await api.get(`/events/${selectedEventId}/stats`);
      setStats(data);
    } catch (err) {
      setStats(null);
      setError(err?.response?.data?.detail || "Не удалось загрузить статистику");
    }
  }

  return (
    <>
      <section className="card page-head">
        <h2>Аналитика мероприятия</h2>
        <p className="muted">Ключевые показатели продаж и прохода по QR-коду.</p>
      </section>

      <section className="card">
        <label>
          Мероприятие
          <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">Выбери событие</option>
            {events.map((event) => (
              <option value={event.id} key={event.id}>
                {event.title} — {event.venue_name}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="error">{error}</p>}

        {stats && (
          <>
            <div className="stats-visual">
              <article className="stat-card chart-card">
                <p className="muted">Посещаемость</p>
                <div
                  className="donut-chart"
                  style={{ "--p": `${Math.min(Math.max(stats.check_in_rate_percent, 0), 100)}%` }}
                >
                  <span>{stats.check_in_rate_percent}%</span>
                </div>
              </article>

              <article className="stat-card chart-card">
                <p className="muted">Проход / Не пришли</p>
                <div className="bar-group">
                  <div className="bar-row">
                    <span>Прошли</span>
                    <div className="bar-track">
                      <div
                        className="bar-fill ok"
                        style={{
                          width: `${stats.sold_count ? (stats.checked_in_count / stats.sold_count) * 100 : 0}%`
                        }}
                      />
                    </div>
                    <strong>{stats.checked_in_count}</strong>
                  </div>
                  <div className="bar-row">
                    <span>Не пришли</span>
                    <div className="bar-track">
                      <div
                        className="bar-fill warn"
                        style={{
                          width: `${stats.sold_count ? (stats.not_checked_in_count / stats.sold_count) * 100 : 0}%`
                        }}
                      />
                    </div>
                    <strong>{stats.not_checked_in_count}</strong>
                  </div>
                </div>
              </article>

              <article className="stat-card chart-card">
                <p className="muted">Результаты сканирования</p>
                <div className="bar-group">
                  <div className="bar-row">
                    <span>Допуск</span>
                    <div className="bar-track">
                      <div
                        className="bar-fill ok"
                        style={{
                          width: `${stats.gate_allow_count + stats.gate_deny_count
                            ? (stats.gate_allow_count / (stats.gate_allow_count + stats.gate_deny_count)) * 100
                            : 0}%`
                        }}
                      />
                    </div>
                    <strong>{stats.gate_allow_count}</strong>
                  </div>
                  <div className="bar-row">
                    <span>Отказы</span>
                    <div className="bar-track">
                      <div
                        className="bar-fill deny"
                        style={{
                          width: `${stats.gate_allow_count + stats.gate_deny_count
                            ? (stats.gate_deny_count / (stats.gate_allow_count + stats.gate_deny_count)) * 100
                            : 0}%`
                        }}
                      />
                    </div>
                    <strong>{stats.gate_deny_count}</strong>
                  </div>
                </div>
              </article>
            </div>

            <div className="stats-grid">
              <article className="stat-card">
                <p className="muted">Продано билетов</p>
                <h3>{stats.sold_count}</h3>
              </article>
              <article className="stat-card">
                <p className="muted">Прошли на вход</p>
                <h3>{stats.checked_in_count}</h3>
              </article>
              <article className="stat-card">
                <p className="muted">Не пришли</p>
                <h3>{stats.not_checked_in_count}</h3>
              </article>
              <article className="stat-card">
                <p className="muted">Процент прохода</p>
                <h3>{stats.check_in_rate_percent}%</h3>
              </article>
              <article className="stat-card">
                <p className="muted">Повторные QR-попытки</p>
                <h3>{stats.repeated_qr_attempts}</h3>
              </article>
            </div>
          </>
        )}
      </section>
    </>
  );
}
