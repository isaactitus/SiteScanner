// fix-code-generator.js

const HEADER_VALUES = {
  "content-security-policy": "default-src 'self'",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-frame-options": "SAMEORIGIN",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

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
    .map(h => `            { "key": "${HEADER_DISPLAY_NAMES[h]}", "value": "${HEADER_VALUES[h]}" }`)
    .join(",\n");

  return `// vercel.json (Works for ANY framework on Vercel)
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
${headerEntries}
      ]
    }
  ]
}`;
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

  const known = missingHeaders.filter((h) => HEADER_VALUES[h]);
  if (known.length === 0) return null;

  let code;
  let label;

  switch (platform) {
    case "vercel":
      code = generateVercelSnippet(known);
      label = "vercel.json (Vercel Infrastructure)";
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