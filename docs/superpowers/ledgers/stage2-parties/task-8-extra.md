# Task 8 additions (binding)
- PartyModal treats `in_progress` (and any unknown-outcome answer) as NOT a definite failure: keep the same attemptId on retry (stage-1 Task 9 rule); new attemptId only after a definite failure (decline, taken, refused). Test.
- Also: start a NEW attemptId when the package or add-ons change (an old id with a different order is refused by Square).
