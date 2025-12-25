import * as fs from 'fs';
import * as path from 'path';

const MEMORY_FILE = path.resolve(process.cwd(), 'duplicateMemory.json');

interface DuplicateEntry {
    duplicateKey: string;
    vendor: string;
    invoiceNumber: string;
    invoiceDate: string;
    firstSeenAt: string;
    seenCount: number;
}

interface DuplicateMemory {
    [duplicateKey: string]: DuplicateEntry;
}

/**
 * Loads duplicate memory from JSON file.
 */
export function loadDuplicateMemory(): DuplicateMemory {
    try {
        if (!fs.existsSync(MEMORY_FILE)) {
            return {};
        }
        const data = fs.readFileSync(MEMORY_FILE, 'utf-8');
        return JSON.parse(data) as DuplicateMemory;
    } catch (error) {
        console.warn("Failed to load duplicate memory:", error);
        return {};
    }
}

/**
 * Saves duplicate memory to JSON file.
 */
export function saveDuplicateMemory(memory: DuplicateMemory): void {
    try {
        const data = JSON.stringify(memory, null, 2);
        fs.writeFileSync(MEMORY_FILE, data, 'utf-8');
    } catch (error) {
        console.error("Failed to save duplicate memory:", error);
    }
}

/**
 * Checks if an invoice is a duplicate and records it.
 * Returns { isDuplicate: boolean, seenCount: number }
 */
export function checkAndRecordInvoice(vendor: string, invoiceNumber: string, invoiceDate: string): { isDuplicate: boolean, seenCount: number } {
    const memory = loadDuplicateMemory();
    const duplicateKey = `${vendor}|${invoiceNumber}|${invoiceDate}`;
    const timestamp = new Date().toISOString();

    if (memory[duplicateKey]) {
        // Duplicate found
        memory[duplicateKey].seenCount += 1;
        saveDuplicateMemory(memory);
        return { isDuplicate: true, seenCount: memory[duplicateKey].seenCount };
    } else {
        // New Invoice
        memory[duplicateKey] = {
            duplicateKey,
            vendor,
            invoiceNumber,
            invoiceDate,
            firstSeenAt: timestamp,
            seenCount: 1
        };
        saveDuplicateMemory(memory);
        return { isDuplicate: false, seenCount: 1 };
    }
}

/**
 * Read-only check for duplication.
 */
export function isDuplicateInvoice(vendor: string, invoiceNumber: string, invoiceDate: string): boolean {
    const memory = loadDuplicateMemory();
    const duplicateKey = `${vendor}|${invoiceNumber}|${invoiceDate}`;
    return !!memory[duplicateKey];
}
