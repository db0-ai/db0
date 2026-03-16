import type { MemoryEntry, MemoryScope } from "../types.js";
import type { Memory } from "../components/memory.js";

export interface ChunkOpts {
  /** Target chunk size in characters. Default: 1000 */
  chunkSize?: number;
  /** Overlap between consecutive chunks in characters. Default: 200 */
  chunkOverlap?: number;
}

export interface FileIngestOpts extends ChunkOpts {
  scope: MemoryScope;
  embeddingFn: (text: string) => Promise<Float32Array>;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Split text into chunks with overlap, preferring paragraph/sentence boundaries.
 */
export function chunkText(text: string, opts?: ChunkOpts): string[] {
  const size = opts?.chunkSize ?? 1000;
  const overlap = opts?.chunkOverlap ?? 200;

  if (text.length <= size) {
    return [text.trim()].filter(Boolean);
  }

  // Split into paragraphs
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (current.length + trimmed.length + 1 <= size) {
      current += (current ? "\n\n" : "") + trimmed;
    } else {
      if (current) {
        chunks.push(current);
        // Keep overlap from end of current chunk
        if (overlap > 0 && current.length > overlap) {
          current = current.slice(-overlap) + "\n\n" + trimmed;
        } else {
          current = trimmed;
        }
      } else {
        // Single paragraph exceeds chunk size — split by sentences
        const sentences = splitSentences(trimmed);
        let sentBuf = "";
        for (const sent of sentences) {
          if (sentBuf.length + sent.length + 1 <= size) {
            sentBuf += (sentBuf ? " " : "") + sent;
          } else {
            if (sentBuf) {
              chunks.push(sentBuf);
              if (overlap > 0 && sentBuf.length > overlap) {
                sentBuf = sentBuf.slice(-overlap) + " " + sent;
              } else {
                sentBuf = sent;
              }
            } else {
              // Single sentence exceeds chunk size — hard split
              for (let i = 0; i < sent.length; i += size - overlap) {
                chunks.push(sent.slice(i, i + size));
              }
              sentBuf = "";
            }
          }
        }
        current = sentBuf;
      }
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.filter(Boolean);
}

/**
 * Ingest a file/text into memory as chunked entries.
 * Returns all created memory entries.
 */
export async function ingestFile(
  memory: Memory,
  text: string,
  opts: FileIngestOpts,
): Promise<MemoryEntry[]> {
  const chunks = chunkText(text, opts);
  const entries: MemoryEntry[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = await opts.embeddingFn(chunk);
    const entry = await memory.write({
      content: chunk,
      scope: opts.scope,
      embedding,
      tags: [...(opts.tags ?? []), "file-chunk"],
      metadata: {
        ...(opts.metadata ?? {}),
        chunkIndex: i,
        totalChunks: chunks.length,
      },
    });
    entries.push(entry);
  }

  return entries;
}

function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace
  const parts = text.split(/(?<=[.!?])\s+/);
  return parts.filter(Boolean);
}
