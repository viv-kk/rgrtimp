import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

export default function AdminCashierRequestsPage() {
  const { me } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    loadRequests();
  }, []);

  async function loadRequests() {
    setLoading(true);
    setError("");
    setActionError("");
    try {
      const { data } = await api.get("/admin/cashier-requests");
      setRequests(data || []);
    } catch (err) {
      setError(err?.response?.data?.detail || "Не удалось загрузить заявки");
    } finally {
      setLoading(false);
    }
  }

  async function approveRequest(requestId) {
    setActionError("");
    try {
      await api.post(`/admin/cashier-requests/${requestId}/approve`);
      setRequests((prev) => prev.filter((item) => item.id !== requestId));
    } catch (err) {
      setActionError(err?.response?.data?.detail || "Не удалось подтвердить заявку");
    }
  }

  async function rejectRequest(requestId) {
    setActionError("");
    try {
      await api.delete(`/admin/cashier-requests/${requestId}`);
      setRequests((prev) => prev.filter((item) => item.id !== requestId));
    } catch (err) {
      setActionError(err?.response?.data?.detail || "Не удалось отклонить заявку");
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
        <h2>Заявки кассиров</h2>
        <p className="muted">Подтверждай или отклоняй регистрации новых кассиров.</p>
      </section>

      <section className="card">
        <div className="audit-header">
          <h3>Ожидают подтверждения</h3>
          <button type="button" onClick={loadRequests} disabled={loading}>
            {loading ? "Обновляем..." : "Обновить"}
          </button>
        </div>

        {error && <p className="error">{error}</p>}
        {actionError && <p className="error">{actionError}</p>}
        {!error && requests.length === 0 && <p className="muted">Сейчас нет новых заявок.</p>}

        {requests.length > 0 && (
          <ul className="list list-actions">
            {requests.map((request) => (
              <li key={request.id}>
                <span>
                  {request.username} — {new Date(request.created_at).toLocaleString("ru-RU", { hour12: false })}
                </span>
                <div className="item-actions">
                  <button type="button" onClick={() => approveRequest(request.id)}>
                    Подтвердить
                  </button>
                  <button type="button" onClick={() => rejectRequest(request.id)}>
                    Отклонить
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
