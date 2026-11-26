"""Plot the priors elicited in the playground runs named "Run 1" ... "Run N".

Each answer states its prior as N(mean, sd^2) on the log(HR) scale; the mean and SD are
parsed from the answer text in logs/openai_calls.jsonl. Produces:
  - left:  every run's prior density, with the ASCENT-04 result for reference
  - right: each run's mean with its 95% prior interval (mean ± 1.96 SD)
and saves code/plot_runs.png plus code/plot_runs.csv (the parsed values).

    python code/plot_runs.py                  # all runs named "Run <number>"
    python code/plot_runs.py "Run"            # same; first argument is the name prefix
"""

import csv
import json
import re
import sys
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from scipy.stats import norm

from openai_client import LOG_FILE

HERE = Path(__file__).parent
PREFIX = sys.argv[1] if len(sys.argv) > 1 else "Run"

# ASCENT-04 result, as in plot.py: HR = 0.65 [0.51, 0.84]
MU_MLE = np.log(0.65)
SD_MLE = (np.log(0.84) - np.log(0.51)) / 3.92

# Start of a normal prior: "N(", "\mathcal N(", "\mathcal{N}\!\left(", ...
PRIOR_START = re.compile(r"N\}?\s*(?:\\!)?\s*(?:\\left)?\s*\(")
MATH_END = re.compile(r"\\\]|\\\)|\n\s*\n")
NUMBER = re.compile(r"[-−]?\d*\.?\d+")


def parse_prior(answer: str) -> tuple[float, float] | None:
    """(mean, sd) from the first normal prior in the answer, or None if there is none.

    Handles N(-0.30, 0.30^2), N(\\mathbf{-0.288}, \\mathbf{0.35^2}),
    N(\\underbrace{-0.357}_{\\text{mean}}, \\underbrace{0.30^2}_{\\text{SD}^2}) and
    N(mean=-0.30, standard deviation=0.35). The second parameter must be written as sd^2 or be
    labelled as a standard deviation, so a bare N(mean, variance) is not misread as an SD.
    """
    for m in PRIOR_START.finditer(answer):
        rest = answer[m.end():m.end() + 300]
        end = MATH_END.search(rest)
        seg = rest[:end.start()] if end else rest
        labelled_sd = re.search(r"standard deviation|\bSD\b|\bsd\b", seg)
        seg = re.sub(r"\\text\{[^{}]*\}", "", seg)        # labels like \text{mean}
        seg = re.sub(r"_\{[^{}]*\}", "", seg)             # \underbrace{..}_{...}
        squared = re.search(r"\^\s*\{?\s*2", seg)
        seg = re.sub(r"\^\s*\{?\s*2\s*\}?", "", seg)      # drop the ^2 so the 2 is not read as a number
        nums = NUMBER.findall(seg)
        if len(nums) >= 2 and (squared or labelled_sd):
            mean, sd = (float(n.replace("−", "-")) for n in nums[:2])
            return mean, abs(sd)
    return None


def load_runs(prefix: str) -> list[dict]:
    """Logged calls named "<prefix> <number>", ordered by number (latest call wins for duplicates)."""
    name = re.compile(rf"{re.escape(prefix)}\s*(\d+)", re.IGNORECASE)
    runs = {}
    for line in LOG_FILE.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        call = json.loads(line)
        m = name.fullmatch((call.get("name") or "").strip())
        if m:
            runs[int(m.group(1))] = call
    return [runs[k] | {"run": k} for k in sorted(runs)]


def main() -> None:
    rows, skipped = [], []
    for call in load_runs(PREFIX):
        prior = parse_prior(call.get("answer") or "")
        if prior is None:
            skipped.append(call["name"])
            continue
        rows.append({"run": call["run"], "name": call["name"], "mean": prior[0], "sd": prior[1],
                     "model": call.get("model_returned"), "timestamp": call.get("timestamp")})
    if skipped:
        print(f"Could not find N(mean, sd^2) in: {', '.join(skipped)}", file=sys.stderr)
    if not rows:
        sys.exit(f'No parsable runs named "{PREFIX} <number>" in {LOG_FILE}')

    means = np.array([r["mean"] for r in rows])
    sds = np.array([r["sd"] for r in rows])
    for r in rows:
        print(f'{r["name"]:>8}: mean {r["mean"]:+.3f}  sd {r["sd"]:.3f}  '
              f'var {r["sd"]**2:.4f}  median HR {np.exp(r["mean"]):.2f}')
    print(f"\n{len(rows)} runs. Means: avg {means.mean():+.3f}, SD across runs {means.std(ddof=1):.3f}, "
          f"range [{means.min():+.3f}, {means.max():+.3f}]")
    print(f"           SDs:   avg {sds.mean():.3f}, range [{sds.min():.3f}, {sds.max():.3f}]")

    with open(HERE / "plot_runs.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["run", "name", "mean", "sd", "model", "timestamp"])
        w.writeheader()
        w.writerows(rows)

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6), gridspec_kw={"width_ratios": [3, 2]})
    colors = plt.colormaps["viridis"](np.linspace(0, 0.9, len(rows)))

    # Left: overlaid prior densities
    lo = min((means - 3.5 * sds).min(), MU_MLE - 3.5 * SD_MLE)
    hi = max((means + 3.5 * sds).max(), 0.3)
    x = np.linspace(lo, hi, 600)
    for r, c in zip(rows, colors):
        ax1.plot(x, norm.pdf(x, r["mean"], r["sd"]), color=c, lw=1.3, alpha=0.8,
                 label=f'{r["name"]}: N({r["mean"]:.2f}, {r["sd"]:.2f}²)')
    ax1.plot(x, norm.pdf(x, MU_MLE, SD_MLE), "k--", lw=2,
             label=f"ASCENT-04 result: N({MU_MLE:.2f}, {SD_MLE:.2f}²)")
    ax1.axvline(0, color="gray", ls=":", lw=1)
    ax1.set_xlabel("θ = log(HR), PFS")
    ax1.set_ylabel("Density")
    ax1.set_title(f"Elicited priors, {len(rows)} runs ({rows[0]['model']})")
    ax1.grid(alpha=0.3)
    ax1.legend(fontsize=7, ncol=2, loc="upper right")

    # Right: mean ± 1.96 SD per run
    y = np.arange(len(rows))[::-1]
    ax2.errorbar(means, y, xerr=1.96 * sds, fmt="o", ms=5, color="tab:blue", ecolor="tab:blue",
                 elinewidth=1.5, capsize=3, label="Prior mean, 95% interval")
    ax2.axvline(MU_MLE, color="k", ls="--", lw=1.5, label="ASCENT-04 result")
    ax2.axvspan(np.log(0.51), np.log(0.84), color="k", alpha=0.08, label="ASCENT-04 95% CI")
    ax2.axvline(means.mean(), color="tab:red", lw=1, label=f"Average prior mean ({means.mean():.2f})")
    ax2.axvline(0, color="gray", ls=":", lw=1)
    ax2.set_yticks(y, [r["name"] for r in rows])
    ax2.set_xlabel("θ = log(HR), PFS")
    ax2.set_title("Prior mean ± 1.96 SD per run")
    ax2.grid(alpha=0.3, axis="x")
    ax2.legend(fontsize=8, loc="upper center", bbox_to_anchor=(0.5, -0.1), ncol=2, frameon=False)

    fig.tight_layout()
    out = HERE / "plot_runs.png"
    fig.savefig(out, dpi=150)
    print(f"\nSaved {out} and {HERE / 'plot_runs.csv'}")
    plt.show()


if __name__ == "__main__":
    main()
