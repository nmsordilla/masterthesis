# Master Thesis Plan — LLM-Elicited Priors for Clinical Trials

Planning website for the KU Leuven master thesis *Using large language models to generate Bayesian prior distributions for predictions of clinical trial outcomes* (STADIUS + BREATHE, 2026–2027).

- Intermediate presentation: February 2027
- Final defense: June 2027

## View it

Open `index.html` in a browser. No build step, no server, no dependencies.

## Update it

### In the browser (Edit mode)

Open the local copy (`explorer.exe index.html`) and switch on **Edit mode** above the timeline.

Everything on the timeline is one kind of thing, an **item**: a bar if it has a start and end date, a ◆ if it has only one date. Each item has a name, a colour (category), optional tasks, and two switches: *TBC* (date not confirmed) and *Key date* (countdown at the top).

- **Drag** a bar or ◆ to move it; **drag a bar's ends** to change start / end
- **Click** an item (or its name) to edit it and its tasks; clear *End* to turn a bar into a ◆, fill it to turn a ◆ into a bar
- **▲▼** swaps rows; **Sort by date** reorders everything; **+ Add item** adds one
- In *Work plan*, click a task's status circle to cycle to do → in progress → done → blocked
- **Undo** (Ctrl+Z); edits are kept as a draft in your browser until you save

**Save plan.js** (Ctrl+S) writes `data/plan.js` directly in Chrome / Edge — the first time, pick `data/plan.js` in the project folder; it remembers it afterwards. Other browsers download `plan.js`; replace `data/plan.js` with it. Then commit and push.

Edit mode only appears on the local copy (or with `?edit` in the URL), not to visitors of the GitHub Pages site, and editing there can never change your repo.

### By hand

| What | Where |
|---|---|
| Timeline (bars and dates) | `data/plan.js` → `timeline` (remove `tbc: true` once a date is confirmed) |
| Tasks, statuses, due dates | `data/plan.js` → `tasks` (`item` = the timeline item's id; status `todo` / `doing` / `done` / `blocked`) |
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
