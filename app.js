/* Anne's job-search dashboard: plain JS, no build step. */
(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const main = $("#main");
  let D = null;                       // decrypted / loaded data
  const ui = {                        // view state (kept across tab switches)
    opps: { q: "", lane: "", path: "", tier: "", sort: "rank", watch: false },
    top: "overall",
    tr: { q: "", status: "", source: "", period: "May–Oct 2026", limit: 50 },
    open: new Set(),
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
    let s = esc(t);
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    s = s.replace(/(^|[\s(:])((?:[a-z0-9-]+\.)+(?:com|org|net|ai|gov|io|co|app)(?:\/[^\s<)]*)?)(?=[\s).,;]|$)/gi, (m, pre, host) => host.includes("@") ? m : `${pre}<a href="https://${host}" target="_blank" rel="noopener noreferrer">${host}</a>`);
    s = s.replace(/(^|[\s(>])([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/g, '$1<a href="mailto:$2">$2</a>');
    return s;
  }
  function md(src) {
    const lines = String(src || "").replace(/\r/g, "").split("\n");
    let html = "", list = null, para = [], quote = [];
    const flushP = () => { if (para.length) { html += `<p>${inline(para.join(" "))}</p>`; para = []; } };
    const flushL = () => { if (list) { html += `<${list.t}>${list.items.map((i) => `<li>${i}</li>`).join("")}</${list.t}>`; list = null; } };
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
        if (list && indent >= 2 && list.items.length) { list.items[list.items.length - 1] += (t === "ol" ? "<br>" : "<br>• ") + inline(m[3]); continue; }
        if (!list || list.t !== t) { flushL(); list = { t, items: [] }; }
        list.items.push(inline(m[3]));
        continue;
      }
      if (list && /^\s{2,}\S/.test(l)) { list.items[list.items.length - 1] += " " + inline(l.trim()); continue; }
      flushL(); flushQ(); para.push(l.trim());
    }
    flush();
    return `<div class="md">${html}</div>`;
  }

  /* ---------------- scores ---------------- */
  const SC = [["speed", "Speed"], ["pay", "Pay"], ["fit", "Fit"], ["reliability", "Reliability"], ["odds", "Interview odds"]];
  const scoreBars = (o, hl) => `<div class="scores">${SC.map(([k, lab]) => {
    const v = o.scores?.[k];
    const n = v == null ? 0 : Math.round(v);
    return `<span class="lab">${lab}</span><span class="bar" role="img" aria-label="${lab} ${v ?? "n/a"} of 5"><i class="s${n}" style="width:${v == null ? 0 : (v / 5) * 100}%"></i></span><span class="val${hl === k ? " hl" : ""}">${v ?? "–"}</span>`;
  }).join("")}</div>`;
  const tierCls = (t) => ({ A: "good", B: "ok", C: "bad" }[String(t || "").toUpperCase()] || "");
  const legalCls = (s) => (/pass/i.test(s || "") ? "good" : /fail/i.test(s || "") ? "bad" : s ? "ok" : "");

  function oppCard(o, ctx, hl, pos) {
    const id = ctx + ":" + o.id;
    const open = ui.open.has(id);
    const chips = [
      o.tier && `<span class="chip ${tierCls(o.tier)}">Tier ${esc(o.tier)}</span>`,
      o.legal && `<span class="chip ${legalCls(o.legal)}">${esc(o.legal)}</span>`,
      o.path && `<span class="chip info">Path ${esc(o.path)}</span>`,
      o.lane && `<span class="chip">${esc(o.lane)}</span>`,
      o.pay_text && `<span class="chip">${esc(o.pay_text)}</span>`,
      o.rank_score != null && `<span class="chip">Score ${o.rank_score}</span>`,
      o.watchlist && `<span class="chip bad">Watchlist: not cleared</span>`,
    ].filter(Boolean).join("");
    return `<article class="card opp${open ? " open" : ""}" data-id="${esc(id)}" tabindex="0" role="button" aria-expanded="${open}">
      <div class="head">
        ${pos ? `<div class="rank">#${pos}<small>${o.rank ? "overall " + o.rank : "list"}</small></div>` : `<div class="rank${o.rank ? "" : " none"}">${o.rank ? "#" + o.rank : "–"}<small>rank</small></div>`}
        <div style="min-width:0"><h3>${esc(o.company)}</h3>${o.role ? `<p class="role">${esc(o.role)}</p>` : ""}</div>
        <svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      <div class="chips">${chips}</div>
      ${scoreBars(o, hl)}
      ${open ? oppDetail(o) : ""}
    </article>`;
  }
  function oppDetail(o) {
    const mail = (o.emails || []).map((e) => `<a class="btn primary" href="mailto:${encodeURIComponent(e).replace(/%40/g, "@")}">✉ ${esc(e)}</a>`).join("");
    const post = safeUrl(o.posting_url) ? `<a class="btn" href="${esc(o.posting_url)}" target="_blank" rel="noopener noreferrer">Open posting ↗</a>` : "";
    const rows = [
      ["Why these scores", o.reasoning], ["Apply path", o.apply_path], ["Contact email", o.email_raw],
      ["Email status", o.email_status], ["Named contact", o.named_contact], ["Resume to use", o.resume],
      ["Email angle", o.email_angle], ["Work model", o.work_model], ["Open role?", o.open],
      ["Weighted score", o.weighted], ["Date verified", o.date_verified],
      ...(o.fields || []).filter(([h]) => !/url$/i.test(h)),
    ].filter(([, v]) => v != null && v !== "");
    const links = (o.links || []).filter((l) => safeUrl(l.url) && l.url !== o.posting_url)
      .map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a> <span class="muted small">${esc(new URL(l.url).hostname)}</span></li>`).join("");
    return `<div class="detail" data-stop>
      <div class="actions">${mail}${post}</div>
      ${o.red_flags ? `<div class="warn"><strong>Red flags / legal:</strong> ${linkify(o.red_flags)}</div>` : ""}
      <dl style="margin-top:12px">${rows.map(([h, v]) => `<dt>${esc(h)}</dt><dd>${linkify(v)}</dd>`).join("")}</dl>
      ${links ? `<dt style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--muted);margin-top:12px">Links</dt><ul style="padding-left:18px;margin:4px 0">${links}</ul>` : ""}
    </div>`;
  }

  /* ---------------- views ---------------- */
  function viewHome() {
    const stats = (D.stats || []).map((s) => `<div class="stat"><div class="l">${esc(s.label)}</div><div class="v">${esc(s.value)}</div>${s.caption ? `<div class="c">${esc(s.caption)}</div>` : ""}</div>`).join("");
    const pend = (D.pending || []).map((p) => `<div class="pending"><div class="when">${esc(p.when)}</div><div>${linkify(p.text)}</div></div>`).join("");
    const groups = {};
    (D.action_now || []).forEach((a) => { const k = a.Priority || "Other"; (groups[k] = groups[k] || []).push(a); });
    const act = Object.entries(groups).map(([k, rows]) => `<h2 class="sec">${esc(k)} · ${rows.length}</h2>` + rows.map((a, i) => actionCard(a, "act:" + k + i)).join("")).join("");
    const top3 = (D.top?.overall || []).slice(0, 3).map((id) => byId(id)).filter(Boolean);
    return `
      ${pend ? `<h2 class="sec">Pending right now</h2><div class="card">${pend}</div>` : ""}
      ${stats ? `<h2 class="sec">Key stats</h2><div class="stats">${stats}</div>` : ""}
      ${D.recap_md ? `<h2 class="sec">Today's recap</h2><details class="fold"><summary>${esc((D.recap_md.match(/^#\s+(.*)/m) || [, "Recap"])[1])}</summary>${md(D.recap_md.replace(/^#\s+.*\n/, ""))}</details>` : ""}
      ${top3.length ? `<h2 class="sec">Top opportunities</h2>${top3.map((o) => oppCard(o, "home")).join("")}<a class="btn more" href="#top">See all top lists</a>` : ""}
      ${act ? `<h2 class="sec" style="font-size:15px;color:var(--ink)">Action now (${(D.action_now || []).length})</h2>${act}` : ""}
      ${footer()}`;
  }
  function actionCard(a, id) {
    const open = ui.open.has(id);
    const due = a["Follow-up Due"];
    const overdue = due && due <= new Date().toISOString().slice(0, 10);
    return `<article class="card opp app${open ? " open" : ""}" data-id="${esc(id)}" tabindex="0" role="button" aria-expanded="${open}">
      <div class="top"><h3>${esc(a.Company)}</h3>${due ? `<span class="chip ${overdue ? "bad" : "info"}">Due ${fmtDate(due)}</span>` : ""}</div>
      <p class="role">${esc(a.Role || "")}</p>
      <div class="chips">${a.Status ? `<span class="chip">${esc(a.Status)}</span>` : ""}${a.Fit ? `<span class="chip ${a.Fit === "High" ? "good" : ""}">Fit ${esc(a.Fit)}</span>` : ""}</div>
      ${a["Next Action"] ? `<p style="margin:8px 0 0;font-size:14.5px"><strong>Next:</strong> ${linkify(a["Next Action"])}</p>` : ""}
      ${open ? rowDetail(a, ["Company", "Role", "Status", "Fit", "Next Action", "Priority", "Follow-up Due"]) : ""}
    </article>`;
  }
  function rowDetail(a, skip) {
    const rows = Object.entries(a).filter(([k, v]) => !k.startsWith("_") && !skip.includes(k) && v != null && v !== "" && !/^link/i.test(k));
    const links = (a._links || []).filter((l) => safeUrl(l.url)).map((l) => `<a class="btn" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join("");
    return `<div class="detail" data-stop>${links ? `<div class="actions">${links}</div>` : ""}<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${/date|due/i.test(k) ? fmtDate(v) : linkify(v)}</dd>`).join("")}</dl></div>`;
  }

  const byId = (id) => D._idx[id];
  const SORTS = { rank: "Overall rank", rank_score: "Rank score", speed: "Speed", pay: "Pay", fit: "Fit", reliability: "Reliability", odds: "Interview odds" };
  function sortVal(o, k) {
    if (k === "rank") return o.rank == null ? 1e9 : o.rank;
    if (k === "rank_score") return -(o.rank_score ?? -1e9);
    return -(o.scores?.[k] ?? -1e9);
  }
  function viewOpps() {
    const s = ui.opps, all = D.opportunities || [];
    const hasWatch = all.some((o) => o.watchlist);
    let list = all.filter((o) => (s.watch || !o.watchlist)
      && (!s.lane || o.lane === s.lane) && (!s.path || o.path === s.path) && (!s.tier || o.tier === s.tier));
    if (s.q) { const q = s.q.toLowerCase(); list = list.filter((o) => JSON.stringify(o).toLowerCase().includes(q)); }
    list.sort((a, b) => sortVal(a, s.sort) - sortVal(b, s.sort) || sortVal(a, "rank") - sortVal(b, "rank"));
    const sel = (key, label, vals) => `<select data-f="opps.${key}" aria-label="${label}">${opt("", "All " + label.toLowerCase(), s[key])}${vals.map((v) => opt(v, v, s[key])).join("")}</select>`;
    return `<div class="controls">
        <input type="search" placeholder="Search company, role, notes…" value="${esc(s.q)}" data-f="opps.q" aria-label="Search opportunities">
        ${sel("lane", "Lanes", uniq(all.map((o) => o.lane)))}
        ${sel("path", "Paths", uniq(all.map((o) => o.path)))}
        ${sel("tier", "Tiers", uniq(all.map((o) => o.tier)))}
        <select data-f="opps.sort" aria-label="Sort by">${Object.entries(SORTS).map(([k, v]) => opt(k, "Sort: " + v, s.sort)).join("")}</select>
        ${hasWatch ? `<label class="check" style="flex:1 1 100%;justify-content:flex-start"><input type="checkbox" data-f="opps.watch"${s.watch ? " checked" : ""}> Include watchlist (not cleared)</label>` : ""}
      </div>
      <p class="count">${list.length} of ${all.filter((o) => s.watch || !o.watchlist).length} opportunities · tap a card for details</p>
      ${list.map((o) => oppCard(o, "opps", ["rank", "rank_score"].includes(s.sort) ? null : s.sort)).join("") || `<p class="muted center pad">No matches.</p>`}
      ${(D.opp_notes || []).length ? `<p class="footer">${D.opp_notes.map(esc).join("<br>")}</p>` : ""}`;
  }
  function viewTop() {
    const metas = (D.top_meta || []).filter((m) => m.count > 0 || m.key !== "watchlist");
    if (!metas.find((m) => m.key === ui.top)) ui.top = metas[0]?.key;
    const m = metas.find((x) => x.key === ui.top);
    const ids = (D.top || {})[ui.top] || [];
    const hl = { speed: "speed", pay: "pay", fit: "fit", reliability: "reliability", odds: "odds" }[ui.top];
    return `<div class="seg" role="tablist">${metas.map((x) => `<button data-top="${x.key}" aria-pressed="${x.key === ui.top}">${esc(x.label)}</button>`).join("")}</div>
      ${m ? `<p class="count">${esc(m.title)}${m.sheet ? "" : " · sheet not in workbook yet"}</p>` : ""}
      ${ids.map((id, i) => { const o = byId(id); return o ? oppCard(o, "top-" + ui.top, hl, ui.top === "overall" ? null : i + 1) : ""; }).join("") || `<p class="muted center pad">Nothing on this list yet.</p>`}`;
  }
  const statusCls = (s) => (/interview/i.test(s) ? "good" : /reject/i.test(s) ? "bad" : /viewed/i.test(s) ? "info" : /no response|unknown/i.test(s) ? "" : "ok");
  function viewTracker() {
    const s = ui.tr;
    const saved = (D.saved || []).map((x) => ({ ...x, Status: "Saved – not applied", "Date Applied": x["Date Saved"], _period: "Saved (not applied)" }));
    const all = (D.applications || []).concat(saved);
    const periods = uniq(all.map((a) => a._period));
    let list = all.filter((a) => (!s.period || a._period === s.period) && (!s.status || a.Status === s.status) && (!s.source || a.Source === s.source));
    if (s.q) { const q = s.q.toLowerCase(); list = list.filter((a) => [a.Company, a.Role, a.Notes, a.Category].join(" ").toLowerCase().includes(q)); }
    list.sort((a, b) => String(b["Date Applied"] || "").localeCompare(String(a["Date Applied"] || "")));
    const pool = all.filter((a) => !s.period || a._period === s.period);
    const sel = (key, label, vals) => `<select data-f="tr.${key}" aria-label="${label}">${opt("", "All " + label.toLowerCase(), s[key])}${vals.map((v) => opt(v, v, s[key])).join("")}</select>`;
    const shown = list.slice(0, s.limit);
    return `<div class="controls">
        <input type="search" placeholder="Search company or role…" value="${esc(s.q)}" data-f="tr.q" aria-label="Search applications">
        <select data-f="tr.period" aria-label="Period">${opt("", "All periods", s.period)}${periods.map((v) => opt(v, v, s.period)).join("")}</select>
        ${sel("status", "Statuses", uniq(pool.map((a) => a.Status)))}
        ${sel("source", "Sources", uniq(pool.map((a) => a.Source)))}
      </div>
      <p class="count">${list.length} shown · newest first</p>
      ${shown.map((a, i) => appCard(a, "tr:" + (a.Company || "") + (a["Date Applied"] || "") + i)).join("") || `<p class="muted center pad">No matches.</p>`}
      ${list.length > shown.length ? `<button class="btn more" data-more>Show ${Math.min(50, list.length - shown.length)} more</button>` : ""}`;
  }
  function appCard(a, id) {
    const open = ui.open.has(id);
    return `<article class="card opp app${open ? " open" : ""}" data-id="${esc(id)}" tabindex="0" role="button" aria-expanded="${open}">
      <div class="top"><h3>${esc(a.Company)}</h3><span class="date">${fmtDate(a["Date Applied"])}</span></div>
      <p class="role">${esc(a.Role || "")}</p>
      <div class="chips">${a.Status ? `<span class="chip ${statusCls(a.Status)}">${esc(a.Status)}</span>` : ""}${a.Source ? `<span class="chip">${esc(a.Source)}</span>` : ""}${a.Fit ? `<span class="chip ${a.Fit === "High" ? "good" : a.Fit === "Exclude" ? "bad" : ""}">Fit ${esc(a.Fit)}</span>` : ""}</div>
      ${open ? rowDetail(a, ["Company", "Role", "Status", "Source", "Fit"]) : ""}
    </article>`;
  }
  const viewStrategy = () => D.strategy?.md ? `<div class="card">${md(D.strategy.md)}</div><p class="footer">Source: ${esc(D.strategy.source)}</p>` : `<p class="muted center pad">Strategy file not found.</p>`;
  const viewLegal = () => `
    <h2 class="sec">When the time comes: contractor checklist</h2>
    <div class="card">${D.legal?.checklist_md ? md(D.legal.checklist_md) : '<p class="muted">Not found.</p>'}</div>
    <h2 class="sec">Legal and audit corrections</h2>
    <div class="card">${D.legal?.corrections_md ? md(D.legal.corrections_md) : '<p class="muted">Not found.</p>'}</div>`;
  function footer() {
    const miss = (D.missing || []);
    return `<div class="footer">Data built ${esc(D.generated)}.${miss.length ? `<br>Missing: ${miss.map(esc).join("; ")}` : ""}
      ${ENC ? `<br><button class="btn" data-lock style="margin-top:8px">Lock &amp; forget on this device</button>` : ""}</div>`;
  }

  /* ---------------- router ---------------- */
  const VIEWS = { home: ["Home", viewHome], opps: ["Opportunities", viewOpps], top: ["Top Lists", viewTop], tracker: ["Tracker", viewTracker], strategy: ["Strategy", viewStrategy], legal: ["Legal", viewLegal] };
  function route() {
    const [tab, sub] = (location.hash.slice(1) || "home").split("/");
    const v = VIEWS[tab] || VIEWS.home;
    if (tab === "top" && sub) ui.top = sub;
    document.querySelectorAll(".tabbar a").forEach((a) => (a.dataset.tab === (VIEWS[tab] ? tab : "home") ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    $("#title").textContent = v[0];
    render(true);
  }
  let curTab = null;
  function render(scrollTop) {
    if (!D) return;
    const tab = (location.hash.slice(1) || "home").split("/")[0];
    const focusF = document.activeElement?.dataset?.f, pos = document.activeElement?.selectionStart;
    main.innerHTML = (VIEWS[tab] || VIEWS.home)[1]();
    if (focusF) { const el = main.querySelector(`[data-f="${focusF}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} } }
    if (scrollTop && curTab !== tab) window.scrollTo(0, 0);
    curTab = tab;
  }
  main.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("a") || t.closest("[data-stop]")) return;
    const top = t.closest("[data-top]"); if (top) { ui.top = top.dataset.top; history.replaceState(null, "", "#top/" + ui.top); render(); return; }
    if (t.closest("[data-more]")) { ui.tr.limit += 50; render(); return; }
    if (t.closest("[data-lock]")) { forgetKey().then(() => location.reload()); return; }
    const card = t.closest("[data-id]");
    if (card) { const id = card.dataset.id; ui.open.has(id) ? ui.open.delete(id) : ui.open.add(id); render(); }
  });
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
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: b64(env.salt), iterations: env.iter }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  }
  async function decrypt(key, env) {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(env.iv), additionalData: new TextEncoder().encode(env.aad || "") }, key, b64(env.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  function setData(d) {
    D = d; D._idx = {};
    (D.opportunities || []).forEach((o) => (D._idx[o.id] = o));
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
    $("#lockForm").onsubmit = async (ev) => {
      ev.preventDefault();
      const btn = $("#unlockBtn"); btn.disabled = true; btn.textContent = "Unlocking…"; $("#lockMsg").textContent = "";
      try {
        const key = await deriveKey($("#pw").value, env);
        const data = await decrypt(key, env);
        if ($("#remember").checked) await saveKey(key);  // non-extractable CryptoKey; passphrase itself is never stored
        $("#pw").value = "";
        setData(data);
      } catch (e) {
        $("#lockMsg").textContent = "That passphrase didn't work. Try again.";
      } finally { btn.disabled = false; btn.textContent = "Unlock"; }
    };
  }

  if ("serviceWorker" in navigator && /^(https:|http:\/\/(localhost|127\.0\.0\.1))/.test(location.href)) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  start();
})();
