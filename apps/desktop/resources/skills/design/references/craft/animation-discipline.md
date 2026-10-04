<!-- Modified work: original Bottega summary of the audited OpenDesign source. See ../PROVENANCE.md. -->

# Animation discipline

- Animate only to explain continuity, hierarchy, causality, or feedback.
- Keep ordinary feedback near 100–200ms and larger transitions near 200–350ms.
- Let input interrupt motion; never make a user wait for decoration to finish.
- Prefer opacity and transforms over layout properties.
- Remove nonessential motion under `prefers-reduced-motion` and preserve state meaning.
- Avoid autonomous page-load movement, looping attention traps, and multiple competing easings.
