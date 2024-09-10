import {
  ConnectionConfig,
  createTransactionSubmissionClient,
  WebSocketCloseHandler,
  WebSocketErrorHandler,
  createLedgerStateQueryClient,
} from '@cardano-ogmios/client'
import {config, parse} from 'dotenv'
import * as Joi from 'joi'
import {mnemonicToEntropy} from 'bip39'
import {
  BaseAddress,
  Bip32PrivateKey,
  NetworkInfo,
  Credential,
  LinearFee,
  BigNum,
  TransactionBuilderConfigBuilder,
  TransactionBuilder,
  TransactionInput,
  TransactionHash,
  Value,
  TransactionOutput,
  hash_transaction,
  TransactionWitnessSet,
  Vkeywitnesses,
  make_vkey_witness,
  Transaction,
} from '@emurgo/cardano-serialization-lib-nodejs'

import {
  createInteractionCtx,
  harden,
  parseStringToArray,
  replaceBigInt,
} from './utils'
import {getTxBuilder} from './transactions'
import {ADA_TO_LOVALACE} from './constants'

enum ENV_KEYS {
  OGMIOS_HOST = 'OGMIOS_HOST',
  OGMIOS_PORT = 'OGMIOS_PORT',
  MNEMONIC = 'MNEMONIC',
}

interface EnvData {
  host: string
  port?: number
  mnemonic: string[]
}

const envSchema = Joi.object<EnvData>({
  host: Joi.string().required(),
  port: Joi.number().allow(''),
  mnemonic: Joi.array().items(Joi.string().required()),
})

function loadEnv(): EnvData {
  config()

  const raw = {
    host: process.env[ENV_KEYS.OGMIOS_HOST],
    port: process.env[ENV_KEYS.OGMIOS_PORT],
    mnemonic: process.env[ENV_KEYS.MNEMONIC],
  }

  const parsed = {
    ...raw,
    mnemonic: raw.mnemonic ? parseStringToArray(raw.mnemonic) : [],
  }
  const {error, value} = envSchema.validate(parsed)

  if (!value || error) {
    console.error(`Env invalid! Reason: ${error?.message}`, error?.stack)
    throw error
  }

  return value
}

async function main(): Promise<void> {
  const env = loadEnv()
  const options: ConnectionConfig = {
    ...env,
  }
  const entropy = mnemonicToEntropy(env.mnemonic.join(' '))

  const rootKey = Bip32PrivateKey.from_bip39_entropy(
    Buffer.from(entropy, 'hex'),
    Buffer.from('')
  )

  const accountKey = rootKey
    .derive(harden(1852))
    .derive(harden(1815))
    .derive(harden(0))

  const utxoPubKey = accountKey
    .derive(0) // external
    .derive(0)
    .to_public()

  const stakeKey = accountKey
    .derive(2) // chimeric
    .derive(0)
    .to_public()

  const address = BaseAddress.new(
    NetworkInfo.testnet_preprod().network_id(),
    Credential.from_keyhash(utxoPubKey.to_raw_key().hash()),
    Credential.from_keyhash(stakeKey.to_raw_key().hash())
  ).to_address()

  const addressStr = address.to_bech32()

  console.log(`address: ${addressStr}`)

  const errorHandle: WebSocketErrorHandler = (error: Error) => {
    console.error(`Catch error! Reason: ${error.message}`, error.stack)
  }
  const closeHandler: WebSocketCloseHandler = (code, reason) => {
    console.log(`Connection is close! Status: ${code}, reason: ${reason}`)
  }

  const ctx = await createInteractionCtx(options, errorHandle, closeHandler)
  const ledgerClient = await createLedgerStateQueryClient(ctx)

  const parameters = await ledgerClient.protocolParameters()

  const txBuilder = getTxBuilder(parameters)

  const utxos = await ledgerClient.utxo({addresses: [addressStr]})

  const utxo = utxos.find(utxo => {
    const assets = Object.keys(utxo.value)

    return (
      assets.includes('ada') &&
      assets.length === 1 &&
      utxo.value.ada.lovelace > BigInt(ADA_TO_LOVALACE)
    )
  })

  if (!utxo) {
    throw new Error('Address should have at least 1 utxo with ada!')
  }

  console.log(`UTXO: ${JSON.stringify(utxo, replaceBigInt, 2)}`)

  const input = TransactionInput.new(
    TransactionHash.from_bytes(Buffer.from(utxo.transaction.id, 'hex')),
    utxo.index
  )

  txBuilder.add_key_input(
    accountKey.to_raw_key().to_public().hash(),
    input,
    Value.new(BigNum.from_str(utxo.value.ada.lovelace.toString()))
  )

  const output = TransactionOutput.new(
    address,
    Value.new(BigNum.from_str(ADA_TO_LOVALACE.toString()))
  )

  txBuilder.add_output(output)

  txBuilder.add_change_if_needed(address)

  const txBody = txBuilder.build()

  const txHash = hash_transaction(txBody)

  const witnesses = TransactionWitnessSet.new()

  const vkeyWitnesses = Vkeywitnesses.new()
  const vkeyWitness = make_vkey_witness(txHash, accountKey.to_raw_key())

  vkeyWitnesses.add(vkeyWitness)

  witnesses.set_vkeys(vkeyWitnesses)

  const transaction = Transaction.new(txBody, witnesses, undefined)

  const txClient = await createTransactionSubmissionClient(ctx)

  const txId = await txClient.submitTransaction(transaction.to_hex())

  console.log(`Transaction id: ${txId}`)
}

main()
