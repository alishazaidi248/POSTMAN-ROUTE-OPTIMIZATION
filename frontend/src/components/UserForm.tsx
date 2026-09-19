import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import styles from "../styles/components.module.css";

const schema = z
  .object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Enter a valid email"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    role: z.enum(["ADMIN", "SUPER_ADMIN"]),
    postOfficeId: z.string().optional()
  })
  .refine((data) => data.role === "SUPER_ADMIN" || !!data.postOfficeId, {
    message: "Select a post office for an admin account",
    path: ["postOfficeId"]
  });

export type UserFormValues = z.infer<typeof schema>;

interface PostOfficeOption {
  id: string;
  name: string;
  code: string;
}

export function UserForm({
  onSubmit,
  onCancel
}: {
  onSubmit: (values: UserFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const { data: postOffices } = useQuery<PostOfficeOption[]>({
    queryKey: ["post-offices"],
    queryFn: () => apiClient.get("/post-offices").then((r) => r.data)
  });

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<UserFormValues>({ resolver: zodResolver(schema), defaultValues: { role: "ADMIN" } });

  const role = watch("role");

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className={styles.formGroup}>
        <label htmlFor="name">Full Name</label>
        <input id="name" className={styles.input} {...register("name")} />
        {errors.name && <span className={styles.errorText}>{errors.name.message}</span>}
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="email">Email</label>
        <input id="email" className={styles.input} type="email" {...register("email")} />
        {errors.email && <span className={styles.errorText}>{errors.email.message}</span>}
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="password">Temporary Password</label>
        <input id="password" className={styles.input} type="password" {...register("password")} />
        {errors.password && <span className={styles.errorText}>{errors.password.message}</span>}
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="role">Role</label>
        <select id="role" className={styles.input} {...register("role")}>
          <option value="ADMIN">Admin (scoped to one post office)</option>
          <option value="SUPER_ADMIN">Super Admin (sees all post offices)</option>
        </select>
      </div>

      {role !== "SUPER_ADMIN" && (
        <div className={styles.formGroup}>
          <label htmlFor="postOfficeId">Post Office</label>
          <select id="postOfficeId" className={styles.input} {...register("postOfficeId")}>
            <option value="">Select a post office…</option>
            {postOffices?.map((po) => (
              <option key={po.id} value={po.id}>{po.name} ({po.code})</option>
            ))}
          </select>
          {errors.postOfficeId && <span className={styles.errorText}>{errors.postOfficeId.message}</span>}
        </div>
      )}

      <div className={styles.toolbar} style={{ justifyContent: "flex-end", marginTop: 8 }}>
        <button type="button" className={styles.button} onClick={onCancel}>Cancel</button>
        <button type="submit" className={styles.buttonPrimary} disabled={isSubmitting}>
          {isSubmitting ? "Creating…" : "Create Account"}
        </button>
      </div>
    </form>
  );
}
