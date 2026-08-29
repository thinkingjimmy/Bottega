<!-- Modified work: original Bottega summary of the audited OpenDesign source. See ../PROVENANCE.md. -->

# Form validation

- Keep persistent labels; placeholders are examples, not names.
- Validate format after blur or submission, while reporting impossible values immediately.
- Place a specific error beside the field and summarize on submission when many fields fail.
- Preserve entered values, focus the first error, and connect messages with `aria-describedby`.
- Distinguish loading, success, recoverable failure, and ambiguous submission outcomes.
- Do not disable the submit action merely because an untouched form is incomplete.
