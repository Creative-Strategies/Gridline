# Security policy

## Supported versions

Security fixes are applied to the latest published minor release. During the
initial 0.x series, consumers should upgrade to the newest release before
reporting an issue.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting flow in the Security tab
of Creative-Strategies/Gridline. Do not open a public issue for a suspected
vulnerability or attach a malicious workbook publicly.

Include the affected package/version, a minimal workbook or encrypted envelope,
the browser/runtime, expected impact, and reproduction steps. We will
acknowledge a report within five business days and coordinate disclosure after
a fix is available.

## Security model

Gridline treats workbook bytes, formulas, strings, relationships, dimensions,
encrypted-envelope headers, and cloud responses as untrusted. Parsing and
Office decryption run in a Web Worker. Source bytes, expanded OOXML, cells, cell
text, formula tokens/work/depth, chart data, viewport cells, CSV area/output,
and password-derivation cost are bounded.

Remote URL loading is an embedding-platform boundary. Hosts must not combine
an untrusted URL with cookies, Authorization headers, or cloud credentials
without an explicit origin and redirect allowlist.
