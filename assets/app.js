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
  const mondayOf = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
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

  const CAT_COLOR = { setup: "--setup", sg1: "--sg1", sg2: "--sg2", sg3: "--sg3", writing: "--writing", deadline: "--milestone", meeting: "--meeting", break: "--setup" };
  const CAT_LABEL = { setup: "Setup / background", sg1: "Sub-goal 1 · accuracy", sg2: "Sub-goal 2 · documentation", sg3: "Sub-goal 3 · futility", writing: "Writing", deadline: "Presentation / deadline", meeting: "Meeting", break: "Break (exams, holidays)" };
  const STATUSES = ["todo", "doing", "done", "blocked"];
  const STATUS_LABEL = { todo: "To do", doing: "In progress", done: "Done", blocked: "Blocked" };
  const FLAG_LABEL = { "": "—", key: "★ Key date", countdown: "★ + countdown" };

  // ---------- plan.js serialisation ----------
  const HEADER = `/*
 * THESIS PLAN DATA — this is the file you update regularly.
 *
 * Edit it by hand, or use "Edit mode" on the timeline of the local site and
 * press "Save plan.js" (that rewrites this whole file).
 *
 * Everything dynamic on the site (countdowns, timeline, tasks, meetings,
 * decisions, progress log) is rendered from this object.
 * Dates are ISO strings (YYYY-MM-DD). Task status: "todo" | "doing" | "done" | "blocked".
 *
 * timeline: blocks (bars) with a start and end date.
 *   category: "setup" | "sg1" | "sg2" | "sg3" | "writing" | "deadline" | "meeting" | "break"
 * tasks: belong to a block through its \`id\` (task.item).
 *   key: true → ★ key date (tick on the bar, listed under Key dates)
 *   countdown: true → countdown at the top      tbc: true → date not confirmed
 * meta.weekOne: Monday of thesis week 1 (week numbers on the timeline).
 *
 * Kept as a .js file (not .json) so the site also works when opened
 * directly from disk (file://), where browsers block fetch().
 */
`;
  const keep = (v) => v !== false && v !== null && v !== undefined && v !== "";
  const line = (o) => "{ " + Object.entries(o).filter(([k, v]) => keep(v) || k === "decision").map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ") + " }";
  const arr = (a) => (a && a.length ? "[\n" + a.map((o) => "    " + line(o)).join(",\n") + "\n  ]" : "[]");
  const pretty = (v) => JSON.stringify(v, null, 2).replace(/\n/g, "\n  ");
  const LIST_KEYS = ["timeline", "tasks", "decisions", "log"];
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
    if (d && d.plan && Array.isArray(d.plan.timeline)) {
      if (planHash(d.plan) === fileBase) store.del(DRAFT_KEY);           // plan.js already contains the draft
      else if (d.base === fileBase) { P = d.plan; if (d.downloaded) savedHash = planHash(P); }
      else staleDraft = d;                                               // plan.js changed since the draft was made
    } else if (d) store.del(DRAFT_KEY);
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

  // ---------- Plan helpers ----------
  const tasksOf = (id) => P.tasks.filter((t) => t.item === id);
  const endOf = (t) => t.end || t.start;
  const byDate = (list) => [...list].sort((a, b) => a.start.localeCompare(b.start) || endOf(a).localeCompare(endOf(b)));
  const colorOf = (cat) => `var(${CAT_COLOR[cat] || "--accent"})`;
  const weekOne = () => mondayOf(parse((P.meta && P.meta.weekOne) || P.timeline.map((t) => t.start).sort()[0] || TODAY));
  const weekNo = (s) => Math.floor(Math.round((mondayOf(parse(s)) - weekOne()) / DAY) / 7) + 1;
  const weekRange = (t) => { const a = weekNo(t.start), b = weekNo(endOf(t)); return a === b ? `week ${a}` : `weeks ${a}–${b}`; };
  const itemDates = (t) => endOf(t) === t.start ? fmt(t.start) : `${fmt(t.start, { day: "numeric", month: "short" })} → ${fmt(endOf(t))}`;
  const keyTasks = () => P.tasks.filter((t) => t.key && t.due).sort((a, b) => a.due.localeCompare(b.due));

  const FILTERS = ["all", "open", "doing", "overdue", "done"];
  let filter = store.get("taskFilter");
  if (!FILTERS.includes(filter)) { filter = "all"; store.del("taskFilter"); }
  const match = (t) => filter === "all" || (filter === "open" && t.status !== "done") || (filter === "overdue" && isOverdue(t)) || t.status === filter;
  let openItems;
  try { openItems = new Set(JSON.parse(store.get("openItems") || "null")); } catch (e) { openItems = null; }
  if (!store.get("openItems")) {
    // first visit: open the block(s) running today, or else the next one coming up
    const withTasks = P.timeline.filter((t) => tasksOf(t.id).length);
    const now = withTasks.filter((t) => t.start <= TODAY && TODAY <= endOf(t));
    const next = byDate(withTasks.filter((t) => t.start > TODAY))[0];
    openItems = new Set((now.length ? now : next ? [next] : []).map((t) => t.id));
  }
  const saveOpen = () => store.set("openItems", JSON.stringify([...openItems]));
  function toggleItem(id) { openItems.has(id) ? openItems.delete(id) : openItems.add(id); saveOpen(); renderGantt(); }

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

    const keys = keyTasks();
    const next = keys.find((t) => t.status !== "done" && daysUntil(t.due) >= 0);
    const cards = [];
    if (next && !next.countdown) cards.push({ label: "Next key date", date: next.due, sub: next.task, tbc: next.tbc });
    keys.filter((t) => t.countdown).forEach((t) => cards.push({ label: t.task, date: t.due, tbc: t.tbc, highlight: true }));
    $("#countdowns").innerHTML = cards.map((c) => {
      const n = daysUntil(c.date);
      return `<div class="count${c.highlight ? " highlight" : ""}">
        <div class="lbl">${esc(c.label)}${tbc(c)}</div>
        <div class="n">${n >= 0 ? n : "✓"}</div>
        <div class="d">${n >= 0 ? `days · ~${Math.floor(n / 7)} weeks` : "done"} · ${fmt(c.date)} · week ${weekNo(c.date)}</div>
        ${c.sub ? `<div class="d">${esc(c.sub)}</div>` : ""}
      </div>`;
    }).join("");
  }

  // ---------- Render: progress + filters ----------
  function renderOverall() {
    const done = P.tasks.filter((t) => t.status === "done").length;
    const overdue = P.tasks.filter(isOverdue).length;
    $("#overall").innerHTML = `<strong>${done} / ${P.tasks.length} tasks done</strong>
      <div class="progress" aria-hidden="true"><div style="width:${(done / (P.tasks.length || 1)) * 100}%"></div></div>
      <span class="muted">${P.tasks.filter((t) => t.status === "doing").length} in progress${overdue ? ` · <span style="color:var(--blocked)">${overdue} overdue</span>` : ""} · now in week ${weekNo(TODAY)}</span>`;
    $$(".filters button[data-filter]").forEach((x) => x.classList.toggle("active", x.dataset.filter === filter));
  }

  // ---------- Render: Gantt ----------
  const G = { start: null, end: null, span: 1 };
  const pct = (d) => (((typeof d === "string" ? parse(d) : d) - G.start) / G.span) * 100;

  function taskList(t, ts) {
    const shown = ts.filter(match);
    return `<div class="g-detail"><div class="g-dinner">
      <div class="d-head"><span>${itemDates(t)} · ${weekRange(t)}${tbc(t)}</span><span class="spacer"></span>
        <button type="button" class="d-edit" data-act="edit">✎ Edit block &amp; tasks</button></div>
      ${shown.length ? `<ul class="tasks">${shown.map((x) => `<li class="${esc(x.status)}${isOverdue(x) ? " overdue" : ""}${x.key ? " key" : ""}" data-ti="${P.tasks.indexOf(x)}">
          <span class="status ${esc(x.status)}" title="${STATUS_LABEL[x.status] || esc(x.status)}${editMode ? " — click to change" : ""}"></span>
          <span class="txt">${x.key ? '<span class="star" title="Key date">★</span> ' : ""}${esc(x.task)}${tbc(x)}</span>
          <span class="due">${x.due ? `${fmt(x.due, { weekday: "short", day: "numeric", month: "short" })} · wk ${weekNo(x.due)}` : ""}</span></li>`).join("")}</ul>`
        : `<div class="empty">${ts.length ? "No tasks match this filter." : "No tasks yet."}</div>`}
    </div></div>`;
  }

  function renderGantt() {
    const dates = [...P.timeline.flatMap((t) => [t.start, endOf(t)]), ...P.tasks.map((t) => t.due).filter(Boolean), TODAY].map(parse);
    G.start = mondayOf(new Date(Math.min(...dates)));
    G.end = mondayOf(new Date(Math.max(...dates))); G.end.setDate(G.end.getDate() + 7);
    G.span = G.end - G.start;

    // Month + week axis, grid lines
    let months = "", weeks = "", lines = "";
    for (let m = new Date(G.start.getFullYear(), G.start.getMonth(), 1); m < G.end; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
      const a = Math.max(0, pct(m)), b = Math.min(100, pct(new Date(m.getFullYear(), m.getMonth() + 1, 1)));
      months += `<div class="g-mseg" style="left:${a}%;width:${b - a}%">${b - a > 3 ? m.toLocaleDateString("en-GB", { month: "short" }) + (m.getMonth() === 0 || a === 0 ? " " + m.getFullYear() : "") : ""}</div>`;
      if (pct(m) > 0) lines += `<div class="g-mline" style="left:${pct(m)}%"></div>`;
    }
    const curMon = +mondayOf(today);
    for (let d = new Date(G.start); d < G.end; d.setDate(d.getDate() + 7)) {
      const s = iso(d), n = weekNo(s), a = pct(d), w = pct(addDays(s, 7)) - a, cur = +d === curMon;
      weeks += `<div class="g-wk${cur ? " cur" : ""}${n < 1 ? " pre" : ""}" style="left:${a}%;width:${w}%" title="Week ${n}: ${fmt(s, { day: "numeric", month: "short" })} – ${fmt(addDays(s, 6))}">${n}</div>`;
      lines += `<div class="g-wline" style="left:${a}%"></div>`;
      if (cur) lines += `<div class="g-curwk" style="left:${a}%;width:${w}%"></div>`;
    }
    lines += P.timeline.filter((t) => t.category === "break").map((t) => `<div class="g-break" style="left:${pct(t.start)}%;width:${pct(addDays(endOf(t), 1)) - pct(t.start)}%"></div>`).join("");
    lines += `<div class="g-today" style="left:${pct(today) + (pct(addDays(TODAY, 1)) - pct(today)) / 2}%" title="Today"></div>`;

    const rows = P.timeline.map((t, i) => {
      const ts = tasksOf(t.id);
      const done = ts.filter((x) => x.status === "done").length;
      const open = openItems.has(t.id) && ts.length > 0;
      const left = pct(t.start), width = Math.max(pct(addDays(endOf(t), 1)) - left, 0.4);
      const prog = ts.length ? Math.round((done / ts.length) * 100) : 0;
      const ticks = ts.filter((x) => x.key && x.due).map((x) => {
        const mid = pct(x.due) + (pct(addDays(x.due, 1)) - pct(x.due)) / 2;
        return `<span class="g-tick" style="left:${Math.min(100, Math.max(0, ((mid - left) / width) * 100))}%" title="★ ${esc(x.task)} · ${fmt(x.due)}"></span>`;
      }).join("");
      const active = t.start <= TODAY && TODAY <= endOf(t);
      const dim = filter !== "all" && ts.length && !ts.some(match);
      return `<div class="g-item${open ? " open" : ""}${active ? " active" : ""}${dim ? " dim" : ""}" data-id="${esc(t.id)}" style="--c:${colorOf(t.category)}">
        <div class="g-row">
          <div class="g-label">
            ${ts.length ? `<button type="button" class="g-toggle" aria-expanded="${open}" aria-label="${open ? "Hide" : "Show"} tasks">▸</button>` : '<span class="g-toggle-sp"></span>'}
            <span class="lname" title="${esc(t.name)} · ${weekRange(t)}">${esc(t.name)}</span>
            ${ts.length ? `<span class="g-count${done === ts.length ? " all" : ""}" title="${done} of ${ts.length} tasks done">${done}/${ts.length}</span>` : ""}
            <span class="g-tools"><button type="button" data-act="up" ${i === 0 ? "disabled" : ""} aria-label="Move up">▲</button><button type="button" data-act="down" ${i === P.timeline.length - 1 ? "disabled" : ""} aria-label="Move down">▼</button><button type="button" data-act="edit" aria-label="Edit">✎</button></span>
          </div>
          <div class="g-track"><div class="g-bar${t.category === "break" ? " break" : ""}" style="left:${left}%;width:${width}%"
            title="${esc(t.name)} · ${itemDates(t)} · ${weekRange(t)}${ts.length ? ` · ${prog}% done` : ""}">
            <span class="rz l"></span><div class="fill" style="width:${prog}%"></div>${ticks}<span class="rz r"></span></div></div>
        </div>
        ${open ? taskList(t, ts) : ""}
      </div>`;
    }).join("");

    $("#gantt").innerHTML = `
      <div class="g-head">
        <div class="g-row g-hrow"><div class="g-label"></div><div class="g-track">${months}</div></div>
        <div class="g-row g-hrow g-weeks"><div class="g-label">Week</div><div class="g-track">${weeks}</div></div>
      </div>
      <div class="g-body"><div class="g-overlay">${lines}</div>${rows}</div>`;

    // Key dates & breaks
    const entries = [
      ...keyTasks().map((t) => ({ date: t.due, label: t.task, tbc: t.tbc, item: t.item, highlight: t.countdown, done: t.status === "done" })),
      ...P.timeline.filter((t) => t.category === "break").map((t) => ({ date: t.start, end: endOf(t), label: t.name, tbc: t.tbc, item: t.id, brk: true }))
    ].sort((a, b) => a.date.localeCompare(b.date));
    $("#milestones").innerHTML = entries.map((e) => `<li data-item="${esc(e.item)}" class="${e.brk ? "kind-break" : ""}${daysUntil(e.end || e.date) < 0 || e.done ? " past" : ""}${e.highlight ? " highlight" : ""}">
      <span class="date">${e.end ? `${fmt(e.date, { day: "numeric", month: "short" })} – ${fmt(e.end)}` : fmt(e.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
      <span class="t">${e.brk ? "" : "★ "}${esc(e.label)}${tbc(e)}</span><span class="rel">wk ${weekNo(e.date)} · ${rel(daysUntil(e.date))}</span></li>`).join("");
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
    renderHero(); renderOverall(); renderGantt(); renderRest(); renderToolbar();
  }

  // ---------- Controls ----------
  function setEdit(on) { editMode = on; store.set("editMode", on ? "1" : "0"); render(); }
  $("#editToggle").addEventListener("change", (e) => setEdit(e.target.checked));
  $("#undoBtn").addEventListener("click", undo);
  $("#addItem").addEventListener("click", () => openItemDialog(null));
  $("#sortBtn").addEventListener("click", () => { change(() => { P.timeline = byDate(P.timeline); }); toast("Sorted by date — Ctrl+Z to undo"); });
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

  $$(".filters button[data-filter]").forEach((b) => b.addEventListener("click", () => {
    filter = b.dataset.filter; store.set("taskFilter", filter);
    if (filter !== "all") { openItems = new Set(P.timeline.filter((t) => tasksOf(t.id).some(match)).map((t) => t.id)); saveOpen(); }
    renderOverall(); renderGantt();
  }));
  $("#expandAll").addEventListener("click", () => { openItems = new Set(P.timeline.map((t) => t.id)); saveOpen(); renderGantt(); });
  $("#collapseAll").addEventListener("click", () => { openItems = new Set(); saveOpen(); renderGantt(); });

  // Gantt clicks: expand/collapse, reorder, edit, task status
  $("#gantt").addEventListener("click", (e) => {
    const el = e.target.closest(".g-item");
    if (!el) return;
    const id = el.dataset.id;
    const act = e.target.closest("[data-act]");
    if (act) {
      if (!editMode) return;
      if (act.dataset.act === "edit") return openItemDialog(id);
      const i = P.timeline.findIndex((t) => t.id === id);
      const j = act.dataset.act === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= P.timeline.length) return;
      change(() => { [P.timeline[i], P.timeline[j]] = [P.timeline[j], P.timeline[i]]; });
      return;
    }
    const li = e.target.closest(".tasks li");
    if (li) {
      if (!editMode) return;
      const ti = +li.dataset.ti;
      if (e.target.classList.contains("status")) change(() => { const t = P.tasks[ti]; t.status = STATUSES[(STATUSES.indexOf(t.status) + 1) % STATUSES.length]; });
      else if (e.target.closest(".txt")) openItemDialog(id);
      return;
    }
    if (e.target.closest(".g-detail")) return;
    if (editMode && e.target.closest(".g-bar")) return;   // handled by drag
    if (e.target.closest(".g-label, .g-track") && tasksOf(id).length) toggleItem(id);
  });

  // Gantt: drag to move / resize (edit mode)
  const tip = $("#dragTip");
  $("#gantt").addEventListener("pointerdown", (e) => {
    if (!editMode || e.button !== 0) return;
    const el = e.target.closest(".g-bar");
    if (!el) return;
    e.preventDefault();
    const id = el.closest(".g-item").dataset.id;
    const item = P.timeline.find((t) => t.id === id);
    const mode = e.target.classList.contains("rz") ? (e.target.classList.contains("l") ? "start" : "end") : "move";
    const o = { start: item.start, end: endOf(item) };
    const pxPerDay = el.parentElement.getBoundingClientRect().width / (G.span / DAY);
    const x0 = e.clientX; let moved = false; let ns = o.start; let ne = o.end;
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    el.classList.add("dragging");

    const onMove = (ev) => {
      if (Math.abs(ev.clientX - x0) > 3) moved = true;
      if (!moved) return;
      const dd = Math.round((ev.clientX - x0) / pxPerDay);
      if (mode === "move") { ns = addDays(o.start, dd); ne = addDays(o.end, dd); }
      else if (mode === "start") { ns = addDays(o.start, dd); if (ns > o.end) ns = o.end; }
      else { ne = addDays(o.end, dd); if (ne < o.start) ne = o.start; }
      el.style.left = pct(ns) + "%";
      el.style.width = Math.max(pct(addDays(ne, 1)) - pct(ns), 0.4) + "%";
      tip.hidden = false; tip.style.left = ev.clientX + "px"; tip.style.top = el.getBoundingClientRect().top + "px";
      const wk = weekNo(ns) === weekNo(ne) ? `wk ${weekNo(ns)}` : `wk ${weekNo(ns)}–${weekNo(ne)}`;
      tip.textContent = `${fmt(ns, { day: "numeric", month: "short" })} → ${fmt(ne, { day: "numeric", month: "short", year: "numeric" })} · ${wk} · ${Math.round((parse(ne) - parse(ns)) / DAY) + 1} days`;
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove); el.removeEventListener("pointerup", onUp); el.removeEventListener("pointercancel", onUp);
      el.classList.remove("dragging"); tip.hidden = true;
      if (!moved) { openItemDialog(id); return; }
      if (ns === o.start && ne === o.end) { render(); return; }
      change(() => {
        const t = P.timeline.find((x) => x.id === id);
        t.start = ns;
        if (ne > ns) t.end = ne; else delete t.end;
      });
    };
    el.addEventListener("pointermove", onMove); el.addEventListener("pointerup", onUp); el.addEventListener("pointercancel", onUp);
  });

  // Key dates list → open its block
  $("#milestones").addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    if (editMode) return openItemDialog(li.dataset.item);
    openItems.add(li.dataset.item); saveOpen(); renderGantt();
    const row = $(`.g-item[data-id="${CSS.escape(li.dataset.item)}"]`);
    if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  // ---------- Dialog ----------
  const dlg = $("#editDialog");
  const options = (map, sel) => Object.entries(map).map(([v, l]) => `<option value="${v}" ${v === sel ? "selected" : ""}>${l}</option>`).join("");
  const taskRow = (t) => `<div class="trow">
      <select name="status" aria-label="Status">${options(STATUS_LABEL, t.status)}</select>
      <input name="task" value="${esc(t.task)}" placeholder="What needs to be done" aria-label="Task">
      <input type="date" name="due" value="${esc(t.due || "")}" aria-label="Due date">
      <select name="flag" aria-label="Key date">${options(FLAG_LABEL, t.countdown ? "countdown" : t.key ? "key" : "")}</select>
      <label class="tbc-check" title="Date still to be confirmed"><input type="checkbox" name="tbc" ${t.tbc ? "checked" : ""}>TBC</label>
      <button type="button" class="del" title="Delete task" aria-label="Delete task">✕</button></div>`;
  const nextId = () => { const ids = new Set(P.timeline.map((t) => t.id)); let n = P.timeline.length; while (ids.has("T" + n)) n++; return "T" + n; };

  function openItemDialog(id) {
    const isNew = !id;
    const it = isNew ? { id: nextId(), name: "", start: TODAY, end: addDays(TODAY, 4), category: "setup" } : P.timeline.find((t) => t.id === id);
    if (!it) return;
    const tasks = isNew ? [] : tasksOf(id);
    dlg.innerHTML = `<form class="dlg" id="dlgForm">
      <h3>${isNew ? "New block" : "Edit block"}</h3>
      <label>Name<input name="name" required value="${esc(it.name)}" placeholder="e.g. Week 9 · Pilot study"></label>
      <div class="row2"><label>Start<input type="date" name="start" required value="${esc(it.start)}"></label>
        <label>End<input type="date" name="end" value="${esc(endOf(it))}"></label></div>
      <p class="hint" id="wkHint"></p>
      <label>Category (colour)<select name="category">${options(CAT_LABEL, it.category)}</select></label>
      <label class="check"><input type="checkbox" name="tbc" ${it.tbc ? "checked" : ""}> Dates still to be confirmed (TBC)</label>
      <h4>Tasks (${tasks.length}) <span class="hint">· ★ key dates show as a tick on the bar and under Key dates; "+ countdown" also adds a countdown at the top</span></h4>
      <div class="trows" id="trows">${tasks.map(taskRow).join("")}</div>
      <div><button type="button" id="addTaskRow">+ Add task</button></div>
      <footer>${isNew ? "" : '<button type="button" class="danger" id="dlgDelete">Delete block</button>'}<span class="spacer"></span>
        <button type="button" id="dlgCancel">Cancel</button><button type="submit" class="primary">${isNew ? "Add" : "Save"}</button></footer>
    </form>`;
    const form = $("#dlgForm");
    const wkHint = () => {
      const s = form.start.value, en = form.end.value || s;
      $("#wkHint").textContent = s ? `Thesis ${weekRange({ start: s, end: en < s ? s : en })}` : "";
    };
    form.start.addEventListener("input", wkHint); form.end.addEventListener("input", wkHint); wkHint();
    $("#addTaskRow").onclick = () => { $("#trows").insertAdjacentHTML("beforeend", taskRow({ task: "", status: "todo", due: form.end.value || "" })); $("#trows").lastElementChild.querySelector("[name=task]").focus(); };
    $("#trows").onclick = (e) => { const d = e.target.closest(".del"); if (d) d.closest(".trow").remove(); };
    $("#dlgCancel").onclick = () => dlg.close();
    if (!isNew) $("#dlgDelete").onclick = () => {
      if (!confirm(`Delete "${it.name}"${tasks.length ? ` and its ${tasks.length} task(s)` : ""}?`)) return;
      dlg.close();
      change(() => { P.timeline = P.timeline.filter((t) => t.id !== id); P.tasks = P.tasks.filter((t) => t.item !== id); });
      toast("Deleted — Ctrl+Z to undo");
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(form);
      let s = f.get("start"), en = f.get("end") || "";
      if (en && en < s) [s, en] = [en, s];
      const out = { id: it.id, name: f.get("name").trim(), start: s };
      if (en && en !== s) out.end = en;
      out.category = f.get("category");
      if (f.has("tbc")) out.tbc = true;
      const newTasks = $$("#trows .trow").map((r) => {
        const flag = r.querySelector("[name=flag]").value;
        const t = { item: it.id, task: r.querySelector("[name=task]").value.trim(), due: r.querySelector("[name=due]").value || undefined, status: r.querySelector("[name=status]").value };
        if (flag) t.key = true;
        if (flag === "countdown") t.countdown = true;
        if (r.querySelector("[name=tbc]").checked) t.tbc = true;
        return t;
      }).filter((t) => t.task);
      dlg.close();
      change(() => {
        if (isNew) {
          const at = P.timeline.findIndex((t) => t.start > out.start);   // insert in date order
          P.timeline.splice(at < 0 ? P.timeline.length : at, 0, out);
        } else P.timeline[P.timeline.findIndex((t) => t.id === id)] = out;
        const at = P.tasks.findIndex((t) => t.item === it.id);
        const rest = P.tasks.filter((t) => t.item !== it.id);
        rest.splice(at < 0 ? rest.length : at, 0, ...newTasks);
        P.tasks = rest;
        if (newTasks.length) { openItems.add(it.id); saveOpen(); }
      });
    };
    dlg.showModal();
    if (isNew) form.name.focus();
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
