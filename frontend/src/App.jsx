import { BrowserRouter, Routes, Route, Link, useNavigate, useParams } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3001/api' : '/api';

// Utility functions
const truncateHash = (hash, chars = 8) => {
  if (!hash) return '';
  return `${hash.slice(0, chars + 2)}...${hash.slice(-chars)}`;
};

const formatTime = (timestamp) => {
  return new Date(timestamp * 1000).toLocaleString();
};

const formatNumber = (num) => {
  return new Intl.NumberFormat().format(num);
};

const formatHashRate = (hashRate) => {
  if (!hashRate || hashRate === 0) return '0 H/s';
  const units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s'];
  let unitIndex = 0;
  let value = hashRate;
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex++;
  }
  return `${value.toFixed(2)} ${units[unitIndex]}`;
};

const formatWTX = (satoshis) => {
  if (!satoshis) return '0';
  return (parseInt(satoshis) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 8 });
};

const formatStakeWeight = (satoshis) => {
  if (!satoshis) return '0 WTX';
  const wtx = satoshis / 1e8;
  if (wtx >= 1e6) return `${(wtx / 1e6).toFixed(2)}M WTX`;
  if (wtx >= 1e3) return `${(wtx / 1e3).toFixed(2)}K WTX`;
  return `${wtx.toFixed(2)} WTX`;
};

// Header Component
function Header() {
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    const q = searchQuery.trim();

    // Direct navigation based on input pattern
    if (/^\d+$/.test(q)) {
      navigate(`/block/${q}`);
    } else if (q.length === 64 || q.length === 66) {
      // Could be block hash or tx hash
      navigate(`/tx/${q}`);
    } else if (q.startsWith('W') || q.startsWith('w') || q.startsWith('0x')) {
      navigate(`/address/${q}`);
    } else {
      // Try search API
      try {
        const res = await axios.get(`${API_URL}/search?q=${q}`);
        if (res.data.results?.length > 0) {
          const first = res.data.results[0];
          if (first.type === 'block') navigate(`/block/${first.data.height}`);
          else if (first.type === 'transaction') navigate(`/tx/${first.data.hash}`);
          else if (first.type === 'address') navigate(`/address/${first.data.address}`);
          else if (first.type === 'token') navigate(`/token/${first.data.address}`);
        }
      } catch (error) {
        console.error('Search error:', error);
      }
    }
  };

  return (
    <header className="shadow-lg" style={{ background: 'linear-gradient(135deg, #0f1419 0%, #1a1f2e 100%)', borderBottom: '2px solid #D4A826' }}>
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <Link to="/" className="text-2xl font-bold flex items-center gap-2 text-white">
            <img src="/logo.png" alt="WATTx" className="w-8 h-8" />
            <span style={{ color: '#D4A826' }}>WATTx</span> Explorer
          </Link>
          <nav className="hidden md:flex space-x-6">
            <Link to="/" className="text-gray-300 hover:text-[#D4A826] transition">Home</Link>
            <Link to="/blocks" className="text-gray-300 hover:text-[#D4A826] transition">Blocks</Link>
            <Link to="/txs" className="text-gray-300 hover:text-[#D4A826] transition">Transactions</Link>
            <Link to="/tokens" className="text-gray-300 hover:text-[#D4A826] transition">Tokens</Link>
            <Link to="/contracts" className="text-gray-300 hover:text-[#D4A826] transition">Contracts</Link>
          </nav>
          <form onSubmit={handleSearch} className="flex">
            <input
              type="text"
              placeholder="Block, Tx, Address, Token..."
              className="px-4 py-2 rounded-l-lg w-48 md:w-64 focus:outline-none text-gray-100"
              style={{ backgroundColor: '#161b26', border: '1px solid #2a3040' }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button type="submit" className="px-4 py-2 rounded-r-lg font-semibold transition" style={{ backgroundColor: '#D4A826', color: '#0f1419' }}>
              Search
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

// Home Page with Network Stats
function HomePage() {
  const [chainInfo, setChainInfo] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [chainRes, blocksRes, statsRes] = await Promise.all([
          axios.get(`${API_URL}/chain`),
          axios.get(`${API_URL}/blocks?limit=10`),
          axios.get(`${API_URL}/stats`).catch(() => ({ data: { stats: {} } }))
        ]);
        setChainInfo(chainRes.data);
        setBlocks(blocksRes.data.blocks || []);
        setStats(statsRes.data.stats);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="animate-pulse">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            {[1,2,3,4].map(i => <div key={i} className="h-24 bg-[#1a1f2e] rounded-lg"></div>)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Network Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="card" style={{ borderLeft: '4px solid #D4A826' }}>
          <h3 className="text-gray-400 text-sm font-medium">Block Height</h3>
          <p className="text-3xl font-bold text-white">{formatNumber(chainInfo?.blocks || 0)}</p>
          <p className="text-gray-500 text-xs mt-1">Chain: {chainInfo?.chain || 'main'}</p>
        </div>
        <div className="card" style={{ borderLeft: '4px solid #4ade80' }}>
          <h3 className="text-gray-400 text-sm font-medium">Money Supply</h3>
          <p className="text-3xl font-bold text-white">{formatNumber(chainInfo?.moneysupply || 0)}</p>
          <p className="text-gray-500 text-xs mt-1">WTX in circulation</p>
        </div>
        <div className="card" style={{ borderLeft: '4px solid #a78bfa' }}>
          <h3 className="text-gray-400 text-sm font-medium">Network Hashrate</h3>
          <p className="text-3xl font-bold text-white">{formatHashRate(chainInfo?.miningInfo?.networkhashps || 0)}</p>
          <p className="text-gray-500 text-xs mt-1">PoW Mining Power</p>
        </div>
        <div className="card" style={{ borderLeft: '4px solid #fb923c' }}>
          <h3 className="text-gray-400 text-sm font-medium">Stake Weight</h3>
          <p className="text-3xl font-bold text-white">{formatStakeWeight(chainInfo?.stakingInfo?.netstakeweight || chainInfo?.miningInfo?.netstakeweight || 0)}</p>
          <p className="text-gray-500 text-xs mt-1">Mature coins staking</p>
        </div>
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="card text-center">
          <p className="text-gray-500 text-xs">Avg Block Time</p>
          <p className="font-bold text-white">{chainInfo?.avgBlockTime ? `${chainInfo.avgBlockTime}s` : '-'}</p>
        </div>
        <div className="card text-center">
          <p className="text-gray-500 text-xs">PoW / PoS Ratio</p>
          <p className="font-bold text-white">{chainInfo?.powPercent || 0}% / {chainInfo?.posPercent || 0}%</p>
        </div>
        <div className="card text-center">
          <p className="text-gray-500 text-xs">Network Staking</p>
          <p className="font-bold text-white">{(chainInfo?.stakingInfo?.netstakeweight > 0 || chainInfo?.posPercent > 0) ? 'Active' : 'Inactive'}</p>
        </div>
        <div className="card text-center">
          <p className="text-gray-500 text-xs">Difficulty (PoW)</p>
          <p className="font-bold text-white">{chainInfo?.difficulty?.toExponential(2) || chainInfo?.miningInfo?.difficulty?.['proof-of-work']?.toExponential(2) || '0'}</p>
        </div>
      </div>

      {/* Recent Blocks */}
      <div className="card">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Recent Blocks</h2>
          <Link to="/blocks" className="text-[#D4A826] hover:text-[#E8C84A] text-sm">View all →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-[#161b26]">
                <th className="py-3 px-2 text-left text-sm font-semibold">Height</th>
                <th className="py-3 px-2 text-left text-sm font-semibold">Hash</th>
                <th className="py-3 px-2 text-left text-sm font-semibold">Type</th>
                <th className="py-3 px-2 text-left text-sm font-semibold">Txs</th>
                <th className="py-3 px-2 text-left text-sm font-semibold">Time</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((block) => (
                <tr key={block.height} className="border-b hover:bg-[#222838] transition">
                  <td className="py-3 px-2">
                    <Link to={`/block/${block.height}`} className="text-[#D4A826] hover:text-[#E8C84A] font-medium">
                      {formatNumber(block.height)}
                    </Link>
                  </td>
                  <td className="py-3 px-2 font-mono text-sm">
                    <Link to={`/block/${block.hash}`} className="text-[#D4A826] hover:text-[#E8C84A]">
                      {truncateHash(block.hash)}
                    </Link>
                  </td>
                  <td className="py-3 px-2">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${block.is_pos ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                      {block.is_pos ? 'PoS' : 'PoW'}
                    </span>
                  </td>
                  <td className="py-3 px-2">{block.tx_count}</td>
                  <td className="py-3 px-2 text-sm text-gray-500">{formatTime(block.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Block Page
function BlockPage() {
  const { id } = useParams();
  const [block, setBlock] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBlock = async () => {
      try {
        const res = await axios.get(`${API_URL}/block/${id}`);
        setBlock(res.data.block);
        setTransactions(res.data.transactions || []);
      } catch (error) {
        console.error('Error fetching block:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchBlock();
  }, [id]);

  if (loading) return <div className="container mx-auto px-4 py-8">Loading...</div>;
  if (!block) return <div className="container mx-auto px-4 py-8">Block not found</div>;

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Block #{formatNumber(block.height)}</h1>

      <div className="card mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-gray-500 text-sm">Block Hash</p>
            <p className="font-mono text-sm break-all">{block.hash}</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">Parent Hash</p>
            <p className="font-mono text-sm break-all">
              <Link to={`/block/${block.parent_hash}`} className="text-[#D4A826]">{block.parent_hash}</Link>
            </p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">Timestamp</p>
            <p>{formatTime(block.timestamp)}</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">Type</p>
            <span className={`px-2 py-1 rounded text-xs font-medium ${block.is_pos ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
              {block.is_pos ? 'Proof of Stake' : 'Proof of Work'}
            </span>
          </div>
          <div>
            <p className="text-gray-500 text-sm">Transactions</p>
            <p>{block.tx_count}</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">Size</p>
            <p>{formatNumber(block.size)} bytes</p>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="text-xl font-bold mb-4">Transactions ({transactions.length})</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-[#161b26]">
                <th className="py-2 text-left text-sm">Hash</th>
                <th className="py-2 text-left text-sm">From</th>
                <th className="py-2 text-left text-sm">To</th>
                <th className="py-2 text-left text-sm">Value</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.hash} className="border-b hover:bg-[#222838]">
                  <td className="py-2 font-mono text-sm">
                    <Link to={`/tx/${tx.hash}`} className="text-[#D4A826]">{truncateHash(tx.hash)}</Link>
                  </td>
                  <td className="py-2 font-mono text-sm">
                    {tx.from_address ? (
                      <Link to={`/address/${tx.from_address}`} className="text-emerald-400">{truncateHash(tx.from_address)}</Link>
                    ) : '-'}
                  </td>
                  <td className="py-2 font-mono text-sm">
                    {tx.to_address ? (
                      <Link to={`/address/${tx.to_address}`} className="text-emerald-400">{truncateHash(tx.to_address)}</Link>
                    ) : <span className="text-purple-400">Contract Creation</span>}
                  </td>
                  <td className="py-2">{formatWTX(tx.value)} WTX</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Transaction Page
function TransactionPage() {
  const { hash } = useParams();
  const [tx, setTx] = useState(null);
  const [logs, setLogs] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTx = async () => {
      try {
        const res = await axios.get(`${API_URL}/tx/${hash}`);
        setTx(res.data.transaction);
        setLogs(res.data.logs || []);
        setTransfers(res.data.transfers || []);
      } catch (error) {
        console.error('Error fetching transaction:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchTx();
  }, [hash]);

  if (loading) return <div className="container mx-auto px-4 py-8">Loading...</div>;
  if (!tx) return <div className="container mx-auto px-4 py-8">Transaction not found</div>;

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Transaction Details</h1>

      <div className="card mb-6">
        <div className="space-y-4">
          <div>
            <p className="text-gray-500 text-sm">Transaction Hash</p>
            <p className="font-mono text-sm break-all">{tx.hash}</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">Block</p>
            <Link to={`/block/${tx.block_height}`} className="text-[#D4A826] font-medium">{formatNumber(tx.block_height)}</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-gray-500 text-sm">From</p>
              {tx.from_address ? (
                <Link to={`/address/${tx.from_address}`} className="font-mono text-sm text-emerald-400 break-all">{tx.from_address}</Link>
              ) : <span className="text-gray-400">-</span>}
            </div>
            <div>
              <p className="text-gray-500 text-sm">To</p>
              {tx.to_address ? (
                <Link to={`/address/${tx.to_address}`} className="font-mono text-sm text-emerald-400 break-all">{tx.to_address}</Link>
              ) : <span className="text-purple-400">Contract Creation</span>}
            </div>
          </div>
          <div>
            <p className="text-gray-500 text-sm">Value</p>
            <p className="font-medium">{formatWTX(tx.value)} WTX</p>
          </div>
        </div>
      </div>

      {transfers.length > 0 && (
        <div className="card mb-6">
          <h2 className="text-xl font-bold mb-4">Token Transfers ({transfers.length})</h2>
          {transfers.map((t, i) => (
            <div key={i} className="border-b py-3 last:border-0">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-500">From:</span>
                <Link to={`/address/${t.from_address}`} className="font-mono text-emerald-400">{truncateHash(t.from_address)}</Link>
                <span className="text-gray-500">→</span>
                <Link to={`/address/${t.to_address}`} className="font-mono text-emerald-400">{truncateHash(t.to_address)}</Link>
                <span className="font-medium ml-2">{t.value} {t.symbol || 'tokens'}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {logs.length > 0 && (
        <div className="card">
          <h2 className="text-xl font-bold mb-4">Event Logs ({logs.length})</h2>
          {logs.map((log, i) => (
            <div key={i} className="border-b py-4 last:border-0">
              <p className="text-sm text-gray-500">Log #{log.log_index}</p>
              <p className="font-mono text-sm">Contract: <Link to={`/address/${log.address}`} className="text-[#D4A826]">{truncateHash(log.address, 12)}</Link></p>
              <div className="mt-2 bg-[#161b26] p-2 rounded text-xs font-mono overflow-x-auto">
                {[log.topic0, log.topic1, log.topic2, log.topic3].filter(Boolean).map((t, j) => (
                  <div key={j} className="text-gray-600">[{j}] {t}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Contract Interaction Page (QTUM-style with Etherscan features)
function ContractPage() {
  const { address } = useParams();
  const [contract, setContract] = useState(null);
  const [activeTab, setActiveTab] = useState('read');
  const [loading, setLoading] = useState(true);
  const [callResults, setCallResults] = useState({});
  const [callInputs, setCallInputs] = useState({});

  // Raw call state
  const [rawCallData, setRawCallData] = useState('');
  const [rawCallResult, setRawCallResult] = useState(null);
  const [rawCallLoading, setRawCallLoading] = useState(false);

  // Storage state
  const [storageSlot, setStorageSlot] = useState('0');
  const [storageValue, setStorageValue] = useState(null);
  const [storageLoading, setStorageLoading] = useState(false);

  useEffect(() => {
    const fetchContract = async () => {
      try {
        const res = await axios.get(`${API_URL}/contract/${address}/details`);
        setContract(res.data);
      } catch (error) {
        console.error('Error fetching contract:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchContract();
  }, [address]);

  const callFunction = async (func) => {
    const inputs = callInputs[func.name] || [];
    try {
      setCallResults(prev => ({ ...prev, [func.name]: { loading: true } }));
      const res = await axios.post(`${API_URL}/contract/${address}/call`, {
        functionName: func.name,
        args: inputs,
        abi: contract.abi
      });
      setCallResults(prev => ({
        ...prev,
        [func.name]: {
          success: res.data.success,
          result: res.data.decoded || res.data.output,
          gasUsed: res.data.gasUsed
        }
      }));
    } catch (error) {
      setCallResults(prev => ({ ...prev, [func.name]: { error: error.response?.data?.error || error.message } }));
    }
  };

  const updateInput = (funcName, index, value) => {
    setCallInputs(prev => {
      const inputs = [...(prev[funcName] || [])];
      inputs[index] = value;
      return { ...prev, [funcName]: inputs };
    });
  };

  // Raw contract call (works without ABI)
  const callRaw = async () => {
    if (!rawCallData.trim()) return;
    setRawCallLoading(true);
    setRawCallResult(null);
    try {
      const res = await axios.post(`${API_URL}/contract/${address}/call`, {
        data: rawCallData.replace(/^0x/, '')
      });
      setRawCallResult(res.data);
    } catch (error) {
      setRawCallResult({ error: error.response?.data?.error || error.message });
    } finally {
      setRawCallLoading(false);
    }
  };

  // Read storage slot
  const readStorage = async () => {
    setStorageLoading(true);
    try {
      const res = await axios.get(`${API_URL}/contract/${address}/storage/${storageSlot}`);
      setStorageValue(res.data.value);
    } catch (error) {
      setStorageValue('Error: ' + (error.response?.data?.error || error.message));
    } finally {
      setStorageLoading(false);
    }
  };

  if (loading) return <div className="container mx-auto px-4 py-8">Loading...</div>;
  if (!contract) return <div className="container mx-auto px-4 py-8">Contract not found</div>;

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Smart Contract</h1>
      <p className="font-mono text-sm text-gray-600 mb-6 break-all">{contract.address}</p>

      {/* Contract Info */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <p className="text-gray-500 text-sm">Hex Address</p>
            <p className="font-mono text-sm break-all">{contract.address}</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">Base58 Address</p>
            <p className="font-mono text-sm">{contract.base58Address || 'N/A'}</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">Bytecode Size</p>
            <p>{formatNumber(contract.bytecodeSize)} bytes</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">Verified</p>
            <span className={`px-2 py-1 rounded text-xs ${contract.verified ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
              {contract.verified ? '✓ Verified' : 'Not Verified'}
            </span>
          </div>
          {contract.name && (
            <div>
              <p className="text-gray-500 text-sm">Contract Name</p>
              <p className="font-medium">{contract.name}</p>
            </div>
          )}
          {contract.compiler && (
            <div>
              <p className="text-gray-500 text-sm">Compiler</p>
              <p>{contract.compiler}</p>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b mb-4">
        <button
          onClick={() => setActiveTab('read')}
          className={`px-4 py-2 font-medium ${activeTab === 'read' ? 'border-b-2 border-[#D4A826] text-[#D4A826]' : 'text-gray-500'}`}
        >
          Read Contract
        </button>
        <button
          onClick={() => setActiveTab('write')}
          className={`px-4 py-2 font-medium ${activeTab === 'write' ? 'border-b-2 border-[#D4A826] text-[#D4A826]' : 'text-gray-500'}`}
        >
          Write Contract
        </button>
        <button
          onClick={() => setActiveTab('code')}
          className={`px-4 py-2 font-medium ${activeTab === 'code' ? 'border-b-2 border-[#D4A826] text-[#D4A826]' : 'text-gray-500'}`}
        >
          Code
        </button>
        <button
          onClick={() => setActiveTab('events')}
          className={`px-4 py-2 font-medium ${activeTab === 'events' ? 'border-b-2 border-[#D4A826] text-[#D4A826]' : 'text-gray-500'}`}
        >
          Events
        </button>
      </div>

      {/* Read Functions */}
      {activeTab === 'read' && (
        <div className="space-y-6">
          {/* Raw Call Section - works for all contracts */}
          <div className="card border-2 border-[#2a3040]">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <span className="text-2xl">🔧</span> Low Level Interaction
            </h2>
            <p className="text-gray-600 text-sm mb-4">
              Call contract with raw calldata (works without verified ABI)
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Calldata (hex)</label>
                <input
                  type="text"
                  className="input font-mono"
                  placeholder="0x06fdde03 (name()) or 0x95d89b41 (symbol())"
                  value={rawCallData}
                  onChange={(e) => setRawCallData(e.target.value)}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Common: 0x06fdde03 (name), 0x95d89b41 (symbol), 0x313ce567 (decimals), 0x18160ddd (totalSupply)
                </p>
              </div>
              <button
                onClick={callRaw}
                className="btn btn-primary"
                disabled={rawCallLoading}
              >
                {rawCallLoading ? 'Calling...' : 'Call Contract'}
              </button>
              {rawCallResult && (
                <div className={`p-4 rounded ${rawCallResult.error ? 'bg-red-50' : 'bg-green-50'}`}>
                  {rawCallResult.error ? (
                    <p className="text-red-700">Error: {rawCallResult.error}</p>
                  ) : (
                    <div className="space-y-2">
                      <div>
                        <span className="text-gray-600 text-sm">Success:</span>
                        <span className={`ml-2 ${rawCallResult.success ? 'text-emerald-400' : 'text-red-600'}`}>
                          {rawCallResult.success ? 'Yes' : 'No'}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600 text-sm">Raw Output:</span>
                        <p className="font-mono text-sm break-all bg-white p-2 rounded mt-1">
                          0x{rawCallResult.output || '(empty)'}
                        </p>
                      </div>
                      {rawCallResult.gasUsed && (
                        <div>
                          <span className="text-gray-600 text-sm">Gas Used:</span>
                          <span className="ml-2">{rawCallResult.gasUsed}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Storage Reader */}
          <div className="card border-2 border-[#2a3040]">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <span className="text-2xl">💾</span> Storage Viewer
            </h2>
            <p className="text-gray-600 text-sm mb-4">
              Read contract storage slots directly
            </p>
            <div className="flex gap-3">
              <input
                type="text"
                className="input font-mono flex-1"
                placeholder="Storage slot (0, 1, 2, or hex)"
                value={storageSlot}
                onChange={(e) => setStorageSlot(e.target.value)}
              />
              <button
                onClick={readStorage}
                className="btn bg-purple-600 text-white hover:bg-purple-700"
                disabled={storageLoading}
              >
                {storageLoading ? 'Reading...' : 'Read'}
              </button>
            </div>
            {storageValue && (
              <div className="mt-3 p-3 bg-purple-50 rounded">
                <span className="text-gray-600 text-sm">Value at slot {storageSlot}:</span>
                <p className="font-mono text-sm break-all mt-1">{storageValue}</p>
              </div>
            )}
          </div>

          {/* Verified Contract Functions */}
          {contract.verified && contract.readFunctions.length > 0 && (
            <div className="card">
              <h2 className="text-lg font-bold mb-4">Read Functions (View/Pure)</h2>
              <div className="space-y-4">
                {contract.readFunctions.map((func, i) => (
                  <div key={i} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium text-[#D4A826]">{i + 1}. {func.name}</h3>
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">{func.stateMutability}</span>
                    </div>

                    {func.inputs.length > 0 && (
                      <div className="space-y-2 mb-3">
                        {func.inputs.map((input, j) => (
                          <div key={j}>
                            <label className="text-sm text-gray-600">{input.name || `arg${j}`} ({input.type})</label>
                            <input
                              type="text"
                              className="input mt-1"
                              placeholder={input.type}
                              onChange={(e) => updateInput(func.name, j, e.target.value)}
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={() => callFunction(func)}
                      className="btn btn-primary text-sm"
                      disabled={callResults[func.name]?.loading}
                    >
                      {callResults[func.name]?.loading ? 'Calling...' : 'Query'}
                    </button>

                    {callResults[func.name] && !callResults[func.name].loading && (
                      <div className={`mt-3 p-3 rounded ${callResults[func.name].error ? 'bg-red-50 text-red-700' : 'bg-green-50'}`}>
                        {callResults[func.name].error ? (
                          <p className="text-sm">Error: {callResults[func.name].error}</p>
                        ) : (
                          <>
                            <p className="text-sm font-medium">Result:</p>
                            <p className="font-mono text-sm break-all">
                              {Array.isArray(callResults[func.name].result)
                                ? callResults[func.name].result.join(', ')
                                : String(callResults[func.name].result)}
                            </p>
                            {callResults[func.name].gasUsed && (
                              <p className="text-xs text-gray-500 mt-1">Gas used: {callResults[func.name].gasUsed}</p>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!contract.verified && (
            <div className="card bg-yellow-50 border border-yellow-200">
              <p className="text-yellow-800">
                <strong>Contract not verified.</strong> Use the low-level interaction above, or{' '}
                <Link to="/verify" className="text-[#D4A826] underline">verify the contract</Link> to get function names and types.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Write Functions */}
      {activeTab === 'write' && (
        <div className="card">
          <h2 className="text-lg font-bold mb-4">Write Functions (State Changing)</h2>
          {!contract.verified ? (
            <p className="text-gray-500">Contract not verified. <Link to="/verify" className="text-[#D4A826]">Verify contract</Link> to interact.</p>
          ) : contract.writeFunctions.length === 0 ? (
            <p className="text-gray-500">No write functions found</p>
          ) : (
            <div className="space-y-4">
              {contract.writeFunctions.map((func, i) => (
                <div key={i} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium text-orange-700">{i + 1}. {func.name}</h3>
                    <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded">{func.stateMutability}</span>
                  </div>

                  {func.inputs.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {func.inputs.map((input, j) => (
                        <div key={j}>
                          <label className="text-sm text-gray-600">{input.name || `arg${j}`} ({input.type})</label>
                          <input
                            type="text"
                            className="input mt-1"
                            placeholder={input.type}
                            onChange={(e) => updateInput(func.name, j, e.target.value)}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="text-sm text-gray-500 mb-2">
                    Write functions require a wallet to sign transactions.
                  </p>
                  <button className="btn bg-orange-500 text-white hover:bg-orange-600 text-sm">
                    Connect Wallet to Write
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Code Tab */}
      {activeTab === 'code' && (
        <div className="card">
          <h2 className="text-lg font-bold mb-4">Contract Bytecode</h2>
          <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-xs overflow-x-auto max-h-96">
            {contract.bytecode}
          </div>

          {contract.sourceCode && (
            <div className="mt-6">
              <h2 className="text-lg font-bold mb-4">Source Code</h2>
              <pre className="bg-gray-900 text-gray-100 p-4 rounded font-mono text-xs overflow-x-auto max-h-96">
                {contract.sourceCode}
              </pre>
            </div>
          )}

          {contract.abi && (
            <div className="mt-6">
              <h2 className="text-lg font-bold mb-4">ABI</h2>
              <pre className="bg-gray-100 p-4 rounded font-mono text-xs overflow-x-auto max-h-64">
                {typeof contract.abi === 'string' ? contract.abi : JSON.stringify(JSON.parse(contract.abi), null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Events Tab */}
      {activeTab === 'events' && (
        <ContractEventsTab address={address} events={contract.events} />
      )}
    </div>
  );
}

// Contract Events Tab Component
function ContractEventsTab({ address, events: eventDefs }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const res = await axios.get(`${API_URL}/contract/${address}/events?from=0`);
        setEvents(res.data.events || []);
      } catch (error) {
        console.error('Error fetching events:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchEvents();
  }, [address]);

  if (loading) return <div className="card"><p>Loading events...</p></div>;

  return (
    <div className="card">
      <h2 className="text-lg font-bold mb-4">Contract Events ({events.length})</h2>
      {events.length === 0 ? (
        <p className="text-gray-500">No events found</p>
      ) : (
        <div className="space-y-3">
          {events.slice(0, 50).map((event, i) => (
            <div key={i} className="border rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-purple-700">
                  {event.decoded?.name || 'Unknown Event'}
                </span>
                <Link to={`/tx/${event.txHash}`} className="text-[#D4A826] text-sm font-mono">
                  {truncateHash(event.txHash)}
                </Link>
              </div>
              {event.decoded?.args && (
                <div className="text-sm text-gray-600">
                  {event.decoded.args.map((arg, j) => (
                    <span key={j} className="mr-4">{String(arg)}</span>
                  ))}
                </div>
              )}
              <div className="text-xs text-gray-400 mt-1">Block: {event.blockNumber}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Address Page
function AddressPage() {
  const { address } = useParams();
  const [addressData, setAddressData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAddress = async () => {
      try {
        const res = await axios.get(`${API_URL}/address/${address}`);
        setAddressData(res.data);
      } catch (error) {
        console.error('Error fetching address:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchAddress();
  }, [address]);

  if (loading) return <div className="container mx-auto px-4 py-8">Loading...</div>;
  if (!addressData) return <div className="container mx-auto px-4 py-8">Address not found</div>;

  // If it's a contract, redirect to contract page
  if (addressData.isContract) {
    return <ContractPage />;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Address</h1>

      <div className="card mb-6">
        <div className="space-y-4">
          <div>
            <p className="text-gray-500 text-sm">Address</p>
            <p className="font-mono break-all">{addressData.address}</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm">Type</p>
            <span className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-800">
              External Address
            </span>
          </div>
        </div>
      </div>

      {addressData.tokenBalances && addressData.tokenBalances.length > 0 && (
        <div className="card mb-6">
          <h2 className="text-xl font-bold mb-4">Token Balances</h2>
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left">Token</th>
                <th className="py-2 text-left">Balance</th>
              </tr>
            </thead>
            <tbody>
              {addressData.tokenBalances.map((token, i) => (
                <tr key={i} className="border-b">
                  <td className="py-2">
                    <Link to={`/token/${token.token_address}`} className="text-[#D4A826]">
                      {token.name} ({token.symbol})
                    </Link>
                  </td>
                  <td className="py-2">{(parseInt(token.balance) / Math.pow(10, token.decimals)).toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2 className="text-xl font-bold mb-4">Recent Transactions</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left">Hash</th>
                <th className="py-2 text-left">Block</th>
                <th className="py-2 text-left">From</th>
                <th className="py-2 text-left">To</th>
              </tr>
            </thead>
            <tbody>
              {addressData.recentTransactions?.map((tx) => (
                <tr key={tx.hash} className="border-b hover:bg-[#222838]">
                  <td className="py-2 font-mono text-sm">
                    <Link to={`/tx/${tx.hash}`} className="text-[#D4A826]">{truncateHash(tx.hash)}</Link>
                  </td>
                  <td className="py-2">
                    <Link to={`/block/${tx.block_height}`} className="text-[#D4A826]">{tx.block_height}</Link>
                  </td>
                  <td className="py-2 font-mono text-sm">{truncateHash(tx.from_address)}</td>
                  <td className="py-2 font-mono text-sm">{truncateHash(tx.to_address)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Blocks List Page
function BlocksPage() {
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBlocks = async () => {
      try {
        const res = await axios.get(`${API_URL}/blocks?limit=50`);
        setBlocks(res.data.blocks || []);
      } catch (error) {
        console.error('Error fetching blocks:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchBlocks();
  }, []);

  if (loading) return <div className="container mx-auto px-4 py-8">Loading...</div>;

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Blocks</h1>

      <div className="card">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-[#161b26]">
              <th className="py-3 px-2 text-left">Height</th>
              <th className="py-3 px-2 text-left">Hash</th>
              <th className="py-3 px-2 text-left">Type</th>
              <th className="py-3 px-2 text-left">Txs</th>
              <th className="py-3 px-2 text-left">Size</th>
              <th className="py-3 px-2 text-left">Time</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((block) => (
              <tr key={block.height} className="border-b hover:bg-[#222838]">
                <td className="py-2 px-2">
                  <Link to={`/block/${block.height}`} className="text-[#D4A826] font-medium">{formatNumber(block.height)}</Link>
                </td>
                <td className="py-2 px-2 font-mono text-sm">
                  <Link to={`/block/${block.hash}`} className="text-[#D4A826]">{truncateHash(block.hash)}</Link>
                </td>
                <td className="py-2 px-2">
                  <span className={`px-2 py-1 rounded text-xs ${block.is_pos ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                    {block.is_pos ? 'PoS' : 'PoW'}
                  </span>
                </td>
                <td className="py-2 px-2">{block.tx_count}</td>
                <td className="py-2 px-2">{formatNumber(block.size)} B</td>
                <td className="py-2 px-2 text-sm text-gray-500">{formatTime(block.timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Tokens List Page
function TokensPage() {
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchContracts = async () => {
      try {
        const res = await axios.get(`${API_URL}/contracts`);
        setContracts((res.data.contracts || []).filter(c => c.isToken));
      } catch (error) {
        console.error('Error fetching contracts:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchContracts();
  }, []);

  if (loading) return <div className="container mx-auto px-4 py-8">Loading...</div>;

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Tokens (QRC-20)</h1>
      <div className="card">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-[#161b26]">
              <th className="py-3 px-2 text-left">Name</th>
              <th className="py-3 px-2 text-left">Symbol</th>
              <th className="py-3 px-2 text-left">Contract Address</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.address} className="border-b hover:bg-[#222838]">
                <td className="py-2 px-2 font-medium">{c.token?.name || 'Unknown'}</td>
                <td className="py-2 px-2 font-bold text-[#D4A826]">{c.token?.symbol || '???'}</td>
                <td className="py-2 px-2 font-mono text-sm">
                  <Link to={`/address/${c.address}`} className="text-[#D4A826]">{truncateHash(c.address, 12)}</Link>
                </td>
              </tr>
            ))}
            {contracts.length === 0 && (
              <tr><td colSpan="3" className="py-8 text-center text-gray-500">No tokens found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Token Details Page
function TokenPage() {
  const { address } = useParams();
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchToken = async () => {
      try {
        const res = await axios.get(`${API_URL}/token/${address}`);
        setToken(res.data.token);
      } catch (error) {
        console.error('Error fetching token:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchToken();
  }, [address]);

  if (loading) return <div className="container mx-auto px-4 py-8">Loading...</div>;
  if (!token) return <div className="container mx-auto px-4 py-8">Token not found</div>;

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Token: {token.name} ({token.symbol})</h1>
      <div className="card">
        <div className="grid grid-cols-2 gap-4">
          <div><span className="text-gray-500">Name:</span> <span className="font-medium">{token.name}</span></div>
          <div><span className="text-gray-500">Symbol:</span> <span className="font-bold">{token.symbol}</span></div>
          <div><span className="text-gray-500">Decimals:</span> {token.decimals}</div>
          <div><span className="text-gray-500">Total Supply:</span> {token.total_supply}</div>
          <div className="col-span-2">
            <span className="text-gray-500">Contract:</span>
            <Link to={`/address/0x${token.address}`} className="font-mono text-sm ml-2 text-[#D4A826]">0x{token.address}</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// Contracts List Page
function ContractsListPage() {
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchContracts = async () => {
      try {
        const res = await axios.get(`${API_URL}/contracts`);
        setContracts(res.data.contracts || []);
      } catch (error) {
        console.error('Error fetching contracts:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchContracts();
  }, []);

  if (loading) return <div className="container mx-auto px-4 py-8">Loading...</div>;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Smart Contracts</h1>
        <Link to="/verify" className="btn btn-primary">Verify Contract</Link>
      </div>
      <div className="card">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-[#161b26]">
              <th className="py-3 px-2 text-left">Address</th>
              <th className="py-3 px-2 text-left">Base58</th>
              <th className="py-3 px-2 text-left">Type</th>
              <th className="py-3 px-2 text-left">Name</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.address} className="border-b hover:bg-[#222838]">
                <td className="py-2 px-2 font-mono text-sm">
                  <Link to={`/address/${c.address}`} className="text-[#D4A826]">{truncateHash(c.address, 10)}</Link>
                </td>
                <td className="py-2 px-2 font-mono text-sm text-emerald-400">{c.base58Address}</td>
                <td className="py-2 px-2">
                  <span className={`px-2 py-1 rounded text-xs ${c.isToken ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'}`}>
                    {c.isToken ? 'Token' : 'Contract'}
                  </span>
                </td>
                <td className="py-2 px-2">{c.token?.name || '-'}</td>
              </tr>
            ))}
            {contracts.length === 0 && (
              <tr><td colSpan="4" className="py-8 text-center text-gray-500">No contracts found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Contract Verify Page
function ContractVerifyPage() {
  const [formData, setFormData] = useState({
    address: '',
    name: '',
    sourceCode: '',
    abi: '',
    compilerVersion: '0.8.20',
    optimization: false
  });
  const [message, setMessage] = useState({ text: '', type: '' });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API_URL}/contract/verify`, formData);
      setMessage({ text: res.data.message || 'Contract verified successfully!', type: 'success' });
    } catch (error) {
      setMessage({ text: error.response?.data?.error || 'Verification failed', type: 'error' });
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Verify Contract</h1>

      <div className="card">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-gray-700 mb-2 font-medium">Contract Address *</label>
            <input
              type="text"
              className="input"
              placeholder="0x... or base58 address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="block text-gray-700 mb-2 font-medium">Contract Name</label>
            <input
              type="text"
              className="input"
              placeholder="MyToken"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-gray-700 mb-2 font-medium">Source Code (Solidity) *</label>
            <textarea
              className="input h-64 font-mono text-sm"
              placeholder="// SPDX-License-Identifier: MIT&#10;pragma solidity ^0.8.0;&#10;&#10;contract MyContract { ... }"
              value={formData.sourceCode}
              onChange={(e) => setFormData({ ...formData, sourceCode: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="block text-gray-700 mb-2 font-medium">ABI (JSON) *</label>
            <textarea
              className="input h-32 font-mono text-sm"
              placeholder='[{"type":"function","name":"balanceOf",...}]'
              value={formData.abi}
              onChange={(e) => setFormData({ ...formData, abi: e.target.value })}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-gray-700 mb-2 font-medium">Compiler Version</label>
              <input
                type="text"
                className="input"
                value={formData.compilerVersion}
                onChange={(e) => setFormData({ ...formData, compilerVersion: e.target.value })}
              />
            </div>
            <div className="flex items-center pt-8">
              <input
                type="checkbox"
                checked={formData.optimization}
                onChange={(e) => setFormData({ ...formData, optimization: e.target.checked })}
                className="mr-2"
              />
              <label>Optimization Enabled</label>
            </div>
          </div>
          <button type="submit" className="btn btn-primary">Verify Contract</button>
        </form>

        {message.text && (
          <div className={`mt-4 p-4 rounded ${message.type === 'error' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
            {message.text}
          </div>
        )}
      </div>
    </div>
  );
}

// Main App
function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen" style={{ backgroundColor: '#0f1419' }}>
        <Header />
        <main className="pb-8">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/blocks" element={<BlocksPage />} />
            <Route path="/block/:id" element={<BlockPage />} />
            <Route path="/tx/:hash" element={<TransactionPage />} />
            <Route path="/txs" element={<BlocksPage />} />
            <Route path="/address/:address" element={<AddressPage />} />
            <Route path="/tokens" element={<TokensPage />} />
            <Route path="/token/:address" element={<TokenPage />} />
            <Route path="/contracts" element={<ContractsListPage />} />
            <Route path="/contract/:address" element={<ContractPage />} />
            <Route path="/verify" element={<ContractVerifyPage />} />
          </Routes>
        </main>
        <footer className="py-6" style={{ backgroundColor: '#0a0e13', borderTop: '1px solid #2a3040' }}>
          <div className="container mx-auto px-4 text-center">
            <p className="text-gray-400">WATTx Block Explorer - Powered by <span style={{ color: '#D4A826' }}>WATTx Core</span></p>
            <p className="text-gray-600 text-sm mt-1">Hybrid PoW/PoS • EVM Compatible • QRC-20 Tokens</p>
          </div>
        </footer>
      </div>
    </BrowserRouter>
  );
}

export default App;
