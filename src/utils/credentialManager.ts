import * as crypto from 'crypto';
import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const DB_NAME = 'secure_env';
const SECRETS_COLLECTION = 'secrets';
const KEYS_COLLECTION = 'master_keys';

export class SecureEnvManager {
  private algorithm = 'aes-256-gcm';
  private db: any;
  private isConnected = false;
  private client: MongoClient;
  private static instance: SecureEnvManager
  isInitialized = false;

  
  private constructor(
    uri: string = process.env.MONGO_URL as string,
  ) {
    this.client = new MongoClient(uri);
  }

  /**
   * Gets or creates a singleton instance of SecureEnvManager
   * @param uri MongoDB connection URI
   * @param keyAgeLimitHours Key age limit in hours
   * @returns The SecureEnvManager instance
   */
  static getInstance(): SecureEnvManager {
    if (!SecureEnvManager.instance) {
      SecureEnvManager.instance = new SecureEnvManager(process.env.ENV_MONGO_URL!);
      SecureEnvManager.instance.isInitialized = true;
    }
    return this.instance;
  }

  async init() {
    if(this.isConnected === true){
      return;
    }
    await this.client.connect();
    this.db = this.client.db(DB_NAME);
    this.isConnected = true;
    console.log("Connected to MongoDB");
  }


  private async ensureConnected() {
    if (!this.isConnected) {
      await this.init();
    }
  }
  /**
   * Get a secret by key and userId, or get all secrets for a userId
   * @param userId The user ID to query for
   * @param key Optional specific key to retrieve
   * @param returnEncrypted Optional flag to return the data in encrypted form (default: false)
   * @param name Optional name to filter by when key is provided
   * @returns Either a decrypted value, an encrypted record, or arrays of either
   */
  async getSecret(
    userId?: string, 
    key?: string, 
    name?: string,
    id?: string,
    returnEncrypted?: boolean,
    internal?: boolean
  ): Promise<
    string | 
    { key: string, name: string, value: string }[] | 
    any | 
    { key: string, name: string, encryptedData: any }[]
  > {
    await this.ensureConnected();

    if(id){
      const record = await this.db.collection(SECRETS_COLLECTION).findOne({ _id: new ObjectId(id)});
      if (!record) {
        throw new Error(`Secret not found for id: ${id}`);
      }
      // Return encrypted data if requested
      if (returnEncrypted === true) {
        return {
          id: record._id,
          key: record.key,
          name: record.name || 'Unnamed Secret',
          userId: record.userId,
          secret: record.secret.encryptedData,
        };
      }

      // Otherwise decrypt and return the value
      const decryptedValue = await this.decryptSingleSecret(record);

      if(internal === true){
        return JSON.parse(decryptedValue)
      }

      return [{
        id: record._id,
        key: record.key,
        name: record.name || 'Unnamed Secret',
        value: JSON.parse(decryptedValue)
      }];
    }

    // If key is provided, get a specific secret
    if (key && userId) {
      // Build the filter based on required and optional parameters
      const filter: any = { userId, key };
      
      // Add name to filter if provided
      if (name) {
        filter.name = name;
      }
      
      const record = await this.db.collection(SECRETS_COLLECTION).findOne(filter);
      if (!record) {
        const errorMessage = name 
          ? `Secret not found for key: ${key}, name: ${name}, and userId: ${userId}`
          : `Secret not found for key: ${key} and userId: ${userId}`;
        throw new Error(errorMessage);
      }

      // Return encrypted data if requested
      if (returnEncrypted) {
        return {
          id: record._id,
          key: record.key,
          name: record.name || 'Unnamed Secret',
          userId: record.userId,
          secret: record.secret.encryptedData,
        };
      }

      // Otherwise decrypt and return the value
      const decryptedValue = await this.decryptSingleSecret(record);

      if(internal === true){
        return JSON.parse(decryptedValue)
      }
      
      return [{
        id: record._id,
        key: record.key,
        name: record.name || 'Unnamed Secret',
        value: JSON.parse(decryptedValue)
      }];
    } 


    // Otherwise, get all secrets for the user
    if (!key && !name && !id && userId) {
      const records = await this.db.collection(SECRETS_COLLECTION).find({ userId }).toArray();
      if (!records || records.length === 0) {
        return []; // Return empty array if no secrets found
      }

      // Return encrypted data if requested
      if (returnEncrypted) {
        return records.map((record: any) => ({
          id: record._id,
          key: record.key,
          name: record.name || 'Unnamed Secret',
          userId: record.userId,
          secret: record.secret.encryptedData,
        }));
      }

      // Otherwise decrypt all secrets and return with metadata
      const decryptedRecords = await this.decryptSecrets(records);    
      // Map the decrypted values to the records
      return records.map((record: any, index: number) => ({
        id: record._id,
        key: record.key,
        name: record.name || 'Unnamed Secret',
        value: JSON.parse(decryptedRecords[index] || '')
      }));
    }

    throw new Error("No valid parameters provided");
  }

  /**
   * Efficiently decrypt multiple secret records at once
   * @param records Array of secret records from the database
   * @returns Array of decrypted secret values
   */
  private async decryptSecrets(records: any[]): Promise<string[]> {
    if (records.length === 0) {
      return [];
    }

    // Extract unique master key IDs to fetch
    const masterKeyIds = [...new Set(records.map(record => record.masterKeyId))];
    
    // Fetch all needed master keys in a single query
    const masterKeyDocs = await this.db.collection(KEYS_COLLECTION)
      .find({ version: { $in: masterKeyIds } })
      .toArray();
    
    // Create a map of master key IDs to their keys for quick lookup
    const masterKeyMap = new Map(
      masterKeyDocs.map((doc: any) => [
        doc.version, 
        Buffer.from(doc.key, 'base64')
      ])
    );
    
    // Process all records
    return Promise.all(records.map(record => {
      // Get the master key for this record
      const masterKey = masterKeyMap.get(record.masterKeyId);
      if (!masterKey) throw new Error(`Master key ${record.masterKeyId} not found.`);
      
      // Decrypt the data encryption key (DEK)
      const dekIv = Buffer.from(record.dek.iv, 'base64');
      const dekAuthTag = Buffer.from(record.dek.authTag, 'base64');
      const encryptedDek = Buffer.from(record.dek.encryptedData, 'base64');
      const dekDecipher = crypto.createDecipheriv(this.algorithm, masterKey as crypto.CipherKey, dekIv);
      (dekDecipher as crypto.DecipherGCM).setAuthTag(dekAuthTag);
      const dek = Buffer.concat([dekDecipher.update(encryptedDek), dekDecipher.final()]);
      
      // Decrypt the secret
      const secretIv = Buffer.from(record.secret.iv, 'base64');
      const secretAuthTag = Buffer.from(record.secret.authTag, 'base64');
      const encryptedSecret = Buffer.from(record.secret.encryptedData, 'base64');
      const decipher = crypto.createDecipheriv(this.algorithm, dek, secretIv);
      (decipher as any).setAuthTag(secretAuthTag);
      const secret = Buffer.concat([decipher.update(encryptedSecret), decipher.final()]).toString('utf8');
      return secret;
    }));
  }

  /**
   * Helper method to decrypt a single secret record
   * @param record The secret record from the database
   * @returns The decrypted secret value
   */
  private async decryptSingleSecret(record: any): Promise<string> {
    const masterKeyDoc = await this.db.collection(KEYS_COLLECTION).findOne({ version: record.masterKeyId });
    if (!masterKeyDoc) throw new Error(`Master key ${record.masterKeyId} not found.`);
    const masterKey = Buffer.from(masterKeyDoc.key, 'base64');

    const dekIv = Buffer.from(record.dek.iv, 'base64');
    const dekAuthTag = Buffer.from(record.dek.authTag, 'base64');
    const encryptedDek = Buffer.from(record.dek.encryptedData, 'base64');
    const dekDecipher = crypto.createDecipheriv(this.algorithm, masterKey, dekIv);
    (dekDecipher as any).setAuthTag(dekAuthTag);
    const dek = Buffer.concat([dekDecipher.update(encryptedDek), dekDecipher.final()]);

    const secretIv = Buffer.from(record.secret.iv, 'base64');
    const secretAuthTag = Buffer.from(record.secret.authTag, 'base64');
    const encryptedSecret = Buffer.from(record.secret.encryptedData, 'base64');
    const decipher = crypto.createDecipheriv(this.algorithm, dek, secretIv);
    (decipher as any).setAuthTag(secretAuthTag);
    const secret = Buffer.concat([decipher.update(encryptedSecret), decipher.final()]).toString('utf8');
    return secret;
  }
}







