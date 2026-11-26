# ASCENT-04 runs (archived, 16 Nov 2026)

First prior-elicitation experiment, on the ASCENT-04 trial (log hazard ratio; reported
result HR = 0.65 [0.51, 0.84]). Kept as a record, not maintained.

| File | What it is |
|---|---|
| `plot_runs.csv` | The elicited priors, N(mean, SD²) on the log(HR) scale, of runs "Run 1" … "Run N". The log those runs came from is gone, so this is the only copy of the values. |
| `plot_runs.png` | Each run's prior next to the ASCENT-04 result. |
| `plot.py`, `plot.png` | One hand-entered prior compared with the ASCENT-04 result. |
| `plot_runs.py` | The script that made `plot_runs.csv` / `.png`. It parsed priors written as "N(mean, sd²)" in the answer text. |

The scripts no longer run from here: `plot_runs.py` imports `openai_client` from `code/`, and
running it would overwrite `plot_runs.csv` with whatever is in the current log.
