# ORCA Hybrid Symbolic + KG Embedding Reasoning Report (Option D)

- Generated at: 2026-11-21T21:22:13+00:00
- Entities: 109 | Relations: 11 | Total asserted relational triples: 146
- Split: 117 train / 29 held-out test triples (degree-preserving, seed=42)
- Embedding dim: 64 | Epochs: 600

## 1. Link Prediction Benchmark (Filtered Ranking)

| Setting | Model | MRR | Mean Rank | Hits@1 | Hits@3 | Hits@10 |
|---|---|---|---|---|---|---|
| Global Filtered | Random | 0.0401 | 62.72 | 0.0172 | 0.0172 | 0.0172 |
| Global Filtered | TransE | 0.2034 | 14.78 | 0.0690 | 0.2069 | 0.5172 |
| Global Filtered | DistMult | 0.2130 | 34.66 | 0.1552 | 0.1897 | 0.2759 |
| OWL-Constrained Filtered | Random | 0.2307 | 7.62 | 0.0345 | 0.2414 | 0.8103 |
| OWL-Constrained Filtered | TransE | 0.5746 | 3.48 | 0.3793 | 0.7414 | 0.9138 |
| OWL-Constrained Filtered | DistMult | 0.6050 | 3.83 | 0.4828 | 0.6552 | 0.9138 |

## 2. Entity Similarity Examples (Cosine Similarity in TransE Space)

- `agent:AdvisingAgent` -> task:RecommendCourses (0.855), agent:TimetableAssistant (0.843), perm:ReadStudentGrades (0.774), tool:StudentRecordsTool (0.754)
- `agent:TimetableAssistant` -> agent:AdvisingAgent (0.843), task:PublishExamTimetable (0.835), tool:CourseCatalogTool (0.810), perm:ReadCourseCatalog (0.765)
- `agent:HelpdeskAgent` -> policy:NoBulkDataExportPolicy (0.867), task:ResetStudentPasswords (0.828), perm:ResetPassword (0.800), tool:PasswordResetTool (0.773)
- `resource:StudentRecordsDB` -> perm:ReadStudentContactInfo (0.798), perm:ExportStudentData (0.773), perm:ReadStudentGrades (0.731), tool:StudentRecordsTool (0.692)
- `perm:ExportStudentData` -> perm:ReadStudentContactInfo (0.786), resource:StudentRecordsDB (0.773), perm:ReadStudentGrades (0.716), perm:ResetPassword (0.672)

## 3. Hybrid Symbolic-Audited Link Predictions (`Predicted_Link`, Unverified)

### Missing tool prediction for unauthorized agent TimetableAssistant

| Predicted Triple | Confidence | Risk Level | Symbolic Audit Summary |
|---|---|---|---|
| `(agent:TimetableAssistant, orca:usesTool, tool:StudentRecordsTool)` | 0.1168 | `EXCESSIVE_EXPOSURE` | Introduces excessive permission(s) [perm:ReadStudentContactInfo, perm:ReadStudentGrades, perm:WriteStudentGrades] (ORCA-D) or new sensitive data exposure (ORCA-C). |
| `(agent:TimetableAssistant, orca:usesTool, tool:ExamTimetableTool)` | 0.1165 | `REMEDIATION_WITH_EXCESS` | Restores [perm:WriteExamTimetable] for agent:TimetableAssistant (NOT_AUTHORIZED -> AUTHORIZED), but also introduces excessive permission(s) [perm:ReadExamTimetable] via ORCA-D. |
| `(agent:TimetableAssistant, orca:usesTool, tool:RubricTool)` | 0.0930 | `EXCESSIVE_EXPOSURE` | Introduces excessive permission(s) [perm:ReadMarkingRubrics] (ORCA-D) or new sensitive data exposure (ORCA-C). |

### Missing direct permission prediction for unauthorized agent TimetableAssistant

| Predicted Triple | Confidence | Risk Level | Symbolic Audit Summary |
|---|---|---|---|
| `(agent:TimetableAssistant, orca:hasPermission, perm:ReadCourseCatalog)` | 0.0790 | `LOW_RISK` | OWL-consistent predicted relation with no new excessive permissions or policy violations. |
| `(agent:TimetableAssistant, orca:hasPermission, perm:WriteExamTimetable)` | 0.0681 | `SAFE_REMEDIATION` | Resolves missing permission(s) [perm:WriteExamTimetable] for agent:TimetableAssistant with zero excessive permissions. |
| `(agent:TimetableAssistant, orca:hasPermission, perm:ReadStudentGrades)` | 0.0579 | `EXCESSIVE_EXPOSURE` | Introduces excessive permission(s) [perm:ReadStudentGrades] (ORCA-D) or new sensitive data exposure (ORCA-C). |

### Missing tool prediction for unauthorized agent AdmissionsReviewAgent

| Predicted Triple | Confidence | Risk Level | Symbolic Audit Summary |
|---|---|---|---|
| `(agent:AdmissionsReviewAgent, orca:usesTool, tool:EmailTool)` | 0.1093 | `EXCESSIVE_EXPOSURE` | Introduces excessive permission(s) [perm:SendStudentEmail] (ORCA-D) or new sensitive data exposure (ORCA-C). |
| `(agent:AdmissionsReviewAgent, orca:usesTool, tool:RubricTool)` | 0.1024 | `EXCESSIVE_EXPOSURE` | Introduces excessive permission(s) [perm:ReadMarkingRubrics] (ORCA-D) or new sensitive data exposure (ORCA-C). |
| `(agent:AdmissionsReviewAgent, orca:usesTool, tool:StudentRecordsTool)` | 0.1014 | `EXCESSIVE_EXPOSURE` | Introduces excessive permission(s) [perm:ReadStudentContactInfo, perm:ReadStudentGrades, perm:WriteStudentGrades] (ORCA-D) or new sensitive data exposure (ORCA-C). |

### Candidate agent/role/tool holder for ExportStudentData (policy-risk probe)

| Predicted Triple | Confidence | Risk Level | Symbolic Audit Summary |
|---|---|---|---|
| `(tool:StudentRecordsTool, orca:hasPermission, perm:ExportStudentData)` | 0.0603 | `EXCESSIVE_EXPOSURE` | Introduces excessive permission(s) [perm:ExportStudentData] (ORCA-D) or new sensitive data exposure (ORCA-C). |
| `(tool:PasswordResetTool, orca:hasPermission, perm:ExportStudentData)` | 0.0587 | `POLICY_VIOLATION` | BLOCKED by Rule ORCA-E: introduces or duplicates prohibited permission triggering governing SecurityPolicy. |
| `(agent:HelpdeskAgent, orca:hasPermission, perm:ExportStudentData)` | 0.0472 | `POLICY_VIOLATION` | BLOCKED by Rule ORCA-E: introduces or duplicates prohibited permission triggering governing SecurityPolicy. |

### Candidate governing policy for PublishExamTimetable

| Predicted Triple | Confidence | Risk Level | Symbolic Audit Summary |
|---|---|---|---|
| `(task:PublishExamTimetable, orca:governedByPolicy, policy:LeastPrivilegePolicy)` | 0.2564 | `LOW_RISK` | OWL-consistent predicted relation with no new excessive permissions or policy violations. |
| `(task:PublishExamTimetable, orca:governedByPolicy, policy:HumanOversightPolicy)` | 0.1928 | `LOW_RISK` | OWL-consistent predicted relation with no new excessive permissions or policy violations. |
| `(task:PublishExamTimetable, orca:governedByPolicy, policy:StudentDataProtectionPolicy)` | 0.1862 | `LOW_RISK` | OWL-consistent predicted relation with no new excessive permissions or policy violations. |

### Candidate official security control for LeastPrivilegePolicy

| Predicted Triple | Confidence | Risk Level | Symbolic Audit Summary |
|---|---|---|---|
| `(policy:LeastPrivilegePolicy, orca:implementsControl, control:CSF_IDAM-07)` | 0.1125 | `LOW_RISK` | OWL-consistent predicted relation with no new excessive permissions or policy violations. |
| `(policy:LeastPrivilegePolicy, orca:implementsControl, control:CSF_GVPO-01)` | 0.1100 | `LOW_RISK` | OWL-consistent predicted relation with no new excessive permissions or policy violations. |
| `(policy:LeastPrivilegePolicy, orca:implementsControl, control:CSF_DECM-03)` | 0.0932 | `LOW_RISK` | OWL-consistent predicted relation with no new excessive permissions or policy violations. |

