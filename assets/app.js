(function () {
  "use strict";

  const P = window.PLAN;
  const $ = (sel) => document.querySelector(sel);
  const DAY = 86400000;

  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const today = (() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); })();
  const daysUntil = (s) => Math.round((parse(s) - today) / DAY);
  const fmt = (s, opts) => parse(s).toLocaleDateString("en-GB", opts || { day: "numeric", month: "short", year: "numeric" });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rel = (n) => n === 0 ? "today" : n > 0 ? `in ${n} day${n === 1 ? "" : "s"}` : `${-n} day${n === -1 ? "" : "s"} ago`;
  const tbc = (m) => (m.tbc ? ' <span class="pill tbc">TBC</span>' : "");
  const isOverdue = (t) => t.status !== "done" && t.due && daysUntil(t.due) < 0;

  const GOAL_COLOR = { setup: "--setup", sg1: "--sg1", sg2: "--sg2", sg3: "--sg3", writing: "--writing", milestone: "--milestone" };

  // ---------- Theme ----------
  const root = document.documentElement;
  try { const saved = localStorage.getItem("theme"); if (saved) root.dataset.theme = saved; } catch (e) {}
  $("#themeToggle").addEventListener("click", () => {
    const dark = root.dataset.theme
      ? root.dataset.theme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch (e) {}
  });

  // ---------- Hero ----------
  $("#thesisTitle").textContent = P.meta.title;
  $("#lastUpdated").textContent = fmt(P.lastUpdated, { day: "numeric", month: "long", year: "numeric" });
  const people = [
    ["Student", P.meta.student], ["Promotor", P.meta.promotor],
    ["Daily advisors", P.meta.advisors], ["Groups", P.meta.groups]
  ];
  if (P.meta.repo) people.push(["Code", `<a href="${esc(P.meta.repo)}">${esc(P.meta.repo.replace(/^https?:\/\//, ""))}</a>`]);
  $("#people").innerHTML = people.map(([k, v]) => `<div><dt>${k}</dt><dd>${k === "Code" ? v : esc(v)}</dd></div>`).join("");

  const next = P.milestones.filter((m) => daysUntil(m.end || m.date) >= 0 && m.kind !== "break")[0];
  const keyDates = P.milestones.filter((m) => m.highlight);
  const counters = [];
  if (next && !next.highlight) counters.push(Object.assign({ label: "Next up" }, next));
  keyDates.forEach((m) => counters.push(Object.assign({ label: m.title }, m)));
  $("#countdowns").innerHTML = counters.map((m) => {
    const n = daysUntil(m.date);
    const weeks = Math.floor(Math.abs(n) / 7);
    return `<div class="count${m.highlight ? " highlight" : ""}">
      <div class="lbl">${esc(m.label)}${tbc(m)}</div>
      <div class="n">${n >= 0 ? n : "✓"}</div>
      <div class="d">${n >= 0 ? `days · ~${weeks} weeks` : "done"} · ${fmt(m.date)}</div>
      ${m.label === "Next up" ? `<div class="d">${esc(m.title)}</div>` : ""}
    </div>`;
  }).join("");

  // ---------- Gantt ----------
  const allDates = [...P.phases.flatMap((p) => [p.start, p.end]), ...P.milestones.flatMap((m) => [m.date, m.end].filter(Boolean))].map(parse);
  const min = new Date(Math.min(...allDates)); const max = new Date(Math.max(...allDates));
  const gStart = new Date(min.getFullYear(), min.getMonth(), 1);
  const gEnd = new Date(max.getFullYear(), max.getMonth() + 1, 1);
  const span = gEnd - gStart;
  const pct = (d) => (((typeof d === "string" ? parse(d) : d) - gStart) / span) * 100;

  const months = [];
  for (let d = new Date(gStart); d < gEnd; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(new Date(d));
  const monthWidths = months.map((d) => {
    const e = new Date(d.getFullYear(), d.getMonth() + 1, 1); return ((e - d) / span) * 100;
  });

  const tasksOf = (id) => P.tasks.filter((t) => t.phase === id);
  const phaseProgress = (id) => { const ts = tasksOf(id); return ts.length ? ts.filter((t) => t.status === "done").length / ts.length : 0; };

  let g = `<div class="g-months" style="grid-template-columns:${monthWidths.map((w) => w + "%").join(" ")}">` +
    months.map((d) => `<div class="g-month">${d.toLocaleDateString("en-GB", { month: "short" })}${d.getMonth() === 0 || d === months[0] ? " " + d.getFullYear() : ""}</div>`).join("") + "</div>";
  g += `<div style="position:relative">`;
  g += `<div class="g-overlay">` +
    months.map((d) => `<div class="g-grid" style="left:${pct(d)}%"></div>`).join("") +
    P.milestones.filter((m) => m.kind === "break").map((m) => `<div class="g-break" title="${esc(m.title)}" style="left:${pct(m.date)}%;width:${pct(m.end) - pct(m.date)}%"></div>`).join("") +
    (today >= gStart && today <= gEnd ? `<div class="g-today" style="left:${pct(today)}%"><span>Today</span></div>` : "") +
    `</div>`;
  P.phases.forEach((p) => {
    const c = `var(${GOAL_COLOR[p.goal] || "--accent"})`;
    const prog = Math.round(phaseProgress(p.id) * 100);
    g += `<div class="g-row"><div class="g-label" title="${esc(p.name)}">${esc(p.name)}</div><div class="g-track">
      <div class="g-bar${p.goal === "milestone" ? " milestone" : ""}" style="--c:${c};left:${pct(p.start)}%;width:${Math.max(pct(p.end) - pct(p.start), .8)}%"
        title="${esc(p.name)}: ${fmt(p.start)} → ${fmt(p.end)} · ${prog}% done"><div class="fill" style="width:${prog}%"></div></div>
    </div></div>`;
  });
  g += `<div class="g-row g-mrow"><div class="g-label">Milestones</div><div class="g-track">` +
    P.milestones.filter((m) => m.kind !== "break").map((m) => `<div class="g-diamond" style="left:${pct(m.date)}%${m.highlight ? ";width:15px;height:15px;top:10px" : ";opacity:.75"}" title="${esc(m.title)} · ${fmt(m.date)}${m.tbc ? " (TBC)" : ""}"></div>`).join("") +
    `</div></div></div>`;
  $("#gantt").innerHTML = g;

  $("#milestones").innerHTML = P.milestones.map((m) => {
    const n = daysUntil(m.end || m.date);
    const date = m.end ? `${fmt(m.date, { day: "numeric", month: "short" })} – ${fmt(m.end)}` : fmt(m.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    return `<li class="kind-${m.kind}${n < 0 ? " past" : ""}${m.highlight ? " highlight" : ""}">
      <span class="date">${date}</span><span class="t">${esc(m.title)}${tbc(m)}</span><span class="rel">${rel(daysUntil(m.date))}</span></li>`;
  }).join("");

  // ---------- Work plan ----------
  const done = P.tasks.filter((t) => t.status === "done").length;
  const overdue = P.tasks.filter(isOverdue).length;
  $("#overall").innerHTML = `<strong>${done} / ${P.tasks.length} tasks done</strong>
    <div class="progress" aria-hidden="true"><div style="width:${(done / P.tasks.length) * 100}%"></div></div>
    <span class="muted">${P.tasks.filter((t) => t.status === "doing").length} in progress${overdue ? ` · <span style="color:var(--blocked)">${overdue} overdue</span>` : ""}</span>`;

  let filter = "all";
  try { filter = localStorage.getItem("taskFilter") || "all"; } catch (e) {}
  const match = (t) => filter === "all" || (filter === "open" && t.status !== "done") || (filter === "overdue" && isOverdue(t)) || t.status === filter;

  function renderPhases() {
    $("#phases").innerHTML = P.phases.map((p) => {
      const ts = tasksOf(p.id); const shown = ts.filter(match);
      const c = `var(${GOAL_COLOR[p.goal] || "--accent"})`;
      const prog = Math.round(phaseProgress(p.id) * 100);
      const active = parse(p.start) <= today && today <= parse(p.end);
      return `<details class="phase" style="--c:${c}" ${active || filter !== "all" ? "open" : ""}>
        <summary><span class="pname">${esc(p.id)} · ${esc(p.name)}${active ? ' <span class="pill" style="background:var(--accent-soft);color:var(--accent)">NOW</span>' : ""}</span>
          <span class="pdates">${fmt(p.start, { day: "numeric", month: "short" })} → ${fmt(p.end)}</span>
          <span class="pprog"><span class="progress"><div style="width:${prog}%"></div></span>${ts.filter((t) => t.status === "done").length}/${ts.length}</span></summary>
        ${shown.length ? `<ul class="tasks">${shown.map((t) => `<li class="${t.status}${isOverdue(t) ? " overdue" : ""}">
          <span class="status ${t.status}" title="${t.status}"></span><span class="txt">${esc(t.task)}</span>
          <span class="due">${t.due ? fmt(t.due, { day: "numeric", month: "short" }) : ""}</span></li>`).join("")}</ul>`
          : `<div class="empty">No tasks match this filter.</div>`}
      </details>`;
    }).join("");
  }
  document.querySelectorAll(".filters button").forEach((b) => {
    b.classList.toggle("active", b.dataset.filter === filter);
    b.addEventListener("click", () => {
      filter = b.dataset.filter;
      try { localStorage.setItem("taskFilter", filter); } catch (e) {}
      document.querySelectorAll(".filters button").forEach((x) => x.classList.toggle("active", x === b));
      renderPhases();
    });
  });
  renderPhases();

  // ---------- Decisions ----------
  $("#decisions").innerHTML = P.decisions.map((d) => `<tr><td>${esc(d.topic)}</td>
    <td><span class="dstatus ${esc(d.status)}">${esc(d.status)}</span></td>
    <td>${d.decision ? `<strong>${esc(d.decision)}</strong><br>` : ""}<span class="muted">${esc(d.note || "")}</span></td></tr>`).join("");

  // ---------- Meetings ----------
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

  // ---------- Log ----------
  $("#logList").innerHTML = [...P.log].sort((a, b) => b.date.localeCompare(a.date))
    .map((l) => `<li><time datetime="${l.date}">${fmt(l.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</time>${esc(l.entry)}</li>`).join("");
})();
