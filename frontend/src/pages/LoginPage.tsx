import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "../lib/auth";
import styles from "../styles/components.module.css";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters")
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      await login(values.email, values.password);
      navigate("/", { replace: true });
    } catch (err: any) {
      const status = err?.response?.status;
      setServerError(
        status === 401 ? "Invalid email or password."
        : status === 429 ? "Too many sign-in attempts. Wait a few minutes and try again."
        : !err?.response && !err?.message?.startsWith("This panel") ? "Cannot reach the server. Try again in a moment."
        : err?.response?.data?.error?.message ?? err?.message ?? "Could not sign in."
      );
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-bg)"
      }}
    >
      <form
        onSubmit={handleSubmit(onSubmit)}
        className={styles.card}
        style={{ width: 360 }}
      >
        <div style={{ borderBottom: "3px solid var(--color-red-700)", paddingBottom: 12, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>Postal Delivery Operations</div>
          <div style={{ fontSize: 12, color: "var(--color-ink-500)", marginTop: 2 }}>
            Admin sign-in
          </div>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="email">Email</label>
          <input id="email" className={styles.input} type="email" autoComplete="username" {...register("email")} />
          {errors.email && <span className={styles.errorText}>{errors.email.message}</span>}
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="password">Password</label>
          <input id="password" className={styles.input} type="password" autoComplete="current-password" {...register("password")} />
          {errors.password && <span className={styles.errorText}>{errors.password.message}</span>}
        </div>

        {serverError && <div className={styles.errorText} style={{ marginBottom: 12 }}>{serverError}</div>}

        <button className={styles.buttonPrimary} type="submit" disabled={isSubmitting} style={{ width: "100%" }}>
          {isSubmitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
