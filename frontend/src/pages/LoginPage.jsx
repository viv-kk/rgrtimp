import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { token, authError, setAuthError, login } = useAuth();
  const [pending, setPending] = useState(false);

  async function handleLogin(event) {
    event.preventDefault();
    setAuthError("");
    setPending(true);
    const formData = new FormData(event.currentTarget);
    const ok = await login(formData.get("username"), formData.get("password"));
    setPending(false);
    if (ok) {
      event.currentTarget.reset();
    }
  }

  if (token) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="login-screen">
      <form className="login-glass" onSubmit={handleLogin}>
        <h1>Event Security</h1>
        <p className="login-subtitle">Контроль продажи и прохода по одноразовому QR-коду</p>

        <label className="login-field">
          <span>Логин</span>
          <input name="username" placeholder="Введите логин" required />
        </label>

        <label className="login-field">
          <span>Пароль</span>
          <input name="password" type="password" placeholder="Введите пароль" required />
        </label>

        <button className="login-submit" type="submit" disabled={pending}>
          {pending ? "Входим..." : "Войти"}
        </button>

        {authError && <p className="login-error">{authError}</p>}

        <p className="login-register-text">
          Нет аккаунта кассира? <Link to="/register-cashier">Зарегистрироваться</Link>
        </p>
      </form>
    </main>
  );
}
