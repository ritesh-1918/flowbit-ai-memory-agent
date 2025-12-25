import * as fs from 'fs';
import * as path from 'path';

const MEMORY_FILE = path.resolve(process.cwd(), 'correctionMemory.json');

interface CorrectionData {
    patternId: string;
    description: string;
    action: string;
    confidence: number;
    approvedCount: number;
    rejectedCount: number;
    lastUpdated: string;
}

interface CorrectionMemory {
    [patternId: string]: CorrectionData;
}

/**
 * Loads correction memory from JSON file.
 */
export function loadCorrectionMemory(): CorrectionMemory {
    try {
        if (!fs.existsSync(MEMORY_FILE)) {
            return {};
        }
        const data = fs.readFileSync(MEMORY_FILE, 'utf-8');
        return JSON.parse(data) as CorrectionMemory;
    } catch (error) {
        console.warn("Failed to load correction memory:", error);
        return {};
    }
}

/**
 * Saves correction memory to JSON file.
 */
export function saveCorrectionMemory(memory: CorrectionMemory): void {
    try {
        const data = JSON.stringify(memory, null, 2);
        fs.writeFileSync(MEMORY_FILE, data, 'utf-8');
    } catch (error) {
        console.error("Failed to save correction memory:", error);
    }
}

/**
 * Tracks an approval for a specific correction pattern.
 * Increases confidence and approved count.
 */
export function rememberCorrectionApproval(patternId: string, description: string, action: string): void {
    const memory = loadCorrectionMemory();
    const timestamp = new Date().toISOString();

    if (memory[patternId]) {
        // Existing pattern: Reinforce
        let newConfidence = memory[patternId].confidence + 0.1;
        if (newConfidence > 1.0) newConfidence = 1.0;

        memory[patternId].confidence = Math.round(newConfidence * 10) / 10;
        memory[patternId].approvedCount += 1;
        memory[patternId].lastUpdated = timestamp;
        // Update description/action in case they evolved? Keeping original for now unless requested.
    } else {
        // New pattern
        memory[patternId] = {
            patternId,
            description,
            action,
            confidence: 0.5,
            approvedCount: 1,
            rejectedCount: 0,
            lastUpdated: timestamp
        };
    }

    saveCorrectionMemory(memory);
}

/**
 * Tracks a rejection for a specific correction pattern.
 * Decreases confidence and increments rejected count.
 */
export function rememberCorrectionRejection(patternId: string): void {
    const memory = loadCorrectionMemory();
    const timestamp = new Date().toISOString();

    if (memory[patternId]) {
        // Penalize confidence
        let newConfidence = memory[patternId].confidence - 0.2;
        if (newConfidence < 0.0) newConfidence = 0.0;

        memory[patternId].confidence = Math.round(newConfidence * 10) / 10;
        memory[patternId].rejectedCount += 1;
        memory[patternId].lastUpdated = timestamp;

        saveCorrectionMemory(memory);
    }
    // If pattern doesn't exist, we can't really reject it (nothing to learn from absence here yet)
}

/**
 * Retrieves memory for a specific pattern.
 */
export function getCorrectionMemory(patternId: string): CorrectionData | null {
    const memory = loadCorrectionMemory();
    return memory[patternId] || null;
}
