# OWASP Top 10 for LLM Applications 2025 – LLM06:2025 Excessive Agency (reference excerpts)

- Source: OWASP Gen AI Security Project, "LLM06:2025 Excessive Agency"
- URL: https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
- Retrieved: 2026 (during ORCA task 4.1)
- License: OWASP Top 10 for LLM Applications is published under CC BY-SA 4.0.
- Why this file exists: the local copy `OWASP_Excessive_Agency.pdf` has no extractable text, so ORCA cites the public web page. Only the short excerpts used by ORCA are kept here. Quotes are verbatim; everything else is a paraphrase.

## Excerpts used by ORCA

### Definition
> "Excessive Agency is the vulnerability that enables damaging actions to be performed in response to unexpected, ambiguous or manipulated outputs from an LLM"

### Root causes
The page lists three root causes of Excessive Agency:

> "excessive functionality; excessive permissions; excessive autonomy."

ORCA mapping:
- Excessive functionality → "unnecessary tool" findings (the agent uses a tool it does not need).
- Excessive permissions → "excessive permission" findings (a permission the agent holds but its task does not require).
- Excessive autonomy → high-impact actions without human approval (motivates the `supervisedBy` link).

### Excessive Functionality (verbatim, used as `control:OWASP_LLM06-ExcessiveFunctionality`)
> "An LLM agent has access to extensions which include functions that are not needed for the intended operation of the system."

### Excessive Permissions (verbatim, used as `control:OWASP_LLM06-ExcessivePermissions`)
> "An LLM extension has permissions on downstream systems that are not needed for the intended operation of the application."

### Example of excessive permissions (paraphrased)
An extension meant only to read data connects with an identity that also has UPDATE, INSERT and DELETE rights on the database.

### Mitigations used by ORCA (paraphrased)
- Limit the extensions an agent may call to the minimum necessary.
- Limit the permissions extensions hold on other systems to the minimum necessary.
- Run actions on behalf of a user in that user's context with minimum privileges.
- Use human-in-the-loop approval for high-impact actions.
- Enforce authorization in downstream systems instead of letting the LLM decide.
- Log and monitor extension activity (limits damage, does not prevent it).

_Content was rephrased for compliance with licensing restrictions, except for the short quoted passages, which are attributed to the source above._
