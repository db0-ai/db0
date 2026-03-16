import type { ExtractionResult, ExtractionStrategy } from "../types.js";

export class ManualExtractionStrategy implements ExtractionStrategy {
  extract(_content: string): ExtractionResult[] {
    return [];
  }
}
