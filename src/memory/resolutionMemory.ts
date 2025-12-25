import * as fs from 'fs';
import * as path from 'path';

const MEMORY_FILE = path.resolve(process.cwd(), 'resolutionMemory.json');

interface ResolutionData {
    memoryId: string;
    approvedCount: number;
    rejectedCount: number;
    lastDecision: "approved" | "rejected";
    lastUpdated: string;
}

interface ResolutionMemory {
    [memoryId: string]: ResolutionData;
}

/**
 * Loads resolution memory from JSON file.
 */
export function loadResolutionMemory(): ResolutionMemory {
    try {
        if (!fs.existsSync(MEMORY_FILE)) {
            return {};
        }
        const data = fs.readFileSync(MEMORY_FILE, 'utf-8');
        return JSON.parse(data) as ResolutionMemory;
    } catch (error) {
        console.warn("Failed to load resolution memory:", error);
        return {};
    }
}

/**
 * Saves resolution memory to JSON file.
 */
export function saveResolutionMemory(memory: ResolutionMemory): void {
    try {
        const data = JSON.stringify(memory, null, 2);
        fs.writeFileSync(MEMORY_FILE, data, 'utf-8');
    } catch (error) {
        console.error("Failed to save resolution memory:", error);
    }
}

/**
 * Records an approval for a specific memory ID.
 */
export function recordApproval(memoryId: string): void {
    const memory = loadResolutionMemory();
    const timestamp = new Date().toISOString();

    if (memory[memoryId]) {
        memory[memoryId].approvedCount += 1;
        memory[memoryId].lastDecision = "approved";
        memory[memoryId].lastUpdated = timestamp;
    } else {
        memory[memoryId] = {
            memoryId,
            approvedCount: 1,
            rejectedCount: 0,
            lastDecision: "approved",
            lastUpdated: timestamp
        };
    }

    saveResolutionMemory(memory);
}

/**
 * Records a rejection for a specific memory ID.
 */
export function recordRejection(memoryId: string): void {
    const memory = loadResolutionMemory();
    const timestamp = new Date().toISOString();

    if (memory[memoryId]) {
        memory[memoryId].rejectedCount += 1;
        memory[memoryId].lastDecision = "rejected";
        memory[memoryId].lastUpdated = timestamp;
    } else {
        memory[memoryId] = {
            memoryId,
            approvedCount: 0,
            rejectedCount: 1,
            lastDecision: "rejected",
            lastUpdated: timestamp
        };
    }

    saveResolutionMemory(memory);
}

/**
 * Retrieves resolution stats for a specific memory ID.
 */
export function getResolutionStats(memoryId: string): ResolutionData | null {
    const memory = loadResolutionMemory();
    return memory[memoryId] || null;
}
