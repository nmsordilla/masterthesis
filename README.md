# Master Thesis Plan — LLM-Elicited Priors for Clinical Trials

Planning website for the KU Leuven master thesis *Using large language models to generate Bayesian prior distributions for predictions of clinical trial outcomes* (STADIUS + BREATHE, 2026–2027).

- Intermediate presentation: February 2027
- Final defense: June 2027

## View it

Open `index.html` in a browser. No build step, no server, no dependencies.

## Update it

| What | Where |
|---|---|
| Tasks, statuses, due dates | `data/plan.js` → `tasks` (`todo` / `doing` / `done` / `blocked`) |
| Milestones and confirmed dates | `data/plan.js` → `milestones` (remove `tbc: true` once confirmed) |
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
