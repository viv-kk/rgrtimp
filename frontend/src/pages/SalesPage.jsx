import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

const defaultTicketForm = {
  event_id: "",
  buyer_name: "",
  price_per_ticket: ""
};

export default function SalesPage() {
  const { events } = useAuth();
  const [ticketForm, setTicketForm] = useState(defaultTicketForm);
  const [selectedSeats, setSelectedSeats] = useState([]);
  const [seatMap, setSeatMap] = useState({ rows: 8, cols: 12, taken_seats: [] });
  const [seatMapError, setSeatMapError] = useState("");
  const [saleResult, setSaleResult] = useState(null); // { tickets, quantity, total_price }
  const [activeTicketId, setActiveTicketId] = useState(null);
  const [emailToSend, setEmailToSend] = useState("");
  const [emailStatus, setEmailStatus] = useState("");

  useEffect(() => {
    if (!ticketForm.event_id) {
      setSeatMap({ rows: 8, cols: 12, taken_seats: [] });
      setSelectedSeats([]);
      return;
    }
    loadSeatMap(ticketForm.event_id);
  }, [ticketForm.event_id]);

  const activeTicket = useMemo(
    () => saleResult?.tickets?.find((ticket) => ticket.id === activeTicketId) || null,
    [saleResult, activeTicketId]
  );

  async function loadSeatMap(eventId) {
    setSeatMapError("");
    try {
      const { data } = await api.get(`/events/${eventId}/seat-map`);
      setSeatMap(data);
      setSelectedSeats((prev) =>
        prev.filter((seat) => !data.taken_seats.includes(seat))
      );
    } catch (error) {
      setSeatMapError(error?.response?.data?.detail || "Не удалось загрузить схему мест");
    }
  }

  function seatLabel(row, col) {
    return `${String.fromCharCode(65 + row)}${col + 1}`;
  }

  function toggleSeat(seat) {
    if (seatMap.taken_seats.includes(seat)) return;
    setSelectedSeats((prev) =>
      prev.includes(seat) ? prev.filter((item) => item !== seat) : [...prev, seat]
    );
  }

  async function sellTicket(event) {
    event.preventDefault();
    setEmailStatus("");
    try {
      const payload = {
        ...ticketForm,
        event_id: Number(ticketForm.event_id),
        seat_labels: selectedSeats,
        price_per_ticket: Number(ticketForm.price_per_ticket)
      };
      const { data } = await api.post("/tickets/sell-batch", payload);
      setSaleResult(data);
      setActiveTicketId(data.tickets[0]?.id ?? null);
      setTicketForm(defaultTicketForm);
      setSelectedSeats([]);
      await loadSeatMap(payload.event_id);
    } catch {
      alert("Ошибка продажи билетов");
    }
  }

  async function sendQrToEmail(event) {
    event.preventDefault();
    if (!activeTicket?.id) return;
    try {
      const ticketIds = saleResult?.tickets?.map((ticket) => ticket.id) || [activeTicket.id];
      const { data } = await api.post(`/tickets/${activeTicket.id}/send-email`, {
        email: emailToSend.trim(),
        ticket_ids: ticketIds
      });
      setEmailStatus(data.message || "Письмо отправлено");
    } catch (error) {
      const message = error?.response?.data?.detail || "Не удалось отправить письмо";
      setEmailStatus(message);
    }
  }

  return (
    <>
      <section className="card page-head">
        <h2>Продажа билетов</h2>
        <p className="muted">Оформи билет, скачай QR и при необходимости отправь его на email посетителя.</p>
      </section>

      <form className="card" onSubmit={sellTicket}>
        <h3>Новый билет</h3>
        <label>
          Мероприятие
          <select
            value={ticketForm.event_id}
            onChange={(e) => setTicketForm({ ...ticketForm, event_id: e.target.value })}
            required
          >
            <option value="">Выбери событие</option>
            {events.map((event) => (
              <option value={event.id} key={event.id}>
                {event.title} — {event.venue_name}
              </option>
            ))}
          </select>
        </label>
        {seatMapError && <p className="error">{seatMapError}</p>}
        {ticketForm.event_id && (
          <div className="seat-map-wrap">
            <p className="muted">Выбери места на схеме (можно несколько):</p>
            <div
              className="seat-grid"
              style={{ gridTemplateColumns: `repeat(${seatMap.cols}, minmax(30px, 1fr))` }}
            >
              {Array.from({ length: seatMap.rows }).map((_, row) =>
                Array.from({ length: seatMap.cols }).map((__, col) => {
                  const seat = seatLabel(row, col);
                  const isTaken = seatMap.taken_seats.includes(seat);
                  const isSelected = selectedSeats.includes(seat);
                  return (
                    <button
                      type="button"
                      key={seat}
                      className={`seat-btn ${isTaken ? "taken" : ""} ${isSelected ? "selected" : ""}`}
                      onClick={() => toggleSeat(seat)}
                      disabled={isTaken}
                      title={isTaken ? "Место уже продано" : seat}
                    >
                      {seat}
                    </button>
                  );
                })
              )}
            </div>
            <p className="muted">
              Выбрано мест: <strong>{selectedSeats.length}</strong>
            </p>
          </div>
        )}
        <label>
          ФИО покупателя
          <input
            value={ticketForm.buyer_name}
            onChange={(e) => setTicketForm({ ...ticketForm, buyer_name: e.target.value })}
          />
        </label>
        <label>
          Цена за 1 билет
          <input
            type="number"
            min="0"
            step="0.01"
            value={ticketForm.price_per_ticket}
            onChange={(e) => setTicketForm({ ...ticketForm, price_per_ticket: e.target.value })}
            required
          />
        </label>
        <p className="muted">
          Итого:{" "}
          <strong>
            {(
              Number(ticketForm.price_per_ticket || 0) * Number(selectedSeats.length || 0)
            ).toFixed(2)}
          </strong>
        </p>
        <button type="submit" disabled={selectedSeats.length === 0}>
          Продать выбранные места
        </button>
      </form>

      {saleResult && (
        <section className="card success">
          <h3>Билеты проданы</h3>
          <p className="muted">Количество: {saleResult.quantity}</p>
          <p className="muted">Общая стоимость: {saleResult.total_price.toFixed(2)}</p>
          <div className="ticket-list">
            {saleResult.tickets.map((ticket) => (
              <button
                type="button"
                key={ticket.id}
                className={`ticket-pill ${activeTicketId === ticket.id ? "active" : ""}`}
                onClick={() => setActiveTicketId(ticket.id)}
              >
                {ticket.short_code}
              </button>
            ))}
          </div>

          {activeTicket && (
            <>
              <p className="muted">Ticket ID: {activeTicket.id}</p>
              <p className="muted">
                Короткий код для ручного ввода: <strong>{activeTicket.short_code}</strong>
              </p>
              <p>QR-код выбранного билета:</p>
              <img
                className="qr-image"
                src={`data:image/png;base64,${activeTicket.qr_image_base64}`}
                alt="QR билета"
              />
              <p>QR Token:</p>
              <textarea readOnly value={activeTicket.qr_token} rows={4} />
              <a
                className="download-link"
                href={`data:image/png;base64,${activeTicket.qr_image_base64}`}
                download={`ticket-${activeTicket.short_code}.png`}
              >
                <button type="button">Скачать QR (PNG)</button>
              </a>
            </>
          )}

          <form className="email-form" onSubmit={sendQrToEmail}>
            <label>
              Email посетителя
              <input
                type="email"
                value={emailToSend}
                onChange={(e) => setEmailToSend(e.target.value)}
                placeholder="visitor@example.com"
                required
              />
            </label>
            <button type="submit">Отправить PDF-билет на почту</button>
          </form>
          {emailStatus && <p className="muted">{emailStatus}</p>}
        </section>
      )}
    </>
  );
}
