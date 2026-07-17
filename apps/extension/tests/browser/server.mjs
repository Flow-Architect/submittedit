import { createServer } from "node:http";

const hostname = "127.0.0.1";
const port = 4179;

const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
  "Content-Type": "text/html; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function page(body, title = "SubmittedIt extension test fixture") {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
      body { font-family: sans-serif; max-width: 44rem; margin: 3rem auto; padding: 0 1rem; }
      label { display: grid; gap: .25rem; margin: 1rem 0; }
      fieldset { margin: 1rem 0; }
    </style>
  </head>
  <body>
    <h1>Synthetic extension fixture</h1>
    ${body}
  </body>
</html>`;
}

const withForm = page(`
  <form
    action="/submitted"
    enctype="multipart/form-data"
    id="synthetic-form"
    method="post"
    name="syntheticForm"
  >
    <label>
      Fictional display name
      <input name="displayName" value="Alex Example">
    </label>
    <label>
      Numeric control
      <input name="numericValue" type="number" value="12">
    </label>
    <label>
      Leading-zero sample
      <input name="leadingZeroCode" value="0012">
    </label>
    <label>
      Sample date
      <input name="sampleDate" type="date" value="2026-07-16">
    </label>
    <label>
      Notes
      <textarea name="notes">First line
Second line</textarea>
    </label>
    <label>
      Single selection
      <select name="singleChoice">
        <option value="first">First</option>
        <option selected value="second">Second</option>
      </select>
    </label>
    <label>
      Multiple selection
      <select multiple name="multipleChoice">
        <option selected value="alpha">Alpha</option>
        <option value="beta">Beta</option>
        <option selected value="gamma">Gamma</option>
      </select>
    </label>
    <fieldset>
      <legend>Checkboxes</legend>
      <label><input checked name="checkedChoice" type="checkbox" value="checked"> Checked</label>
      <label><input name="uncheckedChoice" type="checkbox" value="unchecked"> Unchecked</label>
    </fieldset>
    <fieldset>
      <legend>Radio</legend>
      <label><input name="radioChoice" type="radio" value="first"> First</label>
      <label><input checked name="radioChoice" type="radio" value="second"> Second</label>
    </fieldset>
    <input name="repeatedName" value="first repeated">
    <input name="repeatedName" value="second repeated">
    <input name="explicitEmpty" value="">
    <input disabled name="disabledValue" value="must-not-capture">
    <input name="password" type="password" value="forbidden-password-value">
    <input name="csrf_token" type="hidden" value="forbidden-csrf-value">
    <input name="authenticationToken" type="hidden" value="forbidden-auth-value">
    <input name="session_id" type="hidden" value="forbidden-session-value">
    <input name="requestNonce" type="hidden" value="forbidden-nonce-value">
    <input autocomplete="one-time-code" name="oneTimeCode" value="forbidden-otp-value">
    <label>
      Synthetic file
      <input name="attachment" type="file">
    </label>
    <button type="submit">Submit synthetic fixture</button>
  </form>
`);

const samePageForm = page(`
  <form id="same-page-form">
    <input name="displayName" value="Alex Example">
    <input name="leadingZeroCode" value="0012">
    <button type="submit">Submit without navigation</button>
  </form>
  <p id="submit-count">0</p>
  <script>
    window.__fixtureSubmitCount = 0;
    document.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      window.__fixtureSubmitCount += 1;
      document.querySelector('#submit-count').textContent = String(window.__fixtureSubmitCount);
    });
  </script>
`);

const submitted = page(
  `
  <p id="submitted-marker">The local synthetic site handled the form request.</p>
  <section aria-labelledby="queued-heading" id="confirmation-region">
    <h2 id="queued-heading">Transmission queued</h2>
    <p id="confirmation-evidence">Transmission queued. Queued is not accepted. Reference SYNTHETIC-123.</p>
    <p id="mixed-confirmation"><span>Visible status text.</span><span hidden>Hidden text must not become evidence.</span></p>
    <p>Official acceptance still pending.</p>
  </section>
  <a href="/confirmation-step-two">Open a later confirmation step</a>
`,
  "Synthetic filing status",
);

const confirmationStepTwo = page(
  `
  <p id="confirmation-step-two">Website processing remains queued.</p>
  <p id="confirmation-evidence">Second visible confirmation. Reference SYNTHETIC-456.</p>
  <a href="/submitted">Return to first status</a>
`,
  "Synthetic confirmation step two",
);

const redirectForm = page(`
  <form action="/redirect-start" method="post">
    <input name="displayName" value="Alex Example">
    <button type="submit">Submit redirect fixture</button>
  </form>
`);

const redirectedConfirmation = page(
  `
  <p id="redirect-marker">The synthetic request followed a same-tab redirect.</p>
  <p id="confirmation-evidence">Redirect confirmation shown. Reference REDIRECT-123.</p>
`,
  "Synthetic redirected confirmation",
);

const spaForm = page(`
  <form id="spa-form">
    <input name="displayName" value="Alex Example">
    <button type="submit">Submit SPA fixture</button>
  </form>
  <div aria-live="polite" id="spa-result"></div>
  <script>
    document.querySelector('#spa-form').addEventListener('submit', (event) => {
      event.preventDefault();
      history.pushState({ synthetic: true }, '', '/spa-confirmation');
      document.querySelector('#spa-result').innerHTML =
        '<p id="confirmation-evidence">Inline confirmation shown. Reference SPA-123.</p>';
    });
  </script>
`);

const crossOriginConfirmation = page(
  `
  <p id="cross-origin-marker">The same synthetic tab reached a different test origin.</p>
  <p id="confirmation-evidence">Cross-origin confirmation shown. Reference CROSS-123.</p>
`,
  "Synthetic cross-origin confirmation",
);

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
  if (request.url === "/with-form" && request.method === "GET") {
    response.writeHead(200, securityHeaders);
    response.end(withForm);
    return;
  }
  if (request.url === "/same-page-form" && request.method === "GET") {
    response.writeHead(200, securityHeaders);
    response.end(samePageForm);
    return;
  }
  if (request.url === "/redirect-form" && request.method === "GET") {
    response.writeHead(200, securityHeaders);
    response.end(redirectForm);
    return;
  }
  if (request.url === "/spa-form" && request.method === "GET") {
    response.writeHead(200, securityHeaders);
    response.end(spaForm);
    return;
  }
  if (request.url === "/spa-confirmation" && request.method === "GET") {
    response.writeHead(200, securityHeaders);
    response.end(spaForm);
    return;
  }
  if (request.url === "/confirmation-step-two" && request.method === "GET") {
    response.writeHead(200, securityHeaders);
    response.end(confirmationStepTwo);
    return;
  }
  if (request.url === "/redirected-confirmation" && request.method === "GET") {
    response.writeHead(200, securityHeaders);
    response.end(redirectedConfirmation);
    return;
  }
  if (request.url === "/cross-origin-confirmation" && request.method === "GET") {
    response.writeHead(200, securityHeaders);
    response.end(crossOriginConfirmation);
    return;
  }
  if (request.url === "/without-form" && request.method === "GET") {
    response.writeHead(200, securityHeaders);
    response.end(withoutForm);
    return;
  }
  if (request.url === "/submitted" && request.method === "POST") {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, securityHeaders);
      response.end(submitted);
    });
    return;
  }
  if (request.url === "/submitted" && request.method === "GET") {
    response.writeHead(200, securityHeaders);
    response.end(submitted);
    return;
  }
  if (request.url === "/redirect-start" && request.method === "POST") {
    request.resume();
    request.on("end", () => {
      response.writeHead(303, { ...securityHeaders, Location: "/redirected-confirmation" });
      response.end();
    });
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
