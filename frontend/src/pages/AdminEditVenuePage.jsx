import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

const defaultVenueForm = {
  name: "",
  address: "",
  capacity: ""
};

export default function AdminEditVenuePage() {
  const { me } = useAuth();
  const { venueId } = useParams();
  const navigate = useNavigate();
  const [venueForm, setVenueForm] = useState(defaultVenueForm);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    loadVenue();
  }, [venueId]);

  async function loadVenue() {
    setLoading(true);
    setNotFound(false);
    try {
      const { data } = await api.get("/venues");
      const venue = data.find((item) => item.id === Number(venueId));
      if (!venue) {
        setNotFound(true);
        return;
      }
      setVenueForm({
        name: venue.name || "",
        address: venue.address || "",
        capacity: venue.capacity ? String(venue.capacity) : ""
      });
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }

  async function saveVenue(event) {
    event.preventDefault();
    try {
      await api.put(`/venues/${venueId}`, {
        name: venueForm.name,
        address: venueForm.address || null,
        capacity: venueForm.capacity ? Number(venueForm.capacity) : null
      });
      navigate("/admin/venues");
    } catch (error) {
      alert(error?.response?.data?.detail || "Не удалось обновить площадку");
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
        <p>Загрузка площадки...</p>
      </section>
    );
  }

  if (notFound) {
    return (
      <section className="card">
        <h2>Площадка не найдена</h2>
        <Link to="/admin/venues">Вернуться к площадкам</Link>
      </section>
    );
  }

  return (
    <form className="card" onSubmit={saveVenue}>
      <h2>Редактировать площадку</h2>
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
        <input value={venueForm.address} onChange={(e) => setVenueForm({ ...venueForm, address: e.target.value })} />
      </label>
      <label>
        Вместимость
        <input
          type="number"
          min="1"
          value={venueForm.capacity}
          onChange={(e) => setVenueForm({ ...venueForm, capacity: e.target.value })}
        />
      </label>
      <div className="item-actions">
        <button type="submit">Сохранить</button>
        <Link to="/admin/venues" className="button-link">
          Отмена
        </Link>
      </div>
    </form>
  );
}
