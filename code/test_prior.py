"""Try out prior elicitation with one prompt.

Edit SYSTEM and PROMPT below, then run from the project root:
    python code/test_prior.py

Every call is logged (prompt, answer, tokens, cost) to code/logs/openai_calls.jsonl.
"""

from openai_client import ask, total_cost

# How the model should behave: its role and the format of its answer.
SYSTEM = """You are an expert oncologist helping to elicit a prior distribution for a clinical trial outcome.
Answer only with the five percentiles, one per line, as: P5: x%"""

# The question itself. Replace the evidence with a real dossier.
PROMPT = """Based on the evidence below, give your 5th, 25th, 50th, 75th and 95th percentiles
for the objective response rate (ORR) of drug X in the upcoming phase II trial.

Evidence:
- Phase I (n=30): 9 of 30 patients responded (30%).
- A drug with the same mechanism reached an ORR of 25% in a similar population.
"""

if __name__ == "__main__":
    answer = ask(PROMPT, system=SYSTEM)
    print(answer)
    print(f"\n[total spent so far: ${total_cost():.4f}]")
