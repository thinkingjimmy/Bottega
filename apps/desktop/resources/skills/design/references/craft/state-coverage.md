<!-- Modified work: original Bottega summary of the audited OpenDesign source. See ../PROVENANCE.md. -->

# State coverage

Design every relevant intersection, not only the happy path:

- initial empty, filtered empty, zero value, and permission-limited;
- initial loading, incremental loading, refreshing, and stale cached data;
- complete success, partial success, recoverable error, terminal error, and ambiguous outcome;
- offline, reconnecting, rate-limited, and expired authority;
- disabled, hover, focus, pressed, selected, and destructive confirmation.

Keep layout stable between states and pair each failure with the next valid action.
