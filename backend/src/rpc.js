const axios = require('axios');

class WATTxRPC {
  constructor(url) {
    // Parse URL for auth
    const urlObj = new URL(url);
    this.baseUrl = `${urlObj.protocol}//${urlObj.host}`;

    if (urlObj.username && urlObj.password) {
      this.auth = {
        username: urlObj.username,
        password: urlObj.password
      };
    }

    this.requestId = 0;
    this.walletName = null; // Set after detecting multi-wallet
  }

  async call(method, params = [], useWallet = false) {
    try {
      const url = (useWallet && this.walletName)
        ? `${this.baseUrl}/wallet/${this.walletName}`
        : this.baseUrl;

      const response = await axios.post(url, {
        jsonrpc: '2.0',
        id: ++this.requestId,
        method,
        params
      }, {
        auth: this.auth,
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.data.error) {
        throw new Error(response.data.error.message);
      }

      return response.data.result;
    } catch (error) {
      if (error.response?.data?.error) {
        throw new Error(error.response.data.error.message);
      }
      throw error;
    }
  }

  async detectWallet() {
    try {
      const wallets = await this.call('listwallets');
      if (wallets && wallets.length > 0) {
        this.walletName = wallets[0];
        console.log(`Multi-wallet detected, using wallet: ${this.walletName}`);
      }
    } catch (e) {
      // Single wallet mode, no action needed
    }
  }

  // Block methods
  async getBlockCount() {
    return this.call('getblockcount');
  }

  async getBlockHash(height) {
    return this.call('getblockhash', [height]);
  }

  async getBlock(hashOrHeight, verbosity = 2) {
    let hash = hashOrHeight;
    if (typeof hashOrHeight === 'number') {
      hash = await this.getBlockHash(hashOrHeight);
    }
    return this.call('getblock', [hash, verbosity]);
  }

  async getBestBlockHash() {
    return this.call('getbestblockhash');
  }

  // Transaction methods
  async getTransaction(txid, verbose = true) {
    return this.call('getrawtransaction', [txid, verbose]);
  }

  async getTransactionReceipt(txid) {
    return this.call('gettransactionreceipt', [txid]);
  }

  async sendRawTransaction(hex) {
    return this.call('sendrawtransaction', [hex]);
  }

  // Account methods
  async getBalance(address) {
    // Use listunspent to calculate balance
    const utxos = await this.call('scantxoutset', ['start', [`addr(${address})`]]);
    return utxos?.total_amount || 0;
  }

  async getAddressInfo(address) {
    try {
      return this.call('validateaddress', [address]);
    } catch {
      return { isvalid: false };
    }
  }

  // Contract methods
  async getContractCode(address) {
    return this.call('getcontractcode', [address]);
  }

  async callContract(address, data, senderAddress = null) {
    const params = [address, data];
    if (senderAddress) params.push(senderAddress);
    return this.call('callcontract', params);
  }

  async listContracts(start = 1, max = 100) {
    return this.call('listcontracts', [start, max]);
  }

  // Token methods (QRC-20)
  async getTokenName(contractAddress) {
    return this.call('qrc20name', [contractAddress]);
  }

  async getTokenSymbol(contractAddress) {
    return this.call('qrc20symbol', [contractAddress]);
  }

  async getTokenDecimals(contractAddress) {
    return this.call('qrc20decimals', [contractAddress]);
  }

  async getTokenTotalSupply(contractAddress) {
    return this.call('qrc20totalsupply', [contractAddress]);
  }

  async getTokenBalance(contractAddress, address) {
    return this.call('qrc20balanceof', [contractAddress, address]);
  }

  async getTokenTransactions(contractAddress, address, fromBlock = 0) {
    return this.call('qrc20listtransactions', [contractAddress, address, fromBlock]);
  }

  // Mining/Staking info (require wallet for multi-wallet daemons)
  async getMiningInfo() {
    return this.call('getmininginfo', [], true);
  }

  async getStakingInfo() {
    return this.call('getstakinginfo', [], true);
  }

  // Get difficulty (works without wallet)
  async getDifficulty() {
    return this.call('getdifficulty');
  }

  // Get network hashrate with custom block window (default 720 blocks = ~12 hours)
  async getNetworkHashPs(nblocks = 720) {
    return this.call('getnetworkhashps', [nblocks]);
  }

  async getBlockchainInfo() {
    return this.call('getblockchaininfo');
  }

  async getNetworkInfo() {
    return this.call('getnetworkinfo');
  }

  // Get UTXO set info (includes total_amount for money supply)
  async getTxOutSetInfo() {
    return this.call('gettxoutsetinfo');
  }

  // Search logs
  async searchLogs(fromBlock, toBlock, addresses = [], topics = []) {
    return this.call('searchlogs', [fromBlock, toBlock, { addresses, topics }]);
  }

  // Utility
  async getHexAddress(address) {
    return this.call('gethexaddress', [address]);
  }

  async fromHexAddress(hexAddress) {
    return this.call('fromhexaddress', [hexAddress]);
  }

  // Decode raw transaction
  async decodeRawTransaction(hex) {
    return this.call('decoderawtransaction', [hex]);
  }
}

module.exports = WATTxRPC;
