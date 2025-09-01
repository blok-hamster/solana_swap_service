import amqp, { Connection, Channel, ConsumeMessage } from 'amqplib';
import {  tradeWorkerService } from '../queue/TradeWorker';
import { AgentLedgerTools } from '../utils/ledgerUtility';

export interface QueuedTradeParams {
    agentId: string;
    tradeType: 'buy' | 'sell';
    amount: number;
    privateKey: string;
    mint: string;
    priority?: 'high' | 'medium' | 'low';
    watchConfig?: {
      takeProfitPercentage?: number;
      stopLossPercentage?: number;
      enableTrailingStop?: boolean;
      trailingPercentage?: number;
      maxHoldTimeMinutes?: number;
    }
}

interface ITransactionDetails {
  trx: ITransaction,
  totalValueSOL: number,
  tokenAmount: number,
  pricePerToken: number
}

interface IOverallPnL {
  totalPnL: number,
  realizedPnL: number,
  unrealizedPnL: number,
  totalSOLSpent: number,
  totalSOLReceived: number,
  netSOLFlow: number
}

interface ITokenPnL {
  realizedPnL: number,
  unrealizedPnL: number,
  totalPnL: number,
  totalTokensBought: number,
  totalTokensSold: number,
  currentHoldings: number,
  averageBuyPrice: number,
  investedAmount: number,
  receivedAmount: number,
  investedInCurrentHoldings: number
}

interface ITransactionStats {
  totalTrades: number,
  totalBuyTrades: number,
  totalSellTrades: number,
  totalSOLTraded: number,
  totalSOLSpent: number,
  totalSOLReceived: number,
  uniqueTokensTraded: number,
  averageTradeSize: number,
  totalFeesPaid: number,
  firstTradeDate: Date | null,
  lastTradeDate: Date | null,
  tradingPeriodDays: number,
  winRate: number,
  pnlStats: IOverallPnL
}

interface ITransaction {
  id: string,
  agentId: string, 
  mint: string, 
  action: string,  
  amountIn    : number, 
  amountOut: number, 
  executionPrice: number, 
  status: string,
  transactionHash?: string,
  timestamp?: number,
  fees?: number,
  notes?: string
}

export interface RpcServerOptions {
  /** RabbitMQ connection URL, e.g. 'amqp://localhost' */
  url: string;
  /** The queue name to listen for RPC requests */
  queue: string;
  /** The channel prefetch count; defaults to 1 */
  prefetch?: number;
}

export class RpcServer {
  private connection: Connection | null = null;
  private channel: Channel | null = null;
  private readonly options: RpcServerOptions;
  private isClosing = false;
  static instance: RpcServer;
  isInitialized = false;
  ledgerUtility: AgentLedgerTools;

  constructor(options: RpcServerOptions) {
    this.options = options;
    this.ledgerUtility = new AgentLedgerTools();
    this.start();
  }

  static getInstance(options: RpcServerOptions): RpcServer {
    if(!RpcServer.instance || !RpcServer.instance.isInitialized) {
      RpcServer.instance = new RpcServer(options);
      RpcServer.instance.isInitialized = true;
    }
    return RpcServer.instance;
  }

  /**
   * Starts the RPC server by establishing a connection, creating a channel,
   * asserting the queue, and beginning consumption of messages.
   */
  public async start(): Promise<void> {
    try {
      this.connection = await amqp.connect(this.options.url) as unknown as Connection;
      this.setupConnectionHandlers();
      this.channel = await (this.connection as any).createChannel();
      await this.channel!.assertQueue(this.options.queue, { durable: false });
      const prefetchCount = this.options.prefetch ?? 1;
      this.channel!.prefetch(prefetchCount);
      console.log(` [x] Awaiting RPC requests on queue: ${this.options.queue}`);

      await this.channel!.consume(this.options.queue, async (msg) => {
        if (msg) {
          try {
            // Process the incoming message to fetch data from the server
            const responseData = await this.handleMessage(msg);
            this.channel!.sendToQueue(
              msg.properties.replyTo,
              Buffer.from(JSON.stringify(responseData)),
              { correlationId: msg.properties.correlationId }
            );
          } catch (err) {
            console.error('Error processing message:', err);
            // Optionally, respond with an error object
            this.channel!.sendToQueue(
              msg.properties.replyTo,
              Buffer.from(JSON.stringify({ error: 'Error processing request' })),
              { correlationId: msg.properties.correlationId }
            );
          } finally {
            this.channel!.ack(msg);
          }
        }
      });
    } catch (error) {
      console.error('Failed to start RPC server:', error);
      // If not shutting down, try to reconnect after a delay
      if (!this.isClosing) {
        setTimeout(() => this.start(), 1000);
      }
    }
  }

  /**
   * Processes the message received from the queue. This method is responsible for
   * retrieving data from the server. By default, it parses the incoming JSON payload
   * and passes it to getServerData. You can override this method in a subclass if needed.
   *
   * @param msg - The incoming RabbitMQ message
   * @returns The data to be sent back to the caller
   */
  protected async handleMessage(msg: ConsumeMessage): Promise<any> {
    const requestData = JSON.parse(msg.content.toString());
    console.log('Received request:', requestData);

    // Retrieve data from the server (replace with your actual logic)
    const serverData = await this.getServerData(requestData);
    return serverData;
  }

  /**
   * Simulates data retrieval from the server. Replace this method with your actual
   * data retrieval logic, such as database queries or API calls.
   *
   * @param requestData - Data received from the RPC request
   * @returns An object containing data from the server
   */
  private async getServerData(requestData: any): Promise<any> {
    //The requestData should include the method and its arguements.. 
    /**
     * exampleMethod2: {
     *  "method": "getAgentsByCategory",
     *  "args": {
     *    "category": "Smart_Contract"
     *  }
     * },
     * exampleMethod3: {
     *  "method": "getAgentsByIds",
     *  "args": {
     *    "ids": ["AG0001", "AG0002", "AG0003"]
     *  }
     * },
     * exampleMethod4: {
     *  "method": "allAgents",
     *  "args": {}
     * }
     */



    const {method, args} = requestData
    switch (method) {
        /**
         * export interface QueuedTradeParams {
            agentId: string;
            tradeType: 'buy' | 'sell';
            amount: number;
            privateKey: string;
            mint: string;
            priority?: 'high' | 'medium' | 'low';
            watchConfig?: {
                takeProfitPercentage?: number;
                stopLossPercentage?: number;
                enableTrailingStop?: boolean;
                trailingPercentage?: number;
                maxHoldTimeMinutes?: number;
            }
            }
         */
      case "performBatchTrades":
        return await tradeWorkerService.queueBatchTrades(args.trades as QueuedTradeParams[])
    case "getTxnByAgentId":
        const txnByAgent: ITransaction[] = await this.ledgerUtility.getTxnByAgentId({agentId: args.agentId})
        return txnByAgent
    case "getTxnByAgentIdAndMint":
        const txnByMintAndAgent: ITransaction[] = await this.ledgerUtility.getTxnByAgentIdAndMint({agentId: args.agentId, mint: args.mint})
        return txnByMintAndAgent
    case "calculateOverallPnL":
        const overallPnL: IOverallPnL = await this.ledgerUtility.calculateOverallPnL({agentId: args.agentId})
        return overallPnL
    case "calculateMintPnL":
        const mintPnL: ITokenPnL = await this.ledgerUtility.calculateMintPnL({agentId: args.agentId, mint: args.mint})
        return mintPnL
    case "getUserTransactionDetails":
        const userTransactionDetails: Array<ITransactionDetails> = await this.ledgerUtility.getUserTransactionDetails({agentId: args.agentId})
        return userTransactionDetails
    case "getUserTradingStats":
        const userTradingStats: ITransactionStats = await this.ledgerUtility.getUserTradingStats({agentId: args.agentId})
        return userTradingStats
    case "transferSOL":
        const transferSOL: {success: boolean, message: string, data: {transactionHash: string} | null} = await this.ledgerUtility.transferSOL({to: args.to, amount: args.amount, privateKey: args.privateKey})
        return transferSOL
    case "transferToken":
        const transferToken: {success: boolean, message: string, data: {transactionHash: string} | null} = await this.ledgerUtility.transferToken({to: args.to, amount: args.amount, privateKey: args.privateKey, mint: args.mint})
        return transferToken
      default:
        return {
          message: 'Invalid method',
          request: requestData,
          timestamp: new Date().toISOString(),
          data:null
        }
    }
  }

  /**
   * Gracefully shuts down the RPC server by closing the channel and connection.
   */
  public async stop(): Promise<void> {
    this.isClosing = true;
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await (this.connection as any).close();
      }
      console.log('RPC server stopped gracefully.');
    } catch (error) {
      console.error('Error during shutdown:', error);
    }
  }

  /**
   * Sets up error and close event handlers for the AMQP connection.
   */
  private setupConnectionHandlers(): void {
    if (!this.connection) return;

    this.connection.on('error', (err) => {
      console.error('AMQP connection error:', err);
    });

    this.connection.on('close', () => {
      console.warn('AMQP connection closed.');
      if (!this.isClosing) {
        console.error('Connection closed unexpectedly. Attempting to restart...');
        setTimeout(() => this.start(), 1000);
      }
    });
  }
}


export const rpcServer = RpcServer.getInstance({
  url: process.env.RABBITMQ_URL || 'amqp://localhost',
  queue: 'sol_swap_rpc_queue',
  prefetch: 1,
});
