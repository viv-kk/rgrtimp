import { useEffect, useState } from "react";
import { api } from "../api";

export default function AuditPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedKey, setExpandedKey] = useState("");

  useEffect(() => {
    loadAudit();
  }, []);

  async function loadAudit() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/audit/feed?limit=120");
      setItems(data.items || []);
    } catch (err) {
      setError(err?.response?.data?.detail || "Не удалось загрузить аудит");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="card page-head">
        <h2>Аудит системы</h2>
        <p className="muted">Журнал ключевых действий: продажи билетов и сканирования на входе.</p>
      </section>

      <section className="card">
        <div className="audit-header">
          <h3>Последние события</h3>
          <button type="button" onClick={loadAudit} disabled={loading}>
            {loading ? "Обновляем..." : "Обновить"}
          </button>
        </div>

        {error && <p className="error">{error}</p>}
        {!error && items.length === 0 && <p className="muted">Пока нет событий аудита.</p>}

        {items.length > 0 && (
          <div className="audit-list">
            {items.map((item, index) => (
              <article
                className={`audit-item audit-item-clickable ${expandedKey === `${item.timestamp}-${index}` ? "expanded" : ""}`}
                key={`${item.timestamp}-${index}`}
                onClick={() =>
                  setExpandedKey((prev) => (prev === `${item.timestamp}-${index}` ? "" : `${item.timestamp}-${index}`))
                }
              >
                <div className="audit-item-top">
                  <strong>{item.action}</strong>
                  <span className="audit-type">{item.event_type}</span>
                </div>
                <p className="muted">
                  {new Date(item.timestamp).toLocaleString("ru-RU", { hour12: false })} - {item.actor}
                </p>
                {expandedKey === `${item.timestamp}-${index}` && (
                  <div className="audit-details">
                    <p className="muted">{item.details}</p>
                    {item.extra && (
                      <ul className="audit-details-list">
                        {Object.entries(item.extra).map(([key, value]) => (
                          <li key={key}>
                            <strong>{key}: </strong>
                            {value}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
