const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = 3000;

// RPC Configuration
const RPC_URL = 'http://127.0.0.1:3889';
const RPC_USER = 'wattxrpc';
const RPC_PASS = 'wattxpass123';

// ERC20 Event signatures
const TRANSFER_TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const APPROVAL_TOPIC = '8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';

// RPC Call Helper
async function rpcCall(method, params = []) {
    const response = await axios.post(RPC_URL, {
        jsonrpc: '1.0',
        id: Date.now(),
        method,
        params
    }, {
        auth: { username: RPC_USER, password: RPC_PASS }
    });
    return response.data.result;
}

// Helper to decode ABI-encoded string
function decodeString(hex) {
    if (!hex || hex === '0x' || hex.length < 128) return '';
    try {
        const offset = parseInt(hex.slice(0, 64), 16) * 2;
        const length = parseInt(hex.slice(64, 128), 16);
        const data = hex.slice(128, 128 + length * 2);
        return Buffer.from(data, 'hex').toString('utf8');
    } catch (e) {
        return '';
    }
}

// Helper to decode uint256 from hex
function decodeUint256(hex) {
    if (!hex || hex === '0x') return '0';
    return BigInt('0x' + hex).toString();
}

// Helper to decode address from padded hex (32 bytes -> 20 bytes)
function decodeAddress(hex) {
    if (!hex || hex.length < 40) return '';
    return hex.slice(-40);
}

// Helper to convert hex address to WATTx base58 address
async function hexToBase58(hexAddr) {
    try {
        const result = await rpcCall('fromhexaddress', [hexAddr]);
        return result;
    } catch (e) {
        return hexAddr;
    }
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.get('/api/info', async (req, res) => {
    try {
        const info = await rpcCall('getblockchaininfo');
        const staking = await rpcCall('getstakinginfo');
        res.json({ ...info, staking });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/blocks', async (req, res) => {
    try {
        const count = await rpcCall('getblockcount');
        const blocks = [];
        const limit = Math.min(20, count);
        for (let i = count; i > count - limit && i >= 0; i--) {
            const hash = await rpcCall('getblockhash', [i]);
            const block = await rpcCall('getblock', [hash]);
            blocks.push({
                height: block.height,
                hash: block.hash,
                time: block.time,
                txCount: block.nTx,
                size: block.size
            });
        }
        res.json({ count, blocks });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/block/:id', async (req, res) => {
    try {
        let hash = req.params.id;
        if (/^\d+$/.test(hash)) {
            hash = await rpcCall('getblockhash', [parseInt(hash)]);
        }
        const block = await rpcCall('getblock', [hash, 2]);
        res.json(block);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/tx/:txid', async (req, res) => {
    try {
        let tx;
        try {
            tx = await rpcCall('getrawtransaction', [req.params.txid, true]);
        } catch (e) {
            tx = await rpcCall('gettransaction', [req.params.txid]);
        }
        const receipt = await rpcCall('gettransactionreceipt', [req.params.txid]).catch(() => null);
        res.json({ ...tx, receipt });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/address/:addr', async (req, res) => {
    try {
        const utxos = await rpcCall('listunspent', [0, 9999999, [req.params.addr]]).catch(() => []);
        const balance = utxos.reduce((sum, u) => sum + u.amount, 0);
        res.json({ address: req.params.addr, balance, utxos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/contract/:addr', async (req, res) => {
    try {
        const code = await rpcCall('getcontractcode', [req.params.addr]);
        const storage = await rpcCall('getstorage', [req.params.addr]).catch(() => ({}));
        res.json({ address: req.params.addr, code, storage });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/contract/:addr/call/:data', async (req, res) => {
    try {
        const result = await rpcCall('callcontract', [req.params.addr, req.params.data]);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get full token info
app.get('/api/token/:addr', async (req, res) => {
    try {
        const addr = req.params.addr;

        // Get token info: name, symbol, decimals, totalSupply
        const [nameRes, symbolRes, decimalsRes, totalSupplyRes, codeRes] = await Promise.all([
            rpcCall('callcontract', [addr, '06fdde03']),
            rpcCall('callcontract', [addr, '95d89b41']),
            rpcCall('callcontract', [addr, '313ce567']),
            rpcCall('callcontract', [addr, '18160ddd']),
            rpcCall('getcontractcode', [addr]).catch(() => null)
        ]);

        const decimals = parseInt(decimalsRes.executionResult.output || '0', 16);
        const totalSupply = decodeUint256(totalSupplyRes.executionResult.output);

        res.json({
            address: addr,
            name: decodeString(nameRes.executionResult.output),
            symbol: decodeString(symbolRes.executionResult.output),
            decimals: decimals,
            totalSupply: totalSupply,
            totalSupplyFormatted: formatTokenAmount(totalSupply, decimals),
            hasCode: !!codeRes,
            codeSize: codeRes ? codeRes.length / 2 : 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get token transfers (events)
app.get('/api/token/:addr/transfers', async (req, res) => {
    try {
        const addr = req.params.addr;
        const fromBlock = parseInt(req.query.from) || 0;
        const toBlock = parseInt(req.query.to) || await rpcCall('getblockcount');

        // Search for Transfer events
        const results = await rpcCall('searchlogs', [fromBlock, toBlock, { addresses: [addr] }, { topics: [TRANSFER_TOPIC] }]);

        const transfers = [];
        for (const result of results) {
            // Each result may have multiple log entries
            for (const log of (result.log || [])) {
                if (log.topics && log.topics[0] === TRANSFER_TOPIC) {
                    const from = decodeAddress(log.topics[1]);
                    const to = decodeAddress(log.topics[2]);
                    const value = decodeUint256(log.data);

                    transfers.push({
                        txid: result.transactionHash,
                        blockNumber: result.blockNumber,
                        from: from,
                        fromBase58: await hexToBase58(from).catch(() => from),
                        to: to,
                        toBase58: await hexToBase58(to).catch(() => to),
                        value: value
                    });
                }
            }
        }

        res.json({
            address: addr,
            totalTransfers: transfers.length,
            transfers: transfers.reverse() // Most recent first
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get token balance for an address
app.get('/api/token/:addr/balance/:holder', async (req, res) => {
    try {
        const addr = req.params.addr;
        let holder = req.params.holder;

        // Convert base58 address to hex if needed
        if (holder.startsWith('W')) {
            holder = await rpcCall('gethexaddress', [holder]);
        }

        // Pad address to 32 bytes
        const paddedHolder = holder.padStart(64, '0');
        const data = '70a08231' + paddedHolder; // balanceOf(address)

        const result = await rpcCall('callcontract', [addr, data]);
        const balance = decodeUint256(result.executionResult.output);

        // Get token decimals for formatting
        const decimalsRes = await rpcCall('callcontract', [addr, '313ce567']);
        const decimals = parseInt(decimalsRes.executionResult.output || '0', 16);

        res.json({
            token: addr,
            holder: req.params.holder,
            holderHex: holder,
            balance: balance,
            balanceFormatted: formatTokenAmount(balance, decimals),
            decimals: decimals
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get token holders (derived from Transfer events)
app.get('/api/token/:addr/holders', async (req, res) => {
    try {
        const addr = req.params.addr;
        const toBlock = await rpcCall('getblockcount');

        // Search for all Transfer events
        const results = await rpcCall('searchlogs', [0, toBlock, { addresses: [addr] }, { topics: [TRANSFER_TOPIC] }]);

        // Track balances
        const balances = {};

        for (const result of results) {
            for (const log of (result.log || [])) {
                if (log.topics && log.topics[0] === TRANSFER_TOPIC) {
                    const from = decodeAddress(log.topics[1]);
                    const to = decodeAddress(log.topics[2]);
                    const value = BigInt('0x' + (log.data || '0'));

                    if (from !== '0000000000000000000000000000000000000000') {
                        balances[from] = (balances[from] || BigInt(0)) - value;
                    }
                    if (to !== '0000000000000000000000000000000000000000') {
                        balances[to] = (balances[to] || BigInt(0)) + value;
                    }
                }
            }
        }

        // Get decimals
        const decimalsRes = await rpcCall('callcontract', [addr, '313ce567']);
        const decimals = parseInt(decimalsRes.executionResult.output || '0', 16);

        // Convert to sorted array
        const holders = await Promise.all(
            Object.entries(balances)
                .filter(([_, bal]) => bal > 0)
                .sort((a, b) => (BigInt(b[1]) > BigInt(a[1]) ? 1 : -1))
                .map(async ([hexAddr, balance]) => ({
                    address: hexAddr,
                    addressBase58: await hexToBase58(hexAddr).catch(() => hexAddr),
                    balance: balance.toString(),
                    balanceFormatted: formatTokenAmount(balance.toString(), decimals)
                }))
        );

        res.json({
            address: addr,
            totalHolders: holders.length,
            decimals: decimals,
            holders: holders
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all QRC20 tokens on the chain
app.get('/api/tokens', async (req, res) => {
    try {
        const toBlock = await rpcCall('getblockcount');

        // Search for Transfer events to find token contracts
        const results = await rpcCall('searchlogs', [0, toBlock, {}, { topics: [TRANSFER_TOPIC] }]);

        // Get unique contract addresses from the results
        const tokenAddrs = [...new Set(results.map(r => r.contractAddress))];

        // Get info for each token
        const tokens = await Promise.all(tokenAddrs.map(async (addr) => {
            try {
                const [nameRes, symbolRes, decimalsRes, totalSupplyRes] = await Promise.all([
                    rpcCall('callcontract', [addr, '06fdde03']),
                    rpcCall('callcontract', [addr, '95d89b41']),
                    rpcCall('callcontract', [addr, '313ce567']),
                    rpcCall('callcontract', [addr, '18160ddd'])
                ]);

                const decimals = parseInt(decimalsRes.executionResult.output || '0', 16);
                const totalSupply = decodeUint256(totalSupplyRes.executionResult.output);

                return {
                    address: addr,
                    name: decodeString(nameRes.executionResult.output),
                    symbol: decodeString(symbolRes.executionResult.output),
                    decimals: decimals,
                    totalSupply: totalSupply,
                    totalSupplyFormatted: formatTokenAmount(totalSupply, decimals)
                };
            } catch (e) {
                return null;
            }
        }));

        res.json({
            totalTokens: tokens.filter(t => t).length,
            tokens: tokens.filter(t => t && t.name)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Helper to format token amounts
function formatTokenAmount(amount, decimals) {
    const str = amount.toString().padStart(decimals + 1, '0');
    const whole = str.slice(0, -decimals) || '0';
    const frac = str.slice(-decimals);
    const formatted = frac ? `${whole}.${frac.replace(/0+$/, '')}` : whole;
    return formatted.replace(/\.$/, '');
}

app.listen(PORT, () => {
    console.log(`WATTx Explorer running at http://localhost:${PORT}`);
});
