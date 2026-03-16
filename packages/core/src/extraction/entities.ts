export interface ExtractedEntity {
  text: string;
  type: "person" | "place" | "date" | "event" | "organization";
}

const COMMON_WORDS = new Set([
  "the", "this", "that", "these", "those", "there", "here",
  "what", "which", "who", "whom", "when", "where", "why", "how",
  "not", "but", "and", "also", "just", "very", "really",
  "today", "yesterday", "tomorrow", "now", "then", "still",
  "some", "any", "all", "each", "every", "both", "few",
  "yes", "yeah", "sure", "okay", "well", "hey", "wow",
  "thanks", "thank", "please", "sorry", "great", "good",
  "however", "actually", "basically", "definitely", "probably",
  "maybe", "perhaps", "certainly", "absolutely",
  // Common sentence starters that aren't names
  "so", "oh", "ah", "um", "hmm", "let", "got",
]);

/**
 * Extract named entities from conversational text using pattern matching.
 * Designed for chat-style text where speakers are identified by name.
 */
export function extractEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();

  const addEntity = (text: string, type: ExtractedEntity["type"]) => {
    const key = `${type}:${text.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      entities.push({ text, type });
    }
  };

  // Extract speaker names from "Name: message" pattern (common in conversations)
  const speakerMatches = text.matchAll(/^([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*:/gm);
  for (const match of speakerMatches) {
    addEntity(match[1], "person");
  }

  // Extract names mentioned with possessive or action verbs
  // "Alice's", "Bob said", "told Carol"
  const namePatterns = [
    /\b([A-Z][a-z]{2,}(?:\s[A-Z][a-z]+)?)'s\b/g,
    /\b([A-Z][a-z]{2,}(?:\s[A-Z][a-z]+)?)\s+(?:said|told|asked|mentioned|suggested|recommended|decided|went|visited|bought|started|finished|loves?|likes?|hates?|wants?|needs?|thinks?)/g,
    /(?:told|asked|with|for|about)\s+([A-Z][a-z]{2,}(?:\s[A-Z][a-z]+)?)\b/g,
  ];

  for (const pattern of namePatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      // Filter out common false positives
      const name = match[1];
      if (!COMMON_WORDS.has(name.toLowerCase())) {
        addEntity(name, "person");
      }
    }
  }

  // Extract dates
  // Patterns: "May 8, 2023", "8 May 2023", "2023-05-08", "yesterday", "last week"
  const datePatterns = [
    /\b(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December),?\s+\d{4})\b/gi,
    /\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\b/gi,
    /\b(\d{4}-\d{2}-\d{2})\b/g,
    /\b(yesterday|today|last\s+(?:week|month|year|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday))\b/gi,
    /\b(next\s+(?:week|month|year|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday))\b/gi,
  ];

  for (const pattern of datePatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      addEntity(match[1], "date");
    }
  }

  // Extract places (after common prepositions)
  const placePatterns = [
    /(?:in|at|to|from|near|visit(?:ed|ing)?)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2})\b/g,
  ];

  for (const pattern of placePatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const place = match[1];
      if (!COMMON_WORDS.has(place.toLowerCase()) && place.length > 2) {
        addEntity(place, "place");
      }
    }
  }

  return entities;
}
