/// <reference types="vite/client" />

declare module "*.module.css" {
  const classes: { [key: string]: string };
  export default classes;
}

interface ImportMetaEnv {
  /** The backend's absolute API URL, set at build time when the admin panel is hosted on a different origin. */
  readonly VITE_API_BASE_URL?: string;
}
