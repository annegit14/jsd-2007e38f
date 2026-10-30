/* Anne's job-search dashboard: plain JS, no build step. */
(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const main = $("#main");
  let D = null;                       // decrypted / loaded data
  const ui = {                        // view state (kept across tab switches)
    opps: { q: "", lane: "", path: "", tier: "", sort: "rank", watch: false, mail: false },
    list: "overall",                  // overall | speed | pay | fit | reliability | all
    tr: { q: "", status: "", lane: "", limit: 60, view: "apps" },
    open: new Set(), groups: {}, doc: null,
  };

  /* ---------------- helpers ---------------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (/^(https?:|mailto:)/i.test(String(u || "").trim()) ? String(u).trim() : null);
  const fmtDate = (s) => {
    if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return esc(s || "");
    const d = new Date(s + "T00:00:00");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
  };
  const linkify = (t) => esc(t).replace(/https?:\/\/[^\s<)"']+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u.length > 48 ? u.slice(0, 45) + "…" : u}</a>`)
    .replace(/([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/g, (m, e, off, str) => (str.slice(Math.max(0, off - 7), off).includes("mailto:") || str.slice(Math.max(0, off - 30), off).includes("://") ? m : `<a href="mailto:${e}">${e}</a>`));
  const uniq = (arr) => [...new Set(arr.filter((x) => x != null && x !== ""))].sort((a, b) => String(a).localeCompare(String(b)));
  /* ---------------- per-entry archive (this device: localStorage; all devices: "ua" flag from build) ---------------- */
  const AKEY = "ag-dash-archived";   // NOT cleared by "Lock & forget this device" (that only deletes the key)
  const nk = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const akey = (t, x) => [t, nk(x.co), nk(x.role)].concat(t === "app" ? [nk(x.d)] : []).join("|");
  let LA = {};
  try { LA = JSON.parse(localStorage.getItem(AKEY) || "{}") || {}; } catch (e) { LA = {}; }
  const saveLA = () => { try { localStorage.setItem(AKEY, JSON.stringify(LA)); } catch (e) {} };
  const byMe = (t, x) => !!LA[akey(t, x)];
  // rejections: archived for everyone by the build ("rej"); a device can restore one (kept in ag-dash-unrej)
  const UKEY = "ag-dash-unrej", RSKEY = "ag-dash-rejseen", RAKEY = "ag-dash-rejack";
  const loadJ = (k) => { try { return JSON.parse(localStorage.getItem(k) || "{}") || {}; } catch (e) { return {}; } };
  const saveJ = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  let UNREJ = loadJ(UKEY), REJSEEN = loadJ(RSKEY), REJACK = loadJ(RAKEY);
  const rejArch = (t, x) => t === "app" && !!x.rej && !UNREJ[akey(t, x)];
  const isArch = (t, x) => !!(x.ua || byMe(t, x) || rejArch(t, x));
  // permanent delete (this device): separate set, same stable id. Also not cleared by "Lock & forget".
  const DKEY = "ag-dash-deleted";
  let LD = {};
  try { LD = JSON.parse(localStorage.getItem(DKEY) || "{}") || {}; } catch (e) { LD = {}; }
  const saveLD = () => { try { localStorage.setItem(DKEY, JSON.stringify(LD)); } catch (e) {} };
  const delBtn = (k) => `<button type="button" class="btn sm danger" data-del="${k}">Delete</button>`;
  function applyDeleted() {   // drop deleted entries from the loaded data so every view and count skips them
    D.opps = (D.opps || []).filter((o) => !LD[akey("job", o)]);
    D.act = (D.act || []).filter((a) => !LD[akey("act", a)]);
    D.apps = (D.apps || []).filter((a) => !LD[akey("app", a)]);
    D._idx = {}; D.opps.forEach((o) => (D._idx[o.id] = o));
    D.top = Object.fromEntries(Object.entries(D.top || {}).map(([k, v]) => [k, v.filter((id) => D._idx[id])]));
    ITEMS = {};
    D.opps.forEach((o) => (ITEMS[akey("job", o)] = ITEMS[akey("job", o)] || { t: "job", x: o }));
    D.act.forEach((a) => (ITEMS[akey("act", a)] = ITEMS[akey("act", a)] || { t: "act", x: a }));
    D.apps.forEach((a) => (ITEMS[akey("app", a)] = ITEMS[akey("app", a)] || { t: "app", x: a }));
    TR = null;
  }
  // "My notes": per-device free text per entry (same stable id). Read-only tracker Notes are separate and unchanged.
  const NKEY = "ag-dash-notes";
  let LN = {};
  try { LN = JSON.parse(localStorage.getItem(NKEY) || "{}") || {}; } catch (e) { LN = {}; }
  const saveLN = () => { try { localStorage.setItem(NKEY, JSON.stringify(LN)); } catch (e) {} };
  const noteOf = (t, x) => (LN[akey(t, x)] || {}).text || "";
  const notePv = (t, x) => { const n = noteOf(t, x).trim(); return n ? `<p class="notepv">📝 ${esc(n.split("\n")[0].slice(0, 90))}${n.length > 90 || n.includes("\n") ? "…" : ""}</p>` : ""; };
  function noteBox(t, x) {
    const k = akey(t, x), id = "n_" + Math.abs([...k].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36);
    return `<div class="mynote" data-stop><label for="${id}">My notes <span class="saved" aria-live="polite"></span></label>
      <textarea id="${id}" data-note="${esc(k)}" rows="3" placeholder="Your own notes (saved on this device)">${esc(noteOf(t, x))}</textarea></div>`;
  }
  const noteTimers = {};
  function onNoteInput(el) {
    const k = el.dataset.note, lab = el.parentElement.querySelector(".saved");
    if (lab) lab.textContent = "";
    clearTimeout(noteTimers[k]);
    noteTimers[k] = setTimeout(() => {
      const it = ITEMS[k], text = el.value;
      if (text.trim()) LN[k] = { t: it ? it.t : k.split("|")[0], co: it ? it.x.co : "", role: it ? it.x.role || "" : "", d: it ? it.x.d || "" : "", text, at: new Date().toISOString() };
      else delete LN[k];
      saveLN();
      if (lab) lab.textContent = "Saved";
    }, 600);
  }
  function exportNotes() {
    const rows = Object.values(LN).filter((n) => n && n.text && n.text.trim());
    const lab = { job: "Jobs", act: "Today / Act now", app: "Tracker" };
    const txt = `Anne's dashboard notes (exported ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC, this device)\n\n` +
      (rows.map((n) => `[${lab[n.t] || n.t}] ${n.co}${n.role ? " – " + n.role : ""}${n.d ? " (applied " + n.d + ")" : ""}\nUpdated ${String(n.at).slice(0, 10)}\n${n.text.trim()}`).join("\n\n---\n\n") || "(no notes yet)");
    const json = JSON.stringify({ exported: new Date().toISOString(), notes: rows.map((n) => ({ type: n.t, company: n.co, role: n.role, applied: n.d || null, note: n.text, updated: n.at })) }, null, 2);
    let copied = false;
    const done = () => toast(rows.length ? `${rows.length} note${rows.length === 1 ? "" : "s"} ${copied ? "copied and " : ""}downloaded. Send them to save in your library.` : "No notes to export yet");
    try {
      const url = URL.createObjectURL(new Blob([txt + "\n\n=== JSON ===\n" + json], { type: "text/plain" }));
      const a = document.createElement("a"); a.href = url; a.download = `my-dashboard-notes-${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {}
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => { copied = true; done(); }, done); else done();
  }
  // Optional auto-delete of entries archived by me >90 days ago (per device, OFF by default; checked on app load)
  const ADKEY = "ag-dash-autodel", AD_DAYS = 90;
  const autoDelOn = () => { try { return localStorage.getItem(ADKEY) === "1"; } catch (e) { return false; } };
  const autoDelCtl = (cls = "") => `<label class="check autodel ${cls}"><input type="checkbox" data-autodel${autoDelOn() ? " checked" : ""}> Auto-delete archived entries after ${AD_DAYS} days</label>`;
  function sweepArchived() {
    const now = Date.now(); let changed = false, moved = 0;
    for (const [k, v] of Object.entries(LA)) {
      const at = Date.parse((v && v.at) || "");
      if (!v || !v.at || isNaN(at)) { LA[k] = { ...(v || {}), at: new Date(now).toISOString() }; changed = true; continue; }   // undated: start the clock today
      if (autoDelOn() && now - at > AD_DAYS * 864e5) {
        LD[k] = { ...v, archivedAt: v.at, at: new Date(now).toISOString(), auto: true }; delete LA[k]; if (LN[k]) { delete LN[k]; saveLN(); } changed = true; moved++;
      }
    }
    for (const a of D.apps || []) {
      if (!a.rej) continue;
      const k = akey("app", a);
      if (!REJSEEN[k]) { REJSEEN[k] = new Date(now).toISOString(); changed = true; continue; }   // archive date = first seen here
      if (autoDelOn() && !UNREJ[k] && !LD[k] && now - Date.parse(REJSEEN[k]) > AD_DAYS * 864e5) {
        LD[k] = { t: "app", co: a.co, role: a.role || "", d: a.d || "", at: new Date(now).toISOString(), auto: true, rejected: true };
        if (LN[k]) { delete LN[k]; saveLN(); } changed = true; moved++;
      }
    }
    if (changed) { saveLA(); saveLD(); saveJ(RSKEY, REJSEEN); }
    return moved;
  }
  function deleteEntry(k) {
    const it = ITEMS[k]; if (!it) return;
    if (!window.confirm("Delete permanently from this app? This can't be undone.")) return;
    LD[k] = { t: it.t, co: it.x.co, role: it.x.role || "", d: it.x.d || "", at: new Date().toISOString() };
    saveLD();
    if (LA[k]) { delete LA[k]; saveLA(); }
    if (LN[k]) { delete LN[k]; saveLN(); }
    applyDeleted(); render();
    toast("Deleted from this app");
  }
  let ITEMS = {};   // key -> {t, x}, built at load
  // Snooze (A5): per device, pushes an item's due date by 3 business days (Mon-Fri)
  const SZKEY = "ag-dash-snooze";
  let SZ = loadJ(SZKEY);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayIso = () => iso(new Date());
  const addBiz = (from, n) => { const d = new Date(from + "T00:00:00"); while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) n--; } return iso(d); };
  const effDue = (t, x) => { const z = SZ[akey(t, x)]; return z && (!x.due || z.to > x.due) ? z.to : x.due; };
  function snooze(k) {
    const it = ITEMS[k]; if (!it) return;
    const cur = effDue(it.t, it.x), base = cur && cur > todayIso() ? cur : todayIso(), prev = SZ[k];
    SZ[k] = { to: addBiz(base, 3), at: new Date().toISOString() }; saveJ(SZKEY, SZ); render();
    toast("Snoozed to " + fmtDate(SZ[k].to), () => { if (prev) SZ[k] = prev; else delete SZ[k]; saveJ(SZKEY, SZ); render(); });
  }
  const MBN = { G: "Gmail", I: "iCloud", Y: "Yahoo-legacy", P: "Platform", T: "Phone" };
  const mbChip = (c) => (c && MBN[c] ? `<span class="chip mb mb-${c}" title="Mailbox">${MBN[c]}</span>` : "");
  const worthChip = (v) => (v != null ? `<span class="worth-s" title="Worth it (0-10)">★ ${v}</span>` : "");
  // v23 status categories: one colour each, friendly words only
  const CLOSED_RX = /archived|closed|reject|not selected|withdrawn|no longer|declin|not viable|position filled|not moving forward|no positions|no vacanc/i;
  const CATS = { offer: "Offer", interview: "Meeting", followup: "Follow-up due", scheduled: "Scheduled", waiting: "Waiting to hear", saved: "Saved", archived: "Archived" };
  function catOf(t, x) {
    const st = String(x.st || "");
    if (t === "app" && (x.arch || isArch("app", x))) return "archived";
    if (CLOSED_RX.test(st) || (t === "act" && isArch("act", x))) return "archived";
    if (/^offer|offer (received|accepted|extended|letter)|job offer/i.test(st)) return "offer";
    if (/interview/i.test(st)) return "interview";
    if (/scheduled|approved/i.test(st)) return "scheduled";
    if (/saved/i.test(st) || String(x.p) === "2") return "saved";
    const d = effDue(t, x), soon = (() => { const z = new Date(); z.setDate(z.getDate() + 7); return iso(z); })();
    if (d && d <= soon) return "followup";
    return "waiting";
  }
  const catChip = (c) => `<span class="chip cat cat-${c}">${CATS[c]}</span>`;
  const LANES_T = { pet: "Pet travel", med: "Medical tourism / patients", ai: "Medical AI", esl: "Online English tutoring", gen: "Other" };
  function archBtn(t, x) {
    const k = esc(akey(t, x));
    if (x.ua) return `<span class="muted small arch-all">Archived on all devices</span>${delBtn(k)}`;
    if (rejArch(t, x) && !byMe(t, x)) return `<button type="button" class="btn sm" data-unrej="${k}">Restore</button>${delBtn(k)}`;
    return (byMe(t, x) ? `<button type="button" class="btn sm" data-restore="${k}">Restore</button>`
      : `<button type="button" class="btn sm ghost" data-arch="${k}">Archive</button>`) + delBtn(k);
  }
  let toastT = null;
  function toast(msg, undo) {
    let el = document.getElementById("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite"); document.body.appendChild(el); }
    el.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button type="button" class="undo">Undo</button>` : ""}`;
    el.hidden = false; el.classList.add("show");
    clearTimeout(toastT);
    const hide = () => { el.classList.remove("show"); el.hidden = true; };
    if (undo) el.querySelector(".undo").onclick = () => { clearTimeout(toastT); hide(); undo(); };
    toastT = setTimeout(hide, 6000);
  }
  function setArchived(k, on, withToast = true) {
    const it = ITEMS[k]; if (!it) return;
    if (on) LA[k] = { t: it.t, co: it.x.co, role: it.x.role || "", d: it.x.d || "", at: new Date().toISOString() };
    else delete LA[k];
    saveLA(); TR = null; render();
    if (withToast) toast(on ? "Archived" : "Restored", () => setArchived(k, !on, false));
  }
  const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(label)}</option>`;

  /* ---------------- tiny safe markdown ---------------- */
  function inline(t) {
    let s = esc(String(t ?? "").replace(/\\([\\`*_{}\[\]()#+\-.!"'|])/g, "$1"));
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/\*\*(\S(?:.*?\S)?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    s = s.replace(/(^|[\s(:])((?:[a-z0-9-]+\.)+(?:com|org|net|ai|gov|io|co|app)(?:\/[^\s<)]*)?)(?=[\s).,;]|$)/gi, (m, pre, host) => host.includes("@") ? m : `${pre}<a href="https://${host}" target="_blank" rel="noopener noreferrer">${host}</a>`);
    s = s.replace(/(^|[\s(>])([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/g, '$1<a href="mailto:$2">$2</a>');
    return s;
  }
  function md(src) {
    const lines = String(src || "").replace(/\r/g, "").split("\n");
    let html = "", list = null, para = [], quote = [];
    const flushP = () => { if (para.length) { html += `<p>${inline(para.join(" "))}</p>`; para = []; } };
    const flushL = () => { if (list) { html += `<${list.t}>${list.items.map((i) => `<li>${i.h}${i.sub.length ? `<ul>${i.sub.map((x) => `<li>${x}</li>`).join("")}</ul>` : ""}</li>`).join("")}</${list.t}>`; list = null; } };
    const flushQ = () => { if (quote.length) { html += `<blockquote>${quote.map(inline).join("<br>")}</blockquote>`; quote = []; } };
    const flush = () => { flushP(); flushL(); flushQ(); };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      let m;
      if (!l.trim()) { flush(); continue; }
      if ((m = l.match(/^(#{1,4})\s+(.*)/))) { flush(); const n = m[1].length; html += `<h${n}>${inline(m[2])}</h${n}>`; continue; }
      if (/^\s*\|.*\|\s*$/.test(l) && lines[i + 1] && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        flush();
        const row = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        const head = row(l); i += 2;
        const body = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
        i--;
        html += `<div class="tbl"><table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
        continue;
      }
      if ((m = l.match(/^>\s?(.*)/))) { flushP(); flushL(); quote.push(m[1]); continue; }
      if ((m = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)/))) {
        flushP(); flushQ();
        const t = /\d/.test(m[2]) ? "ol" : "ul";
        const indent = m[1].length;
        if (list && indent >= 2 && list.items.length) { list.items[list.items.length - 1].sub.push(inline(m[3])); continue; }
        if (!list || list.t !== t) { flushL(); list = { t, items: [] }; }
        list.items.push({ h: inline(m[3]), sub: [] });
        continue;
      }
      if (list && /^\s{2,}\S/.test(l)) { const it = list.items[list.items.length - 1]; if (it.sub.length) it.sub[it.sub.length - 1] += " " + inline(l.trim()); else it.h += " " + inline(l.trim()); continue; }
      flushL(); flushQ(); para.push(l.trim());
    }
    flush();
    return `<div class="md">${html}</div>`;
  }

  /* ---------------- scores ---------------- */
  const SC = [["speed", "Spd", "Speed"], ["pay", "Pay", "Pay"], ["fit", "Fit", "Fit"], ["reliability", "Rel", "Reliability"], ["odds", "Odds", "Interview odds"]];
  const badges = (o, hl) => o.sc ? `<div class="badges">${SC.map(([k, ab, lab], i) => {
    const v = o.sc[i];
    return `<span class="b s${v == null ? 0 : Math.round(v)}${hl === k ? " hl" : ""}" title="${lab}" aria-label="${lab} ${v ?? "n/a"} of 5">${ab} <b>${v ?? "–"}</b></span>`;
  }).join("")}</div>` : "";
  const legalShort = (s) => String(s || "").split(/ - | \(/)[0];
  const legalCls = (s) => (/^pass/i.test(s || "") ? "good" : /^fail/i.test(s || "") ? "bad" : s ? "ok" : "");
  const tierCls = (t) => ({ A: "good", B: "ok", C: "bad" }[String(t || "").toUpperCase()] || "");

  function oppCard(o, ctx, hl, pos) {
    const id = ctx + ":" + o.id, open = ui.open.has(id);
    const meta = [
      o.tier && `<span class="t ${tierCls(o.tier)}">Tier ${esc(o.tier)}</span>`,
      o.legal && `<span class="t ${legalCls(o.legal)}">${esc(legalShort(o.legal))}</span>`,
      o.pay && o.pay !== "n/a" && esc(o.pay),
      (o.emails || []).length && `<span title="Has a contact email">✉</span>`,
      o.w && `<span class="t bad">Watchlist</span>`,
    ].filter(Boolean).join(" · ");
    const r = pos || o.rank;
    return `<article class="card opp${open ? " open" : ""}" data-id="${esc(id)}" tabindex="0" role="button" aria-expanded="${open}">
      <div class="head"><div class="rank${r ? "" : " none"}" title="${pos ? "List position" + (o.rank ? ", overall #" + o.rank : "") : "Overall rank"}">${r || "–"}</div>
        <div class="ttl"><h3>${esc(o.co)}</h3>${o.role ? `<p class="role">${esc(o.role)}</p>` : ""}</div></div>
      <div class="meta">${o.ws != null ? `<span class="worth-s">★ ${o.ws}</span> · ` : ""}${meta}</div>
      ${open || hl ? badges(o, hl) : ""}
      ${open ? oppDetail(o) : notePv("job", o)}
    </article>`;
  }
  function oppDetail(o) {
    const mail = emailBlock("job", o);
    const post = safeUrl(o.url) ? `<a class="btn" href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">Posting ↗</a>` : "";
    const contact = [o.who, o.est].filter(Boolean).join(" · ");
    const rows = [["Why these scores", o.why], ["How to apply", o.apply], ["Resume", o.resume], ["Email angle", o.angle],
      ["Contact", contact], ["Legal", o.legal], ["Work", o.work], ["Lane / path", [o.lane0 || o.lane, o.path && "Path " + o.path].filter(Boolean).join(" · ")],
      ["Reviews", o.rev]].filter(([, v]) => v);
    const host = (u) => new URL(u).hostname.replace(/^www\./, "");
    const proof = safeUrl(o.proof) || o.ev ? `<dt>Thailand proof</dt><dd>${o.ev ? esc(o.ev) + " " : ""}${safeUrl(o.proof) ? `<a href="${esc(o.proof)}" target="_blank" rel="noopener noreferrer">${esc(host(o.proof))} ↗</a>` : ""}${o.dv ? ` <span class="muted small">checked ${esc(String(o.dv).slice(0, 10))}</span>` : ""}</dd>` : "";
    const links = (o.links || []).filter(safeUrl).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(new URL(u).hostname.replace(/^www\./, ""))} ↗</a>`).join(" · ");
    return `<div class="detail" data-stop>
      <div class="actions">${mail}${post}${archBtn("job", o)}</div>
      ${o.flags ? `<div class="warn"><strong>Watch out:</strong> ${linkify(o.flags)}</div>` : ""}
      ${noteBox("job", o)}
      <dl>${rows.map(([h, v]) => `<dt>${esc(h)}</dt><dd>${linkify(v)}</dd>`).join("")}${proof}</dl>
      ${links ? `<p class="small muted" style="margin:8px 0 0">More: ${links}</p>` : ""}
    </div>`;
  }

  function worthDetail(a) {
    if (a.ws == null) return null;
    const f = (a.sc5 || []).map((v, i) => `${SC[i][2]} ${v ?? "–"}`).join(" · ");
    return `<b>${a.ws}</b>/10${f ? `<br><span class="small muted">${esc(f)} (each of 5), times the legal check</span>` : ""}`;
  }
  /* ---------------- email drafts (the app only opens a draft; it never sends anything) ---------------- */
  const SIG = "Anne Gyorgy, RN, BSN\nannegyorgy@gmail.com\nThailand: +66 92 270 7704\nUS: +1 919-214-0404";   // ANNE_FACTS: each phone on its own line
  const ME = "25+ years as a US RN (OB-GYN and hospice), including about 8 years of remote telephonic case management";   // ANNE_FACTS (8 vs 9 yrs: open question)
  const LANE_TPL = {
    pet: { inq: ["I'm a US RN and former medical-office operations manager with " + ME.replace("25+ years as a US RN ", "25+ years in nursing ") + ".",
        "I recently moved my own four cats from the US to Thailand, so I know the DLD import permit, rabies-titer timing and airline cargo rules first-hand.",
        "I'd love to help with Asia-side coordination: partner-agent follow-ups, document checks and client updates while your US team sleeps.",
        "Could we set up a 15-minute call? Resume attached."],
      fu: "I've handled an international pet move myself (US to Thailand: DLD import permit, rabies titers, airline cargo), so I know the paperwork first-hand." },
    med: { inq: ["I bring " + ME + ".",
        "Patients choosing treatment abroad need a plain-English explanation of the plan before they book, and someone they trust to follow up once they're home.",
        "I'd like to help your team with intake, records collection, pre-travel preparation and post-op check-ins (non-clinical coordination).",
        "Would a short call this week work? Resume attached."],
      fu: "I can help patients with intake, records collection and post-op check-ins in clear, plain English." },
    ai: { inq: ["I bring " + ME + ", and I'm TEFL-certified (120-hour course).",
        "I'd like to help your models handle health questions safely and clearly: writing rubrics, reviewing responses for accuracy, tone and escalation, and creating patient-education prompts.",
        "I work asynchronously and I'm happy to complete a skills assessment. Resume attached."],
      fu: "I'm comfortable writing rubrics and reviewing health answers for accuracy, tone and escalation." },
    esl: { inq: ["I'm TEFL-certified (120-hour course) and bring " + ME + ", so I'm used to explaining things clearly and patiently.",
        "I'd love to teach with you: conversational, professional and healthcare English.",
        "I'm available for flexible online hours. Resume attached; happy to do a demo lesson."],
      fu: "I'm also TEFL-certified (120-hour course) and enjoy explaining things clearly and patiently." },
    gen: { inq: ["I bring " + ME + ".",
        "I'm interested in {what} and think my patient-education, coordination and documentation experience would be a good fit.",
        "Resume attached. Would a short call work?"],
      fu: "I'm strong at patient education, care coordination and clear documentation." },
  };
  function laneOf(t, x) {
    const L = String(x.lane || "");
    if (t === "job" && /pet/i.test(L)) return "pet";
    if (t === "job" && /tourism|assistance/i.test(L)) return "med";
    if (t === "job" && /AI training|expert/i.test(L)) return "ai";
    const txt = [x.co, x.role, x.lane0, x.nx, t === "job" ? L : ""].join(" ");
    if (/\bpet|animal|relo4paws|jetpets|starwood/i.test(txt)) return "pet";
    if (/tutor|teach|\besl\b|tefl|english (teacher|tutor)|qkids|lesson/i.test(txt)) return "esl";
    if (/\bAI\b|annotat|evaluat|rubric|model|expert|\bSME\b|outlier|mercor|opentrain|alignerr|guidepoint|dialectica|glg|techspert/i.test(txt)) return "ai";
    if (/tourism|hospital|patient|assistance|clinic|dental|wellness|international sos|medical/i.test(txt)) return "med";
    return "gen";
  }
  function isFollowUp(t, x) {
    if (t === "app") return String(x.p) !== "2";
    if (t === "act") return !!x.d || /follow|applied|no reply|no response|viewed|interview/i.test([x.pr, x.st].join(" ")) && !/not yet contacted/i.test(x.st || "");
    return false;
  }
  function draft(t, x) {
    const lane = laneOf(t, x), T = LANE_TPL[lane], role = String(x.role || "").replace(/\s*\(.*$/, "").replace(/…$/, "").trim();
    const short = (v, n = 60) => (v.length > n ? v.slice(0, n).replace(/\s+\S*$/, "") + "…" : v);
    const laneLike = t === "act" && /training|network|relocation|tourism|insurance|adjacent|platform|^profile/i.test(role);
    const what = short(laneLike || !role ? x.co : role);
    let su, lines;
    if (isFollowUp(t, x)) {
      su = `Following up: ${what} – Anne Gyorgy`;
      lines = [`I'm following up on my application${role && !laneLike ? " for " + short(role, 80) : ""}${x.d ? " (sent " + fmtDate(x.d).replace(/<[^>]+>/g, "") + ")" : ""}. I'm still very interested.`,
        "Quick recap: US RN, 25+ years in OB-GYN and hospice, about 8 years of remote telephonic case management.", T.fu,
        "Happy to share anything else you need, or to talk at a time that suits you."];
    } else {
      su = `Inquiry: ${what}`;
      lines = T.inq.map((l) => l.replace("{what}", role && !laneLike ? `the ${short(role)} role at ${x.co}` : `opportunities at ${x.co}`));
    }
    return { su: su.slice(0, 110), body: `Hello,\n\n${lines.join("\n")}\n\nBest regards,\n${SIG}`, lane };
  }
  function emailBlock(t, x) {
    const ems = (t === "job" ? x.emails : x.em) || [];
    if (!ems.length) return `<span class="muted small noemail">No contact email yet</span>`;
    const d = draft(t, x), E = encodeURIComponent;
    return ems.map((e) => {
      const mailto = `mailto:${e}?subject=${E(d.su)}&body=${E(d.body)}`;
      const gm = `https://mail.google.com/mail/?authuser=annegyorgy@gmail.com&view=cm&fs=1&to=${E(e)}&su=${E(d.su)}&body=${E(d.body)}`;
      return `<span class="em-to small muted">To: ${esc(e)}</span><a class="btn primary sm" href="${esc(mailto)}" data-mail="app">✉ Email (Mail app)</a><a class="btn sm" href="${esc(gm)}" target="_blank" rel="noopener noreferrer" data-mail="gmail">Email in Gmail ↗</a>`;
    }).join("");
  }

  /* ---------------- views ---------------- */
  const byId = (id) => D._idx[id];
  // v33 Spare Time: gig platforms to work on in free time
  function spareCard() {
    const S = D.spare || [];
    if (!S.length) return "";
    const open = ui.groups["spare"] ?? true;
    const row = (s, i) => `<li class="sp alt${i % 4}"><div class="top"><b>${esc(s.emoji || "")} ${esc(s.name)}</b>${s.link ? `<a class="small" href="${esc(s.link)}" target="_blank" rel="noopener noreferrer">Open →</a>` : ""}</div><p class="small muted">${esc(s.status || "")}</p><p class="small">${esc(s.next || "")}</p></li>`;
    return `<details class="fold grp" data-g="spare"${open ? " open" : ""}><summary>Spare time · gig platforms<span class="n">${S.length}</span></summary><ul class="spare inner">${S.map(row).join("")}</ul></details>`;
  }
  function viewHome() {
    const pend = (D.pending || []).map((p, i) => { const id = "pend:" + i, open = ui.open.has(id);
      return `<li class="row alt${i % 4}${open ? " open" : ""}" data-id="${id}" tabindex="0" role="button" aria-expanded="${open}"><b>${esc(p.when)}</b><span class="nx">${linkify(p.text)}</span></li>`; }).join("");
    const groups = {};
    const actV = (D.act || []).filter((a) => !isArch("act", a)), actA = (D.act || []).length - actV.length;
    actV.forEach((a) => { const k = a.pr || "Other"; (groups[k] = groups[k] || []).push(a); });
    const act = Object.keys(groups).sort().map((k, gi) => {
      const rows = groups[k], key = "g:" + k;
      const isOpen = ui.groups[key] ?? (/^[01]\b/.test(k) || gi < 2);
      const gn = (D.act_notes || {})[k];
      return `<details class="fold grp" data-g="${esc(key)}"${isOpen ? " open" : ""}><summary>${esc(k.replace(/^\d+\s*-\s*/, ""))}<span class="n">${rows.length}</span></summary>
        ${gn ? `<p class="gnote">${esc(gn)}</p>` : ""}${rows.map((a, i) => actionCard(a, "act:" + k + i)).join("")}</details>`;
    }).join("");
    const H = D.act_hidden || [];
    const hidden = H.length ? `<details class="hidden-note"><summary>${H.length} removed-lead item${H.length === 1 ? "" : "s"} hidden</summary><ul>${H.map((h) =>
      `<li><b>${esc(h.co)}</b>: Removed lead – ${esc(h.why || "see reason in Jobs → All → Removed leads")}</li>`).join("")}</ul></details>` : "";
    // A1 "Do next": at most 7 items (soonest due, then priority group, then Worth it); everything else folded under More
    const prn = (a) => { const n = parseInt(String(a.pr || "9"), 10); return (Number.isNaN(n) ? 9 : n) + (/interview/i.test(a.st || "") ? -2 : /scheduled/i.test(a.st || "") ? 5 : 0); };
    const todo = actV.filter((a) => !/archived/i.test(a.st || ""));
    const ranked = todo.slice().sort((a, b) => String(effDue("act", a) || "9999").localeCompare(String(effDue("act", b) || "9999")) || prn(a) - prn(b) || (b.ws || 0) - (a.ws || 0));
    const top7 = ranked.slice(0, 7);
    const doNext = top7.map((a, i) => actionCard(a, "do:" + i)).join("");
    const moreOpen = !!ui.groups["more"];
    const more = `<details class="fold grp more" data-g="more"${moreOpen ? " open" : ""}><summary>More<span class="n">${Math.max(0, todo.length - top7.length)} more · all ${actV.length} by group</span></summary>
      ${moreOpen ? `<div class="inner">${act}${hidden}${actA ? `<a class="hidden-note arch-link" href="#opps/archived">${actA} archived by you · see Jobs › Archived</a>` : ""}</div>` : ""}</details>`;
    const nuOpen = !!ui.groups["nextup"];
    const nextup = pend ? `<details class="fold grp" data-g="nextup"${nuOpen ? " open" : ""}><summary>Coming up<span class="n">${(D.pending || []).length}</span></summary><ul class="pending inner">${pend}</ul></details>` : "";
    // two friendly numbers only: things going + need a follow-up
    const going = new Set();
    (D.apps || []).forEach((a) => { const c = catOf("app", a); if (c !== "archived" && c !== "saved" && String(a.p) === "0") going.add(nk(a.co)); });
    todo.forEach((a) => { if (catOf("act", a) !== "archived") going.add(nk(a.co)); });
    const fu = new Set(todo.filter((a) => catOf("act", a) === "followup").map((a) => nk(a.co))).size;
    const hello = `<div class="hello"><div class="hi hi-go"><b>${going.size}</b><span>things going</span></div><div class="hi hi-fu"><b>${fu}</b><span>${fu === 1 ? "needs" : "need"} a follow-up</span></div></div>`;
    return `${hello}${repliesCard()}
      <h2 class="sec">Do next</h2><div class="card list donext">${doNext || `<p class="muted center pad">All clear for now.</p>`}</div>
      ${more}
      ${interviewsCard()}
      ${nextup}
      ${spareCard()}
      <a class="btn more" href="#opps/overall">Top 25 opportunities →</a>`;
  }
  const dueChip = (due, snoozed) => { if (!due) return ""; const now = due <= todayIso(); return `<span class="chip ${now ? "ok" : "info"}">${snoozed ? "💤 " : now ? "Today · " : ""}${fmtDate(due)}</span>`; };
  // A4 New replies (filled by the daily Gmail triage; suggestions only, Anne confirms)
  // replies are grouped into one thread per company/person (underlying data stays one entry per email)
  const repKey = (c) => { const x = String(c || "").toLowerCase();
    if (/jinsong|wuxi haisi/.test(x)) return "jinsong";
    if (/florida (health|healthcare) law/.test(x)) return "florida";
    if (/medical travel company|tmtc|bharat/.test(x)) return "tmtc";
    if (/squire patton|wyand/.test(x)) return "squire";
    return nk(x.replace(/\s*\(.*$/, "")) || x; };
  const REP_NAME = { jinsong: "Jinsong (Wuxi Haisi Medical Consulting)", florida: "Florida Healthcare Law Firm (Jennifer Keenan)", tmtc: "The Medical Travel Company (Bharat Bhatt)", squire: "Squire Patton Boggs (John Wyand)" };
  function repliesCard() {
    const R = (D.replies || []).filter((r) => r && !/closed/i.test(r.class || ""));
    if (!R.length) return `<div class="card replies empty"><b>New replies</b><span class="muted small"> · nothing new yet. The daily Gmail check adds replies here with a suggested next step.</span></div>`;
    const G = {};
    R.forEach((r) => { const k = repKey(r.company); (G[k] = G[k] || []).push(r); });
    const rd = (r) => String(r.date || "");
    const groups = Object.keys(G).map((k) => ({ k, items: G[k].slice().sort((a, b) => rd(b).localeCompare(rd(a))) }))
      .sort((a, b) => rd(b.items[0]).localeCompare(rd(a.items[0])));
    const one = (r) => `<p class="nx"><span class="date small">${fmtDate(rd(r).slice(0, 10))}</span> · ${esc(r.summary || r.quoted || "")}</p>${r.suggested_status ? `<p class="small"><span class="chip good">Suggested</span> ${esc(r.suggested_status)}${r.suggested_next ? " → " + esc(r.suggested_next) : ""}</p>` : ""}`;
    return `<h2 class="sec">New replies · ${groups.length}</h2><div class="card list">${groups.map((g) => { const id = "repg:" + g.k, open = ui.open.has(id), L = g.items[0], n = g.items.length;
      return `<article class="row${open ? " open" : ""}" data-id="${id}" tabindex="0" role="button" aria-expanded="${open}"><div class="top"><h3>${esc(REP_NAME[g.k] || L.company)}</h3>${mbChip({ Gmail: "G", iCloud: "I", "Yahoo-legacy": "Y", Platform: "P" }[L.mailbox])}${n > 1 ? `<span class="chip info">${n} replies</span>` : ""}<span class="date">${fmtDate(rd(L).slice(0, 10))}</span></div>
        ${open ? g.items.map(one).join("") : one(L)}</article>`; }).join("")}</div>`;
  }
  // A8 meetings tracker: upcoming companies first, then upcoming attorneys, then a collapsed grayed-out "Past meetings" archive
  function interviewsCard() {
    const I = D.interviews || [];
    if (!I.length) return "";
    const isAtt = (v) => /attorney|law (firm|group)|legal/i.test([v.role, v.company].join(" "));
    const nowMs = Date.now();
    const isPast = (v) => (v.stages || []).length > 0 && (v.stages || []).every((s) => s.done || (s.start_utc && Date.parse(s.start_utc) + (s.dur_min || 60) * 60000 < nowMs));
    const when = (v) => { const st = v.stages || [], s = st.find((x) => !x.done) || st[st.length - 1] || {}; return String(s.start_utc || s.d || "9999"); };
    const lastWhen = (v) => (v.stages || []).map((s) => String(s.start_utc || s.d || "")).sort().pop() || "";
    const notes = (v) => (v.stages || []).filter((s) => Array.isArray(s.mnotes) && s.mnotes.length).map((s) => `<details class="mnotes-d" data-stop><summary class="small">Meeting notes (${s.mnotes.length})</summary><ul class="small">${s.mnotes.map((n) => `<li>${linkify(n)}</li>`).join("")}</ul></details>`).join("");
    const card = (v, past, ci) => `<div class="card iv alt${(ci || 0) % 4}${past ? " past" : ""}"><div class="top"><b>${esc(v.company)}</b>${past ? `<span class="chip">Past</span>` : ""}${v.doc ? `<a class="small" href="#docs/${esc(v.doc)}">Brief →</a>` : ""}</div>
      <p class="small muted">${esc(v.role || "")}${v.who ? " · " + esc(v.who) : ""}</p>
      ${v.practice ? `<p class="practice small">💡 ${esc(v.practice)}</p>` : ""}<ol class="stages">${(v.stages || []).map((st) => `<li class="${st.done ? "done" : ""}"><span class="dot"></span><b>${esc(st.k)}</b> <span class="small muted">${st.d ? fmtDate(st.d) : ""}${st.time ? " · " + esc(st.time) : ""}</span>${st.note ? `<span class="small muted"> · ${esc(st.note)}</span>` : ""}</li>`).join("")}</ol>${notes(v)}</div>`;
    const byWhen = (a, b) => when(a).localeCompare(when(b));
    const up = I.filter((v) => !isPast(v)), past = I.filter(isPast).sort((a, b) => lastWhen(b).localeCompare(lastWhen(a)));
    const co = up.filter((v) => !isAtt(v)).sort(byWhen), at = up.filter(isAtt).sort(byWhen);
    const pOpen = !!ui.groups["pastmeet"];
    return `<h2 class="sec">Meetings · Companies</h2>${co.map((v, i) => card(v, false, i)).join("") || `<p class="muted small">No upcoming company meetings.</p>`}${at.length ? `<h2 class="sec">Meetings · Attorneys</h2>${at.map((v, i) => card(v, false, i)).join("")}` : ""}${past.length ? `<details class="fold grp pastmeet" data-g="pastmeet"${pOpen ? " open" : ""}><summary>Past meetings<span class="n">${past.length}</span></summary><div class="inner">${past.map((v, i) => card(v, true, i)).join("")}</div></details>` : ""}`;
  }
  function actionCard(a, id) {
    const open = ui.open.has(id);
    const c = catOf("act", a);
    return `<article class="row crow c-${c}${open ? " open" : ""}" data-id="${esc(id)}" tabindex="0" role="button" aria-expanded="${open}">
      <div class="top"><h3>${esc(a.co)}</h3>${dueChip(effDue("act", a), effDue("act", a) !== a.due)}</div>
      <div class="tags">${catChip(c)}${mbChip(a.mb)}${worthChip(a.ws)}</div>
      ${a.rm ? `<span class="chip info rmtag">Worth one more follow-up</span>` : ""}
      ${a.nx ? `<p class="nx">${linkify(a.nx)}</p>` : ""}${open ? "" : notePv("act", a)}
      ${open ? rowDetail([["Removed because", a.rm], ["Role", a.role], ["Status", a.st], ["Fit", a.fit], ["Applied", a.d && fmtDate(a.d)], ["Where", a.loc], ["Worth it", worthDetail(a)]], a.u,
        (effDue("act", a) ? `<button type="button" class="btn sm" data-snooze="${esc(akey("act", a))}">Snooze 3 days</button>` : "") + archBtn("act", a), emailBlock("act", a), noteBox("act", a)) : ""}
    </article>`;
  }
  function rowDetail(rows, url, extra = "", mail = "", note = "") {
    rows = rows.filter(([, v]) => v);
    return `<div class="detail" data-stop>${note}<dl class="grid">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${/^Applied|^Due|^Worth/.test(k) ? v : linkify(v)}</dd>`).join("")}</dl>
      ${mail ? `<div class="actions row-actions mail-actions">${mail}</div>` : ""}<div class="actions row-actions">${safeUrl(url) ? `<a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open ${esc(new URL(url).hostname.replace(/^www\./, ""))} ↗</a>` : ""}${extra}</div></div>`;
  }

  const SORTS = { rank: "Rank", speed: "Speed", pay: "Pay", fit: "Fit", reliability: "Reliability", odds: "Interview odds" };
  const LISTS = [["overall", "Top", "overall"], ["speed", "Speed", "speed"], ["pay", "Pay", "pay"], ["fit", "Fit", "fit"], ["reliability", "Reliability", "reliability"], ["all", "All", ""], ["archived", "Archived", ""]];
  function sortVal(o, k) {
    if (k === "rank") return o.rank == null ? 1e9 - (o.rs ?? 0) : o.rank;
    const i = SC.findIndex(([x]) => x === k);
    return -((o.sc || [])[i] ?? -1e9);
  }
  function viewOpps() {
    const all = D.opps || [];
    if (!LISTS.find(([k]) => k === ui.list)) ui.list = "overall";
    const visTop = (k) => ((D.top || {})[k] || []).filter((id) => byId(id) && !isArch("job", byId(id)));
    const nList = (k) => (k === "all" ? all.filter((o) => !o.w && !isArch("job", o)).length : k === "archived" ? archivedAll().length : visTop(k).length);
    const seg = `<div class="seg" role="tablist">${LISTS.map(([k, l]) => `<button data-list="${k}" aria-pressed="${k === ui.list}">${l} (${nList(k)})</button>`).join("")}</div>`;
    const note = D.score_note ? `<details class="note"><summary>How scores work</summary><p>${esc(D.score_note)}</p></details>` : "";
    if (ui.list === "archived") return seg + viewArchived();
    if (ui.list !== "all") {
      const ids = (D.top || {})[ui.list] || [], nA = ids.length - visTop(ui.list).length;
      const hl = ui.list === "overall" ? null : ui.list;
      const cur = LISTS.find(([k]) => k === ui.list);
      const head = `<h2 class="listhead">Top ${ids.length}${ui.list === "overall" ? " overall" : " by " + cur[2]}${nA ? ` <span class="muted small">· ${ids.length - nA} shown, ${nA} archived by you (numbers keep their list position)</span>` : ""}</h2>`;
      return `${seg}${head}${ids.map((id, i) => { const o = byId(id); return o && !isArch("job", o) ? oppCard(o, "l-" + ui.list, hl, i + 1) : ""; }).join("") || `<p class="muted center pad">Nothing on this list yet.</p>`}${note}`;
    }
    const s = ui.opps;
    let list = all.filter((o) => !isArch("job", o) && (s.watch || !o.w) && (!s.mail || (o.emails || []).length)
      && (!s.lane || o.lane === s.lane) && (!s.path || o.path === s.path) && (!s.tier || o.tier === s.tier));
    if (s.q) { const q = s.q.toLowerCase(); list = list.filter((o) => (JSON.stringify(o) + " " + noteOf("job", o)).toLowerCase().includes(q)); }
    list.sort((a, b) => sortVal(a, s.sort) - sortVal(b, s.sort) || sortVal(a, "rank") - sortVal(b, "rank"));
    const sel = (key, label, vals) => `<select data-f="opps.${key}" aria-label="${label}">${opt("", label, s[key])}${vals.map((v) => opt(v, v, s[key])).join("")}</select>`;
    return `${seg}<div class="controls">
        <input type="search" placeholder="Search company, role, notes…" value="${esc(s.q)}" data-f="opps.q" aria-label="Search opportunities">
        <select data-f="opps.sort" aria-label="Sort by">${Object.entries(SORTS).map(([k, v]) => opt(k, "Sort: " + v, s.sort)).join("")}</select>
        ${sel("lane", "Any lane", (D.lanes || []).filter((l) => all.some((o) => o.lane === l)).concat(uniq(all.map((o) => o.lane)).filter((l) => !(D.lanes || []).includes(l))))}
        ${sel("tier", "Tier", uniq(all.map((o) => o.tier)))}
        ${sel("path", "Path", uniq(all.map((o) => o.path)))}
        <label class="check"><input type="checkbox" data-f="opps.mail"${s.mail ? " checked" : ""}> Has email</label>
        ${all.some((o) => o.w) ? `<label class="check"><input type="checkbox" data-f="opps.watch"${s.watch ? " checked" : ""}> Watchlist</label>` : ""}
      </div>
      <p class="count">${list.length} shown · tap for details</p>
      ${list.map((o) => oppCard(o, "all", s.sort === "rank" ? null : s.sort)).join("") || `<p class="muted center pad">No matches.</p>`}${removedFold()}${note}`;
  }
  function archivedAll() {
    return Object.entries(ITEMS).filter(([, it]) => it.x.ua || byMe(it.t, it.x)).map(([k, it]) => ({ k, ...it }));
  }
  function viewArchived() {
    const A = archivedAll();
    const lab = { job: "Jobs", act: "Today › Act now", app: "Tracker" };
    const row = ({ k, t, x }) => `<div class="arow"><div class="ainfo"><b>${esc(x.co)}</b>${x.role ? `<span class="muted small">${esc(x.role)}</span>` : ""}
        <span class="small ${x.ua ? "muted" : "byme"}">${x.ua ? "archived on all devices" : "archived by you" + (LA[k] && LA[k].at ? " · " + fmtDate(LA[k].at.slice(0, 10)) : "")}${t === "app" && x.d ? " · applied " + fmtDate(x.d) : ""}</span></div>
        <div class="abtns">${x.ua ? "" : `<button type="button" class="btn sm" data-restore="${esc(k)}">Restore</button>`}${delBtn(esc(k))}</div></div>`;
    const sec = ["job", "act", "app"].map((t) => { const r = A.filter((a) => a.t === t); return r.length ? `<h2 class="sec">${lab[t]} · ${r.length}</h2><div class="card list">${r.map(row).join("")}</div>` : ""; }).join("");
    return `<h2 class="listhead">Archived by me (${A.length})</h2>
      <div class="autodel-box">${autoDelCtl()}<p class="small muted">${autoDelOn() ? `On: entries you archived more than ${AD_DAYS} days ago are deleted from this app when it opens.` : "Off: nothing is deleted automatically."} Applies to this device only.</p></div>
      <p class="count">Hidden from Today and Jobs. Tap Restore to bring an entry back on this device. Entries marked "archived on all devices" can only be restored by asking for them to be taken off the archive list.</p>
      ${sec || `<p class="muted center pad">Nothing archived yet. Open any job, application or Act now item and tap Archive.</p>`}`;
  }
  function removedFold() {
    const R = D.removed || [], C = D.rcauses || [];
    if (!R.length) return "";
    const open = !!ui.groups["removed"];
    const body = open ? C.map((c, ci) => { const rows = R.filter((r) => r.c === ci); return rows.length ? `<h2 class="sec">${esc(c)} · ${rows.length}</h2>${rows.map((r) =>
      `<div class="rm"><b>${esc(r.co)}</b>${r.lane ? ` <span class="muted small">${esc(r.lane)}</span>` : ""}<p>${esc(r.why || "")}${safeUrl(r.u) ? ` <a href="${esc(r.u)}" target="_blank" rel="noopener noreferrer">source ↗</a>` : ""}</p></div>`).join("")}` : ""; }).join("") : "";
    return `<details class="fold grp rmv" data-g="removed"${open ? " open" : ""}><summary>Removed leads (with reason)<span class="n">${R.length}</span></summary>${body}</details>`;
  }

  // v23 Tracker: running log of EVERY application, newest first, colour by status. Archived only via a small filter.
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  let TR = null;   // built once per data load
  function trackerBase() {
    if (TR) return TR;
    const base = (D.apps || []).map((a) => ({ a, c: catOf("app", a), lane: laneOf("app", a) }));
    TR = { base, lanes: uniq(base.map((r) => r.lane)) };
    return TR;
  }
  function viewTracker() {
    return viewCRM(); // v34: the Applications list was retired; this tab is now Contacts only
  }
  function viewTrackerApplicationsRetired() {
    const s = ui.tr, T = trackerBase(), q = (s.q || "").toLowerCase();
    const seg = `<div class="seg" role="tablist"><button data-trv="apps" aria-pressed="${s.view !== "crm"}">Applications</button><button data-trv="crm" aria-pressed="${s.view === "crm"}">Contacts</button></div>`;
    if (s.view === "crm") return seg + viewCRM();
    const arch = s.status === "archived";
    const list = T.base.filter((r) => (arch ? r.c === "archived" : r.c !== "archived" && (s.status ? r.c === s.status : r.c !== "saved"))
        && (!s.lane || r.lane === s.lane) && (!q || [r.a.co, r.a.role, r.a.st, r.a.nt, r.a.nx, noteOf("app", r.a)].join(" ").toLowerCase().includes(q)))
      .sort((x, y) => String(y.a.d || "").localeCompare(String(x.a.d || "")));
    const shown = list.slice(0, s.limit);
    const stOpts = ["offer", "interview", "followup", "scheduled", "waiting", "saved"].filter((c) => T.base.some((r) => r.c === c));
    return `${seg}<div class="controls">
        <input type="search" placeholder="Search company, role…" value="${esc(s.q)}" data-f="tr.q" aria-label="Search applications">
        <select data-f="tr.status" aria-label="Status">${opt("", "All active", s.status)}${stOpts.map((c) => opt(c, CATS[c], s.status)).join("")}${opt("archived", "Archived", s.status)}</select>
        <select data-f="tr.lane" aria-label="Lane">${opt("", "Any lane", s.lane)}${T.lanes.map((l) => opt(l, LANES_T[l] || l, s.lane)).join("")}</select>
      </div>
      <div class="legend">${stOpts.map(catChip).join("")}</div>
      <div class="tlog">${shown.map((r, i) => appRow(r.a, "tr:" + (r.a.co || "") + (r.a.d || "") + i, r.c, r.lane)).join("") || `<p class="muted center pad">Nothing here yet.</p>`}</div>
      ${list.length > shown.length ? `<button class="btn more" data-more>Show more</button>` : ""}`;
  }
  // A7 contact CRM: one card per company (person, last touch, mailbox, next step)
  function viewCRM() {
    const q = (ui.tr.q || "").toLowerCase();
    const L = (D.crm || []).filter((c) => !q || JSON.stringify(c).toLowerCase().includes(q));
    return `<div class="controls"><input type="search" placeholder="Search company, person…" value="${esc(ui.tr.q)}" data-f="tr.q" aria-label="Search contacts"></div>
      <div class="card list">${L.map((c, i) => { const id = "crm:" + i, open = ui.open.has(id);
        return `<article class="row${open ? " open" : ""}" data-id="${id}" tabindex="0" role="button" aria-expanded="${open}">
          <div class="top"><h3>${esc(c.co)}</h3>${mbChip(c.mb)}<span class="date">${c.last ? "last " + fmtDate(c.last) : ""}</span></div>
          <div class="sub"><span class="role">${esc(c.who || "No named contact yet")}</span></div>
          ${c.nx ? `<p class="nx">${linkify(c.nx)}</p>` : ""}
          ${open ? rowDetail([["Person", c.who], ["Email", c.em], ["Last", c.last && fmtDate(c.last)], ["Mailbox", MBN[c.mb]], ["Next step", c.nx], ["Due", c.due && fmtDate(c.due)], ["Note", c.note]], null) : ""}</article>`; }).join("") || `<p class="muted center pad">No matches.</p>`}</div>`;
  }
  function appRow(a, id, c, lane) {
    const open = ui.open.has(id);
    c = c || catOf("app", a);
    return `<article class="trow c-${c}${open ? " open" : ""}" data-id="${esc(id)}" tabindex="0" role="button" aria-expanded="${open}">
      <div class="top"><h3>${esc(a.co)}</h3><span class="date">${fmtDate(a.d)}</span></div>
      <p class="role">${esc(a.role || "")}</p>
      <div class="tags">${catChip(c)}${mbChip(a.mb)}${lane && lane !== "gen" ? `<span class="chip lane">${esc(LANES_T[lane])}</span>` : ""}</div>${open ? "" : notePv("app", a)}
      ${open ? rowDetail([["Role", a.role], ["Status", a.st], ["Next", a.nx], ["Notes", a.nt], ["Source", a.src], ["Where", a.loc], ["Due", effDue("app", a) && fmtDate(effDue("app", a))]], a.u, archBtn("app", a), emailBlock("app", a), noteBox("app", a)) : ""}
    </article>`;
  }

  function viewDocs() {
    const docs = D.docs || [];
    const miss = D.missing || [];
    const R = D.resumes || [], lane = R.filter((r) => r.lane), old = R.filter((r) => !r.lane);
    const resumes = R.length ? `<details class="fold doc" data-doc="resumes"${ui.doc === "resumes" ? " open" : ""}><summary><span><b>Resumes</b><span class="prev">${lane.length} lane resumes (${lane.filter((r) => r.draft).length} drafts for your review) · ${old.length} existing files</span></span></summary>
      <div class="md">${lane.map((r) => `<details class="sub"><summary><b>${esc(r.lane)}</b> ${r.draft ? `<span class="chip ok">DRAFT – review</span>` : ""}<span class="small muted"> ${esc(r.f)}</span></summary>${r.md ? md(r.md) : ""}</details>`).join("")}
      <p class="small muted">Existing: ${old.map((r) => esc(r.f.split("/").pop())).join(" · ")}</p></div></details>` : "";
    return `${docs.length ? docs.slice(0, 1).map((d) => `<details class="fold doc" data-doc="${esc(d.k)}"${ui.doc === d.k ? " open" : ""}>
        <summary><span><b>${esc(d.t)}</b>${d.s ? `<span class="prev">${esc(d.s)}</span>` : ""}</span></summary>${md(d.md)}</details>`).join("") : ""}${resumes}${docs.slice(1).map((d) => `<details class="fold doc" data-doc="${esc(d.k)}"${ui.doc === d.k ? " open" : ""}>
        <summary><span><b>${esc(d.t)}</b>${d.s ? `<span class="prev">${esc(d.s)}</span>` : ""}</span></summary>${md(d.md)}</details>`).join("") || `<p class="muted center pad">No documents found.</p>`}
      <div class="footer">${esc(D.version || "")} · built ${esc(D.built || D.generated)}${miss.length ? ` · Missing: ${miss.map(esc).join("; ")}` : ""}
        <div class="settings-line">${autoDelCtl("small")}</div>
        <div><button type="button" class="btn sm" data-export>Export my notes (${Object.values(LN).filter((n) => n && n.text && n.text.trim()).length})</button></div>
        ${ENC ? `<button class="btn sm" data-lock>Lock &amp; forget this device</button>` : ""}</div>`;
  }

  /* ---------------- v28: My To-Dos (things only Anne does herself; Done ticks saved on this device) ---------------- */
  const TKEY = "ag-dash-todo-done";   // { id: ISO time ticked }. NOT cleared by "Lock & forget".
  let TD = loadJ(TKEY);
  const TCOL = ["#0f766e", "#4338ca", "#b45309", "#be185d", "#7e22ce", "#0369a1", "#15803d", "#c2410c"];
  function viewTodos() {
    const T = D.todos || [], left = T.filter((t) => !TD[t.id]).length;
    const card = (t, i) => { const done = !!TD[t.id], u = safeUrl(t.link);
      return `<article class="todo${done ? " done" : ""}" style="--tc:${TCOL[i % TCOL.length]}">
        <div class="todo-emo" aria-hidden="true">${esc(t.emoji || "✅")}</div>
        <div class="todo-body"><h3><span class="todo-n">${i + 1}.</span> ${esc(t.title)}</h3>
          ${t.desc ? `<p>${linkify(t.desc)}</p>` : ""}
          ${t.due || u ? `<div class="tags">${t.due ? dueChip(t.due) : ""}${u ? `<a class="chip info" href="${esc(u)}" target="_blank" rel="noopener noreferrer">Open ↗</a>` : ""}</div>` : ""}
          ${done ? `<p class="todo-when">✅ Done ${fmtDate(String(TD[t.id]).slice(0, 10))}</p>` : ""}</div>
        <button type="button" class="todo-chk" data-todo="${esc(t.id)}" aria-pressed="${done}" aria-label="${done ? "Mark not done: " : "Mark done: "}${esc(t.title)}">${done ? "✓ Done" : "Done?"}</button>
      </article>`; };
    const order = T.map((t, i) => [t, i]).sort((a, b) => (!!TD[a[0].id] - !!TD[b[0].id]) || a[1] - b[1]);
    return `<div class="todo-hi"><b>${left}</b><span>${left === 1 ? "thing" : "things"} only you can do${T.length - left ? ` · ${T.length - left} done 🎉` : ""}</span></div>
      <p class="count">Your own list, one at a time. Tap <b>Done?</b> when finished (saved on this phone; tap again to undo).</p>
      <div class="todos">${order.map(([t, i]) => card(t, i)).join("") || `<p class="muted center pad">Nothing on your list right now. 🎉</p>`}</div>`;
  }
  function toggleTodo(id) {
    const was = !!TD[id];
    if (was) delete TD[id]; else TD[id] = new Date().toISOString();
    saveJ(TKEY, TD); render();
    if (!was) toast("Nice! Marked done ✅", () => { delete TD[id]; saveJ(TKEY, TD); render(); });
  }

  /* ---------------- v29: Calendar (read-only; appointments from 00_Index/interviews.json, local time per 00_Index/travel_zones.json) ---------------- */
  ui.cal = { view: "agenda", ym: null, sel: null, also: "", open: {} };
  const _dtf = {};
  const fmtIn = (tz, o) => { const k = tz + JSON.stringify(o); return _dtf[k] || (_dtf[k] = new Intl.DateTimeFormat("en-US", Object.assign({ timeZone: tz }, o))); };
  const dayIn = (tz, t) => { const p = {}; fmtIn(tz, { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(t).forEach((x) => (p[x.type] = x.value)); return `${p.year}-${p.month}-${p.day}`; };
  const timeIn = (tz, t) => fmtIn(tz, { hour: "numeric", minute: "2-digit" }).format(t);
  const dayLong = (s) => new Date(s + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
  const dayShort = (s) => new Date(s + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
  const addDays = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const calZ = () => { const Z = D.zones || {}; return { R: (Z.ranges && Z.ranges.length ? Z.ranges : [{ tz: "America/New_York", label: "US Eastern" }]), A: Z.also || [], E: Z.events || [] }; };
  const inR = (r, day) => (!r.from || day >= r.from) && (!r.to || day <= r.to);
  function zoneForDate(day) { const { R } = calZ(); return R.find((r) => inR(r, day)) || (R[0].from && day < R[0].from ? R[0] : R[R.length - 1]); }
  function zoneForInstant(t) { const { R } = calZ(); return R.find((r) => inR(r, dayIn(r.tz, t))) || zoneForDate(dayIn(R[0].tz, t)); }
  const calToday = () => { const z = zoneForInstant(new Date()); return dayIn(z.tz, new Date()); };
  const calCol = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return TCOL[h % TCOL.length]; };
  const tParse = (u) => { const t = u ? new Date(u) : null; return t && !isNaN(t) ? t : null; };
  const CALL_RX = /\b(call|calls|meeting|meet|interview|zoom|teams|video)\b/i;
  function calItems() {
    const out = [];
    (D.interviews || []).forEach((v) => (v.stages || []).forEach((s) => {
      const t = tParse(s.start_utc); if (!t && !s.d) return;
      const z = t ? zoneForInstant(t) : zoneForDate(s.d), day = t ? dayIn(z.tz, t) : s.d;
      const end = t && s.dur_min ? new Date(t.getTime() + s.dur_min * 60000) : null;
      const flags = [];
      if (s.proposed) flags.push(["info", "Proposed · not confirmed"]);
      if (s.tz_unconfirmed) flags.push(["ok", "Time zone unconfirmed"]);
      out.push({ kind: "appt", day, t, end, z, emo: "", title: v.company, k: s.k, who: v.who || "", sub: [v.role, v.who].filter(Boolean).join(" · "),
        orig: s.time || "", note: s.cal_note || s.note || "", mnotes: Array.isArray(s.mnotes) ? s.mnotes : null, flags, done: !!s.done, col: calCol(v.company) });
    }));
    calZ().E.forEach((e) => {
      const t = tParse(e.start_utc), z = t ? zoneForInstant(t) : zoneForDate(e.d), end = tParse(e.end_utc);
      const endZ = e.end_tz ? { tz: e.end_tz, label: e.end_label || e.end_tz } : null;
      out.push({ kind: "travel", day: e.d, t, end, z, endZ, emo: e.emoji || "✈️", title: e.title, k: "", sub: "", orig: e.time || "", note: e.note || "",
        flags: e.unconfirmed ? [["ok", "Times unconfirmed"]] : [], done: false, col: "#0369a1" });
    });
    const named = (day) => out.filter((x) => x.day === day).map((x) => (x.title + " " + x.sub).toLowerCase()).join(" ");
    (D.todos || []).forEach((td) => {
      if (!td.due || !CALL_RX.test(td.title)) return;
      const words = (String(td.title).split(":")[0].toLowerCase().match(/[\p{L}]{4,}/gu) || []).filter((w) => !/^(call|calls|meeting|video|attorney|attorneys|watch|this|week|interview|sales)$/.test(w));
      const hay = named(td.due);
      if (words.some((w) => hay.includes(w))) return;   // already on the calendar from interviews.json
      out.push({ kind: "todo", day: td.due, t: null, end: null, z: zoneForDate(td.due), emo: td.emoji || "✅", title: td.title, k: "", sub: "Reminder from My To-Dos",
        orig: "", note: td.desc || "", flags: [], done: !!TD[td.id], col: "#be185d" });
    });
    return out.sort((a, b) => a.day.localeCompare(b.day) || ((a.t ? a.t.getTime() : -1) - (b.t ? b.t.getTime() : -1)) || a.title.localeCompare(b.title));
  }
  function calTime(x) {
    if (!x.t) return x.kind === "todo" ? `<span class="cal-t">Reminder</span>` : `<span class="cal-t">${x.orig ? "See note" : "Time TBD"}</span>`;
    let s = timeIn(x.z.tz, x.t);
    if (x.end) {
      const ez = x.endZ || x.z, ed = dayIn(ez.tz, x.end);
      s += ` – ${ed !== x.day ? dayShort(ed).replace(/,.*$/, "") + " " : ""}${timeIn(ez.tz, x.end)}${ez.label !== x.z.label ? " " + esc(ez.label) : ""}`;
    }
    return `<span class="cal-t">${s}</span><span class="cal-z">${esc(x.z.label)}</span>`;
  }
  function calAlso(x) {
    const a = ui.cal.also; if (!a || !x.t) return "";
    const z = calZ().A.find((r) => r.tz === a); if (!z || z.label === x.z.label) return "";
    const d = dayIn(z.tz, x.t);
    return `<p class="cal-also">= ${timeIn(z.tz, x.t)} ${esc(z.label)}${d !== x.day ? ` (${dayShort(d)})` : ""}</p>`;
  }
  /* v30: compact one-line rows; tap (or Enter/Space) opens an accordion with the full details. Open state kept in ui.cal.open across re-renders. */
  const calKey = (x) => [x.kind, x.day, x.t ? x.t.toISOString() : "", x.title, x.k].join("|");
  const calShortFlag = (l) => l.replace(/ · not confirmed$/, "");
  function calTimeShort(x) {
    if (!x.t) return x.kind === "todo" ? `<span class="cal-t">Reminder</span>` : `<span class="cal-t">${x.orig ? "See note" : "Time TBD"}</span>`;
    return `<span class="cal-t">${timeIn(x.z.tz, x.t)}</span><span class="cal-z">${esc(x.z.label)}</span>`;
  }
  function calRange(x) {   // full start–end (only when there is an end time); the row shows the start only
    if (!x.t || !x.end) return "";
    const ez = x.endZ || x.z, ed = dayIn(ez.tz, x.end), dz = ez.label !== x.z.label;
    return `<p class="cal-range">🕑 ${timeIn(x.z.tz, x.t)}${dz ? " " + esc(x.z.label) : ""} – ${ed !== x.day ? dayShort(ed).replace(/,.*$/, "") + " " : ""}${timeIn(ez.tz, x.end)} ${esc(ez.label)}</p>`;
  }
  function calCard(x) {
    const key = calKey(x), open = !!ui.cal.open[key], id = "cx" + (calCard.n = (calCard.n || 0) + 1);
    let who = x.kind === "appt" && x.who ? String(x.who).replace(/\s*\([^)]*\)/g, "").split(/[,;]/)[0].trim() : "";   // name only on the row; full text in details
    if (who && String(x.title).toLowerCase().includes(who.toLowerCase())) who = "";
    return `<article class="cal-ev k-${x.kind}${x.done ? " done" : ""}${open ? " open" : ""}" style="--tc:${x.col}">
      <button type="button" class="cal-row" data-calx="${esc(key)}" aria-expanded="${open}" aria-controls="${id}">
        <span class="cal-when">${calTimeShort(x)}</span>
        <span class="cal-who"><b>${x.emo ? esc(x.emo) + " " : ""}${esc(x.title)}</b>${who || x.flags.length ? `<span class="cal-l2">${who ? `<span class="cal-wn">${esc(who)}</span>` : ""}${x.flags.map(([c, l]) => `<span class="chip ${c}">${esc(calShortFlag(l))}</span>`).join("")}</span>` : ""}</span>
        <span class="cal-chev" aria-hidden="true">›</span>
      </button>
      <div class="cal-body cal-det" id="${id}"${open ? "" : " hidden"}>
        ${calRange(x)}
        ${x.k ? `<p class="cal-k">${esc(x.k)}${x.done ? " · done" : ""}</p>` : ""}${x.sub ? `<p class="small muted">${esc(x.sub)}</p>` : ""}
        ${(fl => fl.length ? `<div class="tags">${fl.map(([c, l]) => `<span class="chip ${c}">${esc(l)}</span>`).join("")}</div>` : "")(x.flags.filter(([, l]) => calShortFlag(l) !== l))}
        ${calAlso(x)}
        ${x.orig ? `<p class="cal-orig small">🕑 As written: ${esc(x.orig)}</p>` : ""}${x.note ? `<p class="small muted">${linkify(x.note)}</p>` : ""}${x.mnotes ? `<div class="mnotes"><p class="mn-h">📝 Meeting notes</p><ul>${x.mnotes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : ""}</div>
    </article>`;
  }
  function calDayHead(day, today) {
    const rel = day === today ? "Today" : day === addDays(today, 1) ? "Tomorrow" : day === addDays(today, -1) ? "Yesterday" : "";
    return `<h2 class="cal-day${day === today ? " today" : ""}">${rel ? `<b>${rel}</b> · ` : ""}${dayLong(day)}<span class="cal-dz">${esc(zoneForDate(day).label)}</span></h2>`;
  }
  function calGroups(list, today, withToday) {
    const g = {}; list.forEach((x) => (g[x.day] = g[x.day] || []).push(x));
    if (withToday && !g[today]) g[today] = [];   // Today is always shown (highlighted), even when empty
    return Object.keys(g).sort().map((d) => `<section class="cal-grp">${calDayHead(d, today)}${g[d].map(calCard).join("") || `<p class="muted small cal-empty">Nothing booked today.</p>`}</section>`).join("");
  }
  function viewCalendar() {
    const C = ui.cal, all = calItems(), today = calToday();
    if (!C.ym) C.ym = today.slice(0, 7);
    if (!C.sel) C.sel = today;
    const upc = all.filter((x) => x.day >= today && !x.done), past = all.filter((x) => x.day < today || x.done);
    const nx = upc.find((x) => x.kind !== "todo" && (!x.t || x.t.getTime() > Date.now() - 3600000));
    const hi = nx ? `<div class="cal-hi"><span>Next up</span><b>${esc(nx.title)}</b><span>${nx.day === today ? "Today" : dayShort(nx.day)}${nx.t ? " · " + timeIn(nx.z.tz, nx.t) + " " + esc(nx.z.label) : ""}</span></div>`
      : `<div class="cal-hi"><b>No calls coming up</b></div>`;
    const seg = `<div class="seg cal-seg"><button type="button" data-calv="agenda" aria-pressed="${C.view === "agenda"}">📋 Agenda</button><button type="button" data-calv="month" aria-pressed="${C.view === "month"}">🗓️ Month</button></div>`;
    const A = calZ().A, also = A.length ? `<div class="cal-also-row"><span class="small muted">Also show:</span>${[["", "Off"]].concat(A.map((z) => [z.tz, z.label])).map(([tz, l]) =>
      `<button type="button" class="chip cal-chip" data-calalso="${esc(tz)}" aria-pressed="${C.also === tz}">${esc(l)}</button>`).join("")}</div>` : "";
    const zl = zoneForDate(today).label;
    const intro = `<p class="count">Read-only. Times are shown in <b>your local time for each day</b> (today: ${esc(zl)}). The original wording is kept under each call.</p>`;
    let body;
    if (C.view === "month") {
      const [y, m] = C.ym.split("-").map(Number), first = `${C.ym}-01`, start = addDays(first, -new Date(Date.UTC(y, m - 1, 1)).getUTCDay());
      const by = {}; all.forEach((x) => (by[x.day] = by[x.day] || []).push(x));
      const cells = []; for (let i = 0; i < 42; i++) { const d = addDays(start, i); if (i >= 35 && d.slice(0, 7) !== C.ym) break; cells.push(d); }
      const grid = cells.map((d) => { const L = by[d] || [], out = d.slice(0, 7) !== C.ym;
        return `<button type="button" class="cal-cell${out ? " out" : ""}${d === today ? " today" : ""}${d === C.sel ? " sel" : ""}${L.length ? " has" : ""}" data-cald="${d}" aria-label="${dayLong(d)}${L.length ? ", " + L.length + " item" + (L.length > 1 ? "s" : "") : ""}">
          <span class="cal-n">${Number(d.slice(8))}</span>${L.slice(0, 2).map((x) => `<span class="cal-lbl" style="--tc:${x.col}">${esc((x.emo ? x.emo + " " : "") + String(x.title).replace(/^(The )/, "").split(/[\s(/–-]+/)[0])}</span>`).join("")}${L.length > 2 ? `<span class="cal-more">+${L.length - 2}</span>` : ""}
          <span class="cal-dots">${L.slice(0, 4).map((x) => `<i style="--tc:${x.col}"></i>`).join("")}</span></button>`; }).join("");
      const title = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
      const selL = by[C.sel] || [];
      body = `<div class="card cal-month"><div class="cal-nav"><button type="button" class="btn sm" data-calm="-1" aria-label="Previous month">‹</button><b>${title}</b><button type="button" class="btn sm" data-calm="1" aria-label="Next month">›</button></div>
        <div class="cal-wd">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => `<span>${w}</span>`).join("")}</div><div class="cal-grid">${grid}</div>
        ${C.ym !== today.slice(0, 7) || C.sel !== today ? `<button type="button" class="btn sm cal-todaybtn" data-caltoday="1">Back to today</button>` : ""}</div>
        <section class="cal-grp">${calDayHead(C.sel, today)}${selL.map(calCard).join("") || `<p class="muted small pad">Nothing on this day.</p>`}</section>`;
    } else {
      body = (calGroups(upc, today, true) || `<p class="muted center pad">Nothing coming up.</p>`) +
        (past.length ? `<details class="fold grp" data-g="calpast"${ui.groups.calpast ? " open" : ""}><summary>Earlier &amp; done<span class="n">${past.length}</span></summary><div class="inner">${calGroups(past.slice().reverse(), today)}</div></details>` : "");
    }
    return `${hi}${seg}${also}${intro}${body}`;
  }

  /* ---------------- router ---------------- */
  const VIEWS = { home: ["Do next", viewHome], todos: ["My To-Dos", viewTodos], calendar: ["Calendar", viewCalendar], opps: ["Opportunities", viewOpps], tracker: ["Contacts", viewTracker], docs: ["Docs", viewDocs] };
  const ALIAS = { top: "opps", strategy: "docs", legal: "docs" };
  function route() {
    let [tab, sub] = (location.hash.slice(1) || "home").split("/");
    if (tab === "strategy" || tab === "legal") sub = sub || tab;
    if (tab === "top") sub = sub || "overall";
    tab = ALIAS[tab] || tab;
    if (tab === "opps" && sub) ui.list = sub;
    if (tab === "docs") ui.doc = sub || ui.doc;
    if (tab === "calendar" && (sub === "month" || sub === "agenda")) ui.cal.view = sub;
    const v = VIEWS[tab] || VIEWS.home;
    document.querySelectorAll(".tabbar a").forEach((a) => (a.dataset.tab === (VIEWS[tab] ? tab : "home") ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    $("#title").textContent = v[0];
    document.body.dataset.tab = VIEWS[tab] ? tab : "home";
    render(true, tab);
  }
  let curTab = null;
  function render(scrollTop, tab) {
    if (!D) return;
    tab = tab || ALIAS[(location.hash.slice(1) || "home").split("/")[0]] || (location.hash.slice(1) || "home").split("/")[0];
    const focusF = document.activeElement?.dataset?.f, pos = document.activeElement?.selectionStart;
    main.innerHTML = (VIEWS[tab] || VIEWS.home)[1]();
    if (focusF) { const el = main.querySelector(`[data-f="${focusF}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} } }
    if (scrollTop && curTab !== tab) main.scrollTop = 0;   // main is the only scroll pane
    curTab = tab;
  }
  main.addEventListener("click", (e) => {
    const t = e.target;
    const tdb = t.closest("[data-todo]"); if (tdb) { e.preventDefault(); toggleTodo(tdb.dataset.todo); return; }
    const ab = t.closest("[data-arch]"); if (ab) { e.preventDefault(); setArchived(ab.dataset.arch, true); return; }
    if (t.closest("[data-export]")) { exportNotes(); return; }
    const ub = t.closest("[data-unrej]"); if (ub) { e.preventDefault(); const k = ub.dataset.unrej; UNREJ[k] = new Date().toISOString(); saveJ(UKEY, UNREJ); TR = null; render();
      toast("Restored", () => { delete UNREJ[k]; saveJ(UKEY, UNREJ); TR = null; render(); }); return; }
    const sz = t.closest("[data-snooze]"); if (sz) { e.preventDefault(); snooze(sz.dataset.snooze); return; }
    const tv = t.closest("[data-trv]"); if (tv) { ui.tr.view = tv.dataset.trv; ui.tr.q = ""; render(); return; }
    if (t.closest("[data-rejack]")) { (D.apps || []).filter((a) => a.rej && !a.arch).forEach((a) => (REJACK[akey("app", a)] = new Date().toISOString())); saveJ(RAKEY, REJACK); render(); return; }
    const db = t.closest("[data-del]"); if (db) { e.preventDefault(); deleteEntry(db.dataset.del); return; }
    const rb = t.closest("[data-restore]"); if (rb) { e.preventDefault(); setArchived(rb.dataset.restore, false); return; }
    const cv = t.closest("[data-calv]"); if (cv) { ui.cal.view = cv.dataset.calv; history.replaceState(null, "", "#calendar/" + ui.cal.view); render(); return; }
    const cm = t.closest("[data-calm]"); if (cm) { const [y, m] = ui.cal.ym.split("-").map(Number), d = new Date(Date.UTC(y, m - 1 + Number(cm.dataset.calm), 1)); ui.cal.ym = d.toISOString().slice(0, 7); render(); return; }
    const cd = t.closest("[data-cald]"); if (cd) { ui.cal.sel = cd.dataset.cald; ui.cal.ym = ui.cal.sel.slice(0, 7); render(); return; }
    if (t.closest("[data-caltoday]")) { ui.cal.sel = calToday(); ui.cal.ym = ui.cal.sel.slice(0, 7); render(); return; }
    const cx = t.closest("[data-calx]"); if (cx) { const k = cx.dataset.calx, o = cx.getAttribute("aria-expanded") !== "true", det = document.getElementById(cx.getAttribute("aria-controls"));
      if (o) ui.cal.open[k] = 1; else delete ui.cal.open[k];
      cx.setAttribute("aria-expanded", String(o)); cx.closest(".cal-ev").classList.toggle("open", o); if (det) det.hidden = !o; return; }
    const ca = t.closest("[data-calalso]"); if (ca) { ui.cal.also = ca.dataset.calalso; render(); return; }
    if (t.closest("a") || t.closest("[data-stop]") || t.closest("summary")) return;
    const l = t.closest("[data-list]"); if (l) { ui.list = l.dataset.list; history.replaceState(null, "", "#opps/" + ui.list); render(); return; }
    if (t.closest("[data-more]")) { ui.tr.limit += 60; render(); return; }
    if (t.closest("[data-lock]")) { forgetKey().then(() => location.reload()); return; }
    const card = t.closest("[data-id]");
    if (card) { const id = card.dataset.id; ui.open.has(id) ? ui.open.delete(id) : ui.open.add(id); render(); }
  });
  main.addEventListener("toggle", (e) => {     // remember which folds are open across re-renders
    const g = e.target.dataset?.g; if (g) ui.groups[g] = e.target.open;
    if (g === "removed" && e.target.open && !e.target.querySelector(".rm")) render();   // body is built lazily
    if (g === "more" && e.target.open && !e.target.querySelector(".inner")) render();
    const d = e.target.dataset?.doc; if (d) { if (e.target.open) ui.doc = d; else if (ui.doc === d) ui.doc = null; }
  }, true);
  main.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-id]")) { e.preventDefault(); e.target.click(); } });
  const onFilter = (e) => {
    const f = e.target.dataset.f; if (!f) return;
    const [grp, key] = f.split(".");
    ui[grp][key] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (grp === "tr") ui.tr.limit = 60;
    render();
  };
  main.addEventListener("input", (e) => { if (e.target.matches("[data-note]")) onNoteInput(e.target); else if (e.target.type === "search") onFilter(e); });
  main.addEventListener("change", (e) => {
    if (e.target.matches("[data-autodel]")) {
      try { localStorage.setItem(ADKEY, e.target.checked ? "1" : "0"); } catch (err) {}
      toast(e.target.checked ? `Auto-delete on: archived entries older than ${AD_DAYS} days will be deleted when the app opens` : "Auto-delete off: nothing will be deleted automatically");
      render(); return;
    }
    if (e.target.type !== "search") onFilter(e);
  });
  window.addEventListener("hashchange", route);

  /* ---------------- data loading + optional decryption ---------------- */
  let ENC = false;
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const IDB = { db: () => new Promise((res, rej) => { const r = indexedDB.open("ag-dash", 1); r.onupgradeneeded = () => r.result.createObjectStore("k"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }) };
  async function idb(mode, fn) { const db = await IDB.db(); return new Promise((res, rej) => { const tx = db.transaction("k", mode); const r = fn(tx.objectStore("k")); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); }); }
  const saveKey = (k) => idb("readwrite", (s) => s.put(k, "key")).catch(() => {});
  const loadKey = () => idb("readonly", (s) => s.get("key")).catch(() => null);
  const forgetKey = () => idb("readwrite", (s) => s.delete("key")).catch(() => {});
  async function deriveKey(pw, env) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(pw).toLowerCase().replace(/\s+/g, "")), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: b64(env.salt), iterations: env.iter }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  }
  async function decrypt(key, env) {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(env.iv), additionalData: new TextEncoder().encode(env.aad || "") }, key, b64(env.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  function setData(d) {
    D = d; D._idx = {}; TR = null;
    (D.opps || []).forEach((o) => (D._idx[o.id] = o));
    // expand the compact tracker encoding (shared-string indexes + URL prefix codes)
    const W = D.dict || [], P = D.upfx || {};
    (D.apps || []).forEach((a) => {
      for (const k of ["st", "src", "nx", "nt", "loc", "fit"]) if (typeof a[k] === "number") a[k] = W[a[k]];
      if (a.u && /^[a-z]\|/.test(a.u) && P[a.u[0]]) a.u = P[a.u[0]] + a.u.slice(2);
    });
    const swept = sweepArchived();   // date undated archives; auto-delete old ones only if the setting is ON
    applyDeleted();   // also builds ITEMS
    if (swept) setTimeout(() => toast(`${swept} archived entr${swept === 1 ? "y" : "ies"} older than ${AD_DAYS} days deleted (auto-delete is on)`), 300);
    $("#updated").textContent = D.version ? `${D.version} · ${String(D.built || "").replace(/ \(Chiang Mai\)$/, "")}` : "Updated " + (D.generated || "").slice(0, 10);
    $("#lock").hidden = true;
    route();
  }
  async function getJSON(url) { const r = await fetch(url, { cache: "no-cache" }); if (!r.ok) throw new Error(r.status); return r.json(); }
  let LOADED = null;   // fingerprint of the data this page shows (iv of the encrypted file, or "generated")
  function showUpdate() {
    if (document.getElementById("updbar")) return;
    const b = document.createElement("button"); b.id = "updbar"; b.type = "button"; b.className = "updbar";
    b.textContent = "New version ready · tap to refresh"; b.onclick = () => location.reload();
    document.body.appendChild(b);
  }
  async function checkUpdate() {
    try {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) { await reg.update(); if (reg.waiting || reg.installing) showUpdate(); }
    } catch (e) {}
    try {
      const r = await fetch((ENC ? "data.enc.json" : "data.json") + "?t=" + Date.now(), { cache: "no-store" });
      if (r.ok) { const j = await r.json(); const fp = ENC ? j.iv : j.generated; if (LOADED && fp && fp !== LOADED) showUpdate(); }
    } catch (e) {}
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && D) checkUpdate(); });
  window.addEventListener("focus", () => { if (D) checkUpdate(); });
  async function start() {
    let env = null;
    try { env = await getJSON("data.enc.json"); } catch (e) {}
    if (env) LOADED = env.iv;
    if (!env) {
      try { const d0 = await getJSON("data.json"); LOADED = d0.generated; setData(d0); } catch (e) { main.innerHTML = `<p class="muted center pad">No data found. Run build_data.py, then reload.</p>`; }
      return;
    }
    ENC = true;
    if (!(window.crypto && crypto.subtle)) { main.innerHTML = `<p class="muted center pad">This page must be opened over https (or localhost) to decrypt.</p>`; return; }
    const stored = await loadKey();
    if (stored) { try { setData(await decrypt(stored, env)); return; } catch (e) { await forgetKey(); } }
    main.innerHTML = "";
    $("#lock").hidden = false;
    setTimeout(() => $("#pw").focus(), 50);
    const eye = $("#pwToggle");
    if (eye) eye.onclick = () => {
      const show = $("#pw").type === "password";
      $("#pw").type = show ? "text" : "password";
      eye.setAttribute("aria-pressed", String(show));
      eye.setAttribute("aria-label", show ? "Hide password" : "Show password");
      $("#pw").focus();
    };
    $("#lockForm").onsubmit = async (ev) => {
      ev.preventDefault();
      const btn = $("#unlockBtn"); btn.disabled = true; btn.textContent = "Unlocking…"; $("#lockMsg").textContent = "";
      try {
        const key = await deriveKey($("#pw").value, env);
        const data = await decrypt(key, env);
        if ($("#remember").checked) await saveKey(key);  // non-extractable CryptoKey; passphrase itself is never stored
        $("#pw").value = ""; $("#pw").type = "password"; $("#pw").blur();   // close the iOS keyboard before the app shows
        setData(data);
      } catch (e) {
        $("#lockMsg").textContent = "That password didn't work. Try again.";
      } finally { btn.disabled = false; btn.textContent = "Unlock"; }
    };
  }

  if ("serviceWorker" in navigator && /^(https:|http:\/\/(localhost|127\.0\.0\.1))/.test(location.href)) {
    const hadCtl = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((reg) => reg.update()).catch(() => {});
    // a new service worker took over: offer a refresh instead of reloading under her finger (A2)
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadCtl) showUpdate(); });
  }
  start();
})();
