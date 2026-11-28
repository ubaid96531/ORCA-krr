# ORCA Explainability and Provenance Examples

- Generated at: 2026-11-21T22:58:23+00:00
- LLM model: `gemini-3.5-flash-lite`

## Trace-1: Multi-Hop Indirect Sensitive Data Access (LibraryHelpBot -> StudentPII)

- **User question:** Which sensitive data categories can LibraryHelpBot reach indirectly, and what paths establish access?
- **Detected intent:** `indirect_single` | **Sufficient evidence:** `True`
- **Generated text (LLM response):** Based on the ORCA knowledge graph, the agent agent:LibraryHelpBot can reach the sensitive data category category:StudentPII indirectly. This access is established through a role path via role:LibraryAssistantRole and perm:ReadLibraryLoans to resource:LibraryLoansDB, as well as a tool path via tool:LibraryTool and perm:ReadLibraryLoans to resource:LibraryLoansDB. Structured query findings confirm that for agent:LibraryHelpBot and category:StudentPII, excessive exposure is False and excessive permissions are none across both the role and tool routes.
- **Deterministic KG template summary:** LibraryHelpBot can reach 1 sensitive data category: StudentPII. StudentPII is reached through LibraryAssistantRole. StudentPII is reached through LibraryTool. Evidence: AI agents agent:LibraryHelpBot; permissions perm:ReadLibraryLoans; resources resource:LibraryLoansDB; sensitive data categories category:StudentPII. Rules applied: ORCA-A, ORCA-B and ORCA-C. Based on 6 explicit facts, 3 inferred facts and 2 access paths.

### 1. Explicit Knowledge (Directly Stored in KG)
- `[Synthetic_Fact]` `agent:LibraryHelpBot orca:hasRole role:LibraryAssistantRole`
- `[Synthetic_Fact]` `agent:LibraryHelpBot orca:usesTool tool:LibraryTool`
- `[Synthetic_Fact]` `perm:ReadLibraryLoans orca:accessesResource resource:LibraryLoansDB`
- `[Synthetic_Fact]` `resource:LibraryLoansDB orca:containsSensitiveData category:StudentPII`
- `[Synthetic_Fact]` `role:LibraryAssistantRole orca:hasPermission perm:ReadLibraryLoans`
- `[Synthetic_Fact]` `tool:LibraryTool orca:hasPermission perm:ReadLibraryLoans`

### 2. Inferred Knowledge (Schema Axioms / ORCA Rules A-E)
- `[Inferred_Fact via ORCA-C]` `agent:LibraryHelpBot orca:canReachSensitiveData category:StudentPII` <- `(agent:LibraryHelpBot orca:hasAvailablePermission perm:ReadLibraryLoans; perm:ReadLibraryLoans orca:accessesResource resource:LibraryLoansDB; resource:LibraryLoansDB orca:containsSensitiveData category:StudentPII)`
- `[Inferred_Fact via ORCA-A]` `agent:LibraryHelpBot orca:hasAvailablePermission perm:ReadLibraryLoans` <- `(agent:LibraryHelpBot orca:usesTool tool:LibraryTool; tool:LibraryTool orca:hasPermission perm:ReadLibraryLoans)`
- `[Inferred_Fact via ORCA-B]` `agent:LibraryHelpBot orca:hasAvailablePermission perm:ReadLibraryLoans` <- `(agent:LibraryHelpBot orca:hasRole role:LibraryAssistantRole; role:LibraryAssistantRole orca:hasPermission perm:ReadLibraryLoans)`

### 3. Multi-Hop Access Paths
- `[role]` agent:LibraryHelpBot --orca:hasRole--> role:LibraryAssistantRole -> role:LibraryAssistantRole --orca:hasPermission--> perm:ReadLibraryLoans -> perm:ReadLibraryLoans --orca:accessesResource--> resource:LibraryLoansDB -> resource:LibraryLoansDB --orca:containsSensitiveData--> category:StudentPII (excessive_exposure=False)
- `[tool]` agent:LibraryHelpBot --orca:usesTool--> tool:LibraryTool -> tool:LibraryTool --orca:hasPermission--> perm:ReadLibraryLoans -> perm:ReadLibraryLoans --orca:accessesResource--> resource:LibraryLoansDB -> resource:LibraryLoansDB --orca:containsSensitiveData--> category:StudentPII (excessive_exposure=False)

## Trace-2: Symbolic Rule Inference & Official Control Trace (HelpdeskAgent Policy Violation)

- **User question:** Which AI agents violate a security policy governing their assigned task, and which official control does that policy implement?
- **Detected intent:** `policy_violation` | **Sufficient evidence:** `True`
- **Generated text (LLM response):** Based on the retrieved knowledge graph context, agent:HelpdeskAgent on task:ResetStudentPasswords violates policy:NoBulkDataExportPolicy, which implements control:OWASP_LLM06-ExcessiveFunctionality (sourced from OWASP LLM06:2025 Excessive Agency under Excessive Functionality). Additionally, agent:HelpdeskAgent on task:ResetStudentPasswords violates policy:NoBulkDataExportPolicy, which implements control:OWASP_LLM06-ExcessivePermissions (sourced from OWASP LLM06:2025 Excessive Agency under Excessive Permissions).
- **Deterministic KG template summary:** agent:HelpdeskAgent on task:ResetStudentPasswords violates policy:NoBulkDataExportPolicy (implements control:OWASP_LLM06-ExcessiveFunctionality / OWASP LLM06:2025 Excessive Agency Excessive Functionality); agent:HelpdeskAgent on task:ResetStudentPasswords violates policy:NoBulkDataExportPolicy (implements control:OWASP_LLM06-ExcessivePermissions / OWASP LLM06:2025 Excessive Agency Excessive Permissions)

### 1. Explicit Knowledge (Directly Stored in KG)
- `[Synthetic_Fact]` `agent:HelpdeskAgent orca:assignedTask task:ResetStudentPasswords`
- `[Synthetic_Fact]` `agent:HelpdeskAgent orca:hasRole role:ITSupportRole`
- `[Synthetic_Fact]` `agent:HelpdeskAgent orca:supervisedBy user:LeilaHartmann`
- `[Synthetic_Fact]` `agent:HelpdeskAgent orca:usesTool tool:PasswordResetTool`
- `[Synthetic_Fact]` `agent:HelpdeskAgent rdf:type orca:AIAgent`
- `[Synthetic_Fact]` `agent:HelpdeskAgent rdfs:label Helpdesk Agent`
- `[Unlabelled]` `orca:AIAgent rdfs:subClassOf orca:PermissionHolder`
- `[Unlabelled]` `orca:isAssignedTo owl:inverseOf orca:assignedTask`
- `[Synthetic_Fact]` `perm:ExportStudentData orca:accessesResource resource:StudentRecordsDB`
- `[Synthetic_Fact]` `policy:NoBulkDataExportPolicy orca:implementsControl control:OWASP_LLM06-ExcessiveFunctionality`
- `[Synthetic_Fact]` `policy:NoBulkDataExportPolicy orca:implementsControl control:OWASP_LLM06-ExcessivePermissions`
- `[Synthetic_Fact]` `policy:NoBulkDataExportPolicy orca:prohibitsPermission perm:ExportStudentData`

### 2. Inferred Knowledge (Schema Axioms / ORCA Rules A-E)
- `[Inferred_Fact via ORCA-C]` `agent:HelpdeskAgent orca:canReachSensitiveData category:AcademicRecord` <- `(agent:HelpdeskAgent orca:hasAvailablePermission perm:ExportStudentData; perm:ExportStudentData orca:accessesResource resource:StudentRecordsDB; resource:StudentRecordsDB orca:containsSensitiveData category:AcademicRecord)`
- `[Inferred_Fact via ORCA-C]` `agent:HelpdeskAgent orca:canReachSensitiveData category:StudentPII` <- `(agent:HelpdeskAgent orca:hasAvailablePermission perm:ExportStudentData; perm:ExportStudentData orca:accessesResource resource:StudentRecordsDB; resource:StudentRecordsDB orca:containsSensitiveData category:StudentPII)`
- `[Inferred_Fact via ORCA-B]` `agent:HelpdeskAgent orca:hasAvailablePermission perm:ExportStudentData` <- `(agent:HelpdeskAgent orca:hasRole role:ITSupportRole; role:ITSupportRole orca:hasPermission perm:ExportStudentData)`
- `[Inferred_Fact via ORCA-A]` `agent:HelpdeskAgent orca:hasAvailablePermission perm:ResetPassword` <- `(agent:HelpdeskAgent orca:usesTool tool:PasswordResetTool; tool:PasswordResetTool orca:hasPermission perm:ResetPassword)`
- `[Inferred_Fact via ORCA-B]` `agent:HelpdeskAgent orca:hasAvailablePermission perm:ResetPassword` <- `(agent:HelpdeskAgent orca:hasRole role:ITSupportRole; role:ITSupportRole orca:hasPermission perm:ResetPassword)`
- `[Inferred_Fact via ORCA-D]` `agent:HelpdeskAgent orca:hasExcessivePermission perm:ExportStudentData` <- `(agent:HelpdeskAgent orca:hasAvailablePermission perm:ExportStudentData)`
- `[Inferred_Fact via ORCA-E]` `agent:HelpdeskAgent orca:violatesPolicy policy:NoBulkDataExportPolicy` <- `(agent:HelpdeskAgent orca:assignedTask task:ResetStudentPasswords; agent:HelpdeskAgent orca:hasAvailablePermission perm:ExportStudentData; policy:NoBulkDataExportPolicy orca:prohibitsPermission perm:ExportStudentData; task:ResetStudentPasswords orca:governedByPolicy policy:NoBulkDataExportPolicy)`
- `[Inferred_Fact via rdfs:subClassOf]` `agent:HelpdeskAgent rdf:type orca:PermissionHolder` <- `(agent:HelpdeskAgent rdf:type orca:AIAgent; orca:AIAgent rdfs:subClassOf orca:PermissionHolder)`
- `[Inferred_Fact via owl:inverseOf]` `task:ResetStudentPasswords orca:isAssignedTo agent:HelpdeskAgent` <- `(agent:HelpdeskAgent orca:assignedTask task:ResetStudentPasswords; orca:isAssignedTo owl:inverseOf orca:assignedTask)`

### 3. Multi-Hop Access Paths
- None.

## Trace-3: Hybrid Symbolic + Embedding Reasoning (TimetableAssistant Missing Permission & Predicted Link)

- **User question:** Which AI agents lack required permissions, and what missing tools or permissions are predicted?
- **Detected intent:** `missing_permissions` | **Sufficient evidence:** `True`
- **Generated text (LLM response):** Based on the verified context, agent:AdmissionsReviewAgent lacks the required permission perm:ReadApplicantDocuments for task:ReviewApplications, and agent:TimetableAssistant lacks perm:WriteExamTimetable for task:PublishExamTimetable. Additionally, there are unverified predictions indicating that agent:AdmissionsReviewAgent might use tool:EmailTool or tool:RubricTool, while agent:TimetableAssistant might use tool:StudentRecordsTool or tool:ExamTimetableTool.
- **Deterministic KG template summary:** Agents lacking required permissions: agent:AdmissionsReviewAgent (task task:ReviewApplications) lacks perm:ReadApplicantDocuments; agent:TimetableAssistant (task task:PublishExamTimetable) lacks perm:WriteExamTimetable.

### 1. Explicit Knowledge (Directly Stored in KG)
- `[Synthetic_Fact]` `agent:AdmissionsReviewAgent orca:assignedTask task:ReviewApplications`
- `[Synthetic_Fact]` `agent:AdmissionsReviewAgent orca:supervisedBy user:TomasSilva`
- `[Synthetic_Fact]` `agent:AdmissionsReviewAgent orca:usesTool tool:FinanceLedgerTool`
- `[Synthetic_Fact]` `agent:AdmissionsReviewAgent rdf:type orca:AIAgent`
- `[Synthetic_Fact]` `agent:AdmissionsReviewAgent rdfs:label Admissions Review Agent`
- `[Synthetic_Fact]` `agent:TimetableAssistant orca:assignedTask task:PublishExamTimetable`
- `[Synthetic_Fact]` `agent:TimetableAssistant orca:supervisedBy user:TomasSilva`
- `[Synthetic_Fact]` `agent:TimetableAssistant orca:usesTool tool:CourseCatalogTool`
- `[Synthetic_Fact]` `agent:TimetableAssistant rdf:type orca:AIAgent`
- `[Synthetic_Fact]` `agent:TimetableAssistant rdfs:label Timetable Assistant`
- `[Unlabelled]` `orca:AIAgent rdfs:subClassOf orca:PermissionHolder`
- `[Unlabelled]` `orca:isAssignedTo owl:inverseOf orca:assignedTask`

### 2. Inferred Knowledge (Schema Axioms / ORCA Rules A-E)
- `[Inferred_Fact via ORCA-C]` `agent:AdmissionsReviewAgent orca:canReachSensitiveData category:FinancialRecord` <- `(agent:AdmissionsReviewAgent orca:hasAvailablePermission perm:ReadFeeBalances; perm:ReadFeeBalances orca:accessesResource resource:FinanceLedgerDB; resource:FinanceLedgerDB orca:containsSensitiveData category:FinancialRecord)`
- `[Inferred_Fact via ORCA-A]` `agent:AdmissionsReviewAgent orca:hasAvailablePermission perm:ReadFeeBalances` <- `(agent:AdmissionsReviewAgent orca:usesTool tool:FinanceLedgerTool; tool:FinanceLedgerTool orca:hasPermission perm:ReadFeeBalances)`
- `[Inferred_Fact via ORCA-D]` `agent:AdmissionsReviewAgent orca:hasExcessivePermission perm:ReadFeeBalances` <- `(agent:AdmissionsReviewAgent orca:hasAvailablePermission perm:ReadFeeBalances)`
- `[Inferred_Fact via rdfs:subClassOf]` `agent:AdmissionsReviewAgent rdf:type orca:PermissionHolder` <- `(agent:AdmissionsReviewAgent rdf:type orca:AIAgent; orca:AIAgent rdfs:subClassOf orca:PermissionHolder)`
- `[Inferred_Fact via ORCA-A]` `agent:TimetableAssistant orca:hasAvailablePermission perm:ReadCourseCatalog` <- `(agent:TimetableAssistant orca:usesTool tool:CourseCatalogTool; tool:CourseCatalogTool orca:hasPermission perm:ReadCourseCatalog)`
- `[Inferred_Fact via rdfs:subClassOf]` `agent:TimetableAssistant rdf:type orca:PermissionHolder` <- `(agent:TimetableAssistant rdf:type orca:AIAgent; orca:AIAgent rdfs:subClassOf orca:PermissionHolder)`
- `[Inferred_Fact via owl:inverseOf]` `task:PublishExamTimetable orca:isAssignedTo agent:TimetableAssistant` <- `(agent:TimetableAssistant orca:assignedTask task:PublishExamTimetable; orca:isAssignedTo owl:inverseOf orca:assignedTask)`
- `[Inferred_Fact via owl:inverseOf]` `task:ReviewApplications orca:isAssignedTo agent:AdmissionsReviewAgent` <- `(agent:AdmissionsReviewAgent orca:assignedTask task:ReviewApplications; orca:isAssignedTo owl:inverseOf orca:assignedTask)`

### 3. Multi-Hop Access Paths
- None.

### 4. Predicted Links (Unverified KG Embedding Predictions — NOT Confirmed Facts)
- `[Predicted_Link | verified=False | TransE conf=0.1093]` `(agent:AdmissionsReviewAgent, orca:usesTool, tool:EmailTool)` -> `EXCESSIVE_EXPOSURE`: Introduces excessive permission(s) [perm:SendStudentEmail] (ORCA-D) or new sensitive data exposure (ORCA-C).
- `[Predicted_Link | verified=False | TransE conf=0.1024]` `(agent:AdmissionsReviewAgent, orca:usesTool, tool:RubricTool)` -> `EXCESSIVE_EXPOSURE`: Introduces excessive permission(s) [perm:ReadMarkingRubrics] (ORCA-D) or new sensitive data exposure (ORCA-C).
- `[Predicted_Link | verified=False | TransE conf=0.1168]` `(agent:TimetableAssistant, orca:usesTool, tool:StudentRecordsTool)` -> `EXCESSIVE_EXPOSURE`: Introduces excessive permission(s) [perm:ReadStudentContactInfo, perm:ReadStudentGrades, perm:WriteStudentGrades] (ORCA-D) or new sensitive data exposure (ORCA-C).
- `[Predicted_Link | verified=False | TransE conf=0.1165]` `(agent:TimetableAssistant, orca:usesTool, tool:ExamTimetableTool)` -> `REMEDIATION_WITH_EXCESS`: Restores [perm:WriteExamTimetable] for agent:TimetableAssistant (NOT_AUTHORIZED -> AUTHORIZED), but also introduces excessive permission(s) [perm:ReadExamTimetable] via ORCA-D.

## Trace-4: Insufficient Evidence Refusal (Out-of-KG Query on PayrollDatabase)

- **User question:** Which AI agent has permission to read PayrollDatabase and who supervises it?
- **Detected intent:** `insufficient_evidence` | **Sufficient evidence:** `False`
- **Generated text (LLM response):** Refusing to answer as there is insufficient evidence in the ORCA knowledge graph. The requested information regarding which AI agent has permission to read PayrollDatabase and who supervises it is missing from the database, specifically regarding the unknown reference `PayrollDatabase`.
- **Deterministic KG template summary:** Insufficient evidence in the ORCA knowledge graph to answer this question fully. The queried entity/topic (PayrollDatabase) is NOT present in the ORCA knowledge graph. No facts outside the graph will be fabricated.

### 1. Explicit Knowledge (Directly Stored in KG)
- None (no matching facts in the ORCA KG).

### 2. Inferred Knowledge (Schema Axioms / ORCA Rules A-E)
- None triggered.

### 3. Multi-Hop Access Paths
- None.

