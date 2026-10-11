/* Anne's job-search dashboard: plain JS, no build step. */
(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const main = $("#main");
  let D = null;                       // decrypted / loaded data
  const ui = {                        // view state (kept across tab switches)
    opps: { q: "", lane: "", path: "", tier: "", sort: "rank", watch: false, mail: false },
    list: "overall",                  // overall | speed | pay | fit | reliability | all
    tr: { q: "", status: "", source: "", period: "0", limit: 50 },
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
      <div class="meta">${meta}</div>
      ${badges(o, hl)}
      ${open ? oppDetail(o) : ""}
    </article>`;
  }
  function oppDetail(o) {
    const mail = (o.emails || []).map((e) => `<a class="btn primary" href="mailto:${encodeURIComponent(e).replace(/%40/g, "@")}">✉ ${esc(e)}</a>`).join("");
    const post = safeUrl(o.url) ? `<a class="btn" href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">Posting ↗</a>` : "";
    const contact = [o.who, o.est].filter(Boolean).join(" · ");
    const rows = [["Why these scores", o.why], ["How to apply", o.apply], ["Resume", o.resume], ["Email angle", o.angle],
      ["Contact", contact], ["Legal", o.legal], ["Work", o.work], ["Lane / path", [o.lane0 || o.lane, o.path && "Path " + o.path].filter(Boolean).join(" · ")],
      ["Reviews", o.rev]].filter(([, v]) => v);
    const host = (u) => new URL(u).hostname.replace(/^www\./, "");
    const proof = safeUrl(o.proof) || o.ev ? `<dt>Thailand proof</dt><dd>${o.ev ? esc(o.ev) + " " : ""}${safeUrl(o.proof) ? `<a href="${esc(o.proof)}" target="_blank" rel="noopener noreferrer">${esc(host(o.proof))} ↗</a>` : ""}${o.dv ? ` <span class="muted small">checked ${esc(String(o.dv).slice(0, 10))}</span>` : ""}</dd>` : "";
    const links = (o.links || []).filter(safeUrl).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(new URL(u).hostname.replace(/^www\./, ""))} ↗</a>`).join(" · ");
    return `<div class="detail" data-stop>
      ${mail || post ? `<div class="actions">${mail}${post}</div>` : ""}
      ${o.flags ? `<div class="warn"><strong>Watch out:</strong> ${linkify(o.flags)}</div>` : ""}
      <dl>${rows.map(([h, v]) => `<dt>${esc(h)}</dt><dd>${linkify(v)}</dd>`).join("")}${proof}</dl>
      ${links ? `<p class="small muted" style="margin:8px 0 0">More: ${links}</p>` : ""}
    </div>`;
  }

  /* ---------------- views ---------------- */
  const byId = (id) => D._idx[id];
  function viewHome() {
    const stats = (D.stats || []).map((s) => `<div class="stat"><div class="v">${esc(s.v)}</div><div class="l">${esc(s.l)}</div></div>`).join("");
    const pend = (D.pending || []).map((p, i) => { const id = "pend:" + i, open = ui.open.has(id);
      return `<li class="row${open ? " open" : ""}" data-id="${id}" tabindex="0" role="button" aria-expanded="${open}"><b>${esc(p.when)}</b><span class="nx">${linkify(p.text)}</span></li>`; }).join("");
    const groups = {};
    (D.act || []).forEach((a) => { const k = a.pr || "Other"; (groups[k] = groups[k] || []).push(a); });
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
    return `${stats ? `<div class="stats">${stats}</div>` : ""}
      ${pend ? `<h2 class="sec">Next up</h2><ul class="card pending">${pend}</ul>` : ""}
      ${act || hidden ? `<h2 class="sec">Act now · ${(D.act || []).length}</h2>${act}${hidden}` : ""}
      <a class="btn more" href="#opps/overall">Top 25 opportunities →</a>`;
  }
  const dueChip = (due) => { if (!due) return ""; const over = due <= new Date().toISOString().slice(0, 10); return `<span class="chip ${over ? "bad" : "info"}">${over ? "Due " : ""}${fmtDate(due)}</span>`; };
  function actionCard(a, id) {
    const open = ui.open.has(id);
    return `<article class="row${open ? " open" : ""}" data-id="${esc(id)}" tabindex="0" role="button" aria-expanded="${open}">
      <div class="top"><h3>${esc(a.co)}</h3>${dueChip(a.due)}</div>
      ${a.rm ? `<span class="chip ok rmtag">Removed lead – follow up anyway</span>` : ""}
      ${a.nx ? `<p class="nx">${linkify(a.nx)}</p>` : ""}
      ${open ? rowDetail([["Removed because", a.rm], ["Role", a.role], ["Status", a.st], ["Fit", a.fit], ["Applied", a.d && fmtDate(a.d)], ["Where", a.loc]], a.u) : ""}
    </article>`;
  }
  function rowDetail(rows, url) {
    rows = rows.filter(([, v]) => v);
    return `<div class="detail" data-stop><dl class="grid">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${/^Applied|^Due/.test(k) ? v : linkify(v)}</dd>`).join("")}</dl>
      ${safeUrl(url) ? `<a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open ${esc(new URL(url).hostname.replace(/^www\./, ""))} ↗</a>` : ""}</div>`;
  }

  const SORTS = { rank: "Rank", speed: "Speed", pay: "Pay", fit: "Fit", reliability: "Reliability", odds: "Interview odds" };
  const LISTS = [["overall", "Top", "overall"], ["speed", "Speed", "speed"], ["pay", "Pay", "pay"], ["fit", "Fit", "fit"], ["reliability", "Reliability", "reliability"], ["all", "All", ""]];
  function sortVal(o, k) {
    if (k === "rank") return o.rank == null ? 1e9 - (o.rs ?? 0) : o.rank;
    const i = SC.findIndex(([x]) => x === k);
    return -((o.sc || [])[i] ?? -1e9);
  }
  function viewOpps() {
    const all = D.opps || [];
    if (!LISTS.find(([k]) => k === ui.list)) ui.list = "overall";
    const nList = (k) => (k === "all" ? all.filter((o) => !o.w).length : ((D.top || {})[k] || []).length);
    const seg = `<div class="seg" role="tablist">${LISTS.map(([k, l]) => `<button data-list="${k}" aria-pressed="${k === ui.list}">${l} (${nList(k)})</button>`).join("")}</div>`;
    const note = D.score_note ? `<details class="note"><summary>How scores work</summary><p>${esc(D.score_note)}</p></details>` : "";
    if (ui.list !== "all") {
      const ids = (D.top || {})[ui.list] || [];
      const hl = ui.list === "overall" ? null : ui.list;
      const cur = LISTS.find(([k]) => k === ui.list);
      const head = `<h2 class="listhead">Top ${ids.length}${ui.list === "overall" ? " overall" : " by " + cur[2]}</h2>`;
      return `${seg}${head}${ids.map((id, i) => { const o = byId(id); return o ? oppCard(o, "l-" + ui.list, hl, i + 1) : ""; }).join("") || `<p class="muted center pad">Nothing on this list yet.</p>`}${note}`;
    }
    const s = ui.opps;
    let list = all.filter((o) => (s.watch || !o.w) && (!s.mail || (o.emails || []).length)
      && (!s.lane || o.lane === s.lane) && (!s.path || o.path === s.path) && (!s.tier || o.tier === s.tier));
    if (s.q) { const q = s.q.toLowerCase(); list = list.filter((o) => JSON.stringify(o).toLowerCase().includes(q)); }
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
  function removedFold() {
    const R = D.removed || [], C = D.rcauses || [];
    if (!R.length) return "";
    const open = !!ui.groups["removed"];
    const body = open ? C.map((c, ci) => { const rows = R.filter((r) => r.c === ci); return rows.length ? `<h2 class="sec">${esc(c)} · ${rows.length}</h2>${rows.map((r) =>
      `<div class="rm"><b>${esc(r.co)}</b>${r.lane ? ` <span class="muted small">${esc(r.lane)}</span>` : ""}<p>${esc(r.why || "")}${safeUrl(r.u) ? ` <a href="${esc(r.u)}" target="_blank" rel="noopener noreferrer">source ↗</a>` : ""}</p></div>`).join("")}` : ""; }).join("") : "";
    return `<details class="fold grp rmv" data-g="removed"${open ? " open" : ""}><summary>Removed leads (with reason)<span class="n">${R.length}</span></summary>${body}</details>`;
  }

  // Period filter. Saved-but-not-applied jobs are their own view so they never inflate application counts.
  const PERIODS = [["0", "Since May 1"], ["1", "Before May"], ["01", "All applied"], ["2", "Saved, not applied"], ["A", "Archived"]];
  const statusCls = (s) => (/interview/i.test(s) ? "good" : /reject|scam/i.test(s) ? "bad" : /viewed/i.test(s) ? "info" : /saved/i.test(s) ? "ok" : "");
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  let TR = null;   // built once at load from the original data; never mutated by filters
  function trackerBase() {
    if (TR) return TR;
    const base = Object.freeze((D.apps || []).map((a) => Object.freeze({ ...a })));
    // archived = older US applications Anne set aside: only in the "Archived" period, never in the default views/counts
    const inP = (a, p) => (p === "A" ? !!a.arch : !a.arch && p.includes(String(a.p ?? 1)));
    const counts = Object.fromEntries(PERIODS.map(([v]) => [v, base.filter((a) => inP(a, v)).length]));
    const main = base.filter((a) => String(a.p ?? 1) === "0");   // dropdown options: fixed at load (since-May rows)
    TR = { base, inP, counts, statuses: Object.freeze(uniq(main.map((a) => a.st))), sources: Object.freeze(uniq(main.map((a) => a.src))) };
    return TR;
  }
  function filterApps(base, s, inP) {   // pure: returns a new array, never touches `base`
    const q = (s.q || "").toLowerCase();
    return base.filter((a) => inP(a, s.period) && (!s.status || a.st === s.status) && (!s.source || a.src === s.source)
      && (!q || [a.co, a.role, a.nt, a.nx].join(" ").toLowerCase().includes(q)))
      .sort((a, b) => String(b.d || "").localeCompare(String(a.d || "")));
  }
  function viewTracker() {
    const s = ui.tr, T = trackerBase();
    if (!PERIODS.some(([v]) => v === s.period)) s.period = "0";
    const list = filterApps(T.base, s, T.inP);
    const sel = (key, label, vals) => `<select data-f="tr.${key}" aria-label="${label}">${opt("", label, s[key])}${vals.map((v) => opt(v, v, s[key])).join("")}</select>`;
    const shown = list.slice(0, s.limit);
    const what = s.period === "2" ? plural(list.length, "saved job") : plural(list.length, "application");
    return `<div class="controls">
        <input type="search" placeholder="Search company, role, notes…" value="${esc(s.q)}" data-f="tr.q" aria-label="Search applications">
        <select data-f="tr.period" aria-label="Period">${PERIODS.map(([v, l]) => opt(v, `${l} (${T.counts[v]})`, s.period)).join("")}</select>
        ${sel("status", "Any status", T.statuses)}
        ${sel("source", "Any source", T.sources)}
      </div>
      <p class="count">${what} · newest first</p>
      <div class="card list">${shown.map((a, i) => appRow(a, "tr:" + (a.co || "") + (a.d || "") + i)).join("") || `<p class="muted center pad">No matches.</p>`}</div>
      ${list.length > shown.length ? `<button class="btn more" data-more>Show ${Math.min(50, list.length - shown.length)} more</button>` : ""}`;
  }
  function appRow(a, id) {
    const open = ui.open.has(id);
    return `<article class="row${open ? " open" : ""}" data-id="${esc(id)}" tabindex="0" role="button" aria-expanded="${open}">
      <div class="top"><h3>${esc(a.co)}</h3><span class="date">${fmtDate(a.d)}</span></div>
      <div class="sub">${a.st ? `<span class="chip ${statusCls(a.st)}">${esc(a.st.replace(/ \(.*\)$/, ""))}</span>` : ""}<span class="role">${esc(a.role || "")}</span></div>
      ${open ? rowDetail([["Role", a.role], ["Status", a.st], ["Next", a.nx], ["Notes", a.nt], ["Fit", a.fit], ["Source", a.src], ["Where", a.loc], ["Due", a.due && fmtDate(a.due)]], a.u) : ""}
    </article>`;
  }

  function viewDocs() {
    const docs = D.docs || [];
    const miss = D.missing || [];
    return `${docs.map((d) => `<details class="fold doc" data-doc="${esc(d.k)}"${ui.doc === d.k ? " open" : ""}>
        <summary><span><b>${esc(d.t)}</b>${d.s ? `<span class="prev">${esc(d.s)}</span>` : ""}</span></summary>${md(d.md)}</details>`).join("") || `<p class="muted center pad">No documents found.</p>`}
      <div class="footer">Built ${esc(D.generated)}${miss.length ? ` · Missing: ${miss.map(esc).join("; ")}` : ""}
        ${ENC ? `<button class="btn sm" data-lock>Lock &amp; forget this device</button>` : ""}</div>`;
  }

  /* ---------------- router ---------------- */
  const VIEWS = { home: ["Today", viewHome], opps: ["Opportunities", viewOpps], tracker: ["Tracker", viewTracker], docs: ["Docs", viewDocs] };
  const ALIAS = { top: "opps", strategy: "docs", legal: "docs" };
  function route() {
    let [tab, sub] = (location.hash.slice(1) || "home").split("/");
    if (tab === "strategy" || tab === "legal") sub = sub || tab;
    if (tab === "top") sub = sub || "overall";
    tab = ALIAS[tab] || tab;
    if (tab === "opps" && sub) ui.list = sub;
    if (tab === "docs") ui.doc = sub || ui.doc;
    const v = VIEWS[tab] || VIEWS.home;
    document.querySelectorAll(".tabbar a").forEach((a) => (a.dataset.tab === (VIEWS[tab] ? tab : "home") ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    $("#title").textContent = v[0];
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
    if (t.closest("a") || t.closest("[data-stop]") || t.closest("summary")) return;
    const l = t.closest("[data-list]"); if (l) { ui.list = l.dataset.list; history.replaceState(null, "", "#opps/" + ui.list); render(); return; }
    if (t.closest("[data-more]")) { ui.tr.limit += 50; render(); return; }
    if (t.closest("[data-lock]")) { forgetKey().then(() => location.reload()); return; }
    const card = t.closest("[data-id]");
    if (card) { const id = card.dataset.id; ui.open.has(id) ? ui.open.delete(id) : ui.open.add(id); render(); }
  });
  main.addEventListener("toggle", (e) => {     // remember which folds are open across re-renders
    const g = e.target.dataset?.g; if (g) ui.groups[g] = e.target.open;
    if (g === "removed" && e.target.open && !e.target.querySelector(".rm")) render();   // body is built lazily
    const d = e.target.dataset?.doc; if (d) { if (e.target.open) ui.doc = d; else if (ui.doc === d) ui.doc = null; }
  }, true);
  main.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-id]")) { e.preventDefault(); e.target.click(); } });
  const onFilter = (e) => {
    const f = e.target.dataset.f; if (!f) return;
    const [grp, key] = f.split(".");
    ui[grp][key] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (grp === "tr") ui.tr.limit = 50;
    render();
  };
  main.addEventListener("input", (e) => e.target.type === "search" && onFilter(e));
  main.addEventListener("change", (e) => e.target.type !== "search" && onFilter(e));
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
    $("#updated").textContent = "Updated " + (D.generated || "").slice(0, 10);
    $("#lock").hidden = true;
    route();
  }
  async function getJSON(url) { const r = await fetch(url, { cache: "no-cache" }); if (!r.ok) throw new Error(r.status); return r.json(); }
  async function start() {
    let env = null;
    try { env = await getJSON("data.enc.json"); } catch (e) {}
    if (!env) {
      try { setData(await getJSON("data.json")); } catch (e) { main.innerHTML = `<p class="muted center pad">No data found. Run build_data.py, then reload.</p>`; }
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
    navigator.serviceWorker.register("sw.js").then((reg) => reg.update()).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded && navigator.serviceWorker.controller) { reloaded = true; location.reload(); } });
  }
  start();
})();
