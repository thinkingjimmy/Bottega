<!-- Modified work: original Bottega summary of the audited OpenDesign source. See ../PROVENANCE.md. -->

# RTL and bidirectional text

- Use logical CSS properties and allow layout flow to mirror without duplicating components.
- Mirror directional navigation and progress; do not mirror universal media or brand marks.
- Isolate user-generated mixed-direction strings with `dir="auto"` or bidi isolation.
- Keep numbers, code, file paths, and technical identifiers readable in their natural direction.
- Test truncation, icons, tables, charts, and focus order in both flows.
