import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { GoogleGenAI, Type } from '@google/genai';

const router = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}${path.extname(file.originalname)}`);
  },
});

const upload = multer({ storage });

const ai = new GoogleGenAI({ apiKey: process.env['GEMINI_API_KEY'] ?? '' });

interface ReceiptExtraction {
  storeName: string;
  total: number;
  date: string;
}

router.post('/', upload.single('receipt'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file received under field name "receipt"' });
    return;
  }

  try {
    const imageBytes = await readFile(req.file.path);

    const aiResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: req.file.mimetype,
                data: imageBytes.toString('base64'),
              },
            },
            {
              text: 'Extract the store name, total amount, and date from this receipt.',
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            storeName: {
              type: Type.STRING,
              description: 'Name of the store or merchant on the receipt',
            },
            total: {
              type: Type.NUMBER,
              description: 'Final total amount charged, as a decimal number',
            },
            date: {
              type: Type.STRING,
              description: 'Date of the transaction in YYYY-MM-DD format',
            },
          },
          required: ['storeName', 'total', 'date'],
        },
      },
    });

    const rawText = aiResponse.text;
    if (!rawText) {
      res.status(502).json({ error: 'AI model returned an empty response' });
      return;
    }

    const extracted = JSON.parse(rawText) as ReceiptExtraction;
    res.json({ filename: req.file.filename, extracted });
  } catch (err: unknown) {
    console.error('[upload] error:', err);
    res.status(500).json({ error: 'Upload processing failed', detail: String(err) });
  }
});

export default router;
