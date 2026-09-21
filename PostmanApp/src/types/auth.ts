// Mirrors backend/prisma/schema.prisma `UserRole` exactly — do not add values
// here that the backend enum does not have.
export type UserRole = "SUPER_ADMIN" | "ADMIN" | "POSTMAN";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  postOfficeId: string | null;
  postmanId: string | null;
  /** The account still has the temporary password an administrator set: a new one must be chosen first. */
  mustChangePassword?: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}
