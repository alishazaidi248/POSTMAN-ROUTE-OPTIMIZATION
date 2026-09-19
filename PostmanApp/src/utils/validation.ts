import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters")
});

export type LoginFormValues = z.infer<typeof loginSchema>;

export const statusReasonSchema = z.object({
  reason: z.string().max(500, "Keep notes under 500 characters").optional()
});

/** Loose validation for native-dialer calls — real number validation
 * (carrier routing, formatting) belongs to the OS dialer, not this app. */
export function isCallablePhoneNumber(phone: string | null | undefined): phone is string {
  if (!phone) return false;
  return /^[+()\-\s\d]{6,20}$/.test(phone.trim());
}
