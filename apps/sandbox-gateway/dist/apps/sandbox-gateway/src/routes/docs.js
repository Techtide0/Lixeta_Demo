/**
 * @file routes/docs.ts
 * @description Developer documentation routes.
 *
 *   GET /openapi.yaml  — serves the raw OpenAPI 3.0 spec
 *   GET /docs          — serves Swagger UI (loads spec from /openapi.yaml)
 *
 * Both routes are intentionally unprotected (no auth, no rate limiting)
 * so that developers and tooling can discover the contract freely.
 *
 * The Swagger UI is loaded from the unpkg CDN (pinned to swagger-ui-dist@5).
 * No additional npm packages are required.
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRouter } from "../lib/mini-router.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Read once at startup — deterministic, no hot-reload required.
const openapiYaml = readFileSync(resolve(__dirname, "../../openapi.yaml"), "utf8");
// ---------------------------------------------------------------------------
// Swagger UI HTML (single-file, CDN-hosted assets)
// ---------------------------------------------------------------------------
const SWAGGER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Lixeta Sandbox API — Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui.css" />
  <style>
    /* ── Base ─────────────────────────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f0f1a;
      color: #e2e8f0;
    }

    /* ── Top banner ───────────────────────────────────────────────────────── */
    .lixeta-header {
      background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%);
      border-bottom: 1px solid rgba(99, 102, 241, 0.3);
      padding: 18px 32px;
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .lixeta-header .logo {
      width: 36px;
      height: 36px;
      background: #4f46e5;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      font-weight: 800;
      color: #fff;
      flex-shrink: 0;
    }

    .lixeta-header h1 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 700;
      color: #fff;
      letter-spacing: -0.02em;
    }

    .lixeta-header .sub {
      font-size: 0.8rem;
      color: #a5b4fc;
      margin-top: 2px;
    }

    .lixeta-header .badge {
      margin-left: auto;
      background: rgba(99, 102, 241, 0.2);
      border: 1px solid rgba(99, 102, 241, 0.4);
      color: #a5b4fc;
      font-size: 0.7rem;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 999px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    /* ── Prism callout ───────────────────────────────────────────────────── */
    .prism-callout {
      margin: 16px 32px 0;
      background: rgba(16, 185, 129, 0.07);
      border: 1px solid rgba(16, 185, 129, 0.25);
      border-radius: 8px;
      padding: 12px 16px;
      font-size: 0.8rem;
      color: #6ee7b7;
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }

    .prism-callout .icon { font-size: 1rem; flex-shrink: 0; margin-top: 1px; }

    .prism-callout code {
      background: rgba(16, 185, 129, 0.15);
      border-radius: 4px;
      padding: 1px 6px;
      font-family: "Fira Code", "Cascadia Code", "JetBrains Mono", monospace;
      font-size: 0.78rem;
      color: #a7f3d0;
    }

    /* ── Swagger UI skin ─────────────────────────────────────────────────── */
    #swagger-ui { padding: 0 0 60px; }

    /* Hide the default topbar (we have our own header) */
    .swagger-ui .topbar { display: none !important; }

    /* Dark background overrides */
    .swagger-ui { background: transparent !important; }
    .swagger-ui .wrapper { background: transparent !important; }

    .swagger-ui .info        { background: #161625 !important; border-bottom: 1px solid #2d2d4a; padding: 28px 32px; margin: 0 !important; }
    .swagger-ui .info .title { color: #e2e8f0 !important; }
    .swagger-ui .info p      { color: #94a3b8 !important; }

    /* Tag sections */
    .swagger-ui .opblock-tag-section { background: #0f0f1a !important; }
    .swagger-ui .opblock-tag         { background: #161625 !important; border-bottom: 1px solid #2d2d4a !important; color: #e2e8f0 !important; }
    .swagger-ui .opblock-tag:hover   { background: #1e1e35 !important; }
    .swagger-ui .opblock-tag h3,
    .swagger-ui .opblock-tag span    { color: #e2e8f0 !important; }

    /* Operation blocks */
    .swagger-ui .opblock              { background: #161625 !important; border-color: #2d2d4a !important; margin: 6px 32px !important; border-radius: 8px !important; }
    .swagger-ui .opblock-summary      { background: transparent !important; }
    .swagger-ui .opblock-summary-path { color: #e2e8f0 !important; }
    .swagger-ui .opblock-description-wrapper p,
    .swagger-ui .opblock-external-docs-wrapper p { color: #94a3b8 !important; }

    /* HTTP method badges */
    .swagger-ui .opblock.opblock-get    .opblock-summary-method { background: #1d4ed8 !important; }
    .swagger-ui .opblock.opblock-post   .opblock-summary-method { background: #059669 !important; }
    .swagger-ui .opblock.opblock-patch  .opblock-summary-method { background: #d97706 !important; }
    .swagger-ui .opblock.opblock-delete .opblock-summary-method { background: #dc2626 !important; }

    /* Expanded content */
    .swagger-ui .opblock-body-add-form-param  { background: #1a1a2e !important; }
    .swagger-ui .opblock-section-header       { background: #1e1e35 !important; }
    .swagger-ui .opblock-section-header label { color: #94a3b8 !important; }
    .swagger-ui .responses-inner h4,
    .swagger-ui .responses-inner h5           { color: #e2e8f0 !important; }
    .swagger-ui .response-col_status          { color: #a5b4fc !important; }
    .swagger-ui table.model thead tr th,
    .swagger-ui table.headers td              { color: #94a3b8 !important; }

    /* Code / models */
    .swagger-ui .model-box           { background: #1a1a2e !important; border-radius: 6px; }
    .swagger-ui .model               { color: #e2e8f0 !important; }
    .swagger-ui .model-title         { color: #a5b4fc !important; }
    .swagger-ui section.models       { background: #161625 !important; border-color: #2d2d4a !important; padding: 0 32px 20px; }
    .swagger-ui section.models h4    { color: #e2e8f0 !important; }

    /* Try-it-out buttons */
    .swagger-ui .btn.try-out__btn    { background: #4f46e5 !important; border-color: #4f46e5 !important; color: #fff !important; }
    .swagger-ui .btn.execute         { background: #4f46e5 !important; border-color: #4f46e5 !important; color: #fff !important; }
    .swagger-ui .btn.cancel          { background: transparent !important; border-color: #6b7280 !important; color: #94a3b8 !important; }

    /* Inputs */
    .swagger-ui input[type=text],
    .swagger-ui textarea,
    .swagger-ui select                { background: #0f0f1a !important; border-color: #2d2d4a !important; color: #e2e8f0 !important; }

    /* Response body */
    .swagger-ui .microlight           { background: #0f0f1a !important; border-radius: 6px !important; color: #a7f3d0 !important; }
    .swagger-ui .response-col_links   { color: #94a3b8 !important; }

    /* Markdown in descriptions */
    .swagger-ui .markdown p  { color: #94a3b8 !important; }
    .swagger-ui .markdown code { background: rgba(99,102,241,0.1); color: #a5b4fc; border-radius: 4px; padding: 1px 5px; }
    .swagger-ui .markdown table th { color: #94a3b8 !important; border-color: #2d2d4a !important; }
    .swagger-ui .markdown table td { color: #e2e8f0 !important; border-color: #2d2d4a !important; }

    /* Filter input */
    .swagger-ui .filter-container { background: #161625 !important; padding: 12px 32px; }
    .swagger-ui .operation-filter-input { background: #0f0f1a !important; border-color: #2d2d4a !important; color: #e2e8f0 !important; }

    /* Scrollbar */
    ::-webkit-scrollbar       { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: #0f0f1a; }
    ::-webkit-scrollbar-thumb { background: #2d2d4a; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #4f46e5; }
  </style>
</head>
<body>

  <!-- ── Branded header ─────────────────────────────────────────────────── -->
  <div class="lixeta-header">
    <div class="logo">L</div>
    <div>
      <h1>Lixeta Sandbox API</h1>
      <div class="sub">Interactive API documentation · v1.0.0</div>
    </div>
    <div class="badge">OpenAPI 3.0</div>
  </div>

  <!-- ── Prism mock server callout ──────────────────────────────────────── -->
  <div class="prism-callout">
    <span class="icon">⚡</span>
    <span>
      <strong>Test without the backend running:</strong>
      <code>npx @stoplight/prism-cli mock http://localhost:4000/openapi.yaml --port 4010</code>
      — then send requests to <code>http://localhost:4010</code>.
      Prism returns mock responses based on the spec examples.
    </span>
  </div>

  <!-- ── Swagger UI mount point ─────────────────────────────────────────── -->
  <div id="swagger-ui"></div>

  <script src="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: "/openapi.yaml",
      dom_id: "#swagger-ui",
      presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIBundle.SwaggerUIStandalonePreset,
      ],
      layout: "BaseLayout",
      deepLinking: true,
      defaultModelsExpandDepth: 1,
      defaultModelExpandDepth: 2,
      docExpansion: "list",
      filter: true,
      tryItOutEnabled: true,
      requestSnippetsEnabled: true,
      syntaxHighlight: { activated: true, theme: "monokai" },
      onComplete: function () {
        // Auto-set the server URL so Try-it-out works out of the box
        const serverInput = document.querySelector(".servers select");
        if (serverInput) serverInput.value = "http://localhost:4000";
      },
    });
  </script>
</body>
</html>`;
// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const router = createRouter();
/** GET /openapi.yaml — serve the raw spec so Prism, Swagger UI, and tooling can fetch it */
router.get("/openapi.yaml", (_req, res) => {
    res
        .set("Content-Type", "text/yaml; charset=utf-8")
        .set("Cache-Control", "no-cache")
        .status(200)
        .send(openapiYaml);
});
/** GET /docs — Swagger UI developer portal */
router.get("/docs", (_req, res) => {
    res
        .set("Content-Type", "text/html; charset=utf-8")
        .set("Cache-Control", "no-cache")
        .status(200)
        .send(SWAGGER_HTML);
});
export { router as docsRouter };
