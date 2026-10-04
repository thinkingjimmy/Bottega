/**
 * [INPUT]: Vite CSS resource imports.
 * [OUTPUT]: Type declarations for stylesheet URLs and side-effect stylesheets.
 * [POS]: Shared stylesheet import contracts for browser and desktop TypeScript builds.
 */
declare module "*.css";
declare module "*.css?url" { const url: string; export default url; }
