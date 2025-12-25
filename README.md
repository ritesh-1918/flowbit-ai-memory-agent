# Flowbit AI Memory Agent

A memory-driven AI agent for invoice automation that learns from human corrections. This project demonstrates how an autonomous agent can progressively reduce human intervention by building persistent, confidence-scored memory systems across multiple invoice processing runs.

---

## Problem Statement

In enterprise invoice processing workflows, human operators repeatedly correct the same types of errors: vendor-specific date formats, quantity mismatches, and field labeling inconsistencies. These corrections are typically discarded after each invoice, forcing operators to re-teach the system the same lessons repeatedly.

This project addresses that inefficiency by implementing a learning agent that:
- Remembers vendor-specific patterns
- Tracks correction approval and rejection rates
- Builds confidence over time
- Autonomously applies learned corrections when confidence is high
- Escalates to humans only when uncertain

**Note:** OCR and data extraction are assumed to be handled upstream. This agent focuses purely on the decision-making and learning layer.

---

## System Architecture

The agent operates in a four-phase loop for each invoice:

```
┌─────────────────────────────────────────────────────────────┐
│                     AGENT DECISION LOOP                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   1. DUPLICATE CHECK                                        │
│      └── If duplicate detected → Exit early                 │
│                                                             │
│   2. RECALL                                                 │
│      ├── Retrieve Vendor Memory                             │
│      └── Retrieve Correction Memory                         │
│                                                             │
│   3. DECIDE                                                 │
│      ├── If confidence >= threshold → Auto-apply            │
│      └── If confidence < threshold → Escalate to human      │
│                                                             │
│   4. LEARN                                                  │
│      ├── Record approval/rejection in Resolution Memory     │
│      └── Reinforce or decay Vendor/Correction confidence    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Memory Systems Implemented

### 1. Vendor Memory (`vendorMemory.ts`)

**Purpose:** Stores vendor-specific field mappings learned from human corrections.

| Field | Description |
|-------|-------------|
| `serviceDateLabel` | The correct label for service date (e.g., "Leistungsdatum") |
| `confidence` | Score from 0.0 to 1.0 indicating reliability |

**Confidence Updates:**
- +0.1 on each human approval (capped at 1.0)
- Initial confidence: 0.5

**Persistence:** `vendorMemory.json` at project root.

---

### 2. Correction Memory (`correctionMemory.ts`)

**Purpose:** Tracks recurring correction patterns (e.g., "Use Delivery Note Quantity when mismatch detected").

| Field | Description |
|-------|-------------|
| `patternId` | Unique identifier (e.g., `QTY_MISMATCH_USE_DN_QTY`) |
| `description` | Human-readable explanation |
| `action` | The correction to apply |
| `confidence` | Score from 0.0 to 1.0 |
| `approvedCount` | Number of times approved |
| `rejectedCount` | Number of times rejected |
| `lastUpdated` | ISO timestamp |

**Confidence Updates:**
- +0.1 on approval (capped at 1.0)
- -0.2 on rejection (floored at 0.0)

**Persistence:** `correctionMemory.json` at project root.

---

### 3. Resolution Memory (`resolutionMemory.ts`)

**Purpose:** Tracks how humans resolved AI suggestions over time (approved vs rejected).

| Field | Description |
|-------|-------------|
| `memoryId` | Unique key (e.g., `VENDOR:Supplier GmbH:serviceDateLabel`) |
| `approvedCount` | Total approvals |
| `rejectedCount` | Total rejections |
| `lastDecision` | `"approved"` or `"rejected"` |
| `lastUpdated` | ISO timestamp |

**Use Case:** Provides audit data for measuring agent accuracy over time.

**Persistence:** `resolutionMemory.json` at project root.

---

### 4. Duplicate Memory (`duplicateMemory.ts`)

**Purpose:** Detects and blocks duplicate invoice submissions to prevent contradictory learning.

| Field | Description |
|-------|-------------|
| `duplicateKey` | Composite key: `vendor|invoiceNumber|invoiceDate` |
| `vendor` | Vendor name |
| `invoiceNumber` | Invoice identifier |
| `invoiceDate` | Invoice date |
| `firstSeenAt` | ISO timestamp of first occurrence |
| `seenCount` | Number of times this invoice was submitted |

**Behavior:**
- First submission: Records entry, returns `isDuplicate: false`
- Subsequent submissions: Increments count, returns `isDuplicate: true`

**Persistence:** `duplicateMemory.json` at project root.

---

## Decision Logic

### Confidence Thresholds
- **Auto-apply threshold:** 0.6
- If vendor or correction memory confidence >= 0.6, the agent applies the learned action automatically.
- Below threshold, the agent escalates to human review.

### Reinforcement and Decay
- **Reinforcement:** Each human approval increases confidence by +0.1
- **Decay:** Each rejection decreases confidence by -0.2
- This asymmetry ensures bad patterns decay faster than good patterns grow.

### Preventing Bad Learning
- Rejections have double the impact of approvals (-0.2 vs +0.1)
- Duplicate invoices are blocked before any learning occurs
- Resolution Memory provides audit trails for manual review

### Duplicate Protection
- Before any processing, the agent checks if the invoice (by `vendor|invoiceNumber|invoiceDate`) has been seen before.
- If duplicate: Processing halts immediately, no learning occurs.

---

## Output Contract

Each invoice processing run produces a JSON object:

```json
{
  "normalizedInvoice": {
    "vendor": "Supplier GmbH",
    "description": "Widget Supply",
    "invoiceNumber": "INV-001",
    "invoiceDate": "2025-01-01",
    "serviceDateLabel": "Leistungsdatum"
  },
  "proposedCorrections": ["Use Delivery Note Quantity"],
  "requiresHumanReview": false,
  "reasoning": "All actions applied with high confidence.",
  "confidenceScore": 0.6,
  "memoryUpdates": [
    "Recorded System Success for 'VENDOR:Supplier GmbH:serviceDateLabel'"
  ],
  "auditTrail": [
    {
      "step": "duplicate_check",
      "timestamp": "2025-12-25T14:21:09.634Z",
      "details": "Invoice is unique. Recorded in Duplicate Memory."
    },
    {
      "step": "recall",
      "timestamp": "2025-12-25T14:21:09.634Z",
      "details": "Vendor Memory retrieved: label='Leistungsdatum', confidence=0.6"
    },
    {
      "step": "apply",
      "timestamp": "2025-12-25T14:21:09.634Z",
      "details": "Auto-applied serviceDateLabel='Leistungsdatum'"
    },
    {
      "step": "decide",
      "timestamp": "2025-12-25T14:21:09.634Z",
      "details": "Decision: requiresHumanReview=false"
    }
  ]
}
```

### Field Descriptions

| Field | Purpose |
|-------|---------|
| `normalizedInvoice` | The invoice with applied normalizations |
| `proposedCorrections` | List of suggested corrections |
| `requiresHumanReview` | Whether human intervention is needed |
| `reasoning` | Explanation for the decision |
| `confidenceScore` | Aggregate confidence level |
| `memoryUpdates` | What was learned or recorded |
| `auditTrail` | Step-by-step log with timestamps |

---

## End-to-End Demo

The `src/demoRunner.ts` file demonstrates the complete agent lifecycle:

### Run 1: Cold Start
- No prior memory exists
- Agent escalates to human review
- Human feedback creates initial memory entries (confidence 0.5)

### Run 2: Reinforcement
- Memory exists but confidence (0.5) is below threshold
- Agent still escalates
- Human approval reinforces memory (confidence increases to 0.6)

### Run 3: Auto-Pilot
- Confidence (0.6) meets threshold
- Agent auto-applies normalizations and corrections
- No human intervention required

### Run 4: Duplicate Detection
- Same invoice as Run 3 is submitted again
- Agent detects duplicate and halts processing
- No learning occurs (prevents contradictory updates)

---

## How to Run the Project

### Prerequisites
- Node.js v18 or higher
- npm

### Installation

```bash
# Clone the repository
git clone https://github.com/ritesh-1918/flowbit-ai-memory-agent.git
cd flowbit-ai-memory-agent

# Install dependencies
npm install
```

### Run the Demo

```bash
npx ts-node src/demoRunner.ts
```

This will reset all memory files and execute the four-run demonstration.

### Build (Optional)

```bash
npm run build
npm start
```

---

## Design Choices and Trade-offs

### Heuristic-Based Learning (No ML)
This implementation uses simple confidence scoring rather than machine learning models. This was chosen for:
- Transparency: Easy to understand and audit
- Predictability: Deterministic behavior
- Simplicity: No training infrastructure required
- Extensibility: Easy to add new heuristics

### File-Based Persistence
JSON files at the project root were chosen for:
- Zero infrastructure: No database setup required
- Portability: Easy to inspect, backup, and version control
- Simplicity: Minimal dependencies

**Trade-off:** Not suitable for concurrent access or large-scale production workloads. In production, these would be replaced with a proper database.

### Extensibility
The modular memory system design allows easy extension:
- New memory types can be added by following the existing pattern
- Confidence thresholds can be tuned per use case
- Additional audit fields can be added to the output contract

---

## Conclusion

This project demonstrates the core principles of an autonomous learning agent:

1. **Memory Persistence:** Knowledge survives across sessions
2. **Confidence Scoring:** Quantified trust in learned patterns
3. **Reinforcement Learning:** Human feedback improves the system
4. **Safety Mechanisms:** Duplicate detection and rejection decay prevent bad learning
5. **Auditability:** Complete trace of decisions for review

The system progressively reduces human workload by learning from corrections and applying them automatically when confidence is high, while maintaining human oversight for uncertain cases.

---

## Repository

GitHub: [https://github.com/ritesh-1918/flowbit-ai-memory-agent](https://github.com/ritesh-1918/flowbit-ai-memory-agent)

---

## License

This project was developed as part of an AI Agent Development Internship assignment for Flowbit.
