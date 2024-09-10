import {ProtocolParameters} from '@cardano-ogmios/schema'
import {
  LinearFee,
  BigNum,
  TransactionBuilderConfigBuilder,
  TransactionBuilder,
} from '@emurgo/cardano-serialization-lib-nodejs'

export function getTxBuilder(
  parameters: ProtocolParameters
): TransactionBuilder {
  const linearFee = LinearFee.new(
    BigNum.from_str(parameters.minFeeCoefficient.toString()),
    BigNum.from_str(parameters.minFeeConstant.ada.lovelace.toString())
  )

  const txBuilderCfg = TransactionBuilderConfigBuilder.new()
    .fee_algo(linearFee)
    .pool_deposit(
      BigNum.from_str(parameters.stakePoolDeposit.ada.lovelace.toString())
    )
    .key_deposit(
      BigNum.from_str(parameters.stakeCredentialDeposit.ada.lovelace.toString())
    )
    .max_value_size(parameters.maxValueSize?.bytes ?? 5000)
    .max_tx_size(parameters.maxTransactionSize?.bytes ?? 16384)
    .coins_per_utxo_byte(
      BigNum.from_str(parameters.minUtxoDepositCoefficient.toString())
    )
    .build()

  return TransactionBuilder.new(txBuilderCfg)
}
