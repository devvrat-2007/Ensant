# FlowZint Enterprise Sales Assistant

Welcome to the **FlowZint** repository. This is an advanced, production-ready AI sales assistant application designed to streamline enterprise workflows. It uses a modern Next.js frontend combined with a robust Django backend to provide RAG-enabled chat, asynchronous document processing, multimodal vision capabilities, and multi-provider model orchestration.

---

## 📖 Overview

FlowZint was built to solve the complexities of enterprise data retrieval and task generation. Instead of just chatting with a standard LLM, users can upload their corporate documents, perform deep semantic searches, execute specialized sales tasks (like drafting emails or battlecards), and sync data directly to a CRM. 

The system leverages **Google Gemini** as its primary reasoning engine while cascading securely to lightweight models during traffic spikes. It features an RLHF (Reinforcement Learning from Human Feedback) pipeline, allowing enterprise admins to review, rate, and export conversation logs for future fine-tuning.

---

## ✨ Core Features We Added (And How We Added Them)

1. **Enterprise Control Panel & Admin Dashboard:**
   - *How:* Built a secure `/admin` control pane in Next.js that displays real-time system health, API latency metrics, active session counts, and live streams of user interactions (`LogFeed.tsx`), allowing managers to oversee the AI's operations seamlessly.

2. **Multimodal Image Processing & Vision Path:**
   - *How:* Modified the chat endpoint (`views.py`) to accept inline `multipart/form-data`. When an image is uploaded, it bypasses standard text-RAG and routes directly to `VISION_MODEL` (`gemini-3.5-flash`) to analyze diagrams, charts, and visual text.

3. **Document Embedding & Ingestion:**
   - *How:* When users upload documents, a background Celery/Redis queue chunks the text and generates dense vectors using Google's embedding model. These embeddings are automatically stored into Pinecone without freezing the UI.

4. **Human Review Feature (RLHF Feedback):**
   - *How:* Implemented a comprehensive review feature via a `FeedbackBar.tsx` component. Users can submit thumbs-up/down signals, 5-star ratings, and written comments on any AI response to be reviewed by admins.

5. **Intelligent Query Routing:**
   - *How:* Implemented a zero-shot router in `views.py` that intercepts the prompt and determines whether the user needs document retrieval (INFO) or is asking for a direct generation task like an email (TASK).

6. **Advanced RAG (Retrieval-Augmented Generation) with Pinecone:**
   - *How:* Using `LangChain` and Pinecone, the backend embeds user queries via `gemini-embedding-2` and retrieves the top 15 most relevant chunks. We then added a **CrossEncoder** (`ms-marco-MiniLM-L-6-v2`) to rerank the chunks and provide the absolute best context to the LLM.

7. **Asynchronous Document Processing:**
   - *How:* Large document uploads freeze APIs. We added **Celery** and **Redis** to background the parsing, chunking, and vector embedding processes, providing task IDs to the frontend for real-time polling.

8. **Multi-Model Orchestration & Failover Cascading:**
   - *How:* Integrated the `safe_generate` wrapper. If the primary model (e.g., `gemini-3.5-flash`) throws a `429` (Rate Limit) or `503` (Overloaded), the system automatically intercepts the crash and cascades to a fallback model (`gemini-3.1-flash-lite`).

9. **Server-Sent Events (SSE) Streaming:**
   - *How:* Instead of waiting for a 15-second generation, the Django backend uses `StreamingHttpResponse` to yield text chunks immediately to the Next.js UI, ensuring a snappy, typing-effect experience.

10. **RLHF Feedback Pipeline (Database & Export):**
    - *How:* Added thumbs-up/down, 5-star ratings, and custom comment fields to the `AuditLog` database model. Created a dedicated Admin dashboard UI to review these logs and a Django management command to export them as JSONL for fine-tuning.

11. **Live Web Search Fallback:**
    - *How:* If the local Pinecone vector database yields zero matching chunks, the system can fallback to a live DuckDuckGo web search to synthesize real-time data from the internet.

12. **CRM Synchronization:**
    - *How:* Added a dedicated `CrmSyncButton.tsx` in the frontend that triggers an API call allowing sales representatives to automatically sync selected chat transcripts directly into an external CRM system.

---

## 🗺️ System Architecture Diagram

The following diagram illustrates how the frontend components, backend views, and background services interact to form the complete FlowZint architecture.

```mermaid
graph TD
    %% Frontend Layer
    subgraph Frontend [Next.js Frontend]
        UI[app/ChatUI.tsx]
        Admin[app/admin/page.tsx]
        Dashboard[components/dashboard/*]
        CRMSync[CrmSyncButton.tsx]
        Feedback[FeedbackBar.tsx]
        
        UI --> |POST /api/chat/| API
        UI <-- |SSE Streaming Response| API
        UI --> |POST /api/upload/| Upload
        CRMSync --> |POST /api/crm/sync/| CRMAPI
        Feedback --> |POST /api/feedback/| FeedbackAPI
        Admin --> |GET /api/admin/| AdminAPI
        Dashboard --> Admin
    end

    %% Backend Layer
    subgraph Backend [Django API]
        API[api/views.py - Chat Endpoint]
        Upload[api/views.py - Upload Endpoint]
        AdminAPI[api/views.py - Admin Endpoints]
        CRMAPI[api/views.py - CRM Endpoint]
        FeedbackAPI[api/views.py - Feedback Endpoint]
        
        Router[LLM Router Logic]
        RAG[Pinecone RAG Search]
        WebSearch[Live Web Search Fallback]
        Orchestrator[Multi-Model Orchestrator]
        SafeGen[safe_generate Wrapper]
        Failover[Failover Cascading Logic]
        
        API --> Router
        Router --> |INFO Request| RAG
        RAG -.-> |No Chunks Found| WebSearch
        Router --> |TASK Request| Orchestrator
        RAG --> Orchestrator
        WebSearch --> Orchestrator
        
        Orchestrator --> SafeGen
        SafeGen -.-> |429/503 Exception| Failover
        Failover --> |Retry with Fallback Model| SafeGen
    end

    %% Services & Infrastructure Layer
    subgraph Infrastructure [Services & DB]
        Models[api/models.py - AuditLog]
        Tasks[api/tasks.py - Celery]
        Redis[(Redis Broker)]
        Pinecone[(Pinecone Vector DB)]
        SQLite[(SQLite/PostgreSQL)]
        LLM((Google / Groq / OpenRouter))
        ExternalCRM((External CRM System))
        
        Upload --> Tasks
        Tasks <--> Redis
        Tasks --> |Embed Chunks| Pinecone
        RAG --> |Query Vectors| Pinecone
        SafeGen <--> LLM
        
        API -.-> |Save Logs & Chunks| Models
        FeedbackAPI -.-> |Save RLHF Signals| Models
        CRMAPI --> ExternalCRM
        Models --> SQLite
        AdminAPI --> SQLite
    end
```

---

## 🏗️ Project Structure & File Index

The project is split into a separated Frontend (`/frontend`) and Backend (`/backend`), containerized for production via Docker. Here is exactly what every file does, how it works, and why we created it.

### 💻 Frontend (Next.js)

The frontend is a React application built on Next.js 16 (App Router) using Tailwind CSS for styling.

* **`/frontend/app/layout.tsx` & `page.tsx`**: The main entry points of the application. `layout.tsx` wraps the app in global metadata and fonts, while `page.tsx` serves the root chat interface.
* **`/frontend/app/ChatUI.tsx`**: **The core engine of the frontend.** We created this massive component to handle the complex state of chat sessions, file uploads, SSE streaming parsing, and UI rendering. It handles the dynamic rendering of Markdown, intercepts system errors, and manages the session ID.
* **`/frontend/app/admin/page.tsx`**: The Admin Dashboard view. Created so enterprise managers can view real-time system health, stats, and the RLHF log feeds without needing backend database access.
* **`/frontend/app/login/page.tsx`**: Handles user authentication and token generation for secure access to the platform.
* **`/frontend/components/ThemeInjector.tsx`**: A utility component that safely injects Light/Dark mode preferences into the DOM.
* **`/frontend/components/dashboard/CrmSyncButton.tsx`**: A specialized UI button that triggers an API call to sync a specific chat conversation out to a mock external CRM system.
* **`/frontend/components/dashboard/FeedbackBar.tsx`**: The UI component rendered under AI messages allowing users to submit RLHF feedback (thumbs up/down, rating, comments).
* **`/frontend/components/dashboard/LogFeed.tsx`**: Displays the raw, live stream of `AuditLog` entries in the Admin dashboard.
* **`/frontend/components/dashboard/Sidebar.tsx`**: The left-hand navigation menu for switching between chat sessions and the admin panel.
* **`/frontend/components/dashboard/StatsCard.tsx` & `SystemHealth.tsx`**: Reusable micro-components for the Admin dashboard to display metrics (like average latency) and database/cache liveness.
* **`/frontend/globals.css`**: Contains custom Tailwind directives and root CSS variables.
* **`/frontend/next.config.ts` & `package.json`**: Build configuration, strict type checking, and dependency definitions for the Next.js environment.

### ⚙️ Backend (Django + DRF)

The backend is an asynchronous, AI-native API built on Django and the Django Rest Framework (DRF).

* **`/backend/api/views.py`**: **The brain of the backend.** We created this to handle the `/api/chat/` endpoint. It processes incoming requests, decides whether to route them to the Vision model, the Router, the Direct Task execution block, or the Pinecone RAG search. It also contains the `safe_generate` error-cascading wrappers and the SSE generator loops.
* **`/backend/api/models.py`**: Defines the SQLite/PostgreSQL database schema. 
  - `ChatSession`: Groups messages together.
  - `AuditLog`: Stores every prompt, response, latency metric, and RLHF feedback. *Why we added custom save logic here:* To truncate massive LLM strings and physically prevent `500 DataError` database crashes.
* **`/backend/api/tasks.py`**: Contains Celery background tasks. We created `process_and_embed_document.delay()` here so that when a user uploads a PDF, the backend instantly responds `202 Accepted` while this file chunks the text and uploads it to Pinecone in the background.
* **`/backend/api/urls.py`**: Maps HTTP endpoints (e.g., `/api/chat/`, `/api/upload/`, `/api/admin/`) to their respective functions in `views.py`.
* **`/backend/api/services/ai_service.py`**: The model orchestrator. It abstracts away the specific API calls to Google, Groq, and OpenRouter, standardizing the interface so we can swap providers easily.
* **`/backend/api/management/commands/export_rlhf_dataset.py`**: A custom terminal command (`python manage.py export_rlhf_dataset`). We built this so AI engineers can instantly dump highly-rated logs into a `.jsonl` file to fine-tune future models.
* **`/backend/api/management/commands/reindex_embeddings.py`**: A utility command to wipe and re-embed all documents in the vector database if we decide to upgrade our embedding model (e.g., from `gemini-embedding-001` to `-002`).
* **`/backend/core/` directory (`settings.py`, `urls.py`, `celery.py`, `wsgi.py`, `asgi.py`)**: The central Django configuration hub. Configures CORS, database connections, installed apps, and initializes the Celery app instance.
* **`/backend/requirements.txt`**: The exact Python dependencies required to run the backend.

### 🐳 Infrastructure

* **`/docker-compose.yml`**: Orchestrates the multi-container environment. We created this to run the `web` (Django), `worker` (Celery), and `redis` (Message Broker) simultaneously, ensuring the local development environment identically matches production.
* **`/backend/Dockerfile`**: Defines the lightweight `python:3.13.3-slim` image, installs system requirements (like `libpq-dev` for Postgres), and sets up a secure non-root `appuser` to run the backend safely.

---

## 🚀 How It Works (The Lifecycle of a Request)

1. **User Input:** The user types a message or uploads an image in `ChatUI.tsx` and hits send.
2. **Frontend Routing:** Next.js sends a POST request to `http://localhost:8000/api/chat/`.
3. **Backend Intake (`views.py`):** 
   - *Is it an image?* Route directly to `VISION_MODEL`.
   - *Is it a greeting?* Short-circuit and reply casually.
4. **The Router:** If it's a complex text prompt, the LLM Router determines if it's an `INFO` request (needs RAG) or a `TASK` request (needs formatting, like an email).
5. **RAG Pipeline (If INFO):** The user's query is converted to vector embeddings, queried against Pinecone, and reranked using a CrossEncoder.
6. **LLM Generation & Protection:** The compiled prompt is sent to `GENERATIVE_MODEL`. If Google's API crashes, rate limits, or blocks the context via safety filters, our `safe_generate` wrapper catches the `Exception`/`ValueError` and securely cascades to `FALLBACK_MODEL` or returns a graceful UI warning.
7. **Streaming Response:** The backend yields Server-Sent Events (SSE) back to the frontend.
8. **Audit Logging:** Once the stream completes, the entire interaction, latency, and context chunks are safely saved to the `AuditLog` database table.

---

## 🛠️ Setup & Installation

To run this project locally:

1. **Start the Backend:**
   ```bash
   docker compose up -d --build
   ```
   *(This boots Django on port 8000, Celery, and Redis).*

2. **Start the Frontend:**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   *(This boots Next.js on port 3000).*

3. **Access the App:** Open `http://localhost:3000` in your browser.

---

## 🤔 Why We Built It This Way

Every architectural decision was made for **resilience and enterprise scale**:
- **Why Celery/Redis?** Synchronous document processing blocks the WSGI thread pool. If 5 users upload 10MB PDFs simultaneously, the server crashes. Celery prevents this.
- **Why the CrossEncoder?** Standard vector similarity (Cosine) often surfaces tangentially related documents. CrossEncoders compare the *semantic relationship* between the query and the chunk, massively reducing LLM hallucinations.
- **Why Model Cascading?** Enterprise APIs (especially during traffic surges) are inherently unstable. Hardcoding a single model guarantees 500 errors. Our try/except cascading ensures the user *always* gets an answer, even if it's from a lighter model.
- **Why the `safe_generate` ValueError catch?** Native SDKs physically crash if safety filters trigger. Catching this allows us to show the user a UI warning rather than breaking the application pipeline.
