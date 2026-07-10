import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as pdfParseModule from 'pdf-parse';
const pdfParse = pdfParseModule.default || pdfParseModule;

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
    case 'pdf':
      const pdfData = readFileSync(filePath);
      const pdfResult = await pdfParse(pdfData);
      text = pdfResult.text;
      break;
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

let vocabulary = [];

function buildVocabulary(texts) {
  const vocabSet = new Set();
  for (const text of texts) {
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    words.forEach(w => vocabSet.add(w));
  }
  vocabulary = Array.from(vocabSet);
}

function simpleEmbed(text) {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const wordCount = {};
  words.forEach(w => { wordCount[w] = (wordCount[w] || 0) + 1; });
  
  const embedding = new Array(100).fill(0);
  words.forEach((word, idx) => {
    const hash = word.split('').reduce((h, c) => h + c.charCodeAt(0), 0);
    embedding[idx % 100] += hash % 100 / 100;
  });
  
  const maxVal = Math.max(...embedding.map(Math.abs));
  if (maxVal > 0) {
    return embedding.map(v => v / maxVal);
  }
  return embedding;
}

async function getEmbedding(text, config) {
  try {
    const response = await fetch(`${config.baseURL}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.warn(`Embedding API 调用失败，使用本地向量化: ${errData.error?.message || response.status}`);
      return simpleEmbed(text);
    }

    const data = await response.json();
    return data.data?.[0]?.embedding;
  } catch (err) {
    console.warn(`Embedding 调用异常，使用本地向量化: ${err.message}`);
    return simpleEmbed(text);
  }
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
    const embedding = await getEmbedding(chunks[i], config);
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

  const queryEmbedding = await getEmbedding(query, config);
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