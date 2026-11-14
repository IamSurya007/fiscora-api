import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const EMBED_BATCH_SIZE = 32;
const EMBED_TIMEOUT_MS = 30_000;

interface EmbedResponse {
  embeddings: number[][];
  dim: number;
  model: string;
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    // Same docker network as the embedding-service container — internal DNS name, not localhost
    this.baseUrl = this.config.get<string>('EMBEDDING_SERVICE_URL', 'http://embedding-service:8090');
  }

  /** The embedding service accepts at most 64 texts per request; send 32 at a time. */
  async embedPassages(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      vectors.push(...(await this.call('/embed/passage', texts.slice(i, i + EMBED_BATCH_SIZE))));
    }
    return vectors;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.call('/embed/query', [text]);
    return vector;
  }

  private async call(path: string, texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`Embedding service ${path} failed: ${res.status} ${body}`);
      throw new Error(`Embedding service error: ${res.status}`);
    }

    const data = (await res.json()) as EmbedResponse;
    return data.embeddings;
  }
}
