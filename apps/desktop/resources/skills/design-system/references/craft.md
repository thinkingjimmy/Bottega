<!--
  [INPUT]: Bottega saved tokens, themes, source versions, component evidence and unsynced inventory
  [OUTPUT]: A usable system description that distinguishes exact source, user decisions and observed mounts
  [POS]: Bottega system review reference; assesses actual captured coverage
-->

# Review system usability

Explain the system in terms of its saved data and intended consumer. Check these questions
against the record rather than a desired completeness claim:

| Question | Evidence |
| --- | --- |
| Which product/source was captured? | Source paths, byte digests, actual Git/digest versions |
| Which values apply in a theme? | Tokens, aliases, origins and first-theme fallback |
| Which values were chosen by the user? | Override and explicit update decisions |
| Which component can be used? | Actual export/entry, captured closure and current mode/reason |
| Which resource is absent or changed? | Complete unsynced stream and font/source records |
| Which consumer uses this system? | That design's fixed systems binding and copied files |

Keep exact source literals even when a visual recommendation would be different. Label a
proposed accessibility or theme improvement as a proposal, then apply it only within the user's
selected intent. A source-preserving inventory and a changed consumer theme are separate results.

Usage guidance should name the actual tokens and component exports. Explain context where
source supplies it; mark newly authored recommendations as such. Do not invent a brand rule,
interaction, font license or library export because a name resembles one.

For components, distinguish captured source, compiler output, a recorded mount image and
observed interaction. Read current styleDigest/mode after token changes. A static approximation
is useful only when described accurately. Missing props, dependencies or Provider/image tools
remain concrete limitations.

Report the inventory's counts together with unsynced coverage. A short result page is not the
whole inventory. Preserve user README/usage content during source updates, and retain conflicting
choices until the exact sourceDigest and CAS can admit them. [Source operations](from-code.md)
define the required calls; [system data](format.md) defines their saved evidence.
