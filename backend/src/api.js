const express = require('express');
const { db, statements } = require('./db');

const router = express.Router();

// Helper to format addresses
const formatAddress = (addr) => addr?.toLowerCase() || null;

// ============ BLOCKS ============

router.get('/blocks', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const blocks = statements.getLatestBlocks.all(limit);
    res.json({ blocks });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/block/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const rpc = req.app.locals.rpc;
    let block;

    if (id.startsWith('0x')) {
      block = statements.getBlockByHash.get(id);
    } else {
      block = statements.getBlock.get(parseInt(id));
    }

    // If not in DB, try to fetch from node
    if (!block && rpc) {
      try {
        const rpcBlock = await rpc.getBlock(id.startsWith('0x') ? id : parseInt(id), 2);
        if (rpcBlock) {
          block = {
            height: rpcBlock.height,
            hash: rpcBlock.hash,
            parent_hash: rpcBlock.previousblockhash,
            timestamp: rpcBlock.time,
            tx_count: rpcBlock.tx?.length || 0,
            size: rpcBlock.size,
            is_pos: rpcBlock.flags?.includes('proof-of-stake') ? 1 : 0
          };
        }
      } catch (e) {}
    }

    if (!block) {
      return res.status(404).json({ error: 'Block not found' });
    }

    const transactions = statements.getTxsByBlock.all(block.height);

    res.json({ block, transactions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ TRANSACTIONS ============

router.get('/tx/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    const rpc = req.app.locals.rpc;
    let tx = statements.getTx.get(hash);

    // If not in DB, try to fetch from node
    if (!tx && rpc) {
      try {
        const rpcTx = await rpc.getTransaction(hash, true);
        if (rpcTx) {
          tx = {
            hash: rpcTx.txid,
            block_height: rpcTx.blockheight,
            block_hash: rpcTx.blockhash,
            timestamp: rpcTx.blocktime
          };
        }
      } catch (e) {}
    }

    if (!tx) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const logs = db.prepare(`
      SELECT * FROM event_logs WHERE tx_hash = ? ORDER BY log_index
    `).all(hash);

    const transfers = db.prepare(`
      SELECT tt.*, t.name, t.symbol, t.decimals
      FROM token_transfers tt
      LEFT JOIN tokens t ON tt.token_address = t.address
      WHERE tt.tx_hash = ?
    `).all(hash);

    let contract = null;
    if (tx.to_address) {
      contract = statements.getContract.get(tx.to_address);
    }

    res.json({ transaction: tx, logs, transfers, contract });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/address/:address/txs', (req, res) => {
  try {
    const address = formatAddress(req.params.address);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const offset = parseInt(req.query.offset) || 0;

    const transactions = statements.getTxsByAddress.all(address, address, limit, offset);

    res.json({ transactions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ADDRESSES ============

router.get('/address/:address', async (req, res) => {
  try {
    let address = req.params.address;
    const rpc = req.app.locals.rpc;

    // Convert hex address format for RPC calls
    let hexAddress = address;
    if (address.startsWith('0x')) {
      hexAddress = address.slice(2);
    } else if (address.startsWith('W') || address.startsWith('w')) {
      // Convert base58 to hex
      try {
        hexAddress = await rpc.getHexAddress(address);
      } catch (e) {}
    }

    // Get address info from node
    const addressInfo = await rpc.getAddressInfo(address).catch(() => ({ isvalid: true }));

    // Check if contract
    let isContract = false;
    let code = null;
    try {
      code = await rpc.getContractCode(hexAddress);
      isContract = code && code !== '0x' && code.length > 2;
    } catch (e) {
      console.log('getContractCode error:', e.message);
    }

    // Get verified contract info if exists
    const contract = statements.getContract.get(formatAddress(address));

    // Get token balances
    const tokenBalances = statements.getTokenBalances.all(formatAddress(address));

    // Get recent transactions
    const transactions = statements.getTxsByAddress.all(
      formatAddress(address), formatAddress(address), 10, 0
    );

    res.json({
      address,
      isValid: addressInfo.isvalid,
      isContract,
      code,
      contract,
      tokenBalances,
      recentTransactions: transactions
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ CONTRACTS ============

// List all contracts from node
router.get('/contracts', async (req, res) => {
  try {
    const rpc = req.app.locals.rpc;
    const contracts = await rpc.listContracts();

    // Enrich with token info if available
    const enrichedContracts = [];
    for (const [address, balance] of Object.entries(contracts)) {
      // Skip precompiles (addresses < 0x100)
      if (address.length < 40 || address.match(/^0{30,}/)) continue;

      let tokenInfo = null;
      try {
        const [name, symbol] = await Promise.all([
          rpc.getTokenName(address),
          rpc.getTokenSymbol(address)
        ]);
        if (name) {
          tokenInfo = { name, symbol };
        }
      } catch (e) {}

      // Get base58 address
      let base58 = null;
      try {
        base58 = await rpc.fromHexAddress(address);
      } catch (e) {}

      enrichedContracts.push({
        address: '0x' + address,
        base58Address: base58,
        balance,
        isToken: !!tokenInfo,
        token: tokenInfo
      });
    }

    res.json({ contracts: enrichedContracts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/contract/:address', (req, res) => {
  try {
    const address = formatAddress(req.params.address);
    const contract = statements.getContract.get(address);

    if (!contract) {
      return res.status(404).json({ error: 'Contract not verified' });
    }

    res.json({ contract });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/contract/verify', (req, res) => {
  try {
    const {
      address,
      name,
      sourceCode,
      abi,
      compilerVersion,
      optimization,
      constructorArgs
    } = req.body;

    if (!address || !sourceCode || !abi) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    statements.insertContract.run(
      formatAddress(address),
      name || 'Unknown',
      sourceCode,
      typeof abi === 'string' ? abi : JSON.stringify(abi),
      compilerVersion || 'unknown',
      optimization ? 1 : 0,
      constructorArgs || '',
      Math.floor(Date.now() / 1000)
    );

    res.json({ success: true, message: 'Contract verified' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/contract/:address/read', async (req, res) => {
  try {
    const address = req.params.address;
    const { functionName, args = [] } = req.body;
    const rpc = req.app.locals.rpc;

    // Get contract ABI
    const contractData = statements.getContract.get(formatAddress(address));
    if (!contractData) {
      return res.status(404).json({ error: 'Contract not verified' });
    }

    const abi = JSON.parse(contractData.abi);

    // Find the function in ABI
    const func = abi.find(f => f.name === functionName && f.type === 'function');
    if (!func) {
      return res.status(400).json({ error: 'Function not found in ABI' });
    }

    // Encode function call data
    const { ethers } = require('ethers');
    const iface = new ethers.Interface(abi);
    const data = iface.encodeFunctionData(functionName, args).slice(2); // Remove 0x

    // Get hex address
    let hexAddress = address;
    if (address.startsWith('w') || address.startsWith('W')) {
      hexAddress = await rpc.getHexAddress(address);
    }

    // Call contract
    const result = await rpc.callContract(hexAddress, data);

    // Decode result
    if (result && result.executionResult && result.executionResult.output) {
      const decoded = iface.decodeFunctionResult(functionName, '0x' + result.executionResult.output);
      res.json({ result: decoded.length === 1 ? decoded[0].toString() : decoded.map(d => d.toString()) });
    } else {
      res.json({ result: null, raw: result });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/contract/:address/encode', (req, res) => {
  try {
    const address = formatAddress(req.params.address);
    const { functionName, args = [] } = req.body;

    const contractData = statements.getContract.get(address);
    if (!contractData) {
      return res.status(404).json({ error: 'Contract not verified' });
    }

    const abi = JSON.parse(contractData.abi);
    const { ethers } = require('ethers');
    const iface = new ethers.Interface(abi);
    const data = iface.encodeFunctionData(functionName, args);

    res.json({ data, to: address });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ TOKENS ============

router.get('/token/:address', async (req, res) => {
  try {
    const rpc = req.app.locals.rpc;
    let address = req.params.address;

    // Convert base58 to hex if needed
    if (address.startsWith('w') || address.startsWith('W')) {
      try {
        address = await rpc.getHexAddress(address);
      } catch (e) {}
    } else if (address.startsWith('0x')) {
      address = address.slice(2);
    }
    address = address.toLowerCase();

    let token = statements.getToken.get(address);

    // Try to fetch from node if not in DB
    if (!token) {
      const rpc = req.app.locals.rpc;
      try {
        const [name, symbol, decimals, totalSupply] = await Promise.all([
          rpc.getTokenName(address),
          rpc.getTokenSymbol(address),
          rpc.getTokenDecimals(address),
          rpc.getTokenTotalSupply(address)
        ]);

        token = { address, name, symbol, decimals: Number(decimals), total_supply: totalSupply };

        statements.insertToken.run(address, name, symbol, Number(decimals), totalSupply, null);
      } catch (e) {
        return res.status(404).json({ error: 'Token not found' });
      }
    }

    const holderCount = db.prepare(`
      SELECT COUNT(DISTINCT address) as count
      FROM token_balances
      WHERE token_address = ? AND balance != '0'
    `).get(address);

    const transferCount = db.prepare(`
      SELECT COUNT(*) as count FROM token_transfers WHERE token_address = ?
    `).get(address);

    res.json({
      token,
      holders: holderCount?.count || 0,
      transfers: transferCount?.count || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/token/:address/transfers', (req, res) => {
  try {
    const address = formatAddress(req.params.address);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const offset = parseInt(req.query.offset) || 0;

    const transfers = statements.getTokenTransfers.all(address, limit, offset);

    res.json({ transfers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/token/:address/holders', (req, res) => {
  try {
    const address = formatAddress(req.params.address);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const offset = parseInt(req.query.offset) || 0;

    const holders = db.prepare(`
      SELECT address, balance
      FROM token_balances
      WHERE token_address = ? AND balance != '0'
      ORDER BY CAST(balance AS INTEGER) DESC
      LIMIT ? OFFSET ?
    `).all(address, limit, offset);

    res.json({ holders });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/address/:address/tokens', async (req, res) => {
  try {
    const address = formatAddress(req.params.address);
    const tokenBalances = statements.getTokenBalances.all(address);

    res.json({ tokens: tokenBalances });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ LOGS ============

router.get('/address/:address/logs', (req, res) => {
  try {
    const address = formatAddress(req.params.address);
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const offset = parseInt(req.query.offset) || 0;

    const logs = statements.getLogs.all(address, limit, offset);

    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ SEARCH ============

router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query required' });
    }

    const query = q.trim().toLowerCase();
    const results = [];

    // Check if it's a block number
    if (/^\d+$/.test(query)) {
      const block = statements.getBlock.get(parseInt(query));
      if (block) {
        results.push({ type: 'block', data: block });
      }
    }

    // Check if it's a hash (block or tx)
    if (query.startsWith('0x') && query.length === 66) {
      const block = statements.getBlockByHash.get(query);
      if (block) {
        results.push({ type: 'block', data: block });
      }

      const tx = statements.getTx.get(query);
      if (tx) {
        results.push({ type: 'transaction', data: tx });
      }
    }

    // Check if it's an address (hex or base58)
    if ((query.startsWith('0x') && query.length === 42) ||
        (query.startsWith('w') && query.length >= 34)) {
      results.push({ type: 'address', data: { address: query } });

      const token = statements.getToken.get(query);
      if (token) {
        results.push({ type: 'token', data: token });
      }
    }

    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ STATS ============

router.get('/stats', (req, res) => {
  try {
    const stats = statements.getStats.get();
    res.json({ stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ADDRESS CONVERSION ============

router.get('/address/convert/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const rpc = req.app.locals.rpc;

    let hexAddress, base58Address;

    // Detect format and convert
    if (address.startsWith('0x')) {
      hexAddress = address.slice(2);
      base58Address = await rpc.fromHexAddress(hexAddress);
    } else if (address.startsWith('w') || address.startsWith('W')) {
      base58Address = address;
      hexAddress = await rpc.getHexAddress(address);
    } else if (address.length === 40) {
      // Assume hex without 0x prefix
      hexAddress = address;
      base58Address = await rpc.fromHexAddress(address);
    } else {
      return res.status(400).json({ error: 'Invalid address format' });
    }

    res.json({
      hex: '0x' + hexAddress,
      base58: base58Address,
      input: address
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ RPC PROXY ============

router.post('/rpc', async (req, res) => {
  try {
    const rpc = req.app.locals.rpc;
    const { method, params = [] } = req.body;

    const result = await rpc.call(method, params);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ENHANCED CONTRACT INTERACTION (QTUM-STYLE) ============

// Get contract details with bytecode and parsed ABI
router.get('/contract/:address/details', async (req, res) => {
  try {
    const rpc = req.app.locals.rpc;
    let address = req.params.address;

    // Convert base58 to hex if needed
    if (address.startsWith('w') || address.startsWith('W')) {
      address = await rpc.getHexAddress(address);
    } else if (address.startsWith('0x')) {
      address = address.slice(2);
    }

    // Get contract bytecode
    let bytecode = null;
    try {
      bytecode = await rpc.getContractCode(address);
    } catch (e) {}

    if (!bytecode || bytecode === '0x') {
      return res.status(404).json({ error: 'No contract at this address' });
    }

    // Get verified contract info if exists
    const verified = statements.getContract.get(address.toLowerCase());

    // Get base58 address
    let base58 = null;
    try {
      base58 = await rpc.fromHexAddress(address);
    } catch (e) {}

    // Parse ABI if verified
    let readFunctions = [];
    let writeFunctions = [];
    let events = [];

    if (verified && verified.abi) {
      try {
        const abi = JSON.parse(verified.abi);
        for (const item of abi) {
          if (item.type === 'function') {
            const func = {
              name: item.name,
              inputs: item.inputs || [],
              outputs: item.outputs || [],
              stateMutability: item.stateMutability || 'nonpayable'
            };
            if (item.stateMutability === 'view' || item.stateMutability === 'pure') {
              readFunctions.push(func);
            } else {
              writeFunctions.push(func);
            }
          } else if (item.type === 'event') {
            events.push({
              name: item.name,
              inputs: item.inputs || []
            });
          }
        }
      } catch (e) {}
    }

    res.json({
      address: '0x' + address,
      base58Address: base58,
      bytecode,
      bytecodeSize: bytecode ? (bytecode.length - 2) / 2 : 0,
      verified: !!verified,
      name: verified?.name,
      compiler: verified?.compiler_version,
      sourceCode: verified?.source_code,
      abi: verified?.abi,
      readFunctions,
      writeFunctions,
      events
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Call contract function (read-only)
router.post('/contract/:address/call', async (req, res) => {
  try {
    const rpc = req.app.locals.rpc;
    let address = req.params.address;
    const { data, abi, functionName, args = [], sender } = req.body;

    // Convert base58 to hex if needed
    if (address.startsWith('w') || address.startsWith('W')) {
      address = await rpc.getHexAddress(address);
    } else if (address.startsWith('0x')) {
      address = address.slice(2);
    }

    let callData = data;
    let funcAbi = null;

    // If we have function name and ABI, encode the call
    if (functionName && abi) {
      try {
        const { ethers } = require('ethers');
        const iface = new ethers.Interface(typeof abi === 'string' ? JSON.parse(abi) : abi);
        callData = iface.encodeFunctionData(functionName, args).slice(2);
        funcAbi = iface.getFunction(functionName);
      } catch (e) {
        return res.status(400).json({ error: 'Failed to encode function call: ' + e.message });
      }
    }

    if (!callData) {
      return res.status(400).json({ error: 'Either data or functionName+abi required' });
    }

    // Remove 0x prefix if present
    if (callData.startsWith('0x')) callData = callData.slice(2);

    // Call the contract
    const result = await rpc.callContract(address, callData, sender);

    // Decode result if we have ABI
    let decoded = null;
    if (result?.executionResult?.output && funcAbi && abi) {
      try {
        const { ethers } = require('ethers');
        const iface = new ethers.Interface(typeof abi === 'string' ? JSON.parse(abi) : abi);
        const decodedResult = iface.decodeFunctionResult(functionName, '0x' + result.executionResult.output);
        decoded = decodedResult.toArray().map(v => {
          if (typeof v === 'bigint') return v.toString();
          if (v._isBigNumber) return v.toString();
          return v;
        });
      } catch (e) {}
    }

    res.json({
      success: result?.executionResult?.excepted === 'None',
      gasUsed: result?.executionResult?.gasUsed,
      output: result?.executionResult?.output,
      decoded,
      excepted: result?.executionResult?.excepted,
      raw: result
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get contract storage at slot
router.get('/contract/:address/storage/:slot', async (req, res) => {
  try {
    const rpc = req.app.locals.rpc;
    let address = req.params.address;
    const slot = req.params.slot;

    // Convert base58 to hex if needed
    if (address.startsWith('w') || address.startsWith('W')) {
      address = await rpc.getHexAddress(address);
    } else if (address.startsWith('0x')) {
      address = address.slice(2);
    }

    // Get storage value
    const value = await rpc.call('getstorage', [address, slot]);

    res.json({
      address: '0x' + address,
      slot,
      value: value || '0x0000000000000000000000000000000000000000000000000000000000000000'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get contract events/logs
router.get('/contract/:address/events', async (req, res) => {
  try {
    const rpc = req.app.locals.rpc;
    let address = req.params.address;
    const fromBlock = parseInt(req.query.from) || 0;
    const toBlock = parseInt(req.query.to) || await rpc.getBlockCount();
    const topic = req.query.topic;

    // Convert base58 to hex if needed
    if (address.startsWith('w') || address.startsWith('W')) {
      address = await rpc.getHexAddress(address);
    } else if (address.startsWith('0x')) {
      address = address.slice(2);
    }

    // Search logs
    const filter = { addresses: [address] };
    const topicFilter = topic ? { topics: [topic] } : {};

    const logs = await rpc.call('searchlogs', [fromBlock, toBlock, filter, topicFilter]);

    // Get verified contract for event decoding
    const verified = statements.getContract.get(address.toLowerCase());
    let eventDefs = {};
    if (verified && verified.abi) {
      try {
        const { ethers } = require('ethers');
        const abi = JSON.parse(verified.abi);
        const iface = new ethers.Interface(abi);
        for (const item of abi) {
          if (item.type === 'event') {
            const sig = iface.getEvent(item.name).topicHash;
            eventDefs[sig.slice(2)] = { name: item.name, inputs: item.inputs, iface };
          }
        }
      } catch (e) {}
    }

    // Process and decode events
    const events = [];
    for (const log of logs) {
      for (const entry of (log.log || [])) {
        const topic0 = entry.topics?.[0];
        const eventDef = topic0 ? eventDefs[topic0] : null;

        let decoded = null;
        if (eventDef) {
          try {
            const { ethers } = require('ethers');
            const parsedLog = eventDef.iface.parseLog({
              topics: entry.topics.map(t => '0x' + t),
              data: '0x' + (entry.data || '')
            });
            decoded = {
              name: parsedLog.name,
              args: parsedLog.args.toArray().map(v => typeof v === 'bigint' ? v.toString() : v)
            };
          } catch (e) {}
        }

        events.push({
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          address: entry.address,
          topics: entry.topics,
          data: entry.data,
          decoded
        });
      }
    }

    res.json({
      address: '0x' + address,
      fromBlock,
      toBlock,
      count: events.length,
      events: events.reverse()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Encode function call data (for wallet signing)
router.post('/contract/encode', async (req, res) => {
  try {
    const { abi, functionName, args = [] } = req.body;

    if (!abi || !functionName) {
      return res.status(400).json({ error: 'ABI and functionName required' });
    }

    const { ethers } = require('ethers');
    const iface = new ethers.Interface(typeof abi === 'string' ? JSON.parse(abi) : abi);
    const data = iface.encodeFunctionData(functionName, args);

    // Get function selector
    const selector = data.slice(0, 10);

    res.json({
      data,
      selector,
      functionName,
      args
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Decode function call data
router.post('/contract/decode', async (req, res) => {
  try {
    const { abi, data } = req.body;

    if (!abi || !data) {
      return res.status(400).json({ error: 'ABI and data required' });
    }

    const { ethers } = require('ethers');
    const iface = new ethers.Interface(typeof abi === 'string' ? JSON.parse(abi) : abi);

    // Try to decode
    const decoded = iface.parseTransaction({ data });

    res.json({
      functionName: decoded.name,
      args: decoded.args.toArray().map(v => typeof v === 'bigint' ? v.toString() : v),
      signature: decoded.signature,
      selector: decoded.selector
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Calculate PoW hashrate from observed block production rate
// The RPC networkhashps is broken for hybrid PoW/PoS chains
async function calculatePoWHashrate(rpc, currentHeight) {
  try {
    const windowSize = 100;
    const startHeight = Math.max(0, currentHeight - windowSize);
    const blocks = [];

    for (let h = currentHeight; h > startHeight; h--) {
      const block = await rpc.getBlock(h, 1);
      blocks.push(block);
    }

    const powBlocks = blocks.filter(b => b.flags === 'proof-of-work');
    if (powBlocks.length < 2) return 0;

    const timeSpan = blocks[0].time - blocks[blocks.length - 1].time;
    if (timeSpan <= 0) return 0;

    const powDifficulty = powBlocks[0].difficulty || 1.52587890625e-05;
    return (powBlocks.length * powDifficulty * Math.pow(2, 32)) / timeSpan;
  } catch {
    return 0;
  }
}

// Cache hashrate to avoid recalculating on every request
let cachedHashrate = { value: 0, height: 0 };

// Get chain info for frontend
router.get('/chain', async (req, res) => {
  try {
    const rpc = req.app.locals.rpc;
    const [blockchainInfo, stakingInfo, miningInfo, difficultyInfo, txOutSetInfo] = await Promise.all([
      rpc.getBlockchainInfo(),
      rpc.getStakingInfo().catch(() => null),
      rpc.getMiningInfo().catch(() => null),
      rpc.getDifficulty().catch(() => null),
      rpc.getTxOutSetInfo().catch(() => null)
    ]);

    // Recalculate hashrate every 10 blocks
    const currentHeight = blockchainInfo.blocks;
    if (currentHeight - cachedHashrate.height >= 10 || cachedHashrate.value === 0) {
      cachedHashrate.value = await calculatePoWHashrate(rpc, currentHeight);
      cachedHashrate.height = currentHeight;
    }

    // Use total_amount from gettxoutsetinfo if moneysupply is 0
    const moneysupply = blockchainInfo.moneysupply || txOutSetInfo?.total_amount || 0;

    // Build miningInfo from available sources (getmininginfo requires wallet, getdifficulty doesn't)
    const miningData = miningInfo ? {
      ...miningInfo,
      networkhashps: cachedHashrate.value,
      networkhashps_rpc: miningInfo.networkhashps
    } : {
      difficulty: difficultyInfo || {},
      networkhashps: cachedHashrate.value
    };

    res.json({
      ...blockchainInfo,
      moneysupply,
      stakingInfo,
      miningInfo: miningData
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
