# Master Thesis Plan — LLM-Elicited Priors for Clinical Trials

Planning website for the KU Leuven master thesis *Using large language models to generate Bayesian prior distributions for predictions of clinical trial outcomes* (STADIUS + BREATHE, 2026–2027).

- Intermediate presentation: February 2027
- Final defense: June 2027

## View it

Open `index.html` in a browser. No build step, no server, no dependencies.

## Update it

### In the browser (Edit mode)

Open the local copy (`explorer.exe index.html`). The **Timeline & work plan** chart shows thesis week numbers along the top (week 1 = the Monday in `meta.weekOne`), one row per block, and each block's progress. Click a row to expand its tasks.

Switch on **Edit mode** above the chart to change things:

- **Drag** a bar to move it; **drag its ends** to change start / end
- **✎** (or click a bar) to edit the block's name, dates, colour and tasks
- In a task: status, text, due date, **★ key date** (tick on the bar + listed under *Key dates*) or **★ + countdown** (also a countdown at the top), and **TBC**
- Click a task's status circle to cycle to do → in progress → done → blocked
- **▲▼** reorders rows; **Sort by date** reorders all; **+ Add block** adds one
- **Undo** (Ctrl+Z); edits are kept as a draft in your browser until you save

**Save plan.js** (Ctrl+S) writes `data/plan.js` directly in Chrome / Edge — the first time, pick `data/plan.js` in the project folder; it remembers it afterwards. Other browsers download `plan.js`; replace `data/plan.js` with it. Then commit and push.

Edit mode only appears on the local copy (or with `?edit` in the URL), not to visitors of the GitHub Pages site, and editing there can never change your repo.

### By hand

| What | Where |
|---|---|
| Timeline blocks | `data/plan.js` → `timeline` |
| Tasks, statuses, due dates, key dates | `data/plan.js` → `tasks` (`item` = block id; `key`, `countdown`, `tbc` flags; remove `tbc` once confirmed) |
| Week numbering | `data/plan.js` → `meta.weekOne` |
| Meeting agenda, notes, action items | `data/plan.js` → `meetings` |
| Design decisions | `data/plan.js` → `decisions` (`open` → `decided`) |
| Progress log | `data/plan.js` → `log` |
| Prose (method, background, risks, reading list) | `index.html` |

Bump `lastUpdated` in `data/plan.js`, then:

```bash
git add -A && git commit -m "Update plan" && git push
```

## Publish with GitHub Pages

Repo → Settings → Pages → Source: *Deploy from a branch* → `main` / root. Mind that a public repo makes the plan public; use a private repo (Pages on private repos needs GitHub Pro) if you prefer.
