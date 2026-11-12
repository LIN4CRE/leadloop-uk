import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const required = [
  "index.html",
  "styles.css",
  "app.js",
  "core.js",
  "sw.js",
  "manifest.webmanifest",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "src/constants.js",
  "src/utils.js",
  "src/quotes.js",
  "src/repeat.js",
  "src/analytics.js",
  "src/templates.js",
  "src/csv.js",
  "src/migration.js",
  "src/db.js",
  "src/print.js",
];
for (const file of required) await access(resolve(file));
const manifest = JSON.parse(await readFile("manifest.webmanifest", "utf8"));
if (!manifest.name || !manifest.start_url || !Array.isArray(manifest.icons))
  throw new Error("PWA manifest is missing required fields.");
for (const size of ["192x192", "512x512"]) {
  if (!manifest.icons.some((icon) => icon.sizes === size))
    throw new Error(`Manifest needs a ${size} icon.`);
}
const html = await readFile("index.html", "utf8");
for (const asset of ["./styles.css", "./app.js", "./manifest.webmanifest"]) {
  if (!html.includes(asset))
    throw new Error(`index.html does not reference ${asset}`);
}
console.log(
  `Static build validation passed (${required.length} files; manifest and entry references valid).`,
);
