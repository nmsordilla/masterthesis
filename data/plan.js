/*
 * THESIS PLAN DATA — this is the file you update regularly.
 *
 * Everything dynamic on the site (countdowns, timeline, task progress,
 * meetings, decisions, progress log) is rendered from this object.
 * Dates are ISO strings (YYYY-MM-DD). Task status: "todo" | "doing" | "done" | "blocked".
 * Set `tbc: true` on a milestone whose date is not yet confirmed.
 *
 * Kept as a .js file (not .json) so the site also works when opened
 * directly from disk (file://), where browsers block fetch().
 */
window.PLAN = {
  lastUpdated: "2026-10-22",

  meta: {
    title: "Using large language models to generate Bayesian prior distributions for predictions of clinical trial outcomes",
    shortTitle: "LLM-Elicited Priors for Clinical Trials",
    student: "Neil Marc Sordilla",
    promotor: "Prof. Maarten De Vos",
    advisors: "Kenneth Verstraete, Elena Smets",
    groups: "STADIUS (ESAT) + BREATHE lab, UZ Leuven",
    contact: "Elena.smets@kuleuven.be",
    repo: "" // e.g. "https://github.com/<you>/masterthesis"
  },

  // Key dates. `kind`: "milestone" | "deadline" | "meeting" | "break"
  milestones: [
    { date: "2026-10-27", title: "First supervision meeting", kind: "meeting" },
    { date: "2026-11-15", title: "Scope locked: gold standard, futility model access, LLMs, budget", kind: "milestone" },
    { date: "2026-12-20", title: "Elicitation pipeline v1 + first priors on reference trial(s)", kind: "milestone" },
    { date: "2027-01-04", end: "2027-02-06", title: "January exam period (reduced thesis time)", kind: "break", tbc: true },
    { date: "2027-02-15", title: "Intermediate presentation", kind: "deadline", tbc: true, highlight: true },
    { date: "2027-03-28", title: "Expert statistician review of documentation completed", kind: "milestone" },
    { date: "2027-03-29", end: "2027-04-11", title: "Easter break", kind: "break", tbc: true },
    { date: "2027-04-30", title: "Downstream futility results frozen", kind: "milestone" },
    { date: "2027-05-15", title: "Full draft to supervisors", kind: "milestone" },
    { date: "2027-05-31", title: "Thesis submission (check faculty deadline)", kind: "deadline", tbc: true },
    { date: "2027-06-21", title: "Final defense", kind: "deadline", tbc: true, highlight: true }
  ],

  // Work packages shown on the Gantt chart. Tasks link to a phase by `id`.
  phases: [
    { id: "P0", name: "Kick-off & scoping",              start: "2026-10-22", end: "2026-11-15", goal: "setup" },
    { id: "P1", name: "Background & literature review",  start: "2026-10-22", end: "2026-12-13", goal: "setup" },
    { id: "P2", name: "Elicitation pipeline",            start: "2026-11-09", end: "2026-12-20", goal: "sg1" },
    { id: "P3", name: "SG1 · Prior accuracy benchmark",  start: "2026-12-01", end: "2027-02-28", goal: "sg1" },
    { id: "P4", name: "Intermediate presentation",       start: "2027-02-01", end: "2027-02-15", goal: "milestone" },
    { id: "P5", name: "SG2 · Documentation & hallucinations", start: "2027-02-08", end: "2027-03-28", goal: "sg2" },
    { id: "P6", name: "SG3 · Futility model impact",     start: "2027-03-01", end: "2027-04-30", goal: "sg3" },
    { id: "P7", name: "Writing the thesis",              start: "2027-03-15", end: "2027-05-31", goal: "writing" },
    { id: "P8", name: "Defense preparation",             start: "2027-06-01", end: "2027-06-21", goal: "milestone" }
  ],

  tasks: [
    // P0 — Kick-off & scoping
    { phase: "P0", task: "Prepare first meeting (reading, one-paragraph pitch, ★ questions)", due: "2026-10-27", status: "doing" },
    { phase: "P0", task: "Get answers on the 4 ★ design questions (gold standard, leakage, futility model, accuracy definition)", due: "2026-10-27", status: "todo" },
    { phase: "P0", task: "Agree meeting rhythm, channel and shared repo with supervisors", due: "2026-10-27", status: "todo" },
    { phase: "P0", task: "Obtain futility prediction model code + documentation", due: "2026-11-08", status: "todo" },
    { phase: "P0", task: "Confirm data policy: can trial data go to external LLM APIs?", due: "2026-11-08", status: "todo" },
    { phase: "P0", task: "Confirm LLM list and API budget (who pays)", due: "2026-11-15", status: "todo" },
    { phase: "P0", task: "Select gold-standard reference trial(s) — prefer several, completed after model cutoffs", due: "2026-11-15", status: "todo" },
    { phase: "P0", task: "Set up GitHub repo, Python env, experiment logging", due: "2026-11-01", status: "doing" },

    // P1 — Background
    { phase: "P1", task: "Read Riegler et al. 2025 incl. supplementary prompt", due: "2026-10-22", status: "doing" },
    { phase: "P1", task: "Read Saville et al. 2014 (PPoS vs conditional power vs posterior)", due: "2026-10-23", status: "todo" },
    { phase: "P1", task: "Read Ji 2026 (FDA draft guidance) + Dallow et al. 2018 (SHELF)", due: "2026-10-24", status: "todo" },
    { phase: "P1", task: "Read AutoElicit, Arai et al., Evans et al., CT Open", due: "2026-10-25", status: "todo" },
    { phase: "P1", task: "Spiegelhalter, Abrams & Myles (2004): priors and monitoring chapters", due: "2026-11-30", status: "todo" },
    { phase: "P1", task: "Draft background chapter (trials, PPoS, priors, LLM elicitation)", due: "2026-12-13", status: "todo" },

    // P2 — Pipeline
    { phase: "P2", task: "Pilot: two LLMs, one well-known trial, plot priors vs published result", due: "2026-10-26", status: "todo" },
    { phase: "P2", task: "Unified LLM client (OpenAI / Google / Anthropic) with full call logging (model, version, temperature, seed, prompt)", due: "2026-11-22", status: "todo" },
    { phase: "P2", task: "Quantile elicitation → parametric fit (SHELF-style) module", due: "2026-11-29", status: "todo" },
    { phase: "P2", task: "Implement prompt strategies: zero-shot, Riegler-structured, CoT, self-consistency, retrieval-grounded, simulated SHELF panel", due: "2026-12-20", status: "todo" },
    { phase: "P2", task: "Leakage controls: masked trial names + post-cutoff trials", due: "2026-12-20", status: "todo" },

    // P3 — SG1
    { phase: "P3", task: "Implement accuracy metrics (KL both ways, Wasserstein, overlap, 90% interval coverage, ESS ratio)", due: "2026-12-31", status: "todo" },
    { phase: "P3", task: "Run full grid: strategies × LLMs × reference trials × repeats", due: "2027-01-31", status: "todo" },
    { phase: "P3", task: "Analyse calibration (width vs centre errors), prompt sensitivity, reproducibility", due: "2027-02-10", status: "todo" },

    // P4 — Intermediate
    { phase: "P4", task: "Build intermediate slides: motivation, design, pipeline, preliminary SG1 results, plan", due: "2027-02-08", status: "todo" },
    { phase: "P4", task: "Dry run with daily advisors", due: "2027-02-11", status: "todo" },

    // P5 — SG2
    { phase: "P5", task: "Reference checker: DOI / PubMed / ClinicalTrials.gov existence check", due: "2027-02-28", status: "todo" },
    { phase: "P5", task: "Claim-support check: does each cited source support its claim?", due: "2027-03-07", status: "todo" },
    { phase: "P5", task: "Define documentation rubric with supervisors (traceable, centre justified, width justified, sensitivity discussed)", due: "2027-02-21", status: "todo" },
    { phase: "P5", task: "Expert statistician review session(s)", due: "2027-03-28", status: "todo" },

    // P6 — SG3
    { phase: "P6", task: "Integrate best LLM prior strategy into the group's futility model", due: "2027-03-21", status: "todo" },
    { phase: "P6", task: "Simulate futile + effective trials; compare LLM vs flat vs expert priors", due: "2027-04-18", status: "todo" },
    { phase: "P6", task: "Metrics: stopping time, correct-stop rate, wrong-stop rate, robustness to prior–data conflict", due: "2027-04-30", status: "todo" },

    // P7 — Writing
    { phase: "P7", task: "Methods chapter", due: "2027-04-11", status: "todo" },
    { phase: "P7", task: "Results chapters (SG1, SG2, SG3)", due: "2027-05-09", status: "todo" },
    { phase: "P7", task: "Discussion, conclusion, abstract; GenAI usage statement", due: "2027-05-15", status: "todo" },
    { phase: "P7", task: "Incorporate supervisor feedback; final proofread", due: "2027-05-29", status: "todo" },

    // P8 — Defense
    { phase: "P8", task: "Defense slides + anticipated questions", due: "2027-06-12", status: "todo" },
    { phase: "P8", task: "Two rehearsals (advisors, peers)", due: "2027-06-18", status: "todo" }
  ],

  // Supervision meetings: add notes and action items after each one.
  meetings: [
    {
      date: "2026-10-27",
      title: "First supervision meeting",
      attendees: "Maarten De Vos, Kenneth Verstraete, Elena Smets",
      agenda: [
        "★ Candidate gold-standard trial(s): disease area, endpoint type, phase",
        "★ Reference trial vs LLM knowledge cutoffs: how to avoid recall",
        "★ The futility model: PPoS simulation, learned predictor, or both? Access to code",
        "★ What counts as an 'accurate' prior?",
        "Data policy for external APIs, LLM list and budget",
        "Expert statistician for review; GenAI focus field (Yes/No/Optional)",
        "Meeting rhythm, repo, KU Leuven milestones"
      ],
      notes: "",
      actions: []
    }
  ],

  // Design decisions — move from open to decided as answers come in.
  decisions: [
    { topic: "Gold-standard reference", status: "open", decision: "", note: "Published protocol with pre-specified priors, else in-house BREATHE trial." },
    { topic: "Number of reference trials", status: "open", decision: "", note: "Aim for several so accuracy is not n = 1." },
    { topic: "Prior family / output format", status: "open", decision: "", note: "Depends on futility model input (Normal on log HR, Beta, mixture)." },
    { topic: "LLMs evaluated", status: "open", decision: "", note: "GPT, Gemini, Claude + possibly one open-weight model for data-sensitive runs." },
    { topic: "Accuracy metric(s)", status: "open", decision: "", note: "KL, Wasserstein, overlap, coverage, ESS ratio." },
    { topic: "Expert reviewer", status: "open", decision: "", note: "Contact via promotor / daily advisor." },
    { topic: "GenAI focus field", status: "open", decision: "", note: "Proposal leaves Yes / No / Optional unspecified." }
  ],

  // Running progress log, newest first.
  log: [
    { date: "2026-10-22", entry: "Set up thesis plan website and GitHub repo." },
    { date: "2026-10-21", entry: "Read the thesis proposal; prepared first-meeting brief (background on trials, PPoS, priors, LLM elicitation; question list; reading plan)." }
  ]
};
