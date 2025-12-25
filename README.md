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

The `src/demoRunner.ts` file demonstrates the complete Appendix-aligned agent lifecycle:

### Appendix Step 1: Invoice Ingestion
- Loads invoices from `src/data/invoices_extracted.json`
- Parses vendor, invoiceNumber, invoiceDate, currency, lineItems, and rawText
- Adds `ingest` audit entry for each invoice

### Appendix Step 2: Human Correction Replay (Pre-Training)
- Loads historical corrections from `src/data/human_corrections.json`
- Replays each correction to pre-populate memory systems
- Agent starts with learned knowledge instead of cold start

### Appendix Step 3: Parts AG VAT and Currency Behavior
- Detects VAT-included pricing from rawText patterns ("MwSt. inkl.", "Prices incl. VAT", "VAT already included")
- Infers missing currency from rawText (EUR, USD, GBP)
- Sets `pricesIncludeVAT = true` and proposes tax recomputation

### Appendix Step 4: Supplier GmbH PO Auto-Suggestion
- Loads purchase orders from `src/data/purchase_orders.json`
- Matches invoice line items to PO items by description
- Auto-suggests PO number when exactly one match exists

### Appendix Step 5: Freight & Co Skonto and SKU Mapping
- Detects Skonto discount terms from rawText (e.g., "2% Skonto if paid within 10 days")
- Maps freight service descriptions to SKU ("Seefracht", "Shipping", "Transport" → FREIGHT)
- Stores discount terms in vendor memory

### Duplicate Invoice Handling
- Checks each invoice against `vendor|invoiceNumber|invoiceDate` key
- Blocks processing and learning for duplicate submissions
- Prevents contradictory memory updates

---

## Appendix Alignment and Sample Data Coverage

This implementation is fully aligned with the Flowbit Appendix requirements:

### Data Ingestion
- Invoice data is loaded from `src/data/invoices_extracted.json` following the Appendix format
- Historical human corrections are replayed from `src/data/human_corrections.json`
- Purchase orders are loaded from `src/data/purchase_orders.json`

### Vendor-Specific Behaviors

#### Supplier GmbH
| Behavior | Implementation |
|----------|----------------|
| Service date extraction | Learned from "Leistungsdatum" pattern in rawText |
| PO auto-suggestion | Single-candidate matching based on line item descriptions |
| Duplicate detection | Prevents re-learning from repeated invoice submissions |

#### Parts AG
| Behavior | Implementation |
|----------|----------------|
| VAT-included detection | Pattern matching: "MwSt. inkl.", "Prices incl. VAT", "VAT already included" |
| Currency recovery | Inferred from rawText when `fields.currency` is null |

#### Freight & Co
| Behavior | Implementation |
|----------|----------------|
| Skonto term detection | Extracted from rawText lines containing "Skonto" or "paid within" |
| Freight SKU mapping | Description keywords ("Seefracht", "Shipping", "Transport") → `sku = FREIGHT` |

### Memory-Driven Design
All behaviors are learned and applied through the four memory systems:

| Memory Type | Purpose |
|-------------|---------|
| Vendor Memory | Stores vendor-specific field mappings and confidence scores |
| Correction Memory | Tracks recurring correction patterns with approval/rejection counts |
| Resolution Memory | Records human decisions on AI suggestions for accuracy measurement |
| Duplicate Memory | Prevents contradictory learning from repeated invoices |

### Design Philosophy
The goal of this implementation is to demonstrate **reusable learned memory** and **explainable decision-making**, not hard-coded accounting logic. The agent:
- Learns from historical corrections
- Builds confidence over time
- Makes transparent decisions with full audit trails
- Escalates to humans when uncertain

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

This will:
1. Reset all memory files
2. Load purchase orders
3. Replay human corrections (pre-training)
4. Process all invoices sequentially
5. Output JSON results with audit trails

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

