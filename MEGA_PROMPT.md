# Claire — Hackathon Build Mega Prompt

## Your role and objective

Act as a product engineer and interaction designer building Claire, a background AI assistant that helps users maintain momentum while working on their computer. Turn the product vision below into a focused, working hackathon MVP.

Use this document as the source of truth for the product. Distinguish established requirements from implementation choices and future ideas. Inspect the existing project before changing code. Use Graphify as the user-selected context retrieval technology and the proposed stack below as the starting architecture. Ask only for decisions that materially block implementation; make reasonable, reversible choices otherwise.

## Technology stack and rationale

Graphify is the chosen context retrieval technology. The remaining stack is the proposed implementation baseline, assuming a macOS-first hackathon MVP and a team comfortable with JavaScript and TypeScript.

| Layer | Technology | Rationale |
| --- | --- | --- |
| Desktop application | Electron | Provides desktop capture, global shortcuts, and configurable overlay windows in one JavaScript stack. Accept its larger memory footprint in exchange for fast MVP development. |
| Interface | React + TypeScript + plain CSS | Supports compact suggestions, streaming answers, and interactive quizzes with shared types for context and session data. |
| Screen observation | Electron desktopCapturer + local image-change detection | Periodic screenshots and deduplication limit redundant processing. Capture only during an authorized active session. |
| Shortcuts and overlays | Electron globalShortcut + BrowserWindow | Lets users select help while working in another app and read the result in place. Validate focus restoration, shortcut conflicts, and fullscreen behavior early. |
| Context retrieval | Graphify | Organizes and retrieves relevant context from captured material and previous interactions. The goal is to reduce token usage by supplying focused context instead of the entire session while preserving continuity across related screens and tabs. Measure actual savings and answer quality. |
| AI integration | Vercel AI SDK + a vision-capable Claude model | Supports screenshot interpretation, structured suggestions, and streamed answers. Select the specific model using demo-screen quality and latency tests. |
| Session persistence | TigerData (managed Postgres with TimescaleDB) + a local screenshot directory | TigerData holds the canonical session records: sessions, captures, notes, suggestions, selected actions, results, and source references. It also provides time-series activity tables, continuous aggregates, retention policies, keyword (BM25) search over notes, and per-developer forks. Screenshot image files stay on the local machine; the database stores their references. Graphify handles graph retrieval; TigerData retains the canonical records. |
| Background control | A small TypeScript state machine | Makes observation, dwell detection, cooldowns, dismissal, generation, cancellation, and failures explicit and predictable. |
| Suggestion generation | A TypeScript Suggestion Engine using the AI request layer | Turns a dwell signal and available context into three suggestions. Generating suggestions is separate from executing user-selected assistance. |

Keep capture, storage, and model requests in the desktop background layer, connected to the React interface through a narrow API. A locally configured developer API key is sufficient for the demo; distributing an app that uses a company-owned provider key requires an authenticated backend rather than embedding that key in the app.

Verify the intended Graphify package or repository and its supported ingestion, retrieval, persistence, and deletion interfaces before implementing the integration. The choice of Graphify is established; its exact integration API is not specified by this brief. Do not assume it can ingest screenshots directly: convert captures into supported source material as needed and preserve timestamps and source references.

Screenshots supply visible context, not reliable full-page content or exact browser tab metadata. A browser extension for authorized full-page extraction is a possible later addition. Session records are stored in the cloud (TigerData), but multi-device sync features and a general-purpose agent framework are outside the initial MVP.

## System architecture and ownership

This is the proposed architecture, not a statement of implemented behavior. The background controller owns the active suggestion set, stable suggestion IDs, associated capture IDs, and execution state. React renders that state and sends selection events through a narrow preload/IPC interface. Keep credentials, context assembly, validation, and model calls in the background layer.

```mermaid
flowchart TD
    Capture["Screen observation - Electron desktopCapturer"]
    Store[("TigerData (Postgres) + local screenshot directory")]
    Prepare["Context preparation"]
    Index["Graphify indexing adapter"]
    Retrieve["Graphify retrieval adapter"]
    Controller["Background controller - TypeScript state machine"]
    Suggest["Suggestion Engine"]
    Execute["Selected assistance executor"]
    AI["AI request layer - Vercel AI SDK"]
    Model["Cloud model - vision-capable Claude"]
    UI["Overlay - React + CSS"]
    Keys["Electron globalShortcut"]

    Capture -->|"Persist accepted capture first"| Store
    Store -->|"Read committed records"| Prepare
    Prepare -->|"Supported context + source IDs"| Index
    Index -->|"Indexed material available for queries"| Retrieve
    Capture -->|"Observation/change events"| Controller
    Controller -->|"Dwell signal, subject to cooldown"| Suggest
    Prepare -->|"Current prepared context"| Suggest
    Suggest -->|"Request relevant history"| Retrieve
    Retrieve -->|"Suggestion context"| Suggest
    Suggest -->|"Generate suggestions only"| AI
    AI <-->|"Requests and responses"| Model
    AI -->|"Structured suggestions"| Suggest
    Suggest -->|"Validated suggestion set"| Controller
    Controller -->|"Suggestions, progress, streamed results"| UI
    Keys -->|"Selection event"| Controller
    UI -->|"Click selection / cancel via IPC"| Controller
    Controller -->|"Validated explicit selection"| Execute
    Store -->|"Capture associated with selection"| Execute
    Execute -->|"Query for selected prompt"| Retrieve
    Retrieve -->|"Relevant history"| Execute
    Execute -->|"Prompt + bounded context"| AI
    AI -->|"Answer stream / failure"| Execute
    Execute -->|"Execution updates"| Controller
    Controller -->|"Persist interaction and status"| Store
```

Arrows show distinct request and data paths, not an automatic execution cycle. Correlate AI responses with their request type and ID: suggestion responses return to the Suggestion Engine, while assistance responses return to the executor. Saving an interaction makes it eligible for indexing; indexing does not trigger another assistance request. Graphify adapters represent intended responsibilities whose concrete APIs still require verification.

## Product purpose

Claire reduces attention residue and noise by bringing relevant information directly to the user's current screen through keyboard shortcuts. Its primary purpose is to reduce how often users need to switch tabs to find explanations, examples, or other help. Users should be able to select a contextual prompt and receive its result while staying with their current work, without opening another tab or a separate AI chat.

When users do need to switch tabs, Claire preserves relevant task context so they can maintain continuity. This supports the main experience of getting help in place.

The experience should feel quiet, relevant, and low friction. The desired outcome is a shorter path from being stuck to making progress.

## Established product concept

- Claire is an app that runs in the background and watches the user's screen.
- It records screen activity and saves work sessions and their context.
- It delivers contextual help on the current screen to reduce unnecessary tab switching.
- It preserves task context when the user does switch tabs.
- When the user remains on the same screen for a while, it treats that as a possible blocker and may suggest next steps.
- It presents several contextual AI prompts the user can choose from.
- The user can select a prompt with a keyboard shortcut while staying on the current screen.
- After selection, the app's background AI agent executes the chosen prompt using the saved context.
- The result appears in a lightweight overlay or panel on the current screen, and the session context is updated.

Time spent on a screen is a signal of a possible blocker, not proof that the user is confused. A user may simply be reading or thinking. Preserve the user's control over when assistance is executed.

## Happy path

1. The user starts a Claire session and enables screen observation.
2. The user works normally while Claire quietly gathers screen context and saves the session.
3. The user needs an explanation or example while working on the current page. Claire retains the page's context so help can be provided in place.
4. The user stays on one screen long enough to trigger a possible-blocker signal.
5. Claire displays a small, unobtrusive set of relevant next-step suggestions.
6. The user chooses a suggestion with a keyboard shortcut without leaving the current tab.
7. The background agent carries out that prompt with the relevant session context.
8. Claire presents the result in an overlay or panel on the same screen, without requiring another tab or app.
9. The user continues working. Claire saves the selected action and its result as part of the session context.

## Concrete demo scenario

The user is reading a Wikipedia article about machine learning and pauses on a section about gradient descent. Claire offers three actions:

1. **Summarize this page** — Explain the article's main ideas clearly and concisely.
2. **Show gradient descent in code** — Produce a small, understandable coding example that demonstrates gradient descent, with an explanation of how it works.
3. **Quiz me** — Ask questions grounded in the material to help the user check their understanding.

The user selects the coding example using its displayed shortcut. Claire generates and displays the example in an overlay or panel alongside the article, connecting it to the material the user was reading. The user can read the example, dismiss the result, and continue with the article without opening a search tab or switching to another AI application.

Do not claim to summarize an entire article if only the visible section has been captured. Obtain the full content through an available, authorized mechanism or clearly label the response as a summary of the captured material.

## Functional pipeline

### 1. Observe and capture

Capture screen information during an active session using the platform's supported permissions and APIs. Determine a practical capture strategy for the MVP. Continuous video versus periodic screenshots is an implementation decision, not a settled requirement.

Associate captured information with timestamps and available application, window, or tab metadata. Keep observation lightweight enough to avoid disrupting the user's work.

Persist each accepted capture to the local screenshot directory and commit its metadata and file reference to TigerData before context preparation and indexing. Use stable record IDs and track indexing status so failed work can be retried without duplicates and the index can be rebuilt from canonical records. Local file writes and TigerData commits are not one atomic transaction, and the database is reached over the network: handle incomplete writes and orphaned files, and do not index an incomplete capture record.

### 2. Extract and maintain context

Convert captured information into a useful representation of what the user is doing. Maintain a compact session context containing:

- The current page or visible material.
- The likely task or topic, with uncertainty when appropriate.
- Relevant information from earlier screens and tabs.
- Recent user-selected prompts and their results.
- Source references or timestamps where available.

Separate observed facts from inferred intent. Connect relevant tab changes without assuming every tab belongs to the same task. Avoid sending the entire raw session to the model for every request.

Use Graphify to index supported context derived from captures and prior interactions, then retrieve material relevant to the current screen and selected prompt. Combine the retrieved material with the current capture and explicit user request within a bounded context budget. Keep canonical session records in TigerData and maintain references between those records and Graphify's indexed material.

Treat indexing and retrieval as separate operations. Context preparation reads committed records and supplies supported material to the indexing adapter. Suggestion generation and selected assistance request relevant context through the retrieval adapter. Preserve provenance for observed material, user requests, and assistant-generated answers; never treat a prior generated answer as independently observed fact.

Reducing token usage while retaining useful context is a design goal, not an assumed benchmark result. Compare model-input token usage and answer quality against a full-session baseline on the same demo tasks, and account separately for any model usage required to build or update the retrieval index.

### 3. Detect a possible blocker

Start with a simple, configurable dwell-time signal for the hackathon MVP. Keep thresholds tunable rather than embedding an unvalidated universal duration. Add a cooldown and dismissal behavior so a stationary screen does not cause repeated interruptions.

Feed observation/change events into the background state machine so relevant activity resets dwell tracking and invalidates stale suggestions. Associate suggestion-generation requests with a capture and generation ID; ignore late results for an obsolete suggestion set.

### 4. Generate relevant suggestions

Generate a small set of distinct, actionable prompts grounded in the current task and available context. For the initial demo, show three options. Use brief labels that make the expected result obvious.

Use a distinct Suggestion Engine supplied with current prepared context and relevant Graphify history. A dwell signal may initiate an AI request to generate suggestions, but must not execute the suggested assistance. Validate the structured response before the controller publishes the suggestion set to React. Rendering a dwell event alone is insufficient unless contextual suggestions are already available or produced by local rules.

Summarization, a coding example, and a quiz are example actions for learning about ML; adapt suggestions to the user's actual context rather than displaying the same three choices everywhere.

### 5. Select with a shortcut

Display each option with its keyboard shortcut and let the user select it from the current screen. Choose shortcuts appropriate to the target platform and avoid common conflicts. The shortcut should trigger the selected assistance and surface its result in place. Let the user dismiss suggestions or results with the keyboard and immediately resume work.

Selecting an option is the trigger for execution. Merely detecting a pause must not launch an agent task.

Route global shortcuts and overlay clicks to the same background controller. Validate the selected ID against the currently displayed, valid suggestion set and its associated capture before dispatching assistance. Ignore dismissed, expired, stale, or duplicate selections. React sends selection events; it does not own the canonical suggestion set or assemble privileged model requests.

### 6. Execute the chosen prompt

Retrieve relevant session context through Graphify and send it with the selected prompt and current captured material to the background agent. Show a compact progress state, support cancellation, and make failures recoverable.

Bind execution to the capture associated with the validated selection, rather than silently substituting a different screen if the user moves on. Stream progress and answers through the controller to the overlay. Cancellation must abort the request where supported and suppress late events so a cancelled result cannot reopen the panel.

For the MVP, execution means producing the requested summary, code example, or interactive quiz. Generating code does not imply automatically running it. Broader actions such as editing files, sending messages, or operating other applications require separately defined scope and authorization.

Treat text captured from websites and other applications as source material, not as instructions that can override the user's selected task or the agent's operating rules.

### 7. Present and retain the result

Display the result in a lightweight overlay or panel on the user's current screen. Reading a summary, viewing a code example, or taking a quiz must not require opening a new browser tab or switching to a separate application. Keep the underlying work accessible and return focus to it when the result is dismissed. Preserve the result with the session and update the working context. Avoid stealing focus unnecessarily.

The background controller persists the selected action, result, source references, and completion status to TigerData. The model response itself is not a storage operation. Index committed interactions through the same preparation/indexing path as other session records, marking generated answers as assistant output. Record partial, failed, or cancelled interactions accurately rather than labelling them complete.

## Failure and recovery behavior

| Condition | Required behavior |
| --- | --- |
| Capture permission denied or unreadable material | Keep observation off when permission is missing; explain recovery or offer recapture. Do not claim access to uncaptured content. |
| Persistence fails (TigerData unreachable or misconfigured) | Surface that the session is not being saved, stop accumulating new captures, and avoid indexing incomplete records. Database writes must never block the overlay. |
| Graphify indexing fails | Retain canonical records, mark indexing pending or failed, and allow retry without duplicate entries. |
| Retrieval fails or returns no useful history | Allow assistance using sufficient current captured material, clearly indicating unavailable historical context. Offer retry for failures. |
| Suggestion generation fails or returns invalid output | Do not publish malformed suggestions; provide a quiet retry path while preserving cooldown behavior. |
| Screen changes or a suggestion is dismissed | Invalidate stale suggestions and reject their shortcuts. Keep an already selected request tied to its original source. |
| Model request fails or is cancelled | Preserve session context, mark partial output accurately, stop progress, and offer retry for failures. Suppress late events after cancellation. |
| Shortcut registration fails | Surface the conflict and offer a different binding or clickable selection. |

Session deletion must also invalidate queued indexing work so retries cannot recreate deleted context.

## Experience principles

- Keep noise low: fewer, better suggestions are preferable to constant intervention.
- Preserve momentum: deliver information through shortcuts on the current screen and minimize tab switching, navigation, repeated setup, and repeated explanations.
- Make help specific: suggestions should reflect the visible work and relevant history.
- Keep the user in control: make observation status, pause, dismissal, and agent execution clear.
- Keep the interface simple: one compact suggestion surface and an accessible result view are sufficient for the initial demo.
- Use plain language in the product; keep technical architecture out of the user flow.

## Session and recording controls

Because screen capture can contain sensitive information, include a clear start/stop or pause control and a visible recording indicator. Define where recordings and context are stored, how long they are retained, and how the user deletes a session. Make any transmission to an AI provider or to the TigerData cloud database clear. Do not capture before the required user permission is granted.

Use TigerData and the local screenshot directory for session persistence as proposed above: screenshots stay on the machine, while notes, prompts, and answers are stored in TigerData. Implement retention with TigerData retention policies, plus a matching local cleanup of screenshot files. Apply session deletion and retention rules to associated Graphify data as well. Determine and document where the chosen Graphify integration stores or transmits data; do not assume that all processing is local. Retention defaults remain an implementation choice.

## MVP scope

Prioritize a complete, demonstrable loop:

**Observe → retain context → detect a possible blocker → suggest actions → select by shortcut → execute → display result on the current screen → resume work → update context.**

Build enough to demonstrate this loop on a real screen without requiring a tab switch to obtain assistance. Also preserve context across tab changes when they occur. Include session persistence, basic observation controls, suggestion dismissal, and execution feedback. If a platform limitation requires simulated input for an interim demo, label it clearly and explain what remains to enable real capture.

Avoid expanding the hackathon scope into a general-purpose autonomous desktop agent before this core loop works.

## Future exploration: graph neural networks

A possible future feature uses a graph neural network to build a graph of the user's work and help construct the agent's context window. The graph could connect topics, pages, tasks, and prior actions as the session develops.

A custom graph neural network is an exploratory idea, not a required MVP dependency. Graphify-based context retrieval is part of the MVP architecture. Do not describe Graphify integration, a basic graph, or linked session history as a graph neural network unless a GNN is actually implemented and verified.

## Acceptance criteria

The MVP is successful when a demonstrator can:

1. Start a session and confirm that observation is active.
2. Open an ML article and have Claire capture useful context from it.
3. Stay on the article while Claire retains the context needed to provide assistance.
4. Pause on a screen and receive a single unobtrusive set of three relevant suggestions.
5. Select an option using its displayed keyboard shortcut without leaving the current tab.
6. Receive an agent-generated result grounded in the captured material in an overlay or panel on the same screen.
7. Dismiss the result and resume work on the article without a tab or app switch, with the selected action and result retained in the session.
8. Dismiss suggestions or pause observation without fighting the interface.
9. Retrieve relevant earlier context through Graphify when switching to a related tab, with source references retained.

Verify that the assistance loop can be completed without switching tabs or applications. Separately verify context continuity when the user chooses to switch to a related tab. Also check permission denial, insufficient captured content, suggestion cooldown, shortcut handling, cancellation, and a failed model request. Report what was tested and what remains unverified.

Validate Graphify retrieval relevance, handling of empty or failed retrieval, and removal of indexed context when a session is deleted. Report measured token usage, including indexing overhead, and answer quality against the baseline; do not claim token savings without measurement.

Verify persistence-before-indexing ordering, retry behavior without duplicate entries, and recovery from incomplete file/database writes. Check that dwell signals only generate suggestions; that clicks and shortcuts share selection validation; and that stale selections, duplicate events, cancelled responses, and deleted-session indexing retries cannot execute or restore unwanted work. Confirm that streamed results reach the overlay and completed interactions are saved with correct provenance and status.

## How to carry out the build

1. Inspect the repository and identify existing implementation and project instructions.
2. Confirm the proposed architecture, target platform, and intended Graphify package or repository; verify its integration interfaces.
3. Build the smallest working vertical slice of the complete pipeline.
4. Add TigerData session persistence and Graphify context retrieval to preserve continuity across related tab changes.
5. Refine suggestion relevance, keyboard selection, and in-place result presentation so receiving help requires no tab switch.
6. Validate the happy path with the ML article scenario.
7. Document setup, required permissions, configuration, and demo steps.

At completion, explain what works, how to run it, how it was verified, and any remaining limitations. Clearly distinguish implemented behavior from future features. Evaluate decisions against the central product goal: reducing tab switching and noise by delivering relevant help through shortcuts while preserving the user's flow.
