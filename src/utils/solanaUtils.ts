import { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, } from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
  getMint,
} from "@solana/spl-token";
import bs58 from 'bs58';
import { SolanaSwapConfig, SwapResult } from '../types';

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

  /**
   * Transfer native SOL
   */
  async transferSol(to: string, amountSol: number): Promise<string> {
    const toPubkey = new PublicKey(to);
    const lamports = amountSol * 1_000_000_000; // 1 SOL = 1e9 lamports

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.payer.publicKey,
        toPubkey,
        lamports,
      })
    );

    return await sendAndConfirmTransaction(this.connection, transaction, [this.payer]);
  }

  /**
   * Transfer SPL token (any fungible token)
   */
  async transferSplToken(
    tokenMint: string,
    to: string,
    amount: number
  ): Promise<string> {
    const mintPubkey = new PublicKey(tokenMint);
    const toPubkey = new PublicKey(to);

    // Get mint info to fetch decimals
    const mintInfo = await getMint(this.connection, mintPubkey);
    const decimals = mintInfo.decimals;

    // Get or create ATA for sender
    const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.payer,
      mintPubkey,
      this.payer.publicKey
    );

    // Get or create ATA for recipient
    const toTokenAccount = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.payer,
      mintPubkey,
      toPubkey
    );

    // Convert to base units
    const amountInBaseUnits = BigInt(amount * Math.pow(10, decimals));

    const transferIx = createTransferInstruction(
      fromTokenAccount.address,
      toTokenAccount.address,
      this.payer.publicKey,
      amountInBaseUnits,
      [],
      TOKEN_PROGRAM_ID
    );

    const transaction = new Transaction().add(transferIx);

    return await sendAndConfirmTransaction(this.connection, transaction, [this.payer]);
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