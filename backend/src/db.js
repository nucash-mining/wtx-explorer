const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '../data/explorer.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  -- Blocks table
  CREATE TABLE IF NOT EXISTS blocks (
    height INTEGER PRIMARY KEY,
    hash TEXT UNIQUE NOT NULL,
    parent_hash TEXT,
    timestamp INTEGER,
    miner TEXT,
    difficulty TEXT,
    gas_limit TEXT,
    gas_used TEXT,
    tx_count INTEGER,
    size INTEGER,
    nonce TEXT,
    is_pos INTEGER DEFAULT 0,
    block_reward TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  -- Transactions table
  CREATE TABLE IF NOT EXISTS transactions (
    hash TEXT PRIMARY KEY,
    block_height INTEGER,
    block_hash TEXT,
    tx_index INTEGER,
    from_address TEXT,
    to_address TEXT,
    value TEXT,
    gas TEXT,
    gas_price TEXT,
    gas_used TEXT,
    nonce INTEGER,
    input TEXT,
    status INTEGER,
    contract_address TEXT,
    timestamp INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (block_height) REFERENCES blocks(height)
  );

  -- Addresses table (for caching balances)
  CREATE TABLE IF NOT EXISTS addresses (
    address TEXT PRIMARY KEY,
    balance TEXT,
    tx_count INTEGER DEFAULT 0,
    is_contract INTEGER DEFAULT 0,
    contract_name TEXT,
    last_updated INTEGER
  );

  -- Contracts table (verified contracts)
  CREATE TABLE IF NOT EXISTS contracts (
    address TEXT PRIMARY KEY,
    name TEXT,
    source_code TEXT,
    abi TEXT,
    compiler_version TEXT,
    optimization INTEGER,
    constructor_args TEXT,
    verified_at INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  -- Tokens table (ERC-20/WTX-20)
  CREATE TABLE IF NOT EXISTS tokens (
    address TEXT PRIMARY KEY,
    name TEXT,
    symbol TEXT,
    decimals INTEGER,
    total_supply TEXT,
    owner TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  -- Token transfers
  CREATE TABLE IF NOT EXISTS token_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_hash TEXT,
    log_index INTEGER,
    token_address TEXT,
    from_address TEXT,
    to_address TEXT,
    value TEXT,
    block_height INTEGER,
    timestamp INTEGER,
    FOREIGN KEY (tx_hash) REFERENCES transactions(hash),
    FOREIGN KEY (token_address) REFERENCES tokens(address)
  );

  -- Token balances
  CREATE TABLE IF NOT EXISTS token_balances (
    address TEXT,
    token_address TEXT,
    balance TEXT,
    last_updated INTEGER,
    PRIMARY KEY (address, token_address)
  );

  -- Event logs
  CREATE TABLE IF NOT EXISTS event_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_hash TEXT,
    log_index INTEGER,
    address TEXT,
    topic0 TEXT,
    topic1 TEXT,
    topic2 TEXT,
    topic3 TEXT,
    data TEXT,
    block_height INTEGER,
    timestamp INTEGER,
    decoded_name TEXT,
    decoded_args TEXT,
    FOREIGN KEY (tx_hash) REFERENCES transactions(hash)
  );

  -- Indexer state
  CREATE TABLE IF NOT EXISTS indexer_state (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  -- Create indexes for common queries
  CREATE INDEX IF NOT EXISTS idx_tx_from ON transactions(from_address);
  CREATE INDEX IF NOT EXISTS idx_tx_to ON transactions(to_address);
  CREATE INDEX IF NOT EXISTS idx_tx_block ON transactions(block_height);
  CREATE INDEX IF NOT EXISTS idx_logs_address ON event_logs(address);
  CREATE INDEX IF NOT EXISTS idx_logs_topic0 ON event_logs(topic0);
  CREATE INDEX IF NOT EXISTS idx_transfers_token ON token_transfers(token_address);
  CREATE INDEX IF NOT EXISTS idx_transfers_from ON token_transfers(from_address);
  CREATE INDEX IF NOT EXISTS idx_transfers_to ON token_transfers(to_address);
  CREATE INDEX IF NOT EXISTS idx_blocks_hash ON blocks(hash);
`);

// Prepared statements for common operations
const statements = {
  insertBlock: db.prepare(`
    INSERT OR REPLACE INTO blocks
    (height, hash, parent_hash, timestamp, miner, difficulty, gas_limit, gas_used, tx_count, size, nonce, is_pos, block_reward)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  insertTx: db.prepare(`
    INSERT OR REPLACE INTO transactions
    (hash, block_height, block_hash, tx_index, from_address, to_address, value, gas, gas_price, gas_used, nonce, input, status, contract_address, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  insertLog: db.prepare(`
    INSERT INTO event_logs
    (tx_hash, log_index, address, topic0, topic1, topic2, topic3, data, block_height, timestamp, decoded_name, decoded_args)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  insertToken: db.prepare(`
    INSERT OR REPLACE INTO tokens (address, name, symbol, decimals, total_supply, owner)
    VALUES (?, ?, ?, ?, ?, ?)
  `),

  insertTransfer: db.prepare(`
    INSERT INTO token_transfers (tx_hash, log_index, token_address, from_address, to_address, value, block_height, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),

  updateTokenBalance: db.prepare(`
    INSERT OR REPLACE INTO token_balances (address, token_address, balance, last_updated)
    VALUES (?, ?, ?, ?)
  `),

  getIndexerState: db.prepare(`SELECT value FROM indexer_state WHERE key = ?`),
  setIndexerState: db.prepare(`INSERT OR REPLACE INTO indexer_state (key, value) VALUES (?, ?)`),

  getBlock: db.prepare(`SELECT * FROM blocks WHERE height = ?`),
  getBlockByHash: db.prepare(`SELECT * FROM blocks WHERE hash = ?`),
  getLatestBlocks: db.prepare(`SELECT * FROM blocks ORDER BY height DESC LIMIT ?`),

  getTx: db.prepare(`SELECT * FROM transactions WHERE hash = ?`),
  getTxsByBlock: db.prepare(`SELECT * FROM transactions WHERE block_height = ? ORDER BY tx_index`),
  getTxsByAddress: db.prepare(`
    SELECT * FROM transactions
    WHERE from_address = ? OR to_address = ?
    ORDER BY block_height DESC, tx_index DESC
    LIMIT ? OFFSET ?
  `),

  getContract: db.prepare(`SELECT * FROM contracts WHERE address = ?`),
  insertContract: db.prepare(`
    INSERT OR REPLACE INTO contracts
    (address, name, source_code, abi, compiler_version, optimization, constructor_args, verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),

  getToken: db.prepare(`SELECT * FROM tokens WHERE address = ?`),
  getTokenBalances: db.prepare(`
    SELECT tb.*, t.name, t.symbol, t.decimals
    FROM token_balances tb
    JOIN tokens t ON tb.token_address = t.address
    WHERE tb.address = ?
  `),

  getTokenTransfers: db.prepare(`
    SELECT tt.*, t.name, t.symbol, t.decimals
    FROM token_transfers tt
    JOIN tokens t ON tt.token_address = t.address
    WHERE tt.token_address = ?
    ORDER BY tt.block_height DESC, tt.log_index DESC
    LIMIT ? OFFSET ?
  `),

  getLogs: db.prepare(`
    SELECT * FROM event_logs
    WHERE address = ?
    ORDER BY block_height DESC, log_index DESC
    LIMIT ? OFFSET ?
  `),

  getStats: db.prepare(`
    SELECT
      (SELECT MAX(height) FROM blocks) as latest_block,
      (SELECT COUNT(*) FROM transactions) as total_txs,
      (SELECT COUNT(*) FROM addresses WHERE is_contract = 1) as total_contracts,
      (SELECT COUNT(*) FROM tokens) as total_tokens
  `)
};

module.exports = { db, statements };
