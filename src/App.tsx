import { useState, useCallback, useEffect, useRef } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { erc20Abi, isAddress } from 'viem'
import { ConnectKitButton } from 'connectkit'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, ExternalLink, Send, ArrowRight, CheckCircle2, XCircle, Wallet, Clock } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { toast } from 'sonner'
import { arcTestnet } from 'viem/chains'
import { getUsdc, buildTxExplorerUrl } from '@/onchain-facts'
import { Amount, parseAmount, usdcDecimalsFor } from '@/onchain-money'

// ─── Chain / USDC facts ────────────────────────────────────────────────────────
const TARGET_CHAIN_ID = arcTestnet.id  // 5042002

const usdcFact = getUsdc(TARGET_CHAIN_ID)
if (!usdcFact) throw new Error('USDC not found for Arc Testnet')
const USDC_ADDRESS = usdcFact.address as `0x${string}`

// ─── Preset amounts ────────────────────────────────────────────────────────────
const PRESETS = ['0.10', '0.25', '1.00', '5.00']

// ─── Glass styles ──────────────────────────────────────────────────────────────
const glass = {
  card: {
    background: 'rgba(255,255,255,0.72)',
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    border: '1px solid rgba(18,45,69,0.10)',
    borderRadius: '24px',
  } as React.CSSProperties,
  inner: {
    background: 'rgba(255,255,255,0.55)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid rgba(18,45,69,0.08)',
    borderRadius: '16px',
  } as React.CSSProperties,
}

// ─── Spectral accent strip ─────────────────────────────────────────────────────
const spectral = 'linear-gradient(90deg,#6366f1,#8b5cf6,#ec4899,#f59e0b,#10b981)'

// ─── Sub-components ────────────────────────────────────────────────────────────

function BalanceCard({ address }: { address?: `0x${string}` }) {
  const { data: raw, isLoading } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: !!address },
  })

  const decimals = usdcDecimalsFor(TARGET_CHAIN_ID)
  const formatted =
    raw != null
      ? Amount.fromRaw(raw, decimals).toFixed(2)
      : null

  return (
    <section className="p-5" style={glass.card}>
      <div className="mb-3 flex items-center gap-2">
        <TokenUSDC variant="branded" size={18} />
        <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--muted)' }}>
          USDC Balance
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="display text-5xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
          {!address
            ? '—'
            : isLoading
            ? '...'
            : formatted ?? '0.00'}
        </span>
        <span className="text-xl font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
      </div>
      <p className="mt-1.5 text-xs" style={{ color: 'var(--muted)' }}>
        {address ? 'Arc Testnet · live' : 'Connect wallet to view balance'}
      </p>
    </section>
  )
}

interface SendSheetProps {
  open: boolean
  onClose: () => void
  senderBalance: bigint | undefined
  onSuccess: (hash: string, amount: string, to: string) => void
}

type TxStatus = 'idle' | 'pending' | 'confirming' | 'success' | 'error'

function SendSheet({ open, onClose, senderBalance, onSuccess }: SendSheetProps) {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const { writeContract, data: hash, isPending, isError, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')

  // Fire onSuccess callback exactly once when confirmed
  const successFiredRef = useRef(false)
  useEffect(() => {
    if (isSuccess && hash && !successFiredRef.current) {
      successFiredRef.current = true
      onSuccess(hash, amount, recipient)
    }
  }, [isSuccess, hash, amount, recipient, onSuccess])

  const wrongChain = chainId !== TARGET_CHAIN_ID

  const decimals = usdcDecimalsFor(TARGET_CHAIN_ID)
  const balanceFormatted =
    senderBalance != null
      ? Amount.fromRaw(senderBalance, decimals).toFixed(2)
      : null

  let txStatus: TxStatus = 'idle'
  if (isPending) txStatus = 'pending'
  else if (isConfirming) txStatus = 'confirming'
  else if (isSuccess) txStatus = 'success'
  else if (isError) txStatus = 'error'

  const isValidAddress = isAddress(recipient)
  const parsedAmount = (() => {
    try {
      if (!amount || !amount.match(/^\d*\.?\d+$/)) return null
      return parseAmount(TARGET_CHAIN_ID, amount)
    } catch {
      return null
    }
  })()

  const hasSufficientBalance =
    senderBalance != null && parsedAmount != null
      ? senderBalance >= parsedAmount.raw
      : true

  const ready =
    !!address &&
    isValidAddress &&
    parsedAmount !== null &&
    hasSufficientBalance &&
    txStatus === 'idle'

  const handleSend = useCallback(() => {
    if (wrongChain) {
      switchChain({ chainId: TARGET_CHAIN_ID })
      return
    }
    if (!parsedAmount) return
    writeContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [recipient as `0x${string}`, parsedAmount.raw],
      chainId: TARGET_CHAIN_ID,
    })
  }, [wrongChain, switchChain, parsedAmount, recipient, writeContract])

  const handleClose = () => {
    if (txStatus === 'success' || txStatus === 'idle' || txStatus === 'error') {
      setRecipient('')
      setAmount('')
      reset()
      onClose()
    }
  }

  const handleReset = () => {
    setRecipient('')
    setAmount('')
    successFiredRef.current = false
    reset()
  }

  const txUrl = hash ? buildTxExplorerUrl(TARGET_CHAIN_ID, hash) : null

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
        >
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <motion.section
            className="relative w-full max-w-md overflow-hidden rounded-t-3xl"
            style={{
              background: 'rgba(255,255,255,0.92)',
              backdropFilter: 'blur(40px) saturate(200%)',
              WebkitBackdropFilter: 'blur(40px) saturate(200%)',
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 340 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Spectral strip */}
            <div className="h-1" style={{ background: spectral }} />

            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-black/10" />
            </div>

            <div className="px-5 pb-8 pt-2">
              {txStatus === 'success' ? (
                <SuccessState txUrl={txUrl} amount={amount} recipient={recipient} onReset={handleReset} />
              ) : (
                <>
                  <div className="mb-5 flex items-center justify-between">
                    <h2 className="display text-xl font-bold" style={{ color: 'var(--ink)' }}>
                      Send USDC
                    </h2>
                    <button
                      onClick={handleClose}
                      className="flex size-8 items-center justify-center rounded-full text-sm font-medium transition-colors"
                      style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
                    >
                      ✕
                    </button>
                  </div>

                  {/* Recipient */}
                  <div className="mb-3">
                    <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                      RECIPIENT ADDRESS
                    </label>
                    <div className="rounded-2xl px-4 py-3" style={glass.inner}>
                      <input
                        className="mono w-full bg-transparent text-sm outline-none placeholder:text-slate-300"
                        style={{ color: 'var(--ink-2)' }}
                        placeholder="0x..."
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value.trim())}
                        spellCheck={false}
                      />
                    </div>
                    {recipient && !isValidAddress && (
                      <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>Invalid address</p>
                    )}
                  </div>

                  {/* Amount */}
                  <div className="mb-3">
                    <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                      AMOUNT
                    </label>
                    <div className="rounded-2xl px-4 py-3" style={glass.inner}>
                      <input
                        inputMode="decimal"
                        className="display w-full bg-transparent text-4xl font-bold tabular-nums outline-none placeholder:text-slate-200"
                        style={{ color: 'var(--ink)' }}
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^0-9.]/g, '')
                          if (v === '' || /^\d*\.?\d*$/.test(v)) setAmount(v)
                        }}
                      />
                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <TokenUSDC variant="branded" size={14} />
                          <span className="text-xs font-medium" style={{ color: 'var(--subtle)' }}>USDC on Arc Testnet</span>
                        </div>
                        {balanceFormatted && (
                          <button
                            className="text-xs font-semibold"
                            style={{ color: 'var(--accent-hover)' }}
                            onClick={() => setAmount(balanceFormatted)}
                          >
                            Max: {balanceFormatted}
                          </button>
                        )}
                      </div>
                    </div>
                    {!hasSufficientBalance && (
                      <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>Insufficient balance</p>
                    )}
                  </div>

                  {/* Quick amounts */}
                  <div className="mb-5 flex gap-2">
                    {PRESETS.map((p) => (
                      <button
                        key={p}
                        onClick={() => setAmount(p)}
                        className="flex-1 rounded-xl py-2 text-xs font-semibold transition-all hover:scale-[1.03] active:scale-[0.97]"
                        style={{
                          background: amount === p ? 'var(--accent)' : 'var(--surface-muted)',
                          color: amount === p ? '#fff' : 'var(--ink-2)',
                        }}
                      >
                        ${p}
                      </button>
                    ))}
                  </div>

                  {/* Error */}
                  {isError && (
                    <div className="mb-3 flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-medium" style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)' }}>
                      <XCircle className="size-3.5 shrink-0" />
                      {error?.message?.includes('User rejected') || error?.message?.includes('user rejected')
                        ? 'Transaction cancelled.'
                        : 'Transaction failed. Please try again.'}
                    </div>
                  )}

                  {/* CTA */}
                  <button
                    disabled={(!ready && !wrongChain) || isPending || isConfirming}
                    onClick={handleSend}
                    className="w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ background: 'var(--accent)' }}
                  >
                    {wrongChain ? (
                      'Switch to Arc Testnet'
                    ) : isPending ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="size-4 animate-spin" /> Confirm in wallet...
                      </span>
                    ) : isConfirming ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="size-4 animate-spin" /> Confirming...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <Send className="size-4" /> Send USDC
                      </span>
                    )}
                  </button>
                </>
              )}
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function SuccessState({
  txUrl,
  amount,
  recipient,
  onReset,
}: {
  txUrl: string | null
  amount: string
  recipient: string
  onReset: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-5 py-4 text-center"
    >
      <div className="flex size-16 items-center justify-center rounded-full" style={{ background: 'rgba(26,128,71,0.12)' }}>
        <CheckCircle2 className="size-8" style={{ color: 'var(--success)' }} />
      </div>
      <div>
        <p className="display text-2xl font-bold" style={{ color: 'var(--ink)' }}>Sent!</p>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          ${amount} USDC to{' '}
          <span className="mono text-xs">{recipient.slice(0, 6)}...{recipient.slice(-4)}</span>
        </p>
      </div>
      {txUrl && (
        <a
          href={txUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-80"
          style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}
        >
          View on ArcScan <ExternalLink className="size-3" />
        </a>
      )}
      <button
        onClick={onReset}
        className="w-full rounded-2xl py-3.5 text-sm font-semibold text-white"
        style={{ background: 'var(--accent)' }}
      >
        Send Another
      </button>
    </motion.div>
  )
}

interface TxRecord {
  hash: string
  amount: string
  to: string
  ts: number
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const { address, isConnected, chainId } = useAccount()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [txHistory, setTxHistory] = useState<TxRecord[]>([])

  // Live USDC balance
  const { data: rawBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 6_000 },
  })

  const handleSendSuccess = useCallback(
    (hash: string, amount: string, to: string) => {
      setTxHistory((prev) => [{ hash, amount, to, ts: Date.now() }, ...prev.slice(0, 9)])
      toast.success(`Sent $${amount} USDC`)
    },
    [],
  )

  const handleSheetClose = () => setSheetOpen(false)

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-gradient)' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2">
          <TokenUSDC variant="branded" size={22} />
          <span className="display text-base font-bold" style={{ color: 'var(--ink)' }}>Arc Pay</span>
        </div>
        <ConnectKitButton />
      </header>

      {/* Body */}
      <main className="mx-auto max-w-md px-4 pb-24 pt-2">
        {/* Balance hero */}
        <BalanceCard address={address} />

        {/* Primary CTA */}
        <div className="mt-4">
          {isConnected ? (
            <button
              onClick={() => setSheetOpen(true)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.01] active:scale-[0.98]"
              style={{ background: 'var(--accent)' }}
            >
              <Send className="size-4" />
              Send USDC
            </button>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-2xl p-6 text-center" style={glass.card}>
              <Wallet className="size-8" style={{ color: 'var(--subtle)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--muted)' }}>
                Connect your wallet to send USDC on Arc Testnet
              </p>
              <ConnectKitButton />
            </div>
          )}
        </div>

        {/* Chain warning */}
        {isConnected && chainId !== TARGET_CHAIN_ID && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-medium"
            style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)', border: '1px solid rgba(186,43,76,0.15)' }}
          >
            <XCircle className="size-3.5 shrink-0" />
            Wrong network — please switch to Arc Testnet.
          </motion.div>
        )}

        {/* Faucet hint */}
        {isConnected && (
          <p className="mt-3 text-center text-xs" style={{ color: 'var(--subtle)' }}>
            Need test USDC? Use "Get test USDC" in the Arc Studio sidebar.
          </p>
        )}

        {/* Activity */}
        {txHistory.length > 0 && (
          <section className="mt-6">
            <h3 className="mb-3 text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--muted)' }}>
              This Session
            </h3>
            <div className="flex flex-col gap-2">
              {txHistory.map((tx) => (
                <a
                  key={tx.hash}
                  href={buildTxExplorerUrl(TARGET_CHAIN_ID, tx.hash as `0x${string}`)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-2xl px-4 py-3 transition-opacity hover:opacity-80"
                  style={glass.card}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-full" style={{ background: 'rgba(26,128,71,0.10)' }}>
                      <ArrowRight className="size-4" style={{ color: 'var(--success)' }} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                        ${tx.amount} USDC
                      </p>
                      <p className="mono text-xs" style={{ color: 'var(--muted)' }}>
                        {tx.to.slice(0, 6)}...{tx.to.slice(-4)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--subtle)' }}>
                    <Clock className="size-3" />
                    {new Date(tx.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    <ExternalLink className="ml-1 size-3" />
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* How it works */}
        {!isConnected && (
          <section className="mt-6">
            <h3 className="mb-3 text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--muted)' }}>
              How it works
            </h3>
            <div className="flex flex-col gap-2">
              {[
                { icon: Wallet, label: 'Connect wallet', sub: 'MetaMask or any injected wallet' },
                { icon: TokenUSDC, label: 'Get test USDC', sub: 'Use the faucet in the Arc Studio sidebar' },
                { icon: Send, label: 'Send USDC', sub: 'Enter an address and amount, confirm onchain' },
              ].map(({ icon: Icon, label, sub }, i) => (
                <div key={i} className="flex items-center gap-3 rounded-2xl px-4 py-3" style={glass.card}>
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--surface-muted)' }}>
                    {Icon === TokenUSDC
                      ? <TokenUSDC variant="branded" size={18} />
                      : <Icon className="size-4" style={{ color: 'var(--ink-2)' }} />
                    }
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{label}</p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>{sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Send sheet */}
      <SendSheet
        open={sheetOpen}
        onClose={handleSheetClose}
        senderBalance={rawBalance}
        onSuccess={handleSendSuccess}
      />
    </div>
  )
}
