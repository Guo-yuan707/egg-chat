import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const KB_DIR = join(process.cwd(), 'data', 'knowledge');
const VECTOR_FILE = join(KB_DIR, 'vectors.json');
const DOCS_FILE = join(KB_DIR, 'documents.json');

function ensureDir() {
  if (!existsSync(KB_DIR)) {
    mkdirSync(KB_DIR, { recursive: true });
  }
}

function loadVectors() {
  ensureDir();
  if (!existsSync(VECTOR_FILE)) {
    writeFileSync(VECTOR_FILE, JSON.stringify([]));
    return [];
  }
  try {
    return JSON.parse(readFileSync(VECTOR_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveVectors(vectors) {
  ensureDir();
  writeFileSync(VECTOR_FILE, JSON.stringify(vectors, null, 2));
}

function loadDocuments() {
  ensureDir();
  if (!existsSync(DOCS_FILE)) {
    writeFileSync(DOCS_FILE, JSON.stringify([]));
    return [];
  }
  try {
    return JSON.parse(readFileSync(DOCS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveDocuments(docs) {
  ensureDir();
  writeFileSync(DOCS_FILE, JSON.stringify(docs, null, 2));
}

async function parseFile(filePath) {
  const ext = filePath.toLowerCase().split('.').pop();
  let text = '';

  switch (ext) {
    case 'pdf': {
      // 动态 import：避免 pdf-parse → pdfjs-dist 在 Vercel Serverless 环境启动时崩溃
      const pdfParseModule = await import('pdf-parse');
      const pdfParse = pdfParseModule.default || pdfParseModule;
      const pdfData = readFileSync(filePath);
      const pdfResult = await pdfParse(pdfData);
      text = pdfResult.text;
      break;
    }
    case 'txt':
    case 'md':
    case 'json':
      text = readFileSync(filePath, 'utf-8');
      break;
    case 'html':
    case 'htm':
      text = readFileSync(filePath, 'utf-8').replace(/<[^>]*>/g, ' ');
      break;
    default:
      throw new Error(`不支持的文件格式: ${ext}`);
  }

  return text;
}

function splitText(text, chunkSize = 500, overlap = 100) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    start += chunkSize - overlap;
  }

  return chunks;
}

// 本地简单向量化（100 维）
// 不使用外部 embedding API，确保存储和搜索的向量维度始终一致
function simpleEmbed(text) {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 1);

  const embedding = new Array(100).fill(0);
  words.forEach((word, idx) => {
    // 基于字符码点累加 hash，对每个位置叠加权重
    const hash = word.split('').reduce((h, c) => h + c.charCodeAt(0), 0);
    embedding[idx % 100] += (hash % 100) / 100;
  });

  const maxVal = Math.max(...embedding.map(Math.abs));
  if (maxVal > 0) {
    return embedding.map(v => v / maxVal);
  }
  return embedding;
}

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function addDocument(filePath, fileName, config) {
  ensureDir();

  const text = await parseFile(filePath);
  const chunks = splitText(text);

  const docs = loadDocuments();
  const vectors = loadVectors();

  const docId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const docEntry = {
    id: docId,
    fileName,
    filePath,
    chunkCount: chunks.length,
    addedAt: new Date().toISOString(),
  };
  docs.push(docEntry);
  saveDocuments(docs);

  for (let i = 0; i < chunks.length; i++) {
    const embedding = simpleEmbed(chunks[i]);
    if (embedding) {
      vectors.push({
        docId,
        chunkIndex: i,
        content: chunks[i],
        embedding,
      });
    }
  }

  saveVectors(vectors);

  return { docId, chunkCount: chunks.length, successCount: vectors.filter(v => v.docId === docId).length };
}

export async function searchKnowledge(query, config, topK = 3) {
  const vectors = loadVectors();
  if (vectors.length === 0) return [];

  const queryEmbedding = simpleEmbed(query);
  if (!queryEmbedding) return [];

  const results = vectors.map(v => ({
    ...v,
    similarity: cosineSimilarity(queryEmbedding, v.embedding),
  })).filter(v => v.similarity > -0.5)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  return results;
}

export function getDocuments() {
  return loadDocuments();
}

export function deleteDocument(docId) {
  const docs = loadDocuments();
  const vectors = loadVectors();

  const newDocs = docs.filter(d => d.id !== docId);
  const newVectors = vectors.filter(v => v.docId !== docId);

  saveDocuments(newDocs);
  saveVectors(newVectors);

  return { deleted: docs.length - newDocs.length, vectorsRemoved: vectors.length - newVectors.length };
}

export function clearKnowledge() {
  saveDocuments([]);
  saveVectors([]);
  return { success: true };
}

export function getKnowledgeStats() {
  const docs = loadDocuments();
  const vectors = loadVectors();
  return {
    documentCount: docs.length,
    vectorCount: vectors.length,
    totalChars: vectors.reduce((sum, v) => sum + v.content.length, 0),
  };
}