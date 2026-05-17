import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

const defaultVenueForm = {
  name: "",
  address: "",
  capacity: ""
};

export default function AdminVenuesPage() {
  const { me } = useAuth();
  const [venues, setVenues] = useState([]);
  const [venueForm, setVenueForm] = useState(defaultVenueForm);

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

  async function createVenue(event) {
    event.preventDefault();
    try {
      await api.post("/venues", {
        name: venueForm.name,
        address: venueForm.address || null,
        capacity: venueForm.capacity ? Number(venueForm.capacity) : null
      });
      setVenueForm(defaultVenueForm);
      loadVenues();
    } catch (error) {
      alert(error?.response?.data?.detail || "Не удалось создать площадку");
    }
  }

  async function removeVenue(venueId) {
    const confirmed = window.confirm("Удалить площадку? Если есть связанные мероприятия, удаление будет запрещено.");
    if (!confirmed) return;
    try {
      await api.delete(`/venues/${venueId}`);
      loadVenues();
    } catch (error) {
      alert(error?.response?.data?.detail || "Не удалось удалить площадку");
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
        <h2>Управление площадками</h2>
        <p className="muted">Создавай площадки, которые затем можно выбирать при создании мероприятий.</p>
      </section>

      <form className="card" onSubmit={createVenue}>
        <h3>Создать площадку</h3>
        <label>
          Название площадки
          <input
            value={venueForm.name}
            onChange={(e) => setVenueForm({ ...venueForm, name: e.target.value })}
            required
          />
        </label>
        <label>
          Адрес
          <input
            value={venueForm.address}
            onChange={(e) => setVenueForm({ ...venueForm, address: e.target.value })}
            placeholder="Город, улица"
          />
        </label>
        <label>
          Вместимость
          <input
            type="number"
            min="1"
            value={venueForm.capacity}
            onChange={(e) => setVenueForm({ ...venueForm, capacity: e.target.value })}
            placeholder="Например 10000"
          />
        </label>
        <button type="submit">Создать площадку</button>
      </form>

      <section className="card">
        <h3>Список площадок</h3>
        {venues.length === 0 ? (
          <p>Площадки пока не созданы.</p>
        ) : (
          <ul className="list list-actions">
            {venues.map((venue) => (
              <li key={venue.id}>
                <span>
                  {venue.name}
                  {venue.address ? ` — ${venue.address}` : ""}
                  {venue.capacity ? ` (вместимость: ${venue.capacity})` : ""}
                </span>
                <div className="item-actions">
                  <Link to={`/admin/venues/${venue.id}/edit`} className="button-link">
                    Редактировать
                  </Link>
                  <button type="button" onClick={() => removeVenue(venue.id)}>
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
