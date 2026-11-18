# Mimex

**Turn a short workflow video into a reusable Codex skill.**

Mimex lets a user upload an existing screen recording or record a workflow directly in the browser. OpenAI analyzes the narration and visual sequence, proposes the workflow objective for human review, and generates a downloadable `SKILL.md` that Codex can use to reproduce the demonstrated task with new inputs.

The project was designed and built collectively by the **Mimex team** for the OpenAI Build Hackathon. It is self-hosted on Netlify and does not require a third-party marketplace account, a dedicated VPS, PostgreSQL, or a separate authentication provider.

## Table of contents

- [Product overview](#product-overview)
- [Core features](#core-features)
- [End-to-end workflow](#end-to-end-workflow)
- [Architecture](#architecture)
- [Repository structure](#repository-structure)
- [Requirements](#requirements)
- [Local development](#local-development)
- [Netlify deployment](#netlify-deployment)
- [Configuration](#configuration)
- [API and processing lifecycle](#api-and-processing-lifecycle)
- [Using a generated skill with Codex](#using-a-generated-skill-with-codex)
- [Demo scenario](#demo-scenario)
- [Testing and quality checks](#testing-and-quality-checks)
- [Security and privacy](#security-and-privacy)
- [Current scope and limitations](#current-scope-and-limitations)
- [Troubleshooting](#troubleshooting)
- [Team](#team)

## Product overview

Traditional workflow automation requires users to describe every step, field, and expected result manually. Mimex uses a short demonstration as the source material instead:

1. A user records or uploads a workflow video.
2. Mimex extracts screenshots and audio with FFmpeg.
3. OpenAI transcribes the narration and analyzes the visual sequence.
4. Mimex proposes a concise workflow objective.
5. The user validates or edits that objective.
6. Mimex generates a structured, reusable Codex skill.
7. The skill can be downloaded, refined, composed with other skills, and given to Codex for execution.

The human validation step is deliberate: Mimex does not silently decide the final purpose of the workflow. The generated skill is based on the objective explicitly approved by the user.

## Core features

### Video capture and import

- Upload MP4, MOV, WebM, or MKV videos up to 200 MB.
- Record a browser tab, application window, or screen from Chrome or Edge.
- Preview the selected recording before processing it.
- Upload media in 4 MB chunks to remain compatible with serverless request limits.

### AI-assisted understanding

- Extract visual frames and the audio track with FFmpeg.
- Transcribe spoken explanations with the OpenAI Audio API.
- Analyze ordered screenshots and narration with the OpenAI Responses API.
- Treat visible or spoken instructions as untrusted source material, not as instructions to the model.
- Propose an objective, summary, ordered actions, uncertainties, and confidence score.
- Require user validation before generating the final skill.
- Resume objective validation from the library after closing or reloading the page.

### Skill generation and management

- Generate a complete Markdown skill with YAML frontmatter.
- Include the objective, authorized target, required inputs, ordered procedure, success criteria, and failure guidance.
- Preview, copy, or download the generated Markdown from the library.
- Copy a ready-to-use handoff instruction for Codex.
- Store generated skills persistently in Netlify Blobs.
- Change a skill’s display name independently of its Codex identifier, refine it with AI, or delete it.
- Compose two to eight skills into a parent skill, with controls to adjust their execution order before generation.

### Included demonstration environment

- Use the built-in fictional CRM as a stable workflow target.
- Create and reset fictional customer records.
- Demonstrate the complete video-to-skill-to-replay loop without real customer data or external side effects.

## End-to-end workflow

```text
Screen recording or uploaded video
                |
                v
Chunked upload to Netlify Functions
                |
                v
Temporary media storage in Netlify Blobs
                |
                v
Background FFmpeg processing
        |               |
        v               v
     Audio          Screenshots
        |               |
        +-------+-------+
                |
                v
OpenAI transcription and visual analysis
                |
                v
Proposed workflow objective
                |
                v
Human review and validation
                |
                v
Generated SKILL.md
        |               |
        v               v
Netlify library     Download for Codex
```

## Architecture

Mimex is a pnpm monorepo with a React frontend, a local Fastify development API, reusable video and skill packages, and a Netlify-native production backend.

### Frontend

- **React 19** for the application interface.
- **Vite** for development and production builds.
- Browser `MediaRecorder` and screen-capture APIs for live recording.
- A chunked upload client with progress reporting.
- Polling for asynchronous analysis and generation states.
- Views for the demo CRM, skill creation, library management, and composition.

### Production backend

- **Netlify Functions** expose upload, run, library, refinement, composition, and download operations.
- A **Netlify background function** performs long-running media and OpenAI processing.
- **Netlify Blobs** stores upload chunks temporarily and skill records persistently.
- **FFmpeg Static** extracts audio and ordered screenshots in the function runtime.
- The **OpenAI API** provides transcription, multimodal analysis, and schema-constrained responses.

### Local backend

- **Fastify** provides the local video-to-objective-to-skill workflow.
- The local compiler can also be invoked from the command line or through the included MCP server.
- FFmpeg and FFprobe are expected on the local machine unless explicit binary paths are configured.

### Processing states

A production run moves through the following states:

```text
uploading -> analyzing -> awaiting_goal -> generating -> succeeded
                                                   `-> failed
```

The frontend polls the run resource until it reaches the next user-visible state. Failed runs retain a readable error so the interface can explain what must be corrected.

## Repository structure

```text
mimex/
|-- apps/
|   `-- demo-crm/                  React, Vite, recorder, studio, and CRM
|-- netlify/
|   `-- functions/
|       |-- api.mts                Public HTTP API and data operations
|       |-- process-background.mts FFmpeg and OpenAI background worker
|       `-- lib/
|           |-- openai.mts         OpenAI prompts and structured outputs
|           `-- store.mts          Netlify Blobs persistence layer
|-- packages/
|   |-- mimex-api/                 Local HTTP API, CLI, and MCP server
|   |-- skill-compiler/            Skill schemas, prompts, rendering, and linting
|   `-- video-pipeline/            Local FFmpeg and FFprobe processing
|-- fixtures/videos/               Local demonstration videos
|-- MVP.md                         Current product scope and demo definition
|-- netlify.toml                   Netlify build, functions, and redirects
|-- pnpm-workspace.yaml            Workspace configuration
`-- package.json                   Root scripts and shared tooling
```

## Requirements

### Required for all environments

- Node.js 20 or newer
- Corepack
- pnpm 10.13.1 or a compatible version
- An OpenAI API key with access to the configured models

### Additional local requirements

- FFmpeg available in `PATH`
- FFprobe available in `PATH`
- Chrome or Edge for browser-based screen recording

The Netlify deployment packages its own Linux FFmpeg binary, so FFmpeg does not need to be installed manually on the Netlify runtime.

## Local development

### 1. Install dependencies

```powershell
corepack pnpm install
```

### 2. Create the local environment file

```powershell
Copy-Item .env.example .env
```

Set at least:

```text
OPENAI_API_KEY=your_new_server_side_key
```

### 3. Start the frontend and local API

```powershell
corepack pnpm dev
```

Open:

- Application: `http://localhost:3000`
- Local API: `http://127.0.0.1:8787`
- Health endpoint: `http://127.0.0.1:8787/api/health`

Vite forwards `/api` requests to the local Fastify server during this development mode.

### Run services separately

```powershell
corepack pnpm dev:crm
corepack pnpm dev:api
```

The optional MCP server can be started with:

```powershell
corepack pnpm dev:mcp
```

### Test the Netlify runtime locally

To exercise Netlify Blobs, background functions, the persistent library, AI refinement, and skill composition locally, use Netlify Dev:

```powershell
npx --yes netlify-cli@latest dev --offline
```

## Netlify deployment

### Deploy from GitHub

1. Sign in to Netlify and select **Add new site**.
2. Choose **Import an existing project**.
3. Connect the GitHub repository containing Mimex.
4. Select the `main` branch.
5. Keep the configuration from `netlify.toml`:
   - Build command: `corepack pnpm build:netlify`
   - Publish directory: `apps/demo-crm/dist`
   - Functions directory: `netlify/functions`
6. Add `OPENAI_API_KEY` under **Site configuration -> Environment variables**.
7. Trigger the first deployment.

Netlify creates the Blob stores on first use. No database migration or external storage provisioning is required.

### Verify the deployment

After the site is live:

1. Open `/api/health` on the deployed domain.
2. Confirm that the response reports `ok: true` and `storage: "netlify-blobs"`.
3. Upload a short non-sensitive test video.
4. Validate the proposed objective.
5. Confirm that the generated skill appears in the library.
6. Download the Markdown file and inspect its frontmatter and procedure.

## Configuration

### Production variables

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `OPENAI_API_KEY` | Yes | None | Server-side OpenAI authentication |
| `OPENAI_VISION_MODEL` | No | `gpt-5.4-mini` | Visual analysis and skill generation model |
| `OPENAI_TRANSCRIBE_MODEL` | No | `whisper-1` | Audio transcription model |
| `OPENAI_COMPOSE_MODEL` | No | `gpt-5.4-mini` | Parent-skill composition model |

### Local variables

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `MIMEX_VISION_MODEL` | No | `gpt-5.4-mini` | Local visual analysis model |
| `MIMEX_TRANSCRIBE_MODEL` | No | `whisper-1` | Local transcription model |
| `MIMEX_FFMPEG_PATH` | No | `ffmpeg` | Local FFmpeg executable |
| `MIMEX_FFPROBE_PATH` | No | `ffprobe` | Local FFprobe executable |
| `MIMEX_KEEP_ARTIFACTS` | No | `0` | Keep extracted media for debugging when set to `1` |
| `MIMEX_MOCK` | No | `0` | Use deterministic mock generation when set to `1` |
| `MIMEX_API_HOST` | No | `127.0.0.1` | Local API bind address |
| `MIMEX_API_PORT` | No | `8787` | Local API port |

Never expose `OPENAI_API_KEY` through a `VITE_*` variable. Vite variables are embedded into the browser bundle.

## API and processing lifecycle

The production frontend uses the following logical API operations.

### Health

```http
GET /api/health
```

Reports API availability, OpenAI configuration status, and the active storage implementation.

### Create a chunked upload

```http
POST /api/uploads
Content-Type: application/json

{
  "filename": "workflow.webm",
  "contentType": "video/webm",
  "size": 7340032,
  "chunkCount": 2
}
```

The client then sends each binary chunk to:

```http
PUT /api/uploads/:uploadId/:chunkIndex
```

When all chunks are present:

```http
POST /api/uploads/:uploadId/complete
```

This creates the run and starts objective analysis in the background.

### Inspect runs

```http
GET /api/runs
GET /api/runs/:runId
```

The list endpoint powers the shared skill library. The detail endpoint is used for processing-state polling.

### Validate the objective and generate the skill

```http
POST /api/runs/:runId/generate
Content-Type: application/json

{
  "goal": "Create a new customer record in the demonstration CRM",
  "appName": "Mimex Demo CRM",
  "startUrl": "https://example.netlify.app"
}
```

### Manage a generated skill

```http
GET    /api/runs/:runId/skill.md
PATCH  /api/runs/:runId
POST   /api/runs/:runId/refine
DELETE /api/runs/:runId
```

Send `{ "displayName": "Customer onboarding" }` in a `PATCH` request to update the name shown in the library and composition picker. The Markdown content and Codex identifier stay the same.

### Compose skills

```http
POST /api/compose
Content-Type: application/json

{
  "runIds": ["first-run-id", "second-run-id"],
  "name": "customer-onboarding",
  "goal": "Create a customer and prepare the follow-up workflow"
}
```

Composition accepts between two and eight completed skills. Child order is preserved in the parent skill.

### Data lifecycle

1. Upload chunks are stored in the `mimex-media` Blob store.
2. Run metadata is stored in the strongly consistent `mimex-runs` Blob store.
3. The background function rebuilds the source video in temporary function storage.
4. FFmpeg extracts audio and screenshots.
5. OpenAI produces the proposal or final skill.
6. Temporary function files are removed.
7. Uploaded Blob chunks are deleted after successful skill generation.
8. The run record and generated Markdown remain available in the skill library.

## Using a generated skill with Codex

1. Generate and download the skill from Mimex.
2. Give the downloaded Markdown file to Codex.
3. Ask Codex to install or use it as the named skill.
4. Provide values for every required input.
5. Ask Codex to execute the procedure only in the authorized target application.
6. Require visual confirmation of the success criteria.

Example handoff:

```text
Install the SKILL.md downloaded from Mimex as $create-customer.
Ask me for every required input, execute it only in the authorized CRM,
and visually confirm each success criterion before reporting completion.
```

The generated skill is an instruction artifact, not an automatic remote-control connection. Codex still requires an appropriate browser or computer-use capability to interact with the target application.

## Demo scenario

The recommended hackathon demonstration uses a 15-second recording of the included CRM.

1. Open the **Demo CRM** view.
2. Start a screen recording.
3. Create a fictional customer with a name, company, and priority.
4. Stop the recording and select the resulting WebM file.
5. Start the Mimex analysis.
6. Review and validate the objective proposed by OpenAI.
7. Generate and download the skill.
8. Give the skill to Codex.
9. Ask Codex to repeat the workflow with a different fictional customer.
10. Verify that the new record appears in the CRM with the requested values.

This demonstrates that Mimex generalized the procedure rather than hard-coding the example values shown in the video.

## Testing and quality checks

Install dependencies before running the checks:

```powershell
corepack pnpm install
```

### Full production build

```powershell
corepack pnpm build
```

### Netlify frontend build

```powershell
corepack pnpm build:netlify
```

### Type checking

```powershell
corepack pnpm typecheck
```

### Unit tests

```powershell
corepack pnpm test
```

### Local CLI compilation

```powershell
corepack pnpm mimex:compile -- --video fixtures/videos/create-customer.mp4 --goal "Create a customer record" --url http://localhost:3000
```

## Security and privacy

- Keep the OpenAI API key exclusively in server-side environment variables.
- Never commit `.env` files or place secrets in `VITE_*` variables.
- Rotate any API key that has appeared in a chat, screenshot, log, or Git history.
- Use fictional or sanitized data in demonstration recordings.
- Do not record passwords, tokens, private customer data, financial information, or regulated data.
- Treat video text and narration as untrusted source content during model analysis.
- Do not let a generated skill expand its target beyond the application and URL approved by the user.
- Require confirmation before irreversible or externally visible actions.
- Stop execution when the observed interface contradicts the generated procedure.
- Remove temporary video data after processing; keep only the generated skill and run metadata needed by the library.

## Current scope and limitations

Mimex is currently optimized for short, single-workflow demonstrations and hackathon evaluation.

- The deployed library is shared because the current MVP does not include user authentication or workspace isolation.
- Anyone with access to the deployed site may be able to submit processing requests and consume the configured OpenAI quota.
- The application does not yet provide rate limiting, moderation queues, audit logs, or per-user billing.
- Videos should show one coherent workflow in one primary application.
- Recording quality, unreadable text, missing final states, or incomplete demonstrations can reduce output quality.
- A generated skill must still be reviewed before it is used for sensitive or production operations.
- Interface changes in the target application can make an older skill inaccurate.

For a public production deployment, add authentication, authorization, rate limiting, usage quotas, per-user Blob prefixes, and an explicit retention policy before accepting real user content.

## Troubleshooting

### `Failed to fetch`

- Confirm that both the frontend and local API are running in local development.
- Open `http://127.0.0.1:8787/api/health` and verify that it returns JSON.
- On Netlify, open `/api/health` on the deployed domain.
- Check the browser network panel and Netlify Function logs for the failing endpoint.

### `OPENAI_API_KEY` is not configured

- Add the key to `.env` for local development.
- Add the key in Netlify environment variables for production.
- Restart the local process or trigger a new Netlify deployment after changing it.
- Do not reuse a key that was previously exposed publicly.

### FFmpeg is unavailable locally

- Install FFmpeg and FFprobe and ensure both commands are available in `PATH`.
- Alternatively, set `MIMEX_FFMPEG_PATH` and `MIMEX_FFPROBE_PATH` to explicit executable paths.

### A run remains in progress

- Check the Netlify background-function logs.
- Confirm that `process-background` was deployed as a background function.
- Verify that the FFmpeg binary is included in the deployed function bundle.
- Confirm that the selected OpenAI models are available to the configured API project.

### The generated skill is incomplete

- Use a clearer recording with a visible start and final state.
- Narrate the intent and important decisions while recording.
- Avoid very fast cursor movement or hidden dropdown selections.
- Correct the proposed objective before generation.
- Use **Refine with AI** to request a precise revision without changing unsupported facts.

## Team

Mimex is designed, developed, and presented collectively by the **Mimex team**. Product direction, UX, OpenAI integration, the Codex workflow, and the Netlify architecture are team-owned contributions and are not attributed to a single individual.

## Responsible demo data

The included CRM contains fictional records only. Do not upload recordings containing real credentials, confidential business processes, personal data, or other sensitive information.
