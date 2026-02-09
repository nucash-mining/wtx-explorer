const WATTxRPC = require('./rpc');
const { db, statements } = require('./db');

class Indexer {
  constructor(rpcUrl) {
    this.rpc = new WATTxRPC(rpcUrl);
    this.isRunning = false;
    this.batchSize = 10;
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('Indexer started');
    await this.sync();
  }

  stop() {
    this.isRunning = false;
    console.log('Indexer stopped');
  }

  getLastIndexedBlock() {
    const row = statements.getIndexerState.get('last_block');
    return row ? parseInt(row.value) : -1;
  }

  setLastIndexedBlock(height) {
    statements.setIndexerState.run('last_block', height.toString());
  }

  async sync() {
    while (this.isRunning) {
      try {
        const chainHeight = await this.rpc.getBlockCount();
        const lastIndexed = this.getLastIndexedBlock();

        if (lastIndexed >= chainHeight) {
          await this.sleep(2000);
          continue;
        }

        const startBlock = lastIndexed + 1;
        const endBlock = Math.min(startBlock + this.batchSize - 1, chainHeight);

        console.log(`Indexing blocks ${startBlock} to ${endBlock}...`);

        for (let height = startBlock; height <= endBlock; height++) {
          await this.indexBlock(height);
        }

        this.setLastIndexedBlock(endBlock);
        console.log(`Indexed up to block ${endBlock}`);

      } catch (error) {
        console.error('Indexer error:', error.message);
        await this.sleep(5000);
      }
    }
  }

  async indexBlock(height) {
    const block = await this.rpc.getBlock(height, 2);
    if (!block) {
      console.warn(`Block ${height} not found`);
      return;
    }

    // Detect PoS from block flags
    const isPos = block.flags?.includes('proof-of-stake') ? 1 : 0;

    // Insert block
    const insertBlock = db.transaction(() => {
      statements.insertBlock.run(
        height,
        block.hash,
        block.previousblockhash || null,
        block.time,
        block.miner || null,
        block.difficulty?.toString() || '0',
        '0', // gas_limit - not directly available
        '0', // gas_used
        block.tx?.length || 0,
        block.size || 0,
        block.nonce?.toString() || '0',
        isPos,
        '0' // block_reward - TODO: calculate
      );

      // Index transactions
      if (block.tx && Array.isArray(block.tx)) {
        for (let i = 0; i < block.tx.length; i++) {
          const tx = block.tx[i];
          if (typeof tx === 'object') {
            this.indexTransaction(tx, block, i);
          }
        }
      }
    });

    insertBlock();
  }

  indexTransaction(tx, block, txIndex) {
    // Extract from/to addresses from vin/vout
    let fromAddress = null;
    let toAddress = null;
    let value = '0';

    // Get sender from first vin if available
    if (tx.vin && tx.vin[0]) {
      const vin = tx.vin[0];
      if (vin.scriptSig?.asm) {
        // Extract address from scriptSig if possible
      }
    }

    // Get primary recipient from vout
    if (tx.vout && tx.vout[0]) {
      const vout = tx.vout[0];
      if (vout.scriptPubKey?.address) {
        toAddress = vout.scriptPubKey.address;
      } else if (vout.scriptPubKey?.addresses && vout.scriptPubKey.addresses[0]) {
        toAddress = vout.scriptPubKey.addresses[0];
      }
      value = Math.round((vout.value || 0) * 1e8).toString();
    }

    // Check for contract creation/call
    let contractAddress = null;
    let inputData = '0x';

    for (const vout of (tx.vout || [])) {
      if (vout.scriptPubKey?.type === 'create') {
        // Contract creation
        contractAddress = vout.scriptPubKey.address || null;
      } else if (vout.scriptPubKey?.type === 'call') {
        // Contract call
        inputData = vout.scriptPubKey.hex || '0x';
      }
    }

    statements.insertTx.run(
      tx.txid,
      block.height,
      block.hash,
      txIndex,
      fromAddress?.toLowerCase() || null,
      toAddress?.toLowerCase() || null,
      value,
      '0', // gas
      '0', // gas_price
      '0', // gas_used
      0,   // nonce
      inputData,
      1,   // status (assume success)
      contractAddress?.toLowerCase() || null,
      block.time
    );

    // Index contract events if receipt available
    this.indexReceipt(tx.txid, block);
  }

  async indexReceipt(txid, block) {
    try {
      const receipts = await this.rpc.getTransactionReceipt(txid);
      if (!receipts || !Array.isArray(receipts)) return;

      for (const receipt of receipts) {
        if (receipt.log && Array.isArray(receipt.log)) {
          for (let i = 0; i < receipt.log.length; i++) {
            const log = receipt.log[i];
            await this.indexLog(txid, log, block, i);
          }
        }

        // Detect token transfers
        if (receipt.contractAddress) {
          await this.detectToken(receipt.contractAddress);
        }
      }
    } catch (e) {
      // Receipt not available for this tx type
    }
  }

  async indexLog(txid, log, block, logIndex) {
    const topics = log.topics || [];

    statements.insertLog.run(
      txid,
      logIndex,
      log.address?.toLowerCase() || null,
      topics[0] || null,
      topics[1] || null,
      topics[2] || null,
      topics[3] || null,
      log.data || '0x',
      block.height,
      block.time,
      null, // decoded_name
      null  // decoded_args
    );

    // Check for Transfer event (ERC-20/QRC-20)
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    if (topics[0] === TRANSFER_TOPIC && topics.length >= 3) {
      const tokenAddress = log.address.toLowerCase();
      const from = '0x' + topics[1].slice(-40).toLowerCase();
      const to = '0x' + topics[2].slice(-40).toLowerCase();
      const value = log.data;

      await this.detectToken(tokenAddress);

      statements.insertTransfer.run(
        txid,
        logIndex,
        tokenAddress,
        from,
        to,
        value,
        block.height,
        block.time
      );
    }
  }

  async detectToken(address) {
    const existing = statements.getToken.get(address.toLowerCase());
    if (existing) return existing;

    try {
      const [name, symbol, decimals, totalSupply] = await Promise.all([
        this.rpc.getTokenName(address).catch(() => 'Unknown'),
        this.rpc.getTokenSymbol(address).catch(() => '???'),
        this.rpc.getTokenDecimals(address).catch(() => 18),
        this.rpc.getTokenTotalSupply(address).catch(() => '0')
      ]);

      statements.insertToken.run(
        address.toLowerCase(),
        name,
        symbol,
        Number(decimals),
        totalSupply.toString(),
        null
      );

      console.log(`Detected token: ${name} (${symbol}) at ${address}`);
      return { address, name, symbol, decimals, totalSupply };
    } catch (e) {
      return null;
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = Indexer;
