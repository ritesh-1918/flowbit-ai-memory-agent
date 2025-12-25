import * as fs from 'fs';
import * as path from 'path';

const MEMORY_FILE = path.resolve(process.cwd(), 'vendorMemory.json');

interface VendorData {
    serviceDateLabel: string;
    confidence: number;
}

interface VendorMemory {
    [vendorName: string]: VendorData;
}

/**
 * Loads the vendor memory from the JSON file.
 * Returns an empty object if the file does not exist.
 */
export function loadVendorMemory(): VendorMemory {
    try {
        if (!fs.existsSync(MEMORY_FILE)) {
            return {};
        }
        const data = fs.readFileSync(MEMORY_FILE, 'utf-8');
        return JSON.parse(data) as VendorMemory;
    } catch (error) {
        console.warn("Failed to load vendor memory:", error);
        return {};
    }
}

/**
 * Saves the given vendor memory object to the JSON file.
 */
export function saveVendorMemory(memory: VendorMemory): void {
    try {
        const data = JSON.stringify(memory, null, 2);
        fs.writeFileSync(MEMORY_FILE, data, 'utf-8');
    } catch (error) {
        console.error("Failed to save vendor memory:", error);
    }
}

/**
 * Remembers a correction for a specific vendor.
 * Increases confidence if vendor exists, otherwise creates new entry.
 */
export function rememberVendorCorrection(vendorName: string, serviceDateLabel: string): void {
    const memory = loadVendorMemory();

    if (memory[vendorName]) {
        // Vendor exists, check if label matches (implied requirement is to reinforce this label)
        // For simplicity based on prompt: "Increase confidence by 0.1 (max 1.0)"
        // We will update the label to the latest corrected one if it differs? 
        // The prompt says "store... serviceDateLabel". 
        // If the user "corrects" it, it implies this is the right one.

        memory[vendorName].serviceDateLabel = serviceDateLabel;

        // Increase confidence, cap at 1.0
        // Using loose floating point addition protection
        let newConfidence = memory[vendorName].confidence + 0.1;
        if (newConfidence > 1.0) newConfidence = 1.0;

        // Round to 1 decimal place to avoid 0.6000000000000001
        memory[vendorName].confidence = Math.round(newConfidence * 10) / 10;

    } else {
        // New vendor entry
        memory[vendorName] = {
            serviceDateLabel: serviceDateLabel,
            confidence: 0.5
        };
    }

    saveVendorMemory(memory);
}

/**
 * Retrieves memory for a specific vendor.
 */
export function getVendorMemory(vendorName: string): VendorData | null {
    const memory = loadVendorMemory();
    return memory[vendorName] || null;
}
