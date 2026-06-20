# Decision Schema

`data/decisions.json` keeps the curated corpus versioned in the repository.

Required decision fields:

- `id`: stable unique identifier.
- `empresa`: company or source owner.
- `topic`: fixed taxonomy used for conflict detection.
- `subject`: technology or architecture choice being judged.
- `verdict`: one of `adopted`, `rejected`, `kept`.
- `context`: situation that made the decision reasonable.
- `reason`: context-anchored explanation.
- `source_url`: canonical source link.
- `tags`: free-form discovery terms.

Display fields:

- `year`: optional year shown on cards.
- `title`: short card headline.
- `ui.color` and `ui.tone`: presentation hints for the static frontend.
