import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

export default function CashierRegistrationPage() {
  const { token } = useAuth();
  const [pending, setPending] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    const formEl = event.currentTarget;
    setSuccessMessage("");
    setErrorMessage("");

    const formData = new FormData(formEl);
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirm_password") || "");

    if (password !== confirmPassword) {
      setErrorMessage("Пароли не совпадают");
      return;
    }

    setPending(true);
    try {
      const { data } = await api.post("/auth/cashier-register", { username, password });
      setSuccessMessage(data?.message || "Заявка отправлена и ожидает подтверждения админа.");
      formEl.reset();
    } catch (error) {
      setErrorMessage(error?.response?.data?.detail || "Не удалось отправить заявку");
    } finally {
      setPending(false);
    }
  }

  if (token) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="login-screen">
      <form className="login-glass" onSubmit={handleSubmit}>
        <h1>Регистрация кассира</h1>
        <p className="login-subtitle">После отправки заявки администратор должен подтвердить аккаунт</p>

        <label className="login-field">
          <span>Логин</span>
          <input name="username" minLength={3} placeholder="Придумай логин" required />
        </label>

        <label className="login-field">
          <span>Пароль</span>
          <input name="password" type="password" minLength={6} placeholder="Минимум 6 символов" required />
        </label>

        <label className="login-field">
          <span>Повтори пароль</span>
          <input
            name="confirm_password"
            type="password"
            minLength={6}
            placeholder="Повтори пароль"
            required
          />
        </label>

        <button className="login-submit" type="submit" disabled={pending}>
          {pending ? "Отправляем..." : "Отправить заявку"}
        </button>

        {successMessage && <p className="login-success">{successMessage}</p>}
        {errorMessage && <p className="login-error">{errorMessage}</p>}

        <p className="login-register-text">
          Уже есть аккаунт? <Link to="/login">Войти</Link>
        </p>
      </form>
    </main>
  );
}
