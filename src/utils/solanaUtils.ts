import { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, } from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  getMint,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import bs58 from 'bs58';
import { SolanaSwapConfig, SwapResult } from '../types';

const TOKEN_ACCOUNT_SIZE = 165; // token account data size in bytes

async function lamportsToSol(lamports: number) {
  return lamports / 1_000_000_000;
}

// /**
//  * Placeholder for AgentLedgerTools - needs to be adapted from RPC server
//  */
// export class AgentLedgerTools {
//   async executeTrade(params: any): Promise<SwapResult> {
//     // TODO: Implement based on the original AgentLedgerTools from RPC server
//     console.log('Executing trade with params:', params);
    
//     // Placeholder implementation
//     return {
//       success: false,
//       error: 'AgentLedgerTools not implemented - needs adaptation from RPC server'
//     };
//   }

//   async validateBalance(params: any): Promise<boolean> {
//     // TODO: Implement balance validation
//     return true;
//   }

//   async getTokenBalance(publicKey: PublicKey, tokenMint: string): Promise<number> {
//     // TODO: Implement token balance checking
//     return 0;
//   }
// }

// /**
//  * Placeholder for SolanaTrackerSwapClient - needs to be adapted from RPC server
//  */
// export class SolanaTrackerSwapClient {
//   private config: SolanaSwapConfig;
//   private connection: Connection;

//   constructor(config: SolanaSwapConfig & { privateKey: string }) {
//     this.config = config;
//     this.connection = new Connection(config.rpcUrl);
//   }

//   async executeBuySwap(params: any): Promise<SwapResult> {
//     // TODO: Implement based on original SolanaTrackerSwapClient
//     console.log('Executing buy swap with params:', params);
    
//     return {
//       success: false,
//       error: 'SolanaTrackerSwapClient not implemented - needs adaptation from RPC server'
//     };
//   }

//   async executeSellSwap(params: any): Promise<SwapResult> {
//     // TODO: Implement based on original SolanaTrackerSwapClient
//     console.log('Executing sell swap with params:', params);
    
//     return {
//       success: false,
//       error: 'SolanaTrackerSwapClient not implemented - needs adaptation from RPC server'
//     };
//   }
// }

// /**
//  * Placeholder for BitquerySolanaAPI - needs to be adapted from RPC server
//  */
// export class BitquerySolanaAPI {
//   private apiKey: string;

//   constructor(apiKey: string) {
//     this.apiKey = apiKey;
//   }

//   async getTokenPrice(tokenMint: string): Promise<number | null> {
//     // TODO: Implement price fetching
//     console.log('Getting token price for:', tokenMint);
//     return null;
//   }

//   async getTokenInfo(tokenMint: string): Promise<any> {
//     // TODO: Implement token info fetching
//     console.log('Getting token info for:', tokenMint);
//     return null;
//   }
// }

// /**
//  * Placeholder for SolanaTrackerClient - needs to be adapted from RPC server
//  */
// export class SolanaTrackerClient {
//   async getTokenPrice(tokenMint: string): Promise<number | null> {
//     // TODO: Implement price tracking
//     console.log('Tracking token price for:', tokenMint);
//     return null;
//   }

//   async getMarketData(tokenMint: string): Promise<any> {
//     // TODO: Implement market data fetching
//     return null;
//   }
// }

export class SolanaTransferService {
  private connection: Connection;
  private payer: Keypair;

  constructor(rpcUrl: string, payer: Keypair) {
    this.connection = new Connection(rpcUrl, "confirmed");
    this.payer = payer;
  }
  
  async getOrCreateATA(
    connection: Connection,
    mint: PublicKey,
    owner: PublicKey,
    payer: Keypair,
    options?: { autoAirdrop?: boolean }
  ): Promise<PublicKey> {
    const ata = await getAssociatedTokenAddress(mint, owner);
  
    // If the account exists, return it
    try {
      const acc = await getAccount(connection, ata);
      return ata;
    } catch (err: any) {
      // TokenAccountNotFoundError — proceed to create
    }
  
    // Compute rent-exempt amount for token account
    const rentExemptLamports = await connection.getMinimumBalanceForRentExemption(
      TOKEN_ACCOUNT_SIZE
    );
  
    // Add a small buffer for fees (transaction fee, etc.)
    const feeBuffer = 5000; // lamports (~0.000005 SOL) — tiny buffer
    const requiredLamports = rentExemptLamports + feeBuffer;
  
    const payerBalance = await connection.getBalance(payer.publicKey);
  
    if (payerBalance < requiredLamports) {
      const msg = `Payer has insufficient SOL to create transaction.
  Payer balance: ${payerBalance} lamports (${(await lamportsToSol(payerBalance)).toFixed(9)} SOL)
  Required (rentExempt + buffer): ${requiredLamports} lamports (${(await lamportsToSol(requiredLamports)).toFixed(9)} SOL)
  Action: Fund the payer wallet with at least ${(await lamportsToSol(requiredLamports)).toFixed(9)} SOL`;
  
      // Optionally auto-airdrop on devnet
      if (options?.autoAirdrop) {
        const version = await connection.getEpochInfo().catch(() => null);
        // best-effort: only request airdrop if network supports it (devnet/testnet)
        try {
          console.log("Attempting airdrop of 0.01 SOL to payer for dev/testing...");
          const airdropSig = await connection.requestAirdrop(
            payer.publicKey,
            10_000_000 // 0.01 SOL
          );
          await connection.confirmTransaction(airdropSig, "confirmed");
        } catch (aErr) {
          console.warn("Airdrop failed or not available:", aErr);
        }
        // re-check balance
        const newBal = await connection.getBalance(payer.publicKey);
        if (newBal < requiredLamports) {
          throw new Error(msg + `\nAfter attempted airdrop, balance is still ${newBal} lamports.`);
        }
      } else {
        throw new Error(msg);
      }
    }
  
    // Build create ATA instruction and send
    const createIx = createAssociatedTokenAccountInstruction(
      payer.publicKey, // payer
      ata, // ata to create
      owner, // owner of ATA
      mint // mint
    );
  
    const tx = new Transaction().add(createIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
  
    // Confirm creation
    await getAccount(connection, ata); // if this still fails it will throw
    console.log("ATA created:", ata.toBase58(), "tx:", sig);
    return ata;
  }
  

  /**
   * Transfer native SOL
   */
  async transferSol(to: string, amountSol: number): Promise<{success: boolean, message: string, data: string | null}> {
    try{
      const toPubkey = new PublicKey(to);
      const lamports = amountSol * 1_000_000_000; // 1 SOL = 1e9 lamports

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: this.payer.publicKey,
          toPubkey,
          lamports,
        })
      );

      const txid = await sendAndConfirmTransaction(this.connection, transaction, [this.payer]);
      if(!txid){
        return {
          success: false,
          message: 'Transaction failed',
          data: null,
        }
      }
      return {
        success: true,
        message: 'Transaction successful',
        data: txid,
      }
    } catch(e: any){
      console.log(e);
      return {
        success: false,
        message: e.message,
        data: null,
      }
    }
  }

  /**
   * Transfer SPL token (any fungible token)
   */
  async transferSplToken(
    tokenMint: string,
    to: string,
    amount: number
  ): Promise<{ success: boolean; message: string; data: string | null }> {
    try {
      const mintPubkey = new PublicKey(tokenMint);
      const toPubkey = new PublicKey(to);
  
      // Get mint info to fetch decimals
      const mintInfo = await getMint(this.connection, mintPubkey);
      const decimals = mintInfo.decimals;
  
      const amountInBaseUnits = BigInt(Math.floor(amount * 10 ** decimals));

      const fromATA = await this.getOrCreateATA(this.connection, mintPubkey, this.payer.publicKey, this.payer);
      //console.log("From ATA:", fromATA.toBase58());
      
      const toATA = await this.getOrCreateATA(this.connection, mintPubkey, toPubkey, this.payer);
      //console.log("To ATA:", toATA.toBase58());

      const transferIx = createTransferInstruction(
        fromATA,
        toATA,
        this.payer.publicKey,
        amountInBaseUnits,
        [],
        TOKEN_PROGRAM_ID
      );
  
      // Build transfer instruction
      
  
      const transaction = new Transaction().add(transferIx);
  
      const txid = await sendAndConfirmTransaction(this.connection, transaction, [this.payer]);
  
      if (!txid) {
        return { success: false, message: "Transaction failed", data: null };
      }
  
      return { success: true, message: "Transaction successful", data: txid };
    } catch (e: any) {
      //console.error(e);
      const errorMessage =
        e.message?.match(/Message:\s*(.*?)\s*Logs:/s)?.[1] || e.message;
      return { success: false, message: errorMessage, data: null };
    }
  }
  
}


/**
 * Check if wallet has sufficient SOL for transaction fees
 */
export async function checkFeeBalance(publicKey: PublicKey): Promise<boolean> {
  try {
    const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
    const balance = await connection.getBalance(publicKey);
    const balanceInSol = balance / 1e9;
    // Require minimum 0.001 SOL for fees
    return balanceInSol >= 0.001;
  } catch (error) {
    console.error('Error checking fee balance:', error);
    return false;
  }
}

/**
 * Get keypair from private key string
 */
export function getKeypairFromPrivateKey(privateKey: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(privateKey));
}

/**
 * Get SOL balance for a wallet
 */
export async function getSolBalance(publicKey: PublicKey): Promise<number> {
  try {
    const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
    const balance = await connection.getBalance(publicKey);
    return balance / 1e9; // Convert lamports to SOL
  } catch (error) {
    console.error('Error getting SOL balance:', error);
    return 0;
  }
}

/**
 * Validate transaction signature
 */
export function isValidSignature(signature: string): boolean {
  try {
    // Basic validation - should be base58 encoded and proper length
    return signature.length >= 64 && signature.length <= 90;
  } catch {
    return false;
  }
} 