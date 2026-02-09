require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const WATTxRPC = require('./rpc');
const apiRouter = require('./api');
const Indexer = require('./indexer');

const app = express();
const PORT = process.env.PORT || 3001;
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:13889';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Create RPC client
const rpc = new WATTxRPC(RPC_URL);
app.locals.rpc = rpc;

// API routes
app.use('/api', apiRouter);

// Health check
app.get('/health', async (req, res) => {
  try {
    const blockNumber = await rpc.getBlockCount();
    res.json({ status: 'ok', blockNumber });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../../frontend/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
  });
}

// Start server
app.listen(PORT, async () => {
  console.log(`WATTx Explorer API running on port ${PORT}`);
  console.log(`Connected to RPC: ${RPC_URL.replace(/:[^:@]+@/, ':***@')}`);

  try {
    // Detect multi-wallet setup
    await rpc.detectWallet();

    const blockNumber = await rpc.getBlockCount();
    console.log(`Current block height: ${blockNumber}`);

    // Start indexer
    const indexer = new Indexer(RPC_URL);
    indexer.start();
  } catch (error) {
    console.error('Failed to connect to RPC:', error.message);
  }
});

module.exports = app;
