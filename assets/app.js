(function () {
  "use strict";

  // ---------- Helpers ----------
  const DAY = 86400000;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const pad = (n) => String(n).padStart(2, "0");
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const today = (() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); })();
  const TODAY = iso(today);
  const daysUntil = (s) => Math.round((parse(s) - today) / DAY);
  const fmt = (s, opts) => parse(s).toLocaleDateString("en-GB", opts || { day: "numeric", month: "short", year: "numeric" });
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rel = (n) => n === 0 ? "today" : n > 0 ? `in ${n} day${n === 1 ? "" : "s"}` : `${-n} day${n === -1 ? "" : "s"} ago`;
  const tbc = (m) => (m.tbc ? ' <span class="pill tbc">TBC</span>' : "");
  const isOverdue = (t) => t.status !== "done" && t.due && daysUntil(t.due) < 0;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  const GOAL_COLOR = { setup: "--setup", sg1: "--sg1", sg2: "--sg2", sg3: "--sg3", writing: "--writing", milestone: "--milestone" };
  const GOAL_LABEL = { setup: "Setup / background", sg1: "Sub-goal 1 · accuracy", sg2: "Sub-goal 2 · documentation", sg3: "Sub-goal 3 · futility", writing: "Writing", milestone: "Presentation / milestone" };
  const KIND_LABEL = { milestone: "Milestone", deadline: "Deadline", meeting: "Meeting", break: "Break / period" };
  const STATUSES = ["todo", "doing", "done", "blocked"];
  const STATUS_LABEL = { todo: "To do", doing: "In progress", done: "Done", blocked: "Blocked" };

  // ---------- plan.js serialisation ----------
  const HEADER = `/*
 * THESIS PLAN DATA — this is the file you update regularly.
 *
 * Edit it by hand, or use "Edit mode" on the timeline of the local site and
 * press "Save plan.js" (that rewrites this whole file).
 *
 * Everything dynamic on the site (countdowns, timeline, task progress,
 * meetings, decisions, progress log) is rendered from this object.
 * Dates are ISO strings (YYYY-MM-DD). Task status: "todo" | "doing" | "done" | "blocked".
 * Set \`tbc: true\` on a milestone whose date is not yet confirmed.
 *
 * Kept as a .js file (not .json) so the site also works when opened
 * directly from disk (file://), where browsers block fetch().
 */
`;
  const keep = (v) => v !== false && v !== null && v !== undefined && v !== "";
  const line = (o) => "{ " + Object.entries(o).filter(([k, v]) => keep(v) || k === "decision").map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ") + " }";
  const arr = (a) => (a && a.length ? "[\n" + a.map((o) => "    " + line(o)).join(",\n") + "\n  ]" : "[]");
  const pretty = (v) => JSON.stringify(v, null, 2).replace(/\n/g, "\n  ");
  const LIST_KEYS = ["milestones", "phases", "tasks", "decisions", "log"];
  function serialize(p) {
    const parts = Object.keys(p).map((k) => {
      const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
      return `  ${key}: ${LIST_KEYS.includes(k) ? arr(p[k]) : pretty(p[k])}`;
    });
    return HEADER + "window.PLAN = {\n" + parts.join(",\n\n") + "\n};\n";
  }
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h.toString(36); };
  const planHash = (p) => { const c = clone(p); delete c.lastUpdated; return hash(serialize(c)); };

  // ---------- State ----------
  const canEdit = location.protocol === "file:" || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || new URLSearchParams(location.search).has("edit");
  const DRAFT_KEY = "thesisPlanDraft";
  let fileState = clone(window.PLAN);       // what plan.js on disk contains (as far as we know)
  let fileBase = planHash(fileState);       // hash of plan.js on disk
  let savedHash = fileBase;                 // hash of last saved/downloaded state
  let P = clone(fileState);
  let staleDraft = null;
  let editMode = canEdit && store.get("editMode") === "1";
  let fileHandle = null;
  const history = [];

  try {
    const d = JSON.parse(store.get(DRAFT_KEY) || "null");
    if (d && d.plan) {
      if (planHash(d.plan) === fileBase) store.del(DRAFT_KEY);           // plan.js already contains the draft
      else if (d.base === fileBase) { P = d.plan; if (d.downloaded) savedHash = planHash(P); }
      else staleDraft = d;                                               // plan.js changed since the draft was made
    }
  } catch (e) { store.del(DRAFT_KEY); }

  const isDirty = () => planHash(P) !== savedHash;
  function persistDraft(downloaded) {
    if (planHash(P) === fileBase) store.del(DRAFT_KEY);
    else store.set(DRAFT_KEY, JSON.stringify({ base: fileBase, plan: P, downloaded: !!downloaded || (!isDirty() && savedHash !== fileBase) }));
  }
  function change(fn) {
    history.push(clone(P));
    if (history.length > 100) history.shift();
    fn();
    P.milestones.sort((a, b) => a.date.localeCompare(b.date));
    persistDraft();
    render();
  }
  function undo() {
    if (!history.length) return;
    P = history.pop();
    persistDraft();
    render();
    toast("Undone");
  }

  // ---------- Theme ----------
  const root = document.documentElement;
  { const saved = store.get("theme"); if (saved) root.dataset.theme = saved; }
  $("#themeToggle").addEventListener("click", () => {
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    store.set("theme", root.dataset.theme);
  });

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg, ms) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), ms || 2500);
  }

  // ---------- Render: hero ----------
  function renderHero() {
    $("#thesisTitle").textContent = P.meta.title;
    $("#lastUpdated").textContent = fmt(P.lastUpdated, { day: "numeric", month: "long", year: "numeric" });
    const people = [
      ["Student", esc(P.meta.student)], ["Promotor", esc(P.meta.promotor)],
      ["Daily advisors", esc(P.meta.advisors)], ["Groups", esc(P.meta.groups)]
    ];
    if (P.meta.repo) people.push(["Code", `<a href="${esc(P.meta.repo)}">${esc(P.meta.repo.replace(/^https?:\/\//, ""))}</a>`]);
    $("#people").innerHTML = people.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");

    const next = P.milestones.filter((m) => daysUntil(m.end || m.date) >= 0 && m.kind !== "break")[0];
    const counters = [];
    if (next && !next.highlight) counters.push(Object.assign({ label: "Next up" }, next));
    P.milestones.filter((m) => m.highlight).forEach((m) => counters.push(Object.assign({ label: m.title }, m)));
    $("#countdowns").innerHTML = counters.map((m) => {
      const n = daysUntil(m.date);
      return `<div class="count${m.highlight ? " highlight" : ""}">
        <div class="lbl">${esc(m.label)}${tbc(m)}</div>
        <div class="n">${n >= 0 ? n : "✓"}</div>
        <div class="d">${n >= 0 ? `days · ~${Math.floor(n / 7)} weeks` : "done"} · ${fmt(m.date)}</div>
        ${m.label === "Next up" ? `<div class="d">${esc(m.title)}</div>` : ""}
      </div>`;
    }).join("");
  }

  // ---------- Render: Gantt ----------
  const G = { start: null, span: 1 };
  const pct = (d) => (((typeof d === "string" ? parse(d) : d) - G.start) / G.span) * 100;
  const tasksOf = (id) => P.tasks.filter((t) => t.phase === id);
  const phaseProgress = (id) => { const ts = tasksOf(id); return ts.length ? ts.filter((t) => t.status === "done").length / ts.length : 0; };
  const colorOf = (goal) => `var(${GOAL_COLOR[goal] || "--accent"})`;

  function renderGantt() {
    const allDates = [...P.phases.flatMap((p) => [p.start, p.end]), ...P.milestones.flatMap((m) => [m.date, m.end].filter(Boolean)), TODAY].map(parse);
    const min = new Date(Math.min(...allDates)); const max = new Date(Math.max(...allDates));
    G.start = new Date(min.getFullYear(), min.getMonth(), 1);
    const gEnd = new Date(max.getFullYear(), max.getMonth() + 1, 1);
    G.span = gEnd - G.start;

    const months = [];
    for (let d = new Date(G.start); d < gEnd; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(new Date(d));
    const widths = months.map((d) => ((new Date(d.getFullYear(), d.getMonth() + 1, 1) - d) / G.span) * 100);

    let g = `<div class="g-months" style="grid-template-columns:${widths.map((w) => w + "%").join(" ")}">` +
      months.map((d, i) => `<div class="g-month">${d.toLocaleDateString("en-GB", { month: "short" })}${d.getMonth() === 0 || i === 0 ? " " + d.getFullYear() : ""}</div>`).join("") + "</div>";
    g += `<div style="position:relative"><div class="g-overlay">` +
      months.map((d) => `<div class="g-grid" style="left:${pct(d)}%"></div>`).join("") +
      P.milestones.filter((m) => m.kind === "break" && m.end).map((m) => `<div class="g-break" title="${esc(m.title)}" style="left:${pct(m.date)}%;width:${pct(m.end) - pct(m.date)}%"></div>`).join("") +
      `<div class="g-today" style="left:${pct(today)}%"><span>Today</span></div></div>`;

    P.phases.forEach((p, i) => {
      const prog = Math.round(phaseProgress(p.id) * 100);
      g += `<div class="g-row"><div class="g-label" title="${esc(p.name)}">
          <span class="g-move"><button type="button" data-act="up" data-id="${esc(p.id)}" ${i === 0 ? "disabled" : ""} aria-label="Move up">▲</button><button type="button" data-act="down" data-id="${esc(p.id)}" ${i === P.phases.length - 1 ? "disabled" : ""} aria-label="Move down">▼</button></span>
          <span class="lname" data-id="${esc(p.id)}">${esc(p.name)}</span></div>
        <div class="g-track"><div class="g-bar${p.goal === "milestone" ? " milestone" : ""}" data-id="${esc(p.id)}"
          style="--c:${colorOf(p.goal)};left:${pct(p.start)}%;width:${Math.max(pct(addDays(p.end, 1)) - pct(p.start), 0.6)}%"
          title="${esc(p.name)}: ${fmt(p.start)} → ${fmt(p.end)} · ${prog}% done">
          <span class="rz l"></span><div class="fill" style="width:${prog}%"></div><span class="rz r"></span></div></div></div>`;
    });
    g += `<div class="g-row g-mrow"><div class="g-label">Events</div><div class="g-track">` +
      P.milestones.map((m, i) => m.kind === "break" ? "" :
        `<div class="g-diamond" data-idx="${i}" style="left:${pct(m.date)}%${m.highlight ? ";width:15px;height:15px;top:10px" : ";opacity:.75"}" title="${esc(m.title)} · ${fmt(m.date)}${m.tbc ? " (TBC)" : ""}"></div>`).join("") +
      `</div></div></div>`;
    $("#gantt").innerHTML = g;

    $("#milestones").innerHTML = P.milestones.map((m, i) => {
      const date = m.end ? `${fmt(m.date, { day: "numeric", month: "short" })} – ${fmt(m.end)}` : fmt(m.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
      return `<li data-idx="${i}" class="kind-${esc(m.kind)}${daysUntil(m.end || m.date) < 0 ? " past" : ""}${m.highlight ? " highlight" : ""}">
        <span class="date">${date}</span><span class="t">${esc(m.title)}${tbc(m)}</span><span class="rel">${rel(daysUntil(m.date))}</span></li>`;
    }).join("");
  }

  // ---------- Render: work plan ----------
  let filter = store.get("taskFilter") || "all";
  const openPhases = new Set(P.phases.filter((p) => parse(p.start) <= today && today <= parse(p.end)).map((p) => p.id));
  const match = (t) => filter === "all" || (filter === "open" && t.status !== "done") || (filter === "overdue" && isOverdue(t)) || t.status === filter;

  function renderWork() {
    const done = P.tasks.filter((t) => t.status === "done").length;
    const overdue = P.tasks.filter(isOverdue).length;
    const total = P.tasks.length || 1;
    $("#overall").innerHTML = `<strong>${done} / ${P.tasks.length} tasks done</strong>
      <div class="progress" aria-hidden="true"><div style="width:${(done / total) * 100}%"></div></div>
      <span class="muted">${P.tasks.filter((t) => t.status === "doing").length} in progress${overdue ? ` · <span style="color:var(--blocked)">${overdue} overdue</span>` : ""}</span>`;

    $("#phases").innerHTML = P.phases.map((p) => {
      const ts = tasksOf(p.id); const shown = ts.filter(match);
      const prog = Math.round(phaseProgress(p.id) * 100);
      const active = parse(p.start) <= today && today <= parse(p.end);
      return `<details class="phase" data-id="${esc(p.id)}" style="--c:${colorOf(p.goal)}" ${openPhases.has(p.id) || filter !== "all" ? "open" : ""}>
        <summary><span class="pname">${esc(p.name)}${active ? ' <span class="pill" style="background:var(--accent-soft);color:var(--accent)">NOW</span>' : ""}<button type="button" class="phase-edit" data-id="${esc(p.id)}">Edit</button></span>
          <span class="pdates">${fmt(p.start, { day: "numeric", month: "short" })} → ${fmt(p.end)}</span>
          <span class="pprog"><span class="progress"><div style="width:${prog}%"></div></span>${ts.filter((t) => t.status === "done").length}/${ts.length}</span></summary>
        ${shown.length ? `<ul class="tasks">${shown.map((t) => `<li class="${esc(t.status)}${isOverdue(t) ? " overdue" : ""}" data-ti="${P.tasks.indexOf(t)}">
          <span class="status ${esc(t.status)}" title="${STATUS_LABEL[t.status] || t.status}${editMode ? " — click to change" : ""}"></span><span class="txt">${esc(t.task)}</span>
          <span class="due">${t.due ? fmt(t.due, { day: "numeric", month: "short" }) : ""}</span></li>`).join("")}</ul>`
          : `<div class="empty">${ts.length ? "No tasks match this filter." : "No tasks yet."}</div>`}
      </details>`;
    }).join("");
    $$("#phases details").forEach((d) => d.addEventListener("toggle", () => { d.open ? openPhases.add(d.dataset.id) : openPhases.delete(d.dataset.id); }));
    $$(".filters button").forEach((x) => x.classList.toggle("active", x.dataset.filter === filter));
  }

  // ---------- Render: decisions, meetings, log ----------
  function renderRest() {
    $("#decisions").innerHTML = P.decisions.map((d) => `<tr><td>${esc(d.topic)}</td>
      <td><span class="dstatus ${esc(d.status)}">${esc(d.status)}</span></td>
      <td>${d.decision ? `<strong>${esc(d.decision)}</strong><br>` : ""}<span class="muted">${esc(d.note)}</span></td></tr>`).join("");

    const list = (title, items) => items && items.length ? `<h4>${title}</h4><ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "";
    $("#meetingList").innerHTML = [...P.meetings].sort((a, b) => b.date.localeCompare(a.date)).map((m) => {
      const n = daysUntil(m.date);
      return `<article class="meeting"><header><h3>${esc(m.title)}</h3>
        <span class="when">${fmt(m.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}${n >= 0 ? ` · <span class="upcoming">upcoming, ${rel(n)}</span>` : ""}</span></header>
        ${m.attendees ? `<p class="muted" style="margin:.3rem 0 0">${esc(m.attendees)}</p>` : ""}
        ${list("Agenda", m.agenda)}
        ${m.notes ? `<h4>Notes</h4><p style="margin:0;white-space:pre-line">${esc(m.notes)}</p>` : ""}
        ${list("Action items", m.actions)}</article>`;
    }).join("");

    $("#logList").innerHTML = [...P.log].sort((a, b) => b.date.localeCompare(a.date))
      .map((l) => `<li><time datetime="${esc(l.date)}">${fmt(l.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</time>${esc(l.entry)}</li>`).join("");
  }

  // ---------- Render: edit toolbar + banner ----------
  function renderToolbar() {
    document.body.classList.toggle("editing", editMode);
    $("#toolbar").hidden = !canEdit;
    $("#editToggle").checked = editMode;
    $("#undoBtn").disabled = !history.length;
    const dirty = isDirty();
    const note = $("#dirtyNote");
    note.classList.toggle("dirty", dirty);
    note.textContent = dirty ? "● Unsaved changes (kept in this browser)" : (planHash(P) !== fileBase ? "Downloaded — replace data/plan.js with it" : "All changes saved");
    $("#discardBtn").disabled = planHash(P) === fileBase;
    $("#saveAsBtn").hidden = !window.showSaveFilePicker;

    const b = $("#banner");
    if (staleDraft) {
      b.innerHTML = `<div class="banner"><span>You have unsaved edits from before <code>plan.js</code> was last changed.</span>
        <button type="button" id="restoreDraft">Restore my edits</button><button type="button" id="dropDraft">Discard them</button></div>`;
      $("#restoreDraft").onclick = () => { const d = staleDraft; staleDraft = null; change(() => { P = d.plan; }); toast("Edits restored — check them, then save."); };
      $("#dropDraft").onclick = () => { staleDraft = null; store.del(DRAFT_KEY); render(); };
    } else if (!editMode && canEdit && isDirty()) {
      b.innerHTML = `<div class="banner"><span>The timeline shows unsaved edits.</span><button type="button" id="bannerEdit">Open edit mode to save</button></div>`;
      $("#bannerEdit").onclick = () => setEdit(true);
    } else b.innerHTML = "";
  }

  function render() {
    renderHero(); renderGantt(); renderWork(); renderRest(); renderToolbar();
  }

  // ---------- Edit mode ----------
  function setEdit(on) {
    editMode = on; store.set("editMode", on ? "1" : "0"); render();
  }
  $("#editToggle").addEventListener("change", (e) => setEdit(e.target.checked));
  $("#undoBtn").addEventListener("click", undo);
  $("#addPhase").addEventListener("click", () => openPhaseDialog(null));
  $("#addMilestone").addEventListener("click", () => openMilestoneDialog(null));
  $("#discardBtn").addEventListener("click", () => {
    if (!confirm("Discard all unsaved edits and go back to what plan.js contains?")) return;
    change(() => { P = clone(fileState); });
    savedHash = fileBase; store.del(DRAFT_KEY); render();
  });
  $("#saveBtn").addEventListener("click", () => save(false));
  $("#saveAsBtn").addEventListener("click", () => save(true));
  document.addEventListener("keydown", (e) => {
    if (!editMode || $("#editDialog").open) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(false); }
  });

  // Filters
  $$(".filters button").forEach((b) => b.addEventListener("click", () => {
    filter = b.dataset.filter; store.set("taskFilter", filter); renderWork();
  }));

  // Gantt: reorder + open dialogs
  $("#gantt").addEventListener("click", (e) => {
    if (!editMode) return;
    const mv = e.target.closest(".g-move button");
    if (mv) {
      const i = P.phases.findIndex((p) => p.id === mv.dataset.id);
      const j = mv.dataset.act === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= P.phases.length) return;
      change(() => { [P.phases[i], P.phases[j]] = [P.phases[j], P.phases[i]]; });
      return;
    }
    const nm = e.target.closest(".lname");
    if (nm) openPhaseDialog(nm.dataset.id);
  });

  // Gantt: drag to move / resize
  const tip = $("#dragTip");
  $("#gantt").addEventListener("pointerdown", (e) => {
    if (!editMode || e.button !== 0) return;
    const el = e.target.closest(".g-bar, .g-diamond");
    if (!el) return;
    e.preventDefault();
    const isMs = el.classList.contains("g-diamond");
    const item = isMs ? P.milestones[+el.dataset.idx] : P.phases.find((p) => p.id === el.dataset.id);
    const mode = e.target.classList.contains("rz") ? (e.target.classList.contains("l") ? "start" : "end") : "move";
    const o = isMs ? { start: item.date, end: item.end } : { start: item.start, end: item.end };
    const pxPerDay = el.parentElement.getBoundingClientRect().width / (G.span / DAY);
    const x0 = e.clientX; let moved = false; let ns = o.start; let ne = o.end;
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    el.classList.add("dragging");

    const onMove = (ev) => {
      if (Math.abs(ev.clientX - x0) > 3) moved = true;
      if (!moved) return;
      const dd = Math.round((ev.clientX - x0) / pxPerDay);
      if (mode === "move") { ns = addDays(o.start, dd); ne = o.end ? addDays(o.end, dd) : o.end; }
      else if (mode === "start") { ns = addDays(o.start, dd); if (ns > o.end) ns = o.end; }
      else { ne = addDays(o.end, dd); if (ne < o.start) ne = o.start; }
      el.style.left = pct(ns) + "%";
      if (!isMs) el.style.width = Math.max(pct(addDays(ne, 1)) - pct(ns), 0.6) + "%";
      tip.hidden = false; tip.style.left = ev.clientX + "px"; tip.style.top = el.getBoundingClientRect().top + "px";
      tip.textContent = isMs ? fmt(ns, { weekday: "short", day: "numeric", month: "short", year: "numeric" })
        : `${fmt(ns, { day: "numeric", month: "short" })} → ${fmt(ne, { day: "numeric", month: "short", year: "numeric" })} · ${Math.round((parse(ne) - parse(ns)) / DAY) + 1} days`;
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove); el.removeEventListener("pointerup", onUp); el.removeEventListener("pointercancel", onUp);
      el.classList.remove("dragging"); tip.hidden = true;
      if (!moved) { isMs ? openMilestoneDialog(+el.dataset.idx) : openPhaseDialog(item.id); return; }
      if (ns === o.start && ne === o.end) { render(); return; }
      change(() => {
        const target = isMs ? P.milestones[+el.dataset.idx] : P.phases.find((p) => p.id === item.id);
        if (isMs) { target.date = ns; if (target.end) target.end = ne; } else { target.start = ns; target.end = ne; }
      });
    };
    el.addEventListener("pointermove", onMove); el.addEventListener("pointerup", onUp); el.addEventListener("pointercancel", onUp);
  });

  // Key dates list → edit event
  $("#milestones").addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (editMode && li) openMilestoneDialog(+li.dataset.idx);
  });

  // Work plan: cycle status, open phase dialog
  $("#phases").addEventListener("click", (e) => {
    if (!editMode) return;
    const btn = e.target.closest(".phase-edit");
    if (btn) { e.preventDefault(); e.stopPropagation(); openPhaseDialog(btn.dataset.id); return; }
    const li = e.target.closest(".tasks li");
    if (!li) return;
    const ti = +li.dataset.ti;
    if (e.target.classList.contains("status")) {
      change(() => { const t = P.tasks[ti]; t.status = STATUSES[(STATUSES.indexOf(t.status) + 1) % STATUSES.length]; });
    } else if (e.target.classList.contains("txt")) openPhaseDialog(P.tasks[ti].phase);
  });

  // ---------- Dialogs ----------
  const dlg = $("#editDialog");
  const options = (map, sel) => Object.entries(map).map(([v, l]) => `<option value="${v}" ${v === sel ? "selected" : ""}>${l}</option>`).join("");
  const taskRow = (t) => `<div class="trow">
      <select name="status" aria-label="Status">${options(STATUS_LABEL, t.status)}</select>
      <input name="task" value="${esc(t.task)}" placeholder="What needs to be done" aria-label="Task">
      <input type="date" name="due" value="${esc(t.due || "")}" aria-label="Due date">
      <button type="button" class="del" title="Delete task" aria-label="Delete task">✕</button></div>`;
  const nextPhaseId = () => "P" + (Math.max(-1, ...P.phases.map((p) => parseInt(String(p.id).replace(/\D/g, ""), 10)).filter((n) => !isNaN(n))) + 1);

  function openPhaseDialog(id) {
    const isNew = !id;
    const p = isNew ? { id: nextPhaseId(), name: "", start: TODAY, end: addDays(TODAY, 13), goal: "setup" } : P.phases.find((x) => x.id === id);
    if (!p) return;
    const tasks = isNew ? [] : tasksOf(id);
    dlg.innerHTML = `<form class="dlg" id="dlgForm">
      <h3>${isNew ? "New phase" : "Edit phase"}</h3>
      <label>Name<input name="name" required value="${esc(p.name)}" placeholder="e.g. Pilot study"></label>
      <div class="row2"><label>Start<input type="date" name="start" required value="${esc(p.start)}"></label><label>End<input type="date" name="end" required value="${esc(p.end)}"></label></div>
      <label>Category (colour)<select name="goal">${options(GOAL_LABEL, p.goal)}</select></label>
      <h4>Tasks (${tasks.length})</h4>
      <div class="trows" id="trows">${tasks.map(taskRow).join("")}</div>
      <div><button type="button" id="addTaskRow">+ Add task</button></div>
      <footer>${isNew ? "" : '<button type="button" class="danger" id="dlgDelete">Delete phase</button>'}<span class="spacer"></span>
        <button type="button" id="dlgCancel">Cancel</button><button type="submit" class="primary">${isNew ? "Add phase" : "Save"}</button></footer>
    </form>`;
    $("#addTaskRow").onclick = () => { $("#trows").insertAdjacentHTML("beforeend", taskRow({ task: "", status: "todo", due: "" })); $("#trows").lastElementChild.querySelector("[name=task]").focus(); };
    $("#trows").onclick = (e) => { const d = e.target.closest(".del"); if (d) d.closest(".trow").remove(); };
    $("#dlgCancel").onclick = () => dlg.close();
    if (!isNew) $("#dlgDelete").onclick = () => {
      if (!confirm(`Delete "${p.name}"${tasks.length ? ` and its ${tasks.length} task(s)` : ""}?`)) return;
      dlg.close();
      change(() => { P.phases = P.phases.filter((x) => x.id !== id); P.tasks = P.tasks.filter((t) => t.phase !== id); });
      toast("Phase deleted — Ctrl+Z to undo");
    };
    $("#dlgForm").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      let s = f.get("start"), en = f.get("end");
      if (en < s) [s, en] = [en, s];
      const newTasks = $$("#trows .trow").map((r) => ({
        phase: p.id,
        task: r.querySelector("[name=task]").value.trim(),
        due: r.querySelector("[name=due]").value || undefined,
        status: r.querySelector("[name=status]").value
      })).filter((t) => t.task);
      dlg.close();
      change(() => {
        const target = isNew ? p : P.phases.find((x) => x.id === id);
        Object.assign(target, { name: f.get("name").trim(), start: s, end: en, goal: f.get("goal") });
        if (isNew) P.phases.push(target);
        const at = P.tasks.findIndex((t) => t.phase === p.id);
        const rest = P.tasks.filter((t) => t.phase !== p.id);
        rest.splice(at < 0 ? rest.length : at, 0, ...newTasks);
        P.tasks = rest;
        openPhases.add(p.id);
      });
    };
    dlg.showModal();
    if (isNew) dlg.querySelector("[name=name]").focus();
  }

  function openMilestoneDialog(idx) {
    const isNew = idx === null;
    const m = isNew ? { date: TODAY, title: "", kind: "milestone" } : P.milestones[idx];
    if (!m) return;
    dlg.innerHTML = `<form class="dlg" id="dlgForm">
      <h3>${isNew ? "New event" : "Edit event"}</h3>
      <label>Title<input name="title" required value="${esc(m.title)}" placeholder="e.g. Meeting with expert statistician"></label>
      <div class="row2"><label>Date<input type="date" name="date" required value="${esc(m.date)}"></label>
        <label>Until (optional, for periods)<input type="date" name="end" value="${esc(m.end || "")}"></label></div>
      <label>Type<select name="kind">${options(KIND_LABEL, m.kind)}</select></label>
      <label class="check"><input type="checkbox" name="tbc" ${m.tbc ? "checked" : ""}> Date still to be confirmed (TBC)</label>
      <label class="check"><input type="checkbox" name="highlight" ${m.highlight ? "checked" : ""}> Key date: show a countdown at the top</label>
      <footer>${isNew ? "" : '<button type="button" class="danger" id="dlgDelete">Delete event</button>'}<span class="spacer"></span>
        <button type="button" id="dlgCancel">Cancel</button><button type="submit" class="primary">${isNew ? "Add event" : "Save"}</button></footer>
    </form>`;
    $("#dlgCancel").onclick = () => dlg.close();
    if (!isNew) $("#dlgDelete").onclick = () => {
      if (!confirm(`Delete "${m.title}"?`)) return;
      dlg.close();
      change(() => { P.milestones.splice(idx, 1); });
      toast("Event deleted — Ctrl+Z to undo");
    };
    $("#dlgForm").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      let d = f.get("date"), en = f.get("end") || undefined;
      if (en && en < d) [d, en] = [en, d];
      const kind = f.get("kind");
      const upd = { date: d, end: en, title: f.get("title").trim(), kind, tbc: f.has("tbc") || undefined, highlight: f.has("highlight") || undefined };
      dlg.close();
      change(() => {
        const out = {};
        ["date", "end", "title", "kind", "tbc", "highlight"].forEach((k) => { if (upd[k] !== undefined) out[k] = upd[k]; });
        if (out.kind === "break" && !out.end) out.end = out.date;
        if (isNew) P.milestones.push(out); else P.milestones[idx] = out;
      });
    };
    dlg.showModal();
    if (isNew) dlg.querySelector("[name=title]").focus();
  }

  // ---------- Saving ----------
  function idb(mode, fn) {
    return new Promise((res, rej) => {
      const r = indexedDB.open("thesis-plan", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const tx = r.result.transaction("kv", mode); const req = fn(tx.objectStore("kv"));
        tx.oncomplete = () => res(req.result); tx.onerror = () => rej(tx.error);
      };
    });
  }
  const idbGet = (k) => idb("readonly", (s) => s.get(k)).catch(() => null);
  const idbSet = (k, v) => idb("readwrite", (s) => s.put(v, k)).catch(() => {});

  async function save(pickNew) {
    const prevUpdated = P.lastUpdated;
    P.lastUpdated = TODAY;
    const text = serialize(P);
    if (window.showSaveFilePicker) {
      try {
        let h = pickNew ? null : fileHandle || (await idbGet("planHandle"));
        if (h) {
          let perm = await h.queryPermission({ mode: "readwrite" });
          if (perm !== "granted") perm = await h.requestPermission({ mode: "readwrite" });
          if (perm !== "granted") h = null;
        }
        if (!h) {
          toast("Pick the file data/plan.js inside your masterthesis folder", 6000);
          h = await window.showSaveFilePicker({ suggestedName: "plan.js", types: [{ description: "JavaScript", accept: { "text/javascript": [".js"] } }] });
        }
        const w = await h.createWritable(); await w.write(text); await w.close();
        fileHandle = h; idbSet("planHandle", h);
        fileState = clone(P); fileBase = planHash(P); savedHash = fileBase;
        store.del(DRAFT_KEY); render();
        toast(`Saved ${h.name}. Commit & push to update GitHub.`, 4000);
        return;
      } catch (err) {
        if (err && err.name === "AbortError") { P.lastUpdated = prevUpdated; toast("Save cancelled"); return; }
        console.warn("File save failed, falling back to download", err);
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
    a.download = "plan.js"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    savedHash = planHash(P); persistDraft(true); render();
    toast("Downloaded plan.js — replace data/plan.js with it, then reload.", 6000);
  }

  render();
})();
