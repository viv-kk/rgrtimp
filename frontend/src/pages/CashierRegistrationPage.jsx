import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

const PASSWORD_RULE_HINT =
  "Минимум 10 символов, строчная и заглавная буквы, цифра и спецсимвол, без пробелов";

function getPasswordValidationError(password) {
  if (password.length < 10) return "Пароль должен быть не короче 10 символов";
  if (/\s/.test(password)) return "Пароль не должен содержать пробелы";
  if (!/[a-z]/.test(password)) return "Пароль должен содержать хотя бы одну строчную букву";
  if (!/[A-Z]/.test(password)) return "Пароль должен содержать хотя бы одну заглавную букву";
  if (!/\d/.test(password)) return "Пароль должен содержать хотя бы одну цифру";
  if (!/[^A-Za-z0-9]/.test(password)) return "Пароль должен содержать хотя бы один специальный символ";
  return "";
}

export default function CashierRegistrationPage() {
  const { token } = useAuth();
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState({ username: "", password: "", confirm_password: "" });

  async function handleSubmit(event) {
    event.preventDefault();
    const formEl = event.currentTarget;
    setSuccessMessage("");
    setErrorMessage("");

    const formData = new FormData(formEl);
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirm_password") || "");
    const nextFieldErrors = {
      username: username ? "" : "Поле обязательно",
      password: password ? "" : "Поле обязательно",
      confirm_password: confirmPassword ? "" : "Поле обязательно"
    };
    setFieldErrors(nextFieldErrors);
    if (nextFieldErrors.username || nextFieldErrors.password || nextFieldErrors.confirm_password) return;

    const passwordError = getPasswordValidationError(password);

    if (passwordError) {
      setErrorMessage("");
      setFieldErrors((prev) => ({ ...prev, password: passwordError }));
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Пароли не совпадают");
      return;
    }

    setPending(true);
    try {
      const { data } = await api.post("/auth/cashier-register", { username, password });
      setSuccessMessage(data?.message || "Заявка отправлена и ожидает подтверждения админа.");
      formEl.reset();
      setFieldErrors({ username: "", password: "", confirm_password: "" });
    } catch (error) {
      const detail = error?.response?.data?.detail || "Не удалось отправить заявку";
      if (detail === "Пароль должен быть не короче 10 символов") {
        setErrorMessage("");
        setFieldErrors((prev) => ({ ...prev, password: detail }));
      } else {
        setErrorMessage(detail);
      }
    } finally {
      setPending(false);
    }
  }

  if (token) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="login-screen">
      <form className="login-glass" onSubmit={handleSubmit} noValidate>
        <h1>Регистрация кассира</h1>
        <p className="login-subtitle">После отправки заявки администратор должен подтвердить аккаунт</p>

        <label className="login-field">
          <span>Логин</span>
          <input
            name="username"
            minLength={3}
            placeholder="Придумай логин"
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
          <div className="login-password-wrap">
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              minLength={10}
              placeholder={PASSWORD_RULE_HINT}
              className={fieldErrors.password ? "input-error" : ""}
              onChange={() => {
                if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: "" }));
              }}
              required
            />
            <button
              type="button"
              className="login-password-toggle"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
              title={showPassword ? "Скрыть пароль" : "Показать пароль"}
            >
              {showPassword ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M3 3l18 18M10.58 10.59A2 2 0 0013.41 13.4M9.88 5.09A10.94 10.94 0 0112 4c5 0 9.27 3.11 11 8-1.1 3.09-3.33 5.49-6.12 6.91M6.61 6.63C4.36 8.09 2.64 9.94 1 12c.68 1.92 1.79 3.58 3.2 4.91"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M1 12C2.73 7.11 7 4 12 4s9.27 3.11 11 8c-1.73 4.89-6 8-11 8S2.73 16.89 1 12z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" fill="none" />
                </svg>
              )}
            </button>
          </div>
          <span className={`field-error ${fieldErrors.password ? "" : "field-error-placeholder"}`}>
            {fieldErrors.password || "."}
          </span>
        </label>

        <label className="login-field">
          <span>Подтверждение пароля</span>
          <div className="login-password-wrap">
            <input
              name="confirm_password"
              type={showConfirmPassword ? "text" : "password"}
              minLength={10}
              placeholder="Введите пароль повторно"
              className={fieldErrors.confirm_password ? "input-error" : ""}
              onChange={() => {
                if (fieldErrors.confirm_password) setFieldErrors((prev) => ({ ...prev, confirm_password: "" }));
              }}
              required
            />
            <button
              type="button"
              className="login-password-toggle"
              onClick={() => setShowConfirmPassword((prev) => !prev)}
              aria-label={showConfirmPassword ? "Скрыть пароль" : "Показать пароль"}
              title={showConfirmPassword ? "Скрыть пароль" : "Показать пароль"}
            >
              {showConfirmPassword ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M3 3l18 18M10.58 10.59A2 2 0 0013.41 13.4M9.88 5.09A10.94 10.94 0 0112 4c5 0 9.27 3.11 11 8-1.1 3.09-3.33 5.49-6.12 6.91M6.61 6.63C4.36 8.09 2.64 9.94 1 12c.68 1.92 1.79 3.58 3.2 4.91"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M1 12C2.73 7.11 7 4 12 4s9.27 3.11 11 8c-1.73 4.89-6 8-11 8S2.73 16.89 1 12z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" fill="none" />
                </svg>
              )}
            </button>
          </div>
          <span className={`field-error ${fieldErrors.confirm_password ? "" : "field-error-placeholder"}`}>
            {fieldErrors.confirm_password || "."}
          </span>
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
