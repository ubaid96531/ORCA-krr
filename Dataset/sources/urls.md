# Official source URLs

| Local file | Source | Public URL |
|---|---|---|
| `NIST.CSWP.29.pdf` | NIST, The NIST Cybersecurity Framework (CSF) 2.0, NIST CSWP 29 (2024) | https://doi.org/10.6028/NIST.CSWP.29 |
| `NIST.AI.100-1.pdf` | NIST, Artificial Intelligence Risk Management Framework (AI RMF 1.0), NIST AI 100-1 (2023) | https://doi.org/10.6028/NIST.AI.100-1 |
| `OWASP_Excessive_Agency.pdf` | OWASP Gen AI Security Project, LLM06:2025 Excessive Agency | https://genai.owasp.org/llmrisk/llm062025-excessive-agency/ |
| `owasp_llm06_2025_reference.md` | Text excerpts of the OWASP page above (the PDF has no extractable text) | https://genai.owasp.org/llmrisk/llm062025-excessive-agency/ |
| `agent_identities.pdf` | Microsoft Learn, Overview of agent identities in Microsoft Entra | https://learn.microsoft.com/en-us/entra/agent-id/agent-identities |
| `authorization.pdf` | Microsoft Learn, Authorization in Microsoft Entra Agent ID | https://learn.microsoft.com/en-us/entra/agent-id/authorization-agent-id |
| `resource_access.pdf` | Microsoft Learn, Grant agents access to Microsoft 365 resources | https://learn.microsoft.com/en-us/entra/agent-id/grant-agent-access-microsoft-365 |

## Note on the Microsoft Entra URLs

The three Entra PDFs were printed with "Microsoft: Print To PDF", which cut off the footer URLs. The footers read:

- `https://learn.microsoft.com/en-us/entra/agent-id/agent-identities?WT.m...`
- `https://learn.microsoft.com/en-us/entra/agent-id/authorization-agent-id...`
- `https://learn.microsoft.com/en-us/entra/agent-id/grant-agent-access-mic...`

The PDFs have no link annotations, so the full URLs were not stored in them. The full URLs above were found on Microsoft Learn: each one starts with its footer prefix and has the same page title as the PDF. The `?WT.mc_id` tracking parameter in the first footer was left out.
