<!-- Modified work: original Bottega summary of the audited OpenDesign source. See ../PROVENANCE.md. -->

# Typography implementation

- Choose system stacks for their role and test fallback metrics on each target platform.
- Set explicit size, line-height, weight, and letter spacing; browser defaults are not a system.
- Preserve language-appropriate word breaking, hyphenation, punctuation, and numeral behavior.
- Prevent layout shift by reserving space and avoiding runtime font substitution.
- Check zoom, narrow widths, long words, localization expansion, and user-supplied content.
