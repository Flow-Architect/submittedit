import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const outputDirectory = resolve(".output/chrome-mv3");
const manifestPath = join(outputDirectory, "manifest.json");
const requiredPermissions = new Set([
  "activeTab",
  "alarms",
  "notifications",
  "scripting",
  "sidePanel",
  "storage",
]);
const prohibitedPermissions = new Set([
  "bookmarks",
  "browsingData",
  "clipboardRead",
  "clipboardWrite",
  "cookies",
  "debugger",
  "downloads",
  "history",
  "identity",
  "management",
  "nativeMessaging",
  "tabs",
  "webNavigation",
  "webRequest",
]);
const expectedIcons = {
  16: "icon-16.png",
  32: "icon-32.png",
  48: "icon-48.png",
  128: "icon-128.png",
};

function fail(message) {
  throw new Error(`Extension build audit failed: ${message}`);
}

async function exists(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

async function readPngDimensions(path) {
  const bytes = await readFile(path);
  const signature = bytes.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a" || bytes.length < 24) {
    fail(`${relative(outputDirectory, path)} is not a valid PNG`);
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.manifest_version !== 3) {
  fail("manifest_version must be 3");
}

const actualPermissions = new Set(manifest.permissions ?? []);
for (const permission of requiredPermissions) {
  if (!actualPermissions.has(permission)) {
    fail(`required permission ${permission} is missing`);
  }
}
for (const permission of actualPermissions) {
  if (!requiredPermissions.has(permission)) {
    fail(`unexpected required permission ${permission}`);
  }
  if (prohibitedPermissions.has(permission)) {
    fail(`prohibited permission ${permission} is present`);
  }
}

if ((manifest.host_permissions ?? []).length !== 0) {
  fail("install-time host_permissions must be empty");
}
if (
  JSON.stringify(manifest).includes("<all_urls>") ||
  JSON.stringify(manifest).includes("*://*/*")
) {
  fail("blanket all-URL access is present");
}
if (
  JSON.stringify(manifest.optional_host_permissions) !==
  JSON.stringify(["http://*/*", "https://*/*"])
) {
  fail("optional_host_permissions must contain only the HTTP and HTTPS capacity patterns");
}
if ((manifest.content_scripts ?? []).length !== 0) {
  fail("capture scripts must not be registered at install time");
}
if (manifest.externally_connectable) {
  fail("external messaging must not be enabled");
}
if (!manifest.side_panel?.default_path) {
  fail("side-panel entry point is missing");
}
if (!manifest.background?.service_worker) {
  fail("background service worker is missing");
}

const requiredOutputFiles = [
  manifest.side_panel.default_path,
  manifest.background.service_worker,
  "content-scripts/capture.js",
];
for (const file of requiredOutputFiles) {
  if (!(await exists(join(outputDirectory, file)))) {
    fail(`manifest output ${file} does not exist`);
  }
}

for (const [size, filename] of Object.entries(expectedIcons)) {
  if (manifest.icons?.[size] !== filename || manifest.action?.default_icon?.[size] !== filename) {
    fail(`manifest icon ${size} is incorrect`);
  }
  const iconPath = join(outputDirectory, filename);
  if (!(await exists(iconPath))) {
    fail(`icon ${filename} is missing`);
  }
  const dimensions = await readPngDimensions(iconPath);
  if (dimensions.width !== Number(size) || dimensions.height !== Number(size)) {
    fail(`icon ${filename} has incorrect dimensions`);
  }
}

const files = await walk(outputDirectory);
const sourceMaps = files.filter((file) => file.endsWith(".map"));
if (sourceMaps.length > 0) {
  fail(
    `source maps found: ${sourceMaps.map((file) => relative(outputDirectory, file)).join(", ")}`,
  );
}

const textFiles = files.filter((file) => /\.(?:css|html|js|json|mjs|txt)$/u.test(file));
for (const file of textFiles) {
  const contents = await readFile(file, "utf8");
  const relativePath = relative(outputDirectory, file);
  for (const forbidden of [
    "/home/ascabrya",
    "submittedit-workspace/control",
    "AGENTS.override.md",
    "BEGIN PRIVATE KEY",
    "BEGIN EC PRIVATE KEY",
    "localhost:3000",
    "127.0.0.1:3000",
  ]) {
    if (contents.includes(forbidden)) {
      fail(`${relativePath} contains forbidden text ${forbidden}`);
    }
  }
  if (/<script[^>]+src=["']https?:\/\//iu.test(contents)) {
    fail(`${relativePath} contains remotely hosted script code`);
  }
}

const workerSource = await readFile(
  join(outputDirectory, manifest.background.service_worker),
  "utf8",
);
for (const requiredCaptureBoundary of [
  "registerContentScripts",
  "getRegisteredContentScripts",
  "permissions.contains",
  "ATTEMPTED",
]) {
  if (!workerSource.includes(requiredCaptureBoundary)) {
    fail(`service worker is missing capture boundary ${requiredCaptureBoundary}`);
  }
}

const captureSource = await readFile(join(outputDirectory, "content-scripts/capture.js"), "utf8");
const javascriptSource = (
  await Promise.all(
    files.filter((file) => file.endsWith(".js")).map((file) => readFile(file, "utf8")),
  )
).join("\n");
for (const requiredRuntimeBoundary of [
  "content-scripts/capture.js",
  "SENSITIVE_HIDDEN_TOKEN",
  "FILE_METADATA_NOT_OPTED_IN",
]) {
  if (!javascriptSource.includes(requiredRuntimeBoundary)) {
    fail(`compiled runtime is missing reviewed boundary ${requiredRuntimeBoundary}`);
  }
}
for (const requiredCaptureCapability of [
  "FormData",
  "formdata",
  "submit",
  "PASSWORD",
  "one-time-code",
  "CAPTURE_ATTEMPT",
]) {
  if (!captureSource.includes(requiredCaptureCapability)) {
    fail(`capture bundle is missing reviewed capability ${requiredCaptureCapability}`);
  }
}
for (const forbiddenCaptureCapability of [
  "fetch(",
  "XMLHttpRequest",
  "WebSocket",
  "sendBeacon",
  "document.cookie",
  ".innerText",
  ".outerHTML",
  ".textContent",
  "BEGIN PRIVATE KEY",
  "testnet.monad",
]) {
  if (captureSource.includes(forbiddenCaptureCapability)) {
    fail(`capture bundle contains out-of-scope capability: ${forbiddenCaptureCapability}`);
  }
}

console.log(
  `Extension build audit passed (${files.length} files, ${actualPermissions.size} required permissions).`,
);
