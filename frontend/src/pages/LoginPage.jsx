import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { token, authError, setAuthError, login } = useAuth();
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({ username: "", password: "" });

  async function handleLogin(event) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const formData = new FormData(formEl);
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");
    const nextErrors = {
      username: username ? "" : "Поле обязательно",
      password: password ? "" : "Поле обязательно"
    };
    setFieldErrors(nextErrors);
    if (nextErrors.username || nextErrors.password) return;

    setAuthError("");
    setPending(true);
    const ok = await login(username, password);
    setPending(false);
    if (ok) {
      formEl.reset();
      setFieldErrors({ username: "", password: "" });
    }
  }

  if (token) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="login-screen">
      <form className="login-glass" onSubmit={handleLogin} noValidate>
        <h1>Event Security</h1>
        <p className="login-subtitle">Контроль продажи и прохода по одноразовому QR-коду</p>

        <label className="login-field">
          <span>Логин</span>
          <input
            name="username"
            placeholder="Введите логин"
            className={fieldErrors.username ? "input-error" : ""}
            onChange={() => {
              if (fieldErrors.username) setFieldErrors((prev) => ({ ...prev, username: "" }));
            }}
            required
          />
          <span className={`field-error ${fieldErrors.username ? "" : "field-error-placeholder"}`}>
            {fieldErrors.username || "."}
          </span>
        </label>

        <label className="login-field">
          <span>Пароль</span>
          <input
            name="password"
            type="password"
            placeholder="Введите пароль"
            className={fieldErrors.password ? "input-error" : ""}
            onChange={() => {
              if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: "" }));
            }}
            required
          />
          <span className={`field-error ${fieldErrors.password ? "" : "field-error-placeholder"}`}>
            {fieldErrors.password || "."}
          </span>
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
