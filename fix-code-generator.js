// fix-code-generator.js
//
// Generates actual, syntactically correct configuration snippets for the
// missing security headers found in a scan — tailored to the detected
// hosting platform. This is NOT AI-generated text; every template here is
// hand-written against each platform's own official documentation syntax:
//
//   Vercel   -> next.config.js headers() API
//              https://nextjs.org/docs/app/api-reference/config/next-config-js/headers
//   Apache   -> mod_headers "Header set" directive (.htaccess)
//              https://httpd.apache.org/docs/current/mod/mod_headers.html
//   Nginx    -> add_header directive (nginx.conf / server block)
//              https://nginx.org/en/docs/http/ngx_http_headers_module.html
//   Netlify  -> _headers file syntax
//              https://docs.netlify.com/routing/headers/
//   Generic  -> raw HTTP header names/values, for any other stack
//
// IMPORTANT FRAMING: this is a correct STARTING POINT to review and adapt,
// not a blind paste-and-forget fix. Every existing site has its own config
// already in place, and merging carelessly can break things. The generated
// output always carries that caveat — this file must never present output
// as guaranteed-safe-to-deploy-as-is.

const HEADER_VALUES = {
  "content-security-policy": "default-src 'self'",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-frame-options": "SAMEORIGIN",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

// Human-readable header name as it appears in actual HTTP responses
// (the raw scan data lowercases these, but real headers are capitalized).
const HEADER_DISPLAY_NAMES = {
  "content-security-policy": "Content-Security-Policy",
  "strict-transport-security": "Strict-Transport-Security",
  "x-frame-options": "X-Frame-Options",
  "x-content-type-options": "X-Content-Type-Options",
  "referrer-policy": "Referrer-Policy",
  "permissions-policy": "Permissions-Policy",
};

function generateVercelSnippet(missingHeaders) {
  const headerEntries = missingHeaders
    .map(
      (h) => `          {
            key: '${HEADER_DISPLAY_NAMES[h]}',
            value: "${HEADER_VALUES[h]}",
          },`
    )
    .join("\n");

  return `// next.config.js
module.exports = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
${headerEntries}
        ],
      },
    ];
  },
};`;
}

function generateApacheSnippet(missingHeaders) {
  const lines = missingHeaders
    .map((h) => `    Header set ${HEADER_DISPLAY_NAMES[h]} "${HEADER_VALUES[h]}"`)
    .join("\n");

  return `# .htaccess (requires mod_headers enabled)
<IfModule mod_headers.c>
${lines}
</IfModule>`;
}

function generateNginxSnippet(missingHeaders) {
  const lines = missingHeaders
    .map((h) => `    add_header ${HEADER_DISPLAY_NAMES[h]} "${HEADER_VALUES[h]}" always;`)
    .join("\n");

  return `# Inside your server { } block in nginx.conf
${lines}`;
}

function generateNetlifySnippet(missingHeaders) {
  const lines = missingHeaders
    .map((h) => `  ${HEADER_DISPLAY_NAMES[h]}: ${HEADER_VALUES[h]}`)
    .join("\n");

  return `# _headers file, placed in your site's publish directory
/*
${lines}`;
}

function generateGenericSnippet(missingHeaders) {
  const lines = missingHeaders
    .map((h) => `${HEADER_DISPLAY_NAMES[h]}: ${HEADER_VALUES[h]}`)
    .join("\n");

  return `# Raw HTTP header names and values — add these via whatever
# mechanism your server/framework/CDN provides:
${lines}`;
}

function generateFixCode(platform, missingHeaders) {
  if (!missingHeaders || missingHeaders.length === 0) return null;

  // Only generate for headers we have known-good values for
  const known = missingHeaders.filter((h) => HEADER_VALUES[h]);
  if (known.length === 0) return null;

  let code;
  let label;

  switch (platform) {
    case "vercel":
      code = generateVercelSnippet(known);
      label = "next.config.js (Vercel / Next.js)";
      break;
    case "apache":
      code = generateApacheSnippet(known);
      label = ".htaccess (Apache)";
      break;
    case "nginx":
      code = generateNginxSnippet(known);
      label = "nginx.conf (Nginx)";
      break;
    case "wordpress":
      // WordPress usually sits on Apache or Nginx under the hood — Apache
      // (.htaccess) is the far more common default on shared WP hosting.
      code = generateApacheSnippet(known);
      label = ".htaccess (most WordPress hosts use Apache)";
      break;
    default:
      code = generateGenericSnippet(known);
      label = "Raw header values (platform not detected)";
  }

  return {
    label,
    code,
    disclaimer:
      "This is a correct starting point based on standard syntax for this platform — not a guaranteed drop-in fix. Review it against your existing config before deploying, since merging blindly can break an existing setup.",
  };
}

export { generateFixCode };