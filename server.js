import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// Import serverless handlers
import chatHandler from './api/chat.js';
import testKeyHandler from './api/test-key.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Config middlewares
app.use(cors());
app.use(express.json());

// Register API routes
app.post('/api/chat', chatHandler);
app.post('/api/test-key', testKeyHandler);

// Serve static build files
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback all other requests to index.html for SPA routing
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[César-IA Server]: Unified Express server running on port ${PORT}`);
});
