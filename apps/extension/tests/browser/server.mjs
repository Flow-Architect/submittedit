import { createServer } from "node:http";

const hostname = "127.0.0.1";
const port = 4179;

const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'",
  "Content-Type": "text/html; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function page(body) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>SubmittedIt extension test fixture</title>
    <style>
      body { font-family: sans-serif; max-width: 44rem; margin: 3rem auto; padding: 0 1rem; }
      label { display: grid; gap: .25rem; margin: 1rem 0; }
    </style>
  </head>
  <body>
    <h1>Synthetic extension fixture</h1>
    ${body}
  </body>
</html>`;
}

const withForm = page(`
  <form id="synthetic-form">
    <label>
      Fictional display name
      <input name="displayName" value="Alex Example">
    </label>
    <label>
      Synthetic contact
      <input name="contact" type="email" value="alex@example.invalid">
    </label>
    <button type="submit">Test-only button</button>
  </form>
  <script>
    window.__fixtureState = {
      initialDisplayName: document.querySelector('[name="displayName"]').value,
      initialContact: document.querySelector('[name="contact"]').value,
      submitted: false
    };
    document.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      window.__fixtureState.submitted = true;
    });
  </script>
`);

const withoutForm = page(`
  <p id="no-form-marker">This synthetic page intentionally has no form.</p>
`);

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("ok");
    return;
  }
  if (request.url === "/with-form") {
    response.writeHead(200, securityHeaders);
    response.end(withForm);
    return;
  }
  if (request.url === "/without-form") {
    response.writeHead(200, securityHeaders);
    response.end(withoutForm);
    return;
  }
  response.writeHead(404, securityHeaders);
  response.end(page("<p>Not found.</p>"));
});

server.listen(port, hostname);

function stop() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
