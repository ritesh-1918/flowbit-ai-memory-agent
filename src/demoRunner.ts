import { getVendorMemory, rememberVendorCorrection } from './memory/vendorMemory';
import { getCorrectionMemory, rememberCorrectionApproval, rememberCorrectionRejection } from './memory/correctionMemory';
import { recordApproval, recordRejection } from './memory/resolutionMemory';
import { checkAndRecordInvoice } from './memory/duplicateMemory';
import * as fs from 'fs';
import * as path from 'path';

// --- Types ---
interface LineItem {
    description: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    sku?: string | null;
}

interface POLineItem {
    sku: string;
    description: string;
    quantity: number;
    unitPrice: number;
}

interface PurchaseOrder {
    poNumber: string;
    vendor: string;
    createdDate: string;
    status: string;
    lineItems: POLineItem[];
}

interface InvoiceFields {
    invoiceNumber: string;
    invoiceDate: string;
    currency: string | null;
    poNumber?: string | null;
    lineItems: LineItem[];
}

interface ExtractedInvoice {
    invoiceId: string;
    vendor: string;
    fields: InvoiceFields;
    rawText: string;
}

interface FieldCorrection {
    field: string;
    originalValue: unknown;
    correctedValue: unknown;
    reason: string;
}

interface HumanCorrection {
    correctionId: string;
    invoiceId: string;
    vendor: string;
    fieldsCorrected: FieldCorrection[];
    finalDecision: "approved" | "rejected";
    timestamp: string;
}

interface AuditEntry {
    step: "ingest" | "recall" | "apply" | "decide" | "learn" | "duplicate_check" | "detect" | "po_match" | "sku_map";
    timestamp: string;
    details: string;
}

interface InvoiceRunResult {
    normalizedInvoice: {
        vendor: string;
        invoiceNumber: string;
        invoiceDate: string;
        currency: string | null;
        serviceDateLabel: string | null;
        pricesIncludeVAT: boolean;
        poNumber: string | null;
        discountTerms: string | null;
        lineItems: LineItem[];
    };
    proposedCorrections: string[];
    requiresHumanReview: boolean;
    reasoning: string;
    confidenceScore: number;
    memoryUpdates: string[];
    auditTrail: AuditEntry[];
}

// --- Helpers ---
function getTimestamp(): string {
    return new Date().toISOString();
}

function resetAllMemories() {
    const files = ['vendorMemory.json', 'correctionMemory.json', 'resolutionMemory.json', 'duplicateMemory.json'];
    files.forEach(f => {
        const p = path.resolve(process.cwd(), f);
        if (fs.existsSync(p)) fs.unlinkSync(p);
    });
    console.log("All memory files reset.\n");
}

function loadInvoices(): ExtractedInvoice[] {
    const dataPath = path.resolve(__dirname, 'data', 'invoices_extracted.json');
    return JSON.parse(fs.readFileSync(dataPath, 'utf-8')) as ExtractedInvoice[];
}

function loadHumanCorrections(): HumanCorrection[] {
    const dataPath = path.resolve(__dirname, 'data', 'human_corrections.json');
    return JSON.parse(fs.readFileSync(dataPath, 'utf-8')) as HumanCorrection[];
}

function loadPurchaseOrders(): PurchaseOrder[] {
    const dataPath = path.resolve(__dirname, 'data', 'purchase_orders.json');
    return JSON.parse(fs.readFileSync(dataPath, 'utf-8')) as PurchaseOrder[];
}

let purchaseOrders: PurchaseOrder[] = [];

// --- VAT Detection ---
function detectVATIncluded(vendor: string, rawText: string): boolean {
    if (vendor !== "Parts AG") return false;
    const vatPatterns = ["MwSt. inkl", "Prices incl. VAT", "VAT already included"];
    return vatPatterns.some(p => rawText.includes(p));
}

// --- Currency Inference ---
function inferCurrencyFromRawText(rawText: string): string | null {
    if (rawText.includes("EUR")) return "EUR";
    if (rawText.includes("USD")) return "USD";
    if (rawText.includes("GBP")) return "GBP";
    return null;
}

// --- PO Matching ---
function findMatchingPO(vendor: string, invoiceLineItems: LineItem[]): PurchaseOrder | null {
    const vendorPOs = purchaseOrders.filter(po => po.vendor === vendor);
    if (vendorPOs.length === 0) return null;
    const invoiceDescriptions = invoiceLineItems.map(li => li.description.toLowerCase().trim());
    const matchingPOs = vendorPOs.filter(po => {
        const poDescriptions = po.lineItems.map(li => li.description.toLowerCase().trim());
        return invoiceDescriptions.every(desc => poDescriptions.includes(desc));
    });
    if (matchingPOs.length === 1) return matchingPOs[0];
    return null;
}

// --- Skonto Detection (Freight & Co) ---
function detectSkonto(vendor: string, rawText: string): string | null {
    if (vendor !== "Freight & Co") return null;
    if (!rawText.includes("Skonto") && !rawText.includes("paid within")) return null;
    // Simple extraction: find line with Skonto
    const lines = rawText.split('\n');
    for (const line of lines) {
        if (line.includes("Skonto") || line.includes("paid within")) {
            return line.trim();
        }
    }
    return null;
}

// --- Freight SKU Mapping ---
function isFreightService(description: string): boolean {
    const freightKeywords = ["Seefracht", "Shipping", "Transport"];
    return freightKeywords.some(kw => description.includes(kw));
}

function applyHumanCorrections(corrections: HumanCorrection[]): void {
    console.log(`Replaying ${corrections.length} human corrections...\n`);
    for (const correction of corrections) {
        const { vendor, invoiceId, fieldsCorrected, finalDecision } = correction;
        for (const fc of fieldsCorrected) {
            const field = fc.field.toLowerCase();
            const reason = fc.reason.toLowerCase();
            if (field.includes('servicedate') || field === 'servicedatelabel') {
                rememberVendorCorrection(vendor, String(fc.correctedValue));
            }
            if (reason.includes('quantity mismatch') || field === 'quantity') {
                const patternId = 'QTY_MISMATCH_USE_DN_QTY';
                finalDecision === 'approved' ? rememberCorrectionApproval(patternId, 'Quantity Mismatch', 'Use Delivery Note Quantity') : rememberCorrectionRejection(patternId);
            }
            if (reason.includes('vat') || field.includes('vat')) {
                rememberCorrectionApproval('VAT_INCLUDED_IN_TOTAL', 'VAT Handling', 'Totals already include VAT');
            }
            if (reason.includes('currency') || field === 'currency') {
                rememberCorrectionApproval('CURRENCY_MISMATCH', 'Currency Mismatch', 'Correct currency based on vendor');
            }
        }
        const memId = `VENDOR:${vendor}:correction`;
        finalDecision === 'approved' ? recordApproval(memId) : recordRejection(memId);
        console.log(`  [learn] Replayed correction for ${invoiceId}`);
    }
    console.log("\nHuman corrections replay complete.\n");
}

async function processInvoice(invoice: ExtractedInvoice, simulateHumanFeedback: boolean = false): Promise<InvoiceRunResult> {
    const { vendor, fields, invoiceId, rawText } = invoice;
    const { invoiceNumber, invoiceDate, lineItems, poNumber: existingPO } = fields;
    let currency = fields.currency;

    const result: InvoiceRunResult = {
        normalizedInvoice: { vendor, invoiceNumber, invoiceDate, currency, serviceDateLabel: null, pricesIncludeVAT: false, poNumber: existingPO || null, discountTerms: null, lineItems: [...lineItems] },
        proposedCorrections: [],
        requiresHumanReview: true,
        reasoning: "",
        confidenceScore: 0,
        memoryUpdates: [],
        auditTrail: []
    };

    result.auditTrail.push({ step: "ingest", timestamp: getTimestamp(), details: `Loaded invoice ${invoiceId}` });

    // Duplicate Check
    const dupResult = checkAndRecordInvoice(vendor, invoiceNumber, invoiceDate);
    if (dupResult.isDuplicate) {
        result.reasoning = `Duplicate invoice (Seen ${dupResult.seenCount} times)`;
        result.auditTrail.push({ step: "duplicate_check", timestamp: getTimestamp(), details: `Duplicate. seenCount=${dupResult.seenCount}` });
        return result;
    }
    result.auditTrail.push({ step: "duplicate_check", timestamp: getTimestamp(), details: "Unique invoice." });

    // PO Matching
    if (!existingPO) {
        const matchedPO = findMatchingPO(vendor, lineItems);
        if (matchedPO) {
            result.auditTrail.push({ step: "po_match", timestamp: getTimestamp(), details: `Found single matching PO: ${matchedPO.poNumber}` });
            const poPatternId = "AUTO_PO_MATCH_SINGLE_CANDIDATE";
            const poMem = getCorrectionMemory(poPatternId);
            if (poMem && poMem.confidence >= 0.6) {
                result.normalizedInvoice.poNumber = matchedPO.poNumber;
                result.proposedCorrections.push(`Set poNumber = ${matchedPO.poNumber}`);
                result.auditTrail.push({ step: "apply", timestamp: getTimestamp(), details: `Auto-applied poNumber='${matchedPO.poNumber}'` });
            } else {
                result.proposedCorrections.push(`Set poNumber = ${matchedPO.poNumber} (needs review)`);
            }
            if (simulateHumanFeedback) {
                rememberCorrectionApproval(poPatternId, "Single matching PO", `Set poNumber to ${matchedPO.poNumber}`);
                recordApproval(`VENDOR:${vendor}:po`);
                result.memoryUpdates.push(`Updated Correction Memory for '${poPatternId}'`);
            }
        } else {
            result.auditTrail.push({ step: "po_match", timestamp: getTimestamp(), details: "No single matching PO found" });
        }
    }

    // Skonto Detection (Freight & Co)
    const skontoTerm = detectSkonto(vendor, rawText);
    if (skontoTerm) {
        result.normalizedInvoice.discountTerms = skontoTerm;
        result.auditTrail.push({ step: "detect", timestamp: getTimestamp(), details: `Skonto detected: ${skontoTerm}` });
        if (simulateHumanFeedback) {
            rememberVendorCorrection(vendor, skontoTerm);
            result.memoryUpdates.push(`Updated Vendor Memory with discountTerms`);
        }
    }

    // Freight SKU Mapping
    for (let i = 0; i < result.normalizedInvoice.lineItems.length; i++) {
        const li = result.normalizedInvoice.lineItems[i];
        if (!li.sku && isFreightService(li.description)) {
            result.auditTrail.push({ step: "sku_map", timestamp: getTimestamp(), details: `Freight SKU mapped for: ${li.description}` });
            const skuPatternId = "FREIGHT_SERVICE_SKU_MAPPING";
            const skuMem = getCorrectionMemory(skuPatternId);
            if (skuMem && skuMem.confidence >= 0.6) {
                result.normalizedInvoice.lineItems[i] = { ...li, sku: "FREIGHT" };
                result.proposedCorrections.push(`Set sku = FREIGHT for '${li.description}'`);
                result.auditTrail.push({ step: "apply", timestamp: getTimestamp(), details: `Auto-applied sku='FREIGHT'` });
            } else {
                result.proposedCorrections.push(`Set sku = FREIGHT for '${li.description}' (needs review)`);
            }
            if (simulateHumanFeedback) {
                rememberCorrectionApproval(skuPatternId, "Freight service mapped from description", "Set sku = FREIGHT");
                recordApproval(`VENDOR:${vendor}:sku`);
                result.memoryUpdates.push(`Updated Correction Memory for '${skuPatternId}'`);
            }
        }
    }

    // VAT Detection (Parts AG)
    const vatDetected = detectVATIncluded(vendor, rawText);
    if (vatDetected) {
        result.normalizedInvoice.pricesIncludeVAT = true;
        result.auditTrail.push({ step: "detect", timestamp: getTimestamp(), details: "VAT-included detected" });
        const vatPatternId = "VAT_INCLUDED_IN_TOTAL";
        const vatMem = getCorrectionMemory(vatPatternId);
        if (vatMem && vatMem.confidence >= 0.6) {
            result.proposedCorrections.push("Recompute tax and gross from net");
            result.auditTrail.push({ step: "apply", timestamp: getTimestamp(), details: `Auto-suggested: ${vatMem.action}` });
        } else {
            result.proposedCorrections.push("Recompute tax and gross from net (needs review)");
        }
        if (simulateHumanFeedback) {
            rememberCorrectionApproval(vatPatternId, "Totals already include VAT", "Recompute tax and gross from net");
            recordApproval(`VENDOR:${vendor}:vat`);
            result.memoryUpdates.push(`Updated Correction Memory for '${vatPatternId}'`);
        }
    }

    // Currency Inference
    if (!currency) {
        const inferred = inferCurrencyFromRawText(rawText);
        if (inferred) {
            result.normalizedInvoice.currency = inferred;
            result.auditTrail.push({ step: "detect", timestamp: getTimestamp(), details: `Currency inferred: ${inferred}` });
            result.proposedCorrections.push(`Set currency = ${inferred}`);
            if (simulateHumanFeedback) {
                rememberCorrectionApproval("CURRENCY_FROM_RAWTEXT", "Currency inferred from rawText", `Set currency = ${inferred}`);
                recordApproval(`VENDOR:${vendor}:currency`);
                result.memoryUpdates.push(`Updated Correction Memory for 'CURRENCY_FROM_RAWTEXT'`);
            }
        }
    }

    // Recall
    const vendorMem = getVendorMemory(vendor);
    let vendorConfidence = 0;
    if (vendorMem) {
        vendorConfidence = vendorMem.confidence;
        result.auditTrail.push({ step: "recall", timestamp: getTimestamp(), details: `Vendor Memory: confidence=${vendorConfidence}` });
    } else {
        result.auditTrail.push({ step: "recall", timestamp: getTimestamp(), details: `No Vendor Memory for '${vendor}'` });
    }

    const patternId = "QTY_MISMATCH_USE_DN_QTY";
    const correctionMem = getCorrectionMemory(patternId);

    // Decision
    const THRESHOLD = 0.6;
    if (vendorMem && vendorConfidence >= THRESHOLD) {
        result.normalizedInvoice.serviceDateLabel = vendorMem.serviceDateLabel;
        result.auditTrail.push({ step: "apply", timestamp: getTimestamp(), details: `Auto-applied serviceDateLabel='${vendorMem.serviceDateLabel}'` });
    }
    if (correctionMem && correctionMem.confidence >= THRESHOLD) {
        result.proposedCorrections.push(correctionMem.action);
    }

    if (vendorMem && vendorConfidence >= THRESHOLD) {
        result.requiresHumanReview = false;
        result.reasoning = "All actions applied with high confidence.";
        result.confidenceScore = vendorConfidence;
    } else {
        result.requiresHumanReview = true;
        result.reasoning = "Confidence below threshold or missing memory.";
        if (vendorMem) result.confidenceScore = vendorConfidence;
    }
    result.auditTrail.push({ step: "decide", timestamp: getTimestamp(), details: `requiresHumanReview=${result.requiresHumanReview}` });

    // Learning
    if (simulateHumanFeedback && result.requiresHumanReview) {
        rememberVendorCorrection(vendor, "Leistungsdatum");
        result.memoryUpdates.push(`Updated Vendor Memory for '${vendor}'`);
        rememberCorrectionApproval(patternId, "Quantity Mismatch", "Use Delivery Note Quantity");
        recordApproval(`VENDOR:${vendor}:serviceDateLabel`);
        result.auditTrail.push({ step: "learn", timestamp: getTimestamp(), details: "Human Feedback: Approved" });
    } else if (!result.requiresHumanReview) {
        recordApproval(`VENDOR:${vendor}:serviceDateLabel`);
        result.memoryUpdates.push(`Recorded System Success`);
    }

    return result;
}

// --- Main ---
async function runDemo() {
    resetAllMemories();
    console.log("Flowbit AI Memory Agent - Appendix Invoice Processing\n");

    purchaseOrders = loadPurchaseOrders();
    console.log(`Loaded ${purchaseOrders.length} purchase orders.\n`);

    const corrections = loadHumanCorrections();
    applyHumanCorrections(corrections);

    const invoices = loadInvoices();
    console.log(`Processing ${invoices.length} invoices...\n`);

    for (let i = 0; i < invoices.length; i++) {
        const invoice = invoices[i];
        console.log(`--- Invoice ${i + 1}/${invoices.length}: ${invoice.invoiceId} (${invoice.vendor}) ---`);
        const result = await processInvoice(invoice, true);
        console.log(JSON.stringify(result, null, 2));
        console.log("\n");
    }

    console.log("=== Processing Complete ===");
}

runDemo();
