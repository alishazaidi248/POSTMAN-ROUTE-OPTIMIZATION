import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import styles from "../styles/components.module.css";

const createSchema = z.object({
  employeeId: z.string().min(1, "Employee ID is required"),
  name: z.string().min(1, "Name is required"),
  phone: z.string().min(10, "Enter a valid 10-digit phone number").max(15),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  address: z.string().optional(),
  emergencyContact: z.string().optional(),
  postOfficeId: z.string().optional()
});

export type PostmanFormValues = z.infer<typeof createSchema>;

interface PostmanFormProps {
  defaultValues?: Partial<PostmanFormValues>;
  submitLabel: string;
  onSubmit: (values: PostmanFormValues) => Promise<void>;
  onCancel: () => void;
  disableEmployeeId?: boolean;
  /** Show a Post Office picker — needed when a Super Admin (no single home office) creates a postman. */
  requirePostOffice?: boolean;
}

export function PostmanForm({
  defaultValues,
  submitLabel,
  onSubmit,
  onCancel,
  disableEmployeeId,
  requirePostOffice
}: PostmanFormProps) {
  const { data: postOffices } = useQuery<{ id: string; name: string; code: string }[]>({
    queryKey: ["post-offices"],
    queryFn: () => apiClient.get("/post-offices").then((r) => r.data),
    enabled: !!requirePostOffice
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<PostmanFormValues>({ resolver: zodResolver(createSchema), defaultValues });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {requirePostOffice && (
        <div className={styles.formGroup}>
          <label htmlFor="postOfficeId">Post Office</label>
          <select id="postOfficeId" className={styles.input} {...register("postOfficeId", { required: true })}>
            <option value="">Select a post office…</option>
            {postOffices?.map((po) => (
              <option key={po.id} value={po.id}>{po.name} ({po.code})</option>
            ))}
          </select>
        </div>
      )}

      <div className={styles.formGroup}>
        <label htmlFor="employeeId">Employee ID</label>
        <input
          id="employeeId"
          className={styles.input}
          disabled={disableEmployeeId}
          {...register("employeeId")}
        />
        {errors.employeeId && <span className={styles.errorText}>{errors.employeeId.message}</span>}
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="name">Full Name</label>
        <input id="name" className={styles.input} {...register("name")} />
        {errors.name && <span className={styles.errorText}>{errors.name.message}</span>}
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="phone">Phone</label>
        <input id="phone" className={styles.input} {...register("phone")} />
        {errors.phone && <span className={styles.errorText}>{errors.phone.message}</span>}
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="email">Email (optional)</label>
        <input id="email" className={styles.input} type="email" {...register("email")} />
        {errors.email && <span className={styles.errorText}>{errors.email.message}</span>}
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="address">Address (optional)</label>
        <input id="address" className={styles.input} {...register("address")} />
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="emergencyContact">Emergency Contact (optional)</label>
        <input id="emergencyContact" className={styles.input} {...register("emergencyContact")} />
      </div>

      <div className={styles.toolbar} style={{ justifyContent: "flex-end", marginTop: 8 }}>
        <button type="button" className={styles.button} onClick={onCancel}>Cancel</button>
        <button type="submit" className={styles.buttonPrimary} disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
