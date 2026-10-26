/*
 * THESIS PLAN DATA — this is the file you update regularly.
 *
 * Edit it by hand, or use "Edit mode" on the timeline of the local site and
 * press "Save plan.js" (that rewrites this whole file).
 *
 * Everything dynamic on the site (countdowns, timeline, task progress,
 * meetings, decisions, progress log) is rendered from this object.
 * Dates are ISO strings (YYYY-MM-DD). Task status: "todo" | "doing" | "done" | "blocked".
 * Set `tbc: true` on a timeline item whose date is not yet confirmed.
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

  // The timeline: one list of items. An item with `start` and `end` is a bar;
  // an item with only `start` is a single date (◆).
  // category: "setup" | "sg1" | "sg2" | "sg3" | "writing" | "deadline" | "meeting" | "break"
  // tbc: true  → date still to be confirmed      key: true → countdown at the top
  // Tasks (below) belong to an item through its `id`.
  timeline: [
    { id: "W1", name: "Week 1 · Kickoff, access & setup", start: "2026-10-27", end: "2026-11-06", category: "setup" },
    { id: "M1", name: "Kickoff meeting", start: "2026-10-27", category: "meeting" },
    { id: "W2", name: "Week 2 · Gold-standard trials & MLE extraction", start: "2026-11-09", end: "2026-11-13", category: "sg1" },
    { id: "W3", name: "Week 3 · Evidence dossiers & anti-leakage protocol", start: "2026-11-16", end: "2026-11-20", category: "sg1" },
    { id: "W4", name: "Week 4 · Baseline pipeline + background chapter", start: "2026-11-23", end: "2026-11-27", category: "sg1" },
    { id: "M2", name: "Ch. 2 draft sent to supervisors", start: "2026-11-27", category: "writing" },
    { id: "W5", name: "Week 5 · SHELF quantile elicitation", start: "2026-11-30", end: "2026-12-04", category: "sg1" },
    { id: "W6", name: "Week 6 · Multi-LLM experiments & variance calibration", start: "2026-12-07", end: "2026-12-11", category: "sg1" },
    { id: "W7", name: "Week 7 · Preliminary evaluation & plots", start: "2026-12-14", end: "2026-12-18", category: "sg1" },
    { id: "W8", name: "Week 8 · Pre-holiday wrap-up & freeze", start: "2026-12-21", end: "2026-12-23", category: "setup" },
    { id: "B1", name: "Christmas holidays", start: "2026-12-24", end: "2027-01-03", category: "break" },
    { id: "B2", name: "January exam period — no heavy thesis work", start: "2027-01-04", end: "2027-01-31", category: "break", tbc: true },
    { id: "S1", name: "Intermediate presentation prep", start: "2027-02-01", end: "2027-02-19", category: "deadline" },
    { id: "M3", name: "Intermediate presentation", start: "2027-02-19", category: "deadline", tbc: true, key: true },
    { id: "S2", name: "Sub-goal 2 · Rationale & hallucinations", start: "2027-02-22", end: "2027-03-12", category: "sg2" },
    { id: "S3", name: "Sub-goal 3 · PPoS & futility simulations", start: "2027-03-15", end: "2027-04-09", category: "sg3" },
    { id: "B3", name: "Easter break", start: "2027-03-29", end: "2027-04-11", category: "break", tbc: true },
    { id: "M4", name: "Hard code freeze", start: "2027-04-09", category: "deadline" },
    { id: "S4", name: "Full draft assembly", start: "2027-04-12", end: "2027-04-23", category: "writing" },
    { id: "M5", name: "Submit full draft 1 to supervisors", start: "2027-04-23", category: "deadline", key: true },
    { id: "S5", name: "Supervisor review round 1", start: "2027-04-26", end: "2027-05-07", category: "writing" },
    { id: "S6", name: "Major revisions window", start: "2027-05-10", end: "2027-05-18", category: "writing" },
    { id: "M6", name: "Submit revised draft 2 for final sign-off", start: "2027-05-19", category: "deadline" },
    { id: "S7", name: "Final polish & official submission", start: "2027-05-24", end: "2027-05-31", category: "writing" },
    { id: "M7", name: "Official thesis submission (check faculty deadline)", start: "2027-05-31", category: "deadline", tbc: true },
    { id: "S8", name: "Defense preparation", start: "2027-06-01", end: "2027-06-20", category: "deadline" },
    { id: "M8", name: "Final defense", start: "2027-06-21", category: "deadline", tbc: true, key: true }
  ],

  tasks: [
    { item: "W1", task: "Hold kickoff meeting with Elena and Kenneth; propose this plan for sign-off", due: "2026-11-06", status: "doing" },
    { item: "W1", task: "Clarify benchmark trial data: in-house UZ Leuven / BREATHE respiratory trial, published trials (e.g. COPD), or both", due: "2026-11-06", status: "todo" },
    { item: "W1", task: "Get access to the group's futility / PPoS codebase (Python / R)", due: "2026-11-06", status: "todo" },
    { item: "W1", task: "Set up API keys for Claude, Gemini and GPT", due: "2026-11-06", status: "todo" },
    { item: "W1", task: "Set up the KU Leuven LaTeX thesis template", due: "2026-11-06", status: "todo" },
    { item: "W1", task: "Set up the GitHub repository for thesis code", due: "2026-11-06", status: "doing" },
    { item: "W2", task: "Lock in 4–6 gold-standard trials (2–3 successful, 2–3 failed)", due: "2026-11-13", status: "todo" },
    { item: "W2", task: "Extract primary endpoint results (rate ratios, odds ratios, hazard ratios + 95% CIs)", due: "2026-11-13", status: "todo" },
    { item: "W2", task: "Script: convert results into ground-truth Normal MLE distributions p̂_MLE(θ) ~ N(θ̂_MLE, σ²_MLE)", due: "2026-11-13", status: "todo" },
    { item: "W2", task: "Implement closed-form KL divergence D_KL(p̂_MLE ‖ p)", due: "2026-11-13", status: "todo" },
    { item: "W2", task: "Implement prior–data conflict Z-score calculator", due: "2026-11-13", status: "todo" },
    { item: "W3", task: "Build a pre-trial evidence dossier per trial (Phase II data, indication, mechanism of action, endpoint scale only)", due: "2026-11-20", status: "todo" },
    { item: "W3", task: "Unblinded version (real drug / trial names) to test whether the LLM memorised the outcome", due: "2026-11-20", status: "todo" },
    { item: "W3", task: "Blinded version (e.g. \"Compound X-33\") to force genuine reasoning and prevent leakage", due: "2026-11-20", status: "todo" },
    { item: "W4", task: "Implement the Riegler et al. (2025) baseline prompt: direct μ₀, σ₀ for moderately vs weakly informative priors", due: "2026-11-27", status: "todo" },
    { item: "W4", task: "Writing milestone 1: draft Ch. 2 Background & literature review (5–8 pages: trials, PPoS, priors, SHELF, Riegler et al.)", due: "2026-11-27", status: "todo" },
    { item: "W4", task: "Send Ch. 2 draft to Elena and Kenneth for early style feedback", due: "2026-11-27", status: "todo" },
    { item: "W5", task: "Implement SHELF quantile elicitation prompts (P01, P25, P50, P75, P99)", due: "2026-12-04", status: "todo" },
    { item: "W5", task: "Curve-fitting script (least squares / IQR fitting): quantiles → N(μ₀, σ₀²) on the log scale", due: "2026-12-04", status: "todo" },
    { item: "W6", task: "Run Direct vs SHELF pipelines across Claude, Gemini and ChatGPT on successful and failed trial dossiers", due: "2026-12-11", status: "todo" },
    { item: "W6", task: "Variance calibration: self-consistency across 10 temperature-sampled runs", due: "2026-12-11", status: "todo" },
    { item: "W6", task: "Variance calibration: elicit skeptical vs enthusiastic archetypes", due: "2026-12-11", status: "todo" },
    { item: "W6", task: "Compare which strategy fixes overconfidence best", due: "2026-12-11", status: "todo" },
    { item: "W7", task: "First results tables: D_KL, Z-scores, coverage", due: "2026-12-18", status: "todo" },
    { item: "W7", task: "Plots: prior vs MLE vs posterior curves (as in Riegler et al. Figs 1–4)", due: "2026-12-18", status: "todo" },
    { item: "W7", task: "Writing milestone 2: draft first half of Ch. 3 Methodology (benchmark trials, anti-leakage design, prompts)", due: "2026-12-18", status: "todo" },
    { item: "W8", task: "Meet Elena and Kenneth to review December results", due: "2026-12-23", status: "todo" },
    { item: "W8", task: "Confirm the outline of the February intermediate presentation", due: "2026-12-23", status: "todo" },
    { item: "W8", task: "Back up all code and plots", due: "2026-12-23", status: "todo" },
    { item: "S1", task: "Build slides from December results", due: "2027-02-19", status: "todo" },
    { item: "S1", task: "Dry run with Elena and Kenneth", due: "2027-02-19", status: "todo" },
    { item: "S1", task: "Deliver the intermediate presentation", due: "2027-02-19", status: "todo" },
    { item: "S2", task: "Evaluate LLM rationales for FDA / regulatory quality", due: "2027-03-12", status: "todo" },
    { item: "S2", task: "Check for hallucinated citations", due: "2027-03-12", status: "todo" },
    { item: "S2", task: "Test RAG: feed real PubMed abstracts to the LLM", due: "2027-03-12", status: "todo" },
    { item: "S3", task: "Plug LLM priors into the group's PPoS futility model", due: "2027-04-09", status: "todo" },
    { item: "S3", task: "Simulate interim analyses at 25% and 50% enrolment", due: "2027-04-09", status: "todo" },
    { item: "S4", task: "Write Ch. 4 Results", due: "2027-04-23", status: "todo" },
    { item: "S4", task: "Write Ch. 5 Discussion", due: "2027-04-23", status: "todo" },
    { item: "S4", task: "Write Ch. 1 Introduction", due: "2027-04-23", status: "todo" },
    { item: "S5", task: "Polish figures and formatting", due: "2027-05-07", status: "todo" },
    { item: "S5", task: "Write appendix with all prompts", due: "2027-05-07", status: "todo" },
    { item: "S5", task: "Start outlining defense slides", due: "2027-05-07", status: "todo" },
    { item: "S6", task: "Incorporate round 1 feedback (incl. any extra sensitivity analysis)", due: "2027-05-18", status: "todo" },
    { item: "S7", task: "Fix remaining typos from round 2", due: "2027-05-31", status: "todo" },
    { item: "S7", task: "Submit final PDF", due: "2027-05-31", status: "todo" },
    { item: "S8", task: "Build defense slides", due: "2027-06-20", status: "todo" },
    { item: "S8", task: "Mock defenses", due: "2027-06-20", status: "todo" }
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
        "Meeting rhythm, repo, KU Leuven milestones",
        "Propose the 8-week Nov–Dec plan and the spring schedule for sign-off"
      ],
      notes: "",
      actions: []
    }
  ],

  // Design decisions — move from open to decided as answers come in.
  decisions: [
    { topic: "Gold-standard reference", status: "open", decision: "", note: "Proposed: observed trial result as Normal MLE p̂_MLE(θ); in-house BREATHE trial and/or published (e.g. COPD) trials." },
    { topic: "Number of reference trials", status: "open", decision: "", note: "Proposed: 4–6 trials (2–3 successful, 2–3 failed)." },
    { topic: "Prior family / output format", status: "open", decision: "", note: "Depends on futility model input (Normal on log HR, Beta, mixture)." },
    { topic: "LLMs evaluated", status: "open", decision: "", note: "GPT, Gemini, Claude + possibly one open-weight model for data-sensitive runs." },
    { topic: "Accuracy metric(s)", status: "open", decision: "", note: "Proposed: D_KL(p̂_MLE ‖ p), prior–data conflict Z-score, coverage." },
    { topic: "Expert reviewer", status: "open", decision: "", note: "Contact via promotor / daily advisor." },
    { topic: "GenAI focus field", status: "open", decision: "", note: "Proposal leaves Yes / No / Optional unspecified." }
  ],

  // Running progress log, newest first.
  log: [
    { date: "2026-10-26", entry: "Adopted detailed plan: 8 weekly blocks for Nov–Dec, spring schedule with code freeze on 9 Apr and draft 1 on 23 Apr." },
    { date: "2026-10-22", entry: "Set up thesis plan website and GitHub repo." },
    { date: "2026-10-21", entry: "Read the thesis proposal; prepared first-meeting brief (background on trials, PPoS, priors, LLM elicitation; question list; reading plan)." }
  ]
};
