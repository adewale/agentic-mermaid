Diagram task eval. The request below is your complete task; do not use any product documentation beyond it.

Task ID: author_auth_flow_source
Task:
Create a new Auth Flow flowchart as Mermaid source, parse it, verify it, then return the source. Do not use mutate because there is no existing diagram to preserve.

Context:
Diagram these facts: User opens Login Page; invalid credentials return to Login Page; valid credentials check MFA; MFA users enter a code; invalid code returns to Enter MFA Code; valid code creates a session; users without MFA create a session; session leads to Dashboard.

Return your final Mermaid diagram source in a ```mermaid fence.
