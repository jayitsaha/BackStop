import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import api from '../api'

// MetaMask / EIP-1193 wallet context. Connects the browser wallet, keeps it on the right testnet, and
// exposes sendTx for buying agents (user → treasury) + reads the chain config from /pay/config.
const Ctx = createContext(null)

export function WalletProvider({ children }) {
  const eth = typeof window !== 'undefined' ? window.ethereum : null
  const available = !!eth
  const [account, setAccount] = useState(null)
  const [chainId, setChainId] = useState(null)
  const [connecting, setConnecting] = useState(false)
  const [cfg, setCfg] = useState(null) // { treasury, chain_id_hex, chain_name, rpc, explorer, agent_price_wei, ... }

  useEffect(() => {
    api.payConfig().then(setCfg).catch(() => {})
  }, [])

  useEffect(() => {
    if (!eth) return
    eth.request({ method: 'eth_accounts' }).then((a) => a?.[0] && setAccount(a[0])).catch(() => {})
    eth.request({ method: 'eth_chainId' }).then(setChainId).catch(() => {})
    const onAcc = (a) => setAccount((a && a[0]) || null)
    const onChain = (c) => setChainId(c)
    eth.on?.('accountsChanged', onAcc)
    eth.on?.('chainChanged', onChain)
    return () => {
      eth.removeListener?.('accountsChanged', onAcc)
      eth.removeListener?.('chainChanged', onChain)
    }
  }, [eth])

  const connect = useCallback(async () => {
    if (!eth) {
      window.open('https://metamask.io/download/', '_blank')
      return null
    }
    setConnecting(true)
    try {
      const a = await eth.request({ method: 'eth_requestAccounts' })
      const acc = (a && a[0]) || null
      setAccount(acc)
      return acc
    } finally {
      setConnecting(false)
    }
  }, [eth])

  const ensureChain = useCallback(async () => {
    if (!eth || !cfg?.chain_id_hex) return
    const cur = await eth.request({ method: 'eth_chainId' })
    if (String(cur).toLowerCase() === String(cfg.chain_id_hex).toLowerCase()) return
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: cfg.chain_id_hex }] })
    } catch (e) {
      if (e?.code === 4902 || /Unrecognized chain/i.test(e?.message || '')) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: cfg.chain_id_hex,
            chainName: cfg.chain_name,
            rpcUrls: [cfg.rpc],
            blockExplorerUrls: [cfg.explorer],
            nativeCurrency: { name: 'SepoliaETH', symbol: 'ETH', decimals: 18 },
          }],
        })
      } else {
        throw e
      }
    }
  }, [eth, cfg])

  // Send a tx from the connected wallet. value is a decimal wei string/number; converted to hex here.
  const sendTx = useCallback(
    async ({ to, value, data }) => {
      if (!eth) throw new Error('No wallet installed')
      let from = account
      if (!from) from = await connect()
      if (!from) throw new Error('Wallet not connected')
      await ensureChain()
      const valueHex = value != null ? '0x' + BigInt(value).toString(16) : undefined
      const txParams = { from, to }
      if (valueHex) txParams.value = valueHex
      if (data) txParams.data = data
      return eth.request({ method: 'eth_sendTransaction', params: [txParams] })
    },
    [eth, account, connect, ensureChain],
  )

  const disconnect = useCallback(() => setAccount(null), [])

  const onTargetChain =
    !!cfg?.chain_id_hex && String(chainId).toLowerCase() === String(cfg.chain_id_hex).toLowerCase()

  return (
    <Ctx.Provider
      value={{ account, chainId, connecting, available, cfg, onTargetChain, connect, disconnect, ensureChain, sendTx }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useWallet() {
  return useContext(Ctx) || { available: false }
}
