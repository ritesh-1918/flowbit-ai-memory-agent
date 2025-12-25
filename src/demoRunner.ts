import { getVendorMemory, rememberVendorCorrection } from './memory/vendorMemory';
import { getCorrectionMemory, rememberCorrectionApproval } from './memory/correctionMemory';
import { recordApproval, recordRejection } from './memory/resolutionMemory';
import { checkAndRecordInvoice } from './memory/duplicateMemory';
import * as fs from 'fs';
import * as path from 'path';

// --- Types ---
interface AuditEntry {
    step: "recall" | "apply" | "decide" | "learn" | "duplicate_check";
    timestamp: string;
    details: string;
}

interface InvoiceRunResult {
    normalizedInvoice: {
        vendor: string;
        description: string;
        invoiceNumber: string;
        invoiceDate: string;
        serviceDateLabel: string | null;
    };
    proposedCorrections: string[];
    requiresHumanReview: boolean;
    reasoning: string;
    confidenceScore: number;
    memoryUpdates: string[];
    auditTrail: AuditEntry[];
}

// --- Helper Functions ---
function getTimestamp(): string {
    return new Date().toISOString();
}

function resetAllMemories() {
    const files = [
        'vendorMemory.json',
        'correctionMemory.json',
        'resolutionMemory.json',
        'duplicateMemory.json'
    ];
    files.forEach(f => {
        const p = path.resolve(process.cwd(), f);
        if (fs.existsSync(p)) fs.unlinkSync(p);
    });
    console.log("All memory files reset.\n");
}

async function processInvoice(
    vendor: string,
    invoiceNumber: string,
    invoiceDate: string,
    description: string,
    simulateHumanFeedback: boolean = false
): Promise<InvoiceRunResult> {
    const result: InvoiceRunResult = {
        normalizedInvoice: { vendor, invoiceNumber, invoiceDate, description, serviceDateLabel: null },
        proposedCorrections: [],
        requiresHumanReview: true,
        reasoning: "",
        confidenceScore: 0,
        memoryUpdates: [],
        auditTrail: []
    };

    // --- 1. Duplicate Check ---
    const dupResult = checkAndRecordInvoice(vendor, invoiceNumber, invoiceDate);
    if (dupResult.isDuplicate) {
        result.requiresHumanReview = true;
        result.reasoning = `Duplicate invoice detected (Seen ${dupResult.seenCount} times)`;
        result.auditTrail.push({
            step: "duplicate_check",
            timestamp: getTimestamp(),
            details: `Duplicate key found. seenCount=${dupResult.seenCount}`
        });
        return result; // Exit early
    }
    result.auditTrail.push({
        step: "duplicate_check",
        timestamp: getTimestamp(),
        details: "Invoice is unique. Recorded in Duplicate Memory."
    });

    // --- 2. Recall Phase ---
    // Vendor Memory
    const vendorMem = getVendorMemory(vendor);
    let vendorConfidence = 0;

    if (vendorMem) {
        vendorConfidence = vendorMem.confidence;
        result.auditTrail.push({
            step: "recall",
            timestamp: getTimestamp(),
            details: `Vendor Memory retrieved: label='${vendorMem.serviceDateLabel}', confidence=${vendorConfidence}`
        });
    } else {
        result.auditTrail.push({
            step: "recall",
            timestamp: getTimestamp(),
            details: `No Vendor Memory found for '${vendor}'`
        });
    }

    // Correction Memory (Sample: Quantity Mismatch)
    // We simulate checking for a specific pattern relevant to this invoice
    const patternId = "QTY_MISMATCH_USE_DN_QTY";
    const correctionMem = getCorrectionMemory(patternId);
    let correctionConfidence = 0;

    if (correctionMem) {
        correctionConfidence = correctionMem.confidence;
        result.auditTrail.push({
            step: "recall",
            timestamp: getTimestamp(),
            details: `Correction Memory retrieved: pattern='${patternId}', confidence=${correctionConfidence}`
        });
    } else {
        result.auditTrail.push({
            step: "recall",
            timestamp: getTimestamp(),
            details: `No Correction Memory found for pattern '${patternId}'`
        });
    }

    // --- 3. Decision Phase ---
    const VENDOR_THRESHOLD = 0.6;
    const CORRECTION_THRESHOLD = 0.6;

    // Decide on Vendor Normalization
    if (vendorMem && vendorConfidence >= VENDOR_THRESHOLD) {
        result.normalizedInvoice.serviceDateLabel = vendorMem.serviceDateLabel;
        result.auditTrail.push({
            step: "apply",
            timestamp: getTimestamp(),
            details: `Auto-applied serviceDateLabel='${vendorMem.serviceDateLabel}' (Confidence ${vendorConfidence} >= ${VENDOR_THRESHOLD})`
        });
    }

    // Decide on Corrections
    if (correctionMem && correctionConfidence >= CORRECTION_THRESHOLD) {
        result.proposedCorrections.push(correctionMem.action);
        result.auditTrail.push({
            step: "apply",
            timestamp: getTimestamp(),
            details: `Auto-suggested correction: ${correctionMem.action}`
        });
    }

    // Final Decision Status
    if (vendorConfidence >= VENDOR_THRESHOLD && (correctionConfidence >= CORRECTION_THRESHOLD || !correctionMem)) {
        // If we are confident in what we found (or didn't find blocking corrections)
        // For demo simplicity: if we auto-applied vendor, we consider it "auto-handled" unless correction is weak?
        // Let's stick strictly to: if ANY suggestion is below threshold, review.
        // Actually, if we applied everything we know confidently, maybe no review?
        // Let's say: if we have NO memory, we definitely need review.
        if (vendorMem) {
            result.requiresHumanReview = false;
            result.reasoning = "All actions applied with high confidence.";
            result.confidenceScore = Math.min(vendorConfidence, correctionConfidence || 1); // rough aggregate
        } else {
            result.requiresHumanReview = true;
            result.reasoning = "New vendor - requires setup.";
        }
    } else {
        result.requiresHumanReview = true;
        result.reasoning = "Confidence below threshold or missing memory.";
        if (vendorMem) result.confidenceScore = vendorConfidence;
    }

    // Record Decision in Audit
    result.auditTrail.push({
        step: "decide",
        timestamp: getTimestamp(),
        details: `Decision: requiresHumanReview=${result.requiresHumanReview}, reasoning='${result.reasoning}'`
    });


    // --- 4. Learning Phase (Simulated) ---
    if (simulateHumanFeedback) {
        if (result.requiresHumanReview) {
            // Simulate Human "Fixing" or "Approving"
            result.auditTrail.push({
                step: "learn",
                timestamp: getTimestamp(),
                details: "Human Feedback: Approved correct values."
            });

            // 1. Learn Vendor
            const correctLabel = "Leistungsdatum"; // Hardcoded for demo
            rememberVendorCorrection(vendor, correctLabel);
            result.memoryUpdates.push(`Updated Vendor Memory for '${vendor}'`);

            // 2. Learn Correction Pattern (if applicable)
            // Simulate that this invoice actually HAD that pattern and human approved the fix
            rememberCorrectionApproval(patternId, "Quantity Mismatch", "Use Delivery Note Quantity");
            result.memoryUpdates.push(`Updated Correction Memory for '${patternId}'`);

            // 3. Record Resolution
            // We track resolution for the specific decisions. 
            // e.g. "VENDOR:{vendor}:serviceDateLabel"
            const memId = `VENDOR:${vendor}:serviceDateLabel`;
            recordApproval(memId);
            result.memoryUpdates.push(`Recorded Approval for '${memId}'`);

        } else {
            // Auto-pilot success -> Implicit approval? Or explicit verification?
            // Usually we record that the system acted alone.
            const memId = `VENDOR:${vendor}:serviceDateLabel`;
            recordApproval(memId); // System got it right
            result.memoryUpdates.push(`Recorded System Success for '${memId}'`);
        }
    }

    return result;
}

// --- Main Execution ---
async function runDemo() {
    resetAllMemories();
    console.log("Flowbit AI Memory Agent - End-to-End Demo\n");

    const vendor = "Supplier GmbH";
    const desc = "Widget Supply";

    // Run 1: Cold Start
    console.log("--- Run 1: Cold Start ---");
    const res1 = await processInvoice(vendor, "INV-001", "2025-01-01", desc, true);
    console.log(JSON.stringify(res1, null, 2));

    // Run 2: Learning Progress (Confidence should increase, but maybe not enough yet)
    console.log("\n--- Run 2: Reinforcement ---");
    const res2 = await processInvoice(vendor, "INV-002", "2025-02-01", desc, true);
    console.log(JSON.stringify(res2, null, 2));

    // Run 3: Fully Trained (Confidence > 0.6)
    console.log("\n--- Run 3: Auto-Pilot ---");
    const res3 = await processInvoice(vendor, "INV-003", "2025-03-01", desc, true); // No human feedback needed potentially?
    console.log(JSON.stringify(res3, null, 2));

    // Run 4: Duplicate Detection
    console.log("\n--- Run 4: Duplicate Attack ---");
    const res4 = await processInvoice(vendor, "INV-003", "2025-03-01", desc, false); // Same as Run 3
    console.log(JSON.stringify(res4, null, 2));
}

runDemo();
