/**
 * Visit counting for the two install pages.
 *
 * ─── OFF until you fill in the code below ───────────────────────────────────
 *
 * GitHub Pages keeps no access logs, so the add-on itself cannot be measured:
 * once someone has installed it, Stremio fetches the manifest and catalogs
 * directly and nothing here ever runs again. What this can tell you is how
 * many people reach the install page and how many of them press Install.
 *
 * Setup (about a minute, free):
 *   1. Sign up at https://www.goatcounter.com and pick a site code.
 *   2. Put that code between the quotes below and push.
 *   3. Your dashboard is at https://<code>.goatcounter.com
 *
 * GoatCounter is used because it sets no cookies and collects no personal
 * data, which matters for a page other people are asked to visit. Leaving the
 * code empty disables all of this — no request is made and no note is shown.
 */
const GOATCOUNTER_CODE = "";

(function () {
  if (!GOATCOUNTER_CODE) return;

  const script = document.createElement("script");
  script.async = true;
  script.src = "//gc.zgo.at/count.js";
  script.dataset.goatcounter = `https://${GOATCOUNTER_CODE}.goatcounter.com/count`;
  document.head.appendChild(script);

  /** Count a named action. Page views are counted by the script itself. */
  const event = (name) => {
    if (window.goatcounter && window.goatcounter.count) {
      window.goatcounter.count({ path: name, title: name, event: true });
    }
  };

  // Pressing Install is the closest thing to an install signal a static page
  // has — Stremio takes over from there and never reports back.
  document.addEventListener("click", (e) => {
    const link = e.target.closest("a.install");
    if (link) event("install-click");
    else if (e.target.closest("#copyBtn")) event("copy-url");
  });

  // Say so on the page rather than counting people quietly.
  document.addEventListener("DOMContentLoaded", () => {
    const note = document.querySelector(".note");
    if (!note) return;
    const line = document.createElement("span");
    line.style.display = "block";
    line.style.marginTop = ".6em";
    line.style.opacity = ".65";
    line.textContent = "Visits are counted with GoatCounter — no cookies, no personal data.";
    note.appendChild(line);
  });
})();
