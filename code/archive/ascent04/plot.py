from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt
from scipy.stats import norm

# 1. Define the 3 Normal distributions on the log(HR) scale
# OpenAI Prior: N(, ^2)
mu_prior, sd_prior = -0.25, 0.30
var_prior = sd_prior**2

# ASCENT-04 Trial MLE Ground Truth: HR = 0.65 [0.51, 0.84]
mu_mle = np.log(0.65)                        # -0.4308
sd_mle = (np.log(0.84) - np.log(0.51)) / 3.92  # 0.1273
var_mle = sd_mle**2

# Bayesian Posterior (Normal-Normal Conjugate Update)
var_post = 1.0 / ((1.0 / var_prior) + (1.0 / var_mle))
sd_post = np.sqrt(var_post)
mu_post = var_post * ((mu_prior / var_prior) + (mu_mle / var_mle))

# 2. Compute Evaluation Metrics
z_score = abs(mu_mle - mu_prior) / sd_prior
kl_div = 0.5 * (np.log(var_prior / var_mle) + (var_mle /
                var_prior) + ((mu_mle - mu_prior)**2 / var_prior) - 1)

print(f"Prior-Data Conflict Z-score: {z_score:.2f}")
print(f"KL Divergence D_KL(MLE || Prior): {kl_div:.3f}")
print(
    f"Posterior: N({mu_post:.4f}, {sd_post:.4f}^2) -> Implied HR = {np.exp(mu_post):.3f}")

# 3. Plot the 3 curves (matching Riegler et al., 2025)
x = np.linspace(-1.2, 0.6, 500)

plt.figure(figsize=(8, 5))
plt.plot(x, norm.pdf(x, mu_prior, sd_prior), 'r--', lw=2,
         label=f'OpenAI Prior: N({mu_prior:.2f}, {sd_prior:.2f}²)')
plt.plot(x, norm.pdf(x, mu_mle, sd_mle), 'k-', lw=2,
         label=f'ASCENT-04 MLE: N({mu_mle:.2f}, {sd_mle:.2f}²)')
plt.plot(x, norm.pdf(x, mu_post, sd_post), 'b-', lw=2.5,
         label=f'Posterior: N({mu_post:.2f}, {sd_post:.2f}²)')
plt.axvline(0, color='gray', linestyle=':', label='Null Effect (log(HR) = 0)')

plt.title(
    f'ASCENT-04 Bayesian Updating (KL = {kl_div:.2f}, Z = {z_score:.2f})')
plt.xlabel('Treatment Effect θ = log(HR)')
plt.ylabel('Density')
plt.legend()
plt.grid(alpha=0.3)
plt.tight_layout()
out = Path(__file__).parent / "plot.png"
plt.savefig(out, dpi=150)
print(f"Saved figure to {out}")
plt.show()
