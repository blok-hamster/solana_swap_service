import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
//import { getParsedTokenAccountsByOwner } from "@solana/spl-token"
import bs58 from "bs58";
import { SolanaTracker } from "solana-swap";
import { config } from 'dotenv';

config();

// -- Request Interfaces --
/** Parameters for searching tokens with filters and pagination */
export interface SearchTokensParams {
  query: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  showAllPools?: boolean;
}

/** Request body for fetching multiple tokens */
export interface MultiTokensRequest {
  tokens: string[];
}

// -- Common Response Interfaces --
/** Standard API error structure */
export interface APIError {
  message: string;
}

/** Token metadata information */
export interface Token {
  name: string;
  symbol: string;
  mint: string;
  uri?: string;
  decimals: number;
  description?: string;
  image?: string;
  hasFileMetaData?: boolean;
  createdOn?: number;
  showName?: boolean;
  twitter?: string;
  telegram?: string;
  website?: string;
  strictSocials: Record<string, string>;
}

/** Pair liquidity details */
export interface Liquidity {
  quote: number;
  usd: number;
}

/** Price information */
export interface Price {
  quote: number;
  usd: number;
}

/** Market capitalization details */
export interface MarketCap {
  quote: number;
  usd: number;
}

/** Transaction counts */
export interface Txns {
  buys: number;
  sells: number;
  total?: number;
  volume?: number;
}

/** Security authorities */
export interface Security {
  freezeAuthority: string | null;
  mintAuthority: string | null;
}

/** Pool entry for a token */
export interface Pool {
  poolId: string;
  liquidity: Liquidity;
  price: Price;
  tokenSupply: number;
  lpBurn: number;
  tokenAddress: string;
  marketCap: MarketCap;
  market: string;
  quoteToken?: string;
  decimals: number;
  security: Security;
  lastUpdated: number;
  deployer?: string;
  txns: Txns;
  curve?: string;
  curvePercentage?: number;
  createdAt?: number;
}

/** Price change event over intervals */
export interface PriceChange {
  priceChangePercentage: number;
}

/** Collection of price change events keyed by timeframe */
export type Events = Record<string, PriceChange>;

/** Risk assessment for a token */
export interface RiskItem {
  name: string;
  description: string;
  level: string;
  score: number;
}

export interface Risk {
  rugged: boolean;
  risks: RiskItem[];
  score: number;
  jupiterVerified?: boolean;
}

/** Single token response including pools, events, risk, and statistics */
export interface GetTokenResponse {
  token: Token;
  pools: Pool[];
  events: Events;
  risk: Risk;
  buys: number;
  sells: number;
  txns: number;
  holders: number;
}

/** Account holding information in token holder lists */
export interface HolderAccount {
  wallet: string;
  amount: number;
  value: Price;
  percentage: number;
}

/** Response for token holders endpoint */
export interface GetTokenHoldersResponse {
  total: number;
  accounts: HolderAccount[];
}

/** Single top holder entry */
export interface TopHolder {
  address: string;
  amount: number;
  percentage: number;
  value: Price;
}

/** Response for top token holders */
export type GetTopTokenHoldersResponse = TopHolder[];

/** Response for all-time-high endpoint */
export interface GetTokenATHResponse {
  highest_price: number;
  timestamp: number;
}

/** Individual token in deployer response */
export interface DeployerToken {
  name: string;
  symbol: string;
  mint: string;
  image: string;
  decimals: number;
  hasSocials: boolean;
  poolAddress: string;
  liquidityUsd: number;
  marketCapUsd: number;
  priceUsd: number;
  lpBurn: number;
  market: string;
  freezeAuthority: string | null;
  mintAuthority: string | null;
  createdAt: number;
  lastUpdated: number;
  buys: number;
  sells: number;
  totalTransactions: number;
}

/** Response for tokens by deployer */
export interface GetTokensByDeployerResponse {
  total: number;
  tokens: DeployerToken[];
}

/** Single result in search response */
export interface SearchTokenResult {
  name: string;
  symbol: string;
  mint: string;
  decimals: number;
  image: string;
  holders: number;
  jupiter: boolean;
  verified: boolean;
  liquidityUsd: number;
  marketCapUsd: number;
  priceUsd: number;
  lpBurn: number;
  market: string;
  freezeAuthority: string | null;
  mintAuthority: string | null;
  poolAddress: string;
  totalBuys: number;
  totalSells: number;
  totalTransactions: number;
  volume_5m: number;
  volume: number;
  volume_15m: number;
  volume_30m: number;
  volume_1h: number;
  volume_6h: number;
  volume_12h: number;
  volume_24h: number;
}

/** Response for search tokens endpoint */
export interface SearchTokensResponse {
  status: string;
  data: SearchTokenResult[];
}

/** Item in latest tokens list */
export interface LatestTokenItem {
  token: Token;
  pools: Pool[];
  events: Events;
  risk: Risk;
  buys: number;
  sells: number;
  txns: number;
}

/** Response for latest tokens endpoint */
export type GetLatestTokensResponse = LatestTokenItem[];

/** Response for multiple tokens endpoint */
export type GetMultipleTokensResponse = GetTokenResponse[];

/** Response for trending tokens endpoint */
export type GetTrendingTokensResponse = SearchTokenResult[];

/** Response for tokens by volume endpoint */
export type GetTokensByVolumeResponse = SearchTokenResult[];

/** Overview response structure */
export interface TokenOverviewResponse {
  latest: LatestTokenItem[];
  graduating?: LatestTokenItem[];
  graduated?: LatestTokenItem[];
}

/** Response for token overview endpoint */
export type GetTokenOverviewResponse = TokenOverviewResponse;

/**
 * SolanaTrackerClient provides convenient methods to access Solana Tracker Public Data API endpoints.
 */
export class SolanaTrackerClient {
  private readonly axiosInstance: AxiosInstance;
  private readonly baseUrl = 'https://data.solanatracker.io';

  /**
   * Create a new client instance.
   * @param apiKey Your Solana Tracker API key.
   * @param axiosConfig Optional Axios configuration overrides.
   */
  constructor(apiKey: string = process.env.SOLANA_TRACKER_API_KEY!, axiosConfig?: AxiosRequestConfig) {
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      ...axiosConfig,
    });
  }

  /** Centralized error handler. */
  private handleError(error: unknown, methodName: string): never {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const statusText = axiosError.response?.statusText;
      throw new Error(
        `SolanaTrackerClient.${methodName} failed: ${status} ${statusText}`
      );
    }
    throw new Error(`SolanaTrackerClient.${methodName} failed: ${(error as Error).message}`);
  }

  /** GET /tokens/{tokenAddress} */
  async getToken(tokenAddress: string): Promise<GetTokenResponse> {
    try {
      const { data } = await this.axiosInstance.get<GetTokenResponse>(`/tokens/${tokenAddress}`);
      return data;
    } catch (error) {
      this.handleError(error, 'getToken');
    }
  }

  async fetchTokenPrice(tokenAddress: string): Promise<{price: number, priceInUsd: number, name: string, symbol: string}> {
    try {
      const token: GetTokenResponse = await this.getToken(tokenAddress);
      if (!token.pools || token.pools.length === 0 ) {
        throw new Error('No pools or price data found for token');
      }
      return {price: token.pools[0]?.price.quote || 0, priceInUsd: token.pools[0]?.price.usd || 0, name: token.token.name, symbol: token.token.symbol};
    } catch (error) {
      this.handleError(error, 'getTokenPrice'); 
    }
  }

  /** GET /tokens/by-pool/{poolAddress} */
  async getTokenByPool(poolAddress: string): Promise<GetTokenResponse> {
    try {
      const { data } = await this.axiosInstance.get<GetTokenResponse>(`/tokens/by-pool/${poolAddress}`);
      return data;
    } catch (error) {
      this.handleError(error, 'getTokenByPool');
    }
  }

  /** GET /tokens/{tokenAddress}/holders */
  async getTokenHolders(tokenAddress: string): Promise<GetTokenHoldersResponse> {
    try {
      const { data } = await this.axiosInstance.get<GetTokenHoldersResponse>(`/tokens/${tokenAddress}/holders`);
      return data;
    } catch (error) {
      this.handleError(error, 'getTokenHolders');
    }
  }

  /** GET /tokens/{tokenAddress}/holders/top */
  async getTopTokenHolders(tokenAddress: string): Promise<GetTopTokenHoldersResponse> {
    try {
      const { data } = await this.axiosInstance.get<GetTopTokenHoldersResponse>(`/tokens/${tokenAddress}/holders/top`);
      return data;
    } catch (error) {
      this.handleError(error, 'getTopTokenHolders');
    }
  }

  /** GET /tokens/{tokenAddress}/ath */
  async getTokenATH(tokenAddress: string): Promise<GetTokenATHResponse> {
    try {
      const { data } = await this.axiosInstance.get<GetTokenATHResponse>(`/tokens/${tokenAddress}/ath`);
      return data;
    } catch (error) {
      this.handleError(error, 'getTokenATH');
    }
  }

  /** GET /deployer/{wallet} */
  async getTokensByDeployer(wallet: string): Promise<GetTokensByDeployerResponse> {
    try {
      const { data } = await this.axiosInstance.get<GetTokensByDeployerResponse>(`/deployer/${wallet}`);
      return data;
    } catch (error) {
      this.handleError(error, 'getTokensByDeployer');
    }
  }

  /** GET /search */
  async searchTokens(params: SearchTokensParams): Promise<SearchTokensResponse> {
    try {
      const { data } = await this.axiosInstance.get<SearchTokensResponse>(`/search`, { params });
      return data;
    } catch (error) {
      this.handleError(error, 'searchTokens');
    }
  }

  /** GET /tokens/latest */
  async getLatestTokens(page = 1): Promise<GetLatestTokensResponse> {
    try {
      const { data } = await this.axiosInstance.get<GetLatestTokensResponse>(`/tokens/latest`, { params: { page } });
      return data;
    } catch (error) {
      this.handleError(error, 'getLatestTokens');
    }
  }

  /** POST /tokens/multi */
  async getMultipleTokens(request: MultiTokensRequest): Promise<any> {
    try {
      const { data } = await this.axiosInstance.post(`/tokens/multi`, request);
      // Transform the response data from object format to array format
      if (data && data.tokens && typeof data.tokens === 'object') {
        const tokensArray = Object.entries(data.tokens).map(([mint, tokenData]) => ({
          mint,
          ...(tokenData as object)
        }));
        const transformedData = { tokens: tokensArray };
        return transformedData.tokens;
      }
      return data;
    } catch (error) {
      this.handleError(error, 'getMultipleTokens');
    }
  }

  /** GET /tokens/trending/{timeframe} */
  async getTrendingTokens(timeframe: string = '1h'): Promise<GetTrendingTokensResponse> {
    try {
      const { data } = await this.axiosInstance.get<GetTrendingTokensResponse>(`/tokens/trending/${timeframe}`);
      return data;
    } catch (error) {
      this.handleError(error, 'getTrendingTokens');
    }
  }

  /** GET /tokens/volume/{timeframe} */
  async getTokensByVolume(timeframe: string = '1h'): Promise<GetTokensByVolumeResponse> {
    try {
      const { data } = await this.axiosInstance.get<GetTokensByVolumeResponse>(`/tokens/volume/${timeframe}`);
      return data;
    } catch (error) {
      this.handleError(error, 'getTokensByVolume');
    }
  }

  /** GET /tokens/multi/all */
  async getTokenOverview(): Promise<GetTokenOverviewResponse> {
    try {
      const { data } = await this.axiosInstance.get<GetTokenOverviewResponse>(`/tokens/multi/all`);
      return data;
    } catch (error) {
      this.handleError(error, 'getTokenOverview');
    }
  }

  /** GET /wallet/{owner} */
  async getWallet(owner: string): Promise<any> {
    try {
      const { data } = await this.axiosInstance.get<any>(`/wallet/${owner}`);
      return data;
    } catch (error) {
      this.handleError(error, 'getWallet');
    }
  } 

  //get
}

interface PerformSwapOptions {
  fromToken: string;
  toToken: string;
  amount: number;
  slippage: number;
  payer: string;
  priorityFee: number;
}

interface IRateResponse {
  amountIn: number;
  amountOut: number;
  minAmountOut: number;
  currentPrice: number;
  executionPrice: number;
  priceImpact: number;
  fee: number;
  baseCurrency: {
    decimals: number;
    mint: string;
  };
  quoteCurrency: {
    decimals: number;
    mint: string;
  };
  platformFee: number;
  platformFeeUI: number;
}

export class SolanaTrackerSwapClient {
  private readonly rpcUrl: string;
  private readonly privateKey: string;
  private readonly apiKey: string;
  private connection
  
  constructor({apiKey = process.env.SOLANA_TRACKER_API_KEY!, rpcUrl = process.env.SOLANA_RPC_URL!, privateKey}: {apiKey: string, rpcUrl: string, privateKey: string}) {
    this.rpcUrl = rpcUrl;
    this.privateKey = privateKey;
    this.apiKey = apiKey;
    this.connection = new Connection(rpcUrl);
  }

  //Trump token: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN"
  async getTokenBalance({mint}:{mint?: string}) {
      try{  
        const keypair = Keypair.fromSecretKey(bs58.decode(this.privateKey));
        //const owner = new PublicKey("8ezggN9N1QM6a6jBgqmdRAGSMQZ25mDw3dyWWbRhNhhp")
        const owner = keypair.publicKey
        
        const accounts = await this.connection.getParsedTokenAccountsByOwner(owner, {
          programId: TOKEN_PROGRAM_ID 
        });

        let infos: Array<{account: string, mint: string, balance: number}> = []
        accounts.value.forEach(({ pubkey, account }) => {
          const info = account.data.parsed.info;
          infos.push({account: pubkey.toBase58(), mint: info.mint, balance: info.tokenAmount.uiAmount})
        });

        let balanceInfo: {account: string, mint: string, balance: number} = {account: '', mint: '', balance: 0};
        infos.map(x => {
          if(x.mint === mint){
            balanceInfo = x
          }
        })

        return {status: true, data: balanceInfo, message: 'token blance retrived'}
      }catch(e){
        console.log((e as Error))
        return {status: false, data: null, message: 'error geting token balance'}
      }
  }


  async performSwap({fromToken, toToken, amount, slippage, payer, priorityFee}: PerformSwapOptions) {
    try {
      const keypair = Keypair.fromSecretKey(bs58.decode(this.privateKey));
      const solanaTracker = new SolanaTracker(
        keypair,
        this.rpcUrl,
        this.apiKey
      );

      const balance = await this.connection.getBalance(keypair.publicKey);
    
      // Get the rate information
      const rate = await solanaTracker.getRate(fromToken, toToken, amount, slippage);
    
      // Validate if the wallet has enough balance
      const balanceValidation = await this.validateSwapBalance(balance, rate);
    
      if (!balanceValidation.canProceed) {
        return {
          success: false,
          message: `Insufficient balance. Need ${balanceValidation.totalRequired} SOL but have ${balanceValidation.balanceInSol} SOL (${(balanceValidation.percentageCovered || 0).toFixed(2)}% covered)`,
          data: {
            txid: null,
            rateDetails: balanceValidation.details,
            swapResponse: null
          }
        };
      }

      if(balanceValidation.details?.priceImpact && balanceValidation.details.priceImpact > 1){
        return {
          success: false,
          message: "Price impact is too high",
          data: {
            txid: null,
            rateDetails: balanceValidation.details,
            swapResponse: null
          }
        }
      }
    
      // Proceed with the swap if balance is sufficient
      const swapResponse = await solanaTracker.getSwapInstructions(fromToken, toToken, amount, slippage, payer, priorityFee, false, {
        fee: {
            wallet: process.env.FEE_WALLET_ADDRESS!,
            percentage: 0.5  // 0.5% fee
          },
          feeType: "add"
      });
    
      const txid = await solanaTracker.performSwap(swapResponse, {
        sendOptions: { skipPreflight: true },
        confirmationRetries: 30,
        confirmationRetryTimeout: 500,
        lastValidBlockHeightBuffer: 150,
        resendInterval: 1000,
        confirmationCheckInterval: 1000,
        commitment: "processed",
        skipConfirmationCheck: true
      });

      // Wait for transaction to propagate to mempool before checking status
      //console.log(`Transaction ${txid} submitted, waiting for mempool propagation...`);
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check if transaction was successful
      const transactionSuccess = await this.checkTransactionSuccess(txid);
      
      if (!transactionSuccess.success) {
        return {
          success: false,
          message: `Transaction failed: ${transactionSuccess.error}`,
          data: {
            txid: txid,
            rateDetails: balanceValidation.details,
            swapResponse: null
          }
        };
      }

      // Get execution price from the confirmed transaction
      if(txid && balanceValidation.details){
        const executionPrice = swapResponse.rate.executionPrice;
        balanceValidation.details.executionPrice = executionPrice;
      }
    
      const swapResult = {
        txid: txid,
        swapResponse: swapResponse,
        rateDetails: balanceValidation.details
      };
    
      return {
        success: true,
        message: "Swap successful and confirmed",
        data: swapResult
      };
    } catch (error: any) {
      console.log("error", error.message)
      console.log("error", error.response.data)
      return {
        success: false,
        message: error.message,
        data: null
      }
    }
  }

  /**
   * Checks if a transaction was successful by verifying its confirmation status
   * @param txid The transaction ID to check
   * @returns An object indicating if the transaction was successful
   */
  async checkTransactionSuccess(txid: string): Promise<{success: boolean, error?: string}> {
    try {
      const maxRetries = 4;
      const retryInterval = 2000; // 2 seconds
      
      for (let i = 0; i < maxRetries; i++) {
        try {
          const transaction = await this.connection.getTransaction(txid, {
            maxSupportedTransactionVersion: 0,
            commitment: "confirmed"
          });

          if (transaction) {
            // Check if transaction succeeded (no error)
            if (transaction.meta?.err === null) {
              console.log(`Transaction ${txid} confirmed successfully`);
              return { success: true };
            } else {
              console.log(`Transaction ${txid} failed with error:`, transaction.meta?.err);
              return { 
                success: false, 
                error: `Transaction failed: ${JSON.stringify(transaction.meta?.err)}` 
              };
            }
          }

          // Transaction not found yet, wait and retry
          //TODO: handle transaction errors properly
          //console.log(`Transaction ${txid} not confirmed yet, retrying... (${i + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, retryInterval));
          
        } catch (innerError) {
          console.log(`Error checking transaction ${txid} on attempt ${i + 1}:`, (innerError as Error).message);
          if (i === maxRetries - 1) {
            throw innerError;
          }
          await new Promise(resolve => setTimeout(resolve, retryInterval));
        }
      }

      // If we've exhausted all retries
      return { 
        success: false, 
        error: `Transaction confirmation timeout after ${maxRetries} attempts` 
      };

    } catch (error) {
      console.error(`Error checking transaction success for ${txid}:`, error);
      return { 
        success: false, 
        error: `Failed to verify transaction: ${(error as Error).message}` 
      };
    }
  }

  /**
   * Validates if a wallet has sufficient balance to perform a swap
   * @param balance The wallet's current balance in lamports
   * @param rateResponse The response from solanaTracker.getRate()
   * @returns An object indicating if the balance is sufficient and any relevant details
   */
  async validateSwapBalance(balance: number, rateResponse: IRateResponse) {
    try {
      // Convert balance from lamports to SOL (1 SOL = 1e9 lamports)
      const balanceInSol = balance / 1e9;

      if(rateResponse.quoteCurrency.mint === "So11111111111111111111111111111111111111112"){
        return {
          canProceed: true,
          balanceInSol,
          totalRequired: rateResponse.amountIn,
          details: {
            priceImpact: 0,
            executionPrice: rateResponse.executionPrice,
            amountIn: rateResponse.amountIn,
            platformFee: rateResponse.platformFeeUI,
            baseCurrency: rateResponse.baseCurrency.mint,
            quoteCurrency: rateResponse.quoteCurrency.mint,
          }
        }
      }
      
      // Calculate total required amount including fees
      const totalRequired = rateResponse.amountIn + rateResponse.platformFeeUI;
      
      // Check if the wallet has enough balance
      const hasEnoughBalance = balanceInSol >= totalRequired;
      
      // Calculate how much more is needed if balance is insufficient
      const deficit = hasEnoughBalance ? 0 : totalRequired - balanceInSol;
      
      // Calculate the percentage of required amount that the wallet has
      const percentageCovered = hasEnoughBalance ? 100 : (balanceInSol / totalRequired) * 100;
      
      return {
        canProceed: hasEnoughBalance,
        balanceInSol,
        totalRequired,
        deficit,
        percentageCovered,
        details: {
          amountIn: rateResponse.amountIn,
          platformFee: rateResponse.platformFeeUI,
          baseCurrency: rateResponse.baseCurrency.mint,
          quoteCurrency: rateResponse.quoteCurrency.mint,
          priceImpact: rateResponse.priceImpact,
          executionPrice: rateResponse.executionPrice
        }
      };
    } catch (error) {
      console.error("Error validating swap balance:", error);
      return {
        canProceed: false,
        error: (error as Error).message || "Unknown error during balance validation",
        balanceInSol: balance / 1e9,
        totalRequired: 0,
        deficit: 0,
        percentageCovered: 0,
        details: null
      };
    }
  }

}
