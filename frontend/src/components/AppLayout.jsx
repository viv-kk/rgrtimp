import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function AppLayout() {
  const { me, logout } = useAuth();

  return (
    <main className="container">
      <header className="header">
        <div className="brand">
          <p className="eyebrow">Система безопасности мероприятий</p>
          <h1>Event Security</h1>
          <p className="muted">
            Пользователь: <strong>{me?.username}</strong>
          </p>
        </div>
        <div className="header-actions">
          <span className="role-chip">{me?.role}</span>
          <button onClick={logout}>Выйти</button>
        </div>
      </header>

      <nav className="nav card">
        {me?.role === "cashier" && (
          <>
            <NavLink to="/sales" className="nav-link">
              Продажа билетов
            </NavLink>
            <NavLink to="/gate" className="nav-link">
              Контроль входа
            </NavLink>
          </>
        )}
        {me?.role === "admin" && (
          <NavLink to="/stats" className="nav-link">
            Аналитика
          </NavLink>
        )}
        {me?.role === "admin" && (
          <>
            <NavLink to="/admin/venues" className="nav-link">
              Управление площадками
            </NavLink>
            <NavLink to="/admin/events" className="nav-link">
              Управление мероприятиями
            </NavLink>
            <NavLink to="/admin/audit" className="nav-link">
              Аудит системы
            </NavLink>
            <NavLink to="/admin/cashier-requests" className="nav-link">
              Заявки кассиров
            </NavLink>
          </>
        )}
      </nav>

      <Outlet />
    </main>
  );
}
