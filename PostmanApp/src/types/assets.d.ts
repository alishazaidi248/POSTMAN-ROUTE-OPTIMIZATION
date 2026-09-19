// Side-effect CSS imports (web-only, e.g. maplibre-gl/dist/maplibre-gl.css)
// aren't resolved by tsc's module resolution on their own.
declare module "*.css";
