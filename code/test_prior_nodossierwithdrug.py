"""Try out prior elicitation with one prompt.

Edit SYSTEM and PROMPT below, then run from the project root:
    python code/test_prior.py

Every call is logged (prompt, answer, tokens, cost) to code/logs/openai_calls.jsonl.
"""

from openai_client import ask, total_cost

# How the model should behave: its role and the format of its answer.
SYSTEM = """You are an expert clinical trial biostatistician and respiratory epidemiologist. Your task is to 
provide calibrated subjective probability distributions (SHELF quantiles) for clinical trial endpoints 
based on provided evidence dossiers. You must rigorously account for trial attrition, placebo effects, 
and Phase II subgroup shrinkage ("winner's curse"). You must return your final answer strictly as a 
JSON object matching the requested schema."""

# The question itself. Replace the evidence with a real dossier.
PROMPT = """We are eliciting a Bayesian prior distribution using the Sheffield Elicitation Framework (SHELF) for an upcoming Phase III respiratory clinical trial, relying strictly on your internal knowledge of published Phase II clinical trials and respiratory medicine.

Trial Specification (No Dossier Provided - Use Your Internal Literature Knowledge):
- Disease: Severe eosinophilic asthma
- Drug: Compound DP2-450 (450 mg once daily oral DP2 / CRTH2 receptor antagonist) vs. Placebo
- Primary Endpoint: Percentage reduction in the annualized rate of moderate-to-severe asthma exacerbations over 52 weeks compared to placebo (where 0% means no reduction/total failure, and 50% means cutting exacerbations in half).
- Temporal Cutoff Constraint: Pretend the year is 2017 (before Phase III LUSTER-1 and LUSTER-2 read out). Base your prior strictly on your recollection of the published Phase II Compound DP2-450 trials (e.g., sputum eosinophil reduction and FEV1 lung function studies) and typical Phase II-to-III translation in asthma.

Instructions:
1. Do NOT arbitrarily invent a Beta(a,b) distribution first. Instead, reason clinically from the recalled Phase II trials of Compound DP2-450 and the biology of DP2 antagonism.
2. State which Phase II studies/findings of Compound DP2-450 you recall.
3. Elicit your SHELF quantiles (P5, P25, P50, P75, P95) for the true Phase III percentage reduction in asthma exacerbations.

Return a JSON object with this exact structure:
{
  "rationale_summary": "Brief summary of your clinical reasoning and shrinkage adjustment",
  "shelf_quantiles_rr": {
    "P01_lower": 0.0,
    "P25_q1": 0.0,
    "P50_median": 0.0,
    "P75_q3": 0.0,
    "P99_upper": 0.0
  }
}
"""

if __name__ == "__main__":
    answer = ask(PROMPT, system=SYSTEM)
    print(answer)
    print(f"\n[total spent so far: ${total_cost():.4f}]")
